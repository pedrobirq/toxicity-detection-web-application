import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_CATEGORIES = [
  "profanity",
  "insult",
  "derogation_mockery",
  "threat_violence",
  "hate_speech",
] as const;

type ToxicityCategory = (typeof TARGET_CATEGORIES)[number];

interface ToxicEntity {
  span: string;
  start: number;
  end: number;
  category: ToxicityCategory;
  confidence?: number;
}

const CATEGORY_SET = new Set<string>(TARGET_CATEGORIES);

const GEMINI_SYSTEM_PROMPT = `Ты — точный NLP-анализатор токсичных языковых паттернов на русском языке (аналог обученной модели RuBERT BIO-tagger).

Найди в тексте все токсичные фрагменты (спаны) и отнеси каждый строго к одной из 5 категорий:
1. profanity — ненормативная лексика, мат, бранные слова и ругательства общего характера, не направленные прямо на конкретную личность.
2. insult — прямые оскорбления личности, унижение характера, внешности или интеллекта.
3. derogation_mockery — уничижительные ярлыки, саркастические выражения, язвительное коверкание слов и насмешки.
4. threat_violence — угрозы физической расправой, причинением вреда или пожелания смерти.
5. hate_speech — язык вражды, ксенофобия, расизм или дискриминация по признаку расы, национальности, гендера и др.

Правила:
- Выделяй точную подстроку из исходного текста с сохранением регистра.
- Не включай внешнюю пунктуацию, если она не является частью токсичного выражения.
- Не придумывай фрагменты, которых нет в исходном тексте.
- Если токсичности нет, верни пустой массив spans: [].
- Указывай уверенность confidence от 0.50 до 0.99.`;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alignSpans(
  text: string,
  rawSpans: Array<{ span?: string; category?: string; confidence?: number }>
): ToxicEntity[] {
  const entities: ToxicEntity[] = [];
  const usedRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const item of rawSpans) {
    const span = typeof item.span === "string" ? item.span.trim() : "";
    const category = typeof item.category === "string" ? item.category.trim() : "";
    if (!span || !CATEGORY_SET.has(category)) {
      continue;
    }

    const escaped = escapeRegExp(span);
    let chosen: { start: number; end: number } | null = null;

    for (const flags of ["g", "gi"]) {
      const regex = new RegExp(escaped, flags);
      const matches: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        const overlaps = usedRanges.some(
          (r) => Math.max(start, r.start) < Math.min(end, r.end)
        );
        if (!overlaps) {
          matches.push({ start, end });
        }
        if (m[0].length === 0) break;
      }

      if (matches.length === 0) continue;

      const afterCursor = matches.filter((mItem) => mItem.start >= cursor);
      chosen = (afterCursor.length > 0 ? afterCursor : matches)[0];
      break;
    }

    if (!chosen) continue;

    usedRanges.push(chosen);
    const rawConf =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.min(0.99, Math.max(0.5, item.confidence))
        : 0.88;

    entities.push({
      span: text.slice(chosen.start, chosen.end),
      start: chosen.start,
      end: chosen.end,
      category: category as ToxicityCategory,
      confidence: Number(rawConf.toFixed(4)),
    });

    cursor = Math.max(cursor, chosen.end);
  }

  entities.sort((a, b) => a.start - b.start || a.end - b.end);
  return entities;
}

function normalizeRemoteEntities(text: string, rawEntities: unknown): ToxicEntity[] {
  if (!Array.isArray(rawEntities)) return [];
  const normalized: ToxicEntity[] = [];
  for (const item of rawEntities) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const start = Number(record.start);
    const end = Number(record.end);
    const category = typeof record.category === "string" ? record.category : "";
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > text.length ||
      !CATEGORY_SET.has(category)
    ) {
      continue;
    }
    const entity: ToxicEntity = {
      span: text.slice(start, end),
      start,
      end,
      category: category as ToxicityCategory,
    };
    if (typeof record.confidence === "number" && Number.isFinite(record.confidence)) {
      entity.confidence = Number(record.confidence.toFixed(4));
    }
    normalized.push(entity);
  }
  normalized.sort((a, b) => a.start - b.start || a.end - b.end);
  return normalized;
}

async function analyzeWithFastApi(
  text: string,
  includeConfidence: boolean
): Promise<{
  entities: ToxicEntity[];
  modelVersion: string;
} | null> {
  const baseUrl = (process.env.MODEL_API_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) return null;

  const isLocal =
    baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
  const controller = new AbortController();
  const timeoutMs = isLocal ? 3000 : 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.MODEL_API_SECRET) {
      headers["Authorization"] = `Bearer ${process.env.MODEL_API_SECRET}`;
    }

    const res = await fetch(`${baseUrl}/predict`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        include_confidence: includeConfidence,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[FastAPI] HTTP ${res.status} from ${baseUrl}/predict`);
      return null;
    }

    const data = (await res.json()) as {
      entities?: unknown;
      model_version?: string;
    };
    return {
      entities: normalizeRemoteEntities(text, data.entities),
      modelVersion:
        typeof data.model_version === "string" && data.model_version.trim()
          ? data.model_version.trim()
          : "rubert-toxic-detector-v1",
    };
  } catch (err) {
    console.info(
      `[FastAPI] Unavailable at ${baseUrl}, falling back to Gemini demo:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeWithGeminiFallback(
  text: string,
  includeConfidence: boolean
): Promise<{
  entities: ToxicEntity[];
  modelVersion: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "Ни Python FastAPI-сервер (MODEL_API_URL), ни GEMINI_API_KEY не настроены для выполнения инференса."
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const response = await ai.models.generateContent({
    model: "gemini-4-hydrogen",
    contents: `Проанализируй следующий русскоязычный комментарий и найди все токсичные спаны:\n\n${text}`,
    config: {
      systemInstruction: GEMINI_SYSTEM_PROMPT,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          spans: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                span: {
                  type: Type.STRING,
                  description: "Точная подстрока из исходного текста",
                },
                category: {
                  type: Type.STRING,
                  description:
                    "Одна из категорий: profanity, insult, derogation_mockery, threat_violence, hate_speech",
                },
                confidence: {
                  type: Type.NUMBER,
                  description: "Уверенность от 0.5 до 0.99",
                },
              },
              required: ["span", "category"],
            },
          },
        },
        required: ["spans"],
      },
    },
  });

  const rawText = (response.text ?? '{"spans": []}').trim();
  const parsed = JSON.parse(rawText) as {
    spans?: Array<{ span?: string; category?: string; confidence?: number }>;
  };

  let entities = alignSpans(text, parsed.spans ?? []);
  if (!includeConfidence) {
    entities = entities.map(({ confidence: _c, ...rest }) => rest);
  }

  return {
    entities,
    modelVersion: "gemini-4-hydrogen-demo",
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Health check for Python FastAPI bridge & fallback availability
  app.get("/api/health", async (_req, res) => {
    const baseUrl = (process.env.MODEL_API_URL || "").trim().replace(/\/+$/, "");
    let modelApiOnline = false;
    let fastApiInfo: Record<string, unknown> | null = null;

    if (baseUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const healthRes = await fetch(`${baseUrl}/health`, {
          signal: controller.signal,
        });
        if (healthRes.ok) {
          modelApiOnline = true;
          fastApiInfo = (await healthRes.json()) as Record<string, unknown>;
        }
      } catch {
        modelApiOnline = false;
      } finally {
        clearTimeout(timer);
      }
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiConfigured = Boolean(geminiKey && geminiKey !== "MY_GEMINI_API_KEY");

    res.json({
      ok: true,
      modelApiConfigured: Boolean(baseUrl),
      modelApiUrl: baseUrl || null,
      modelApiOnline,
      fastApiInfo,
      geminiConfigured,
    });
  });

  // Main NER inference endpoint
  app.post("/api/analyze", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body as { text?: unknown; includeConfidence?: unknown };
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const includeConfidence = body?.includeConfidence !== false;

    if (!text) {
      return res.status(400).json({ error: "Введите текст комментария для анализа." });
    }
    if (text.length > 4000) {
      return res.status(400).json({
        error: "Длина текста превышает лимит MVP (максимум 4000 символов).",
      });
    }

    try {
      const fastApiResult = await analyzeWithFastApi(text, includeConfidence);
      if (fastApiResult) {
        const latencyMs = Math.max(1, Date.now() - startedAt);
        return res.json({
          id: 0,
          text,
          entities: fastApiResult.entities,
          engine: "fastapi",
          modelVersion: fastApiResult.modelVersion,
          latencyMs,
        });
      }

      const fallbackResult = await analyzeWithGeminiFallback(text, includeConfidence);
      const latencyMs = Math.max(1, Date.now() - startedAt);
      return res.json({
        id: 0,
        text,
        entities: fallbackResult.entities,
        engine: "gemini-fallback",
        modelVersion: fallbackResult.modelVersion,
        latencyMs,
      });
    } catch (error) {
      console.error("[/api/analyze] Inference error:", error);
      return res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Не удалось выполнить анализ текста. Проверьте подключение модели.",
      });
    }
  });

  // Serve Vite in dev or static dist in production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`[ToxicSpan Lab] Сервер запущен: http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
