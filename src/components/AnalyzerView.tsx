import React, { useMemo, useRef, useState } from "react";
import {
  Check,
  Code2,
  FileUp,
  Loader2,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import {
  AnalysisResult,
  CATEGORY_META,
  CATEGORY_ORDER,
  DEMO_PRESETS,
  RequestLogRecord,
  ToxicityCategory,
} from "../types/toxicity";
import { createRequestLog, submitLogVerdict } from "../lib/firestoreRepo";
import { NerVisualizer } from "./NerVisualizer";

interface AnalyzerViewProps {
  onErrorNotice: (msg: string) => void;
}

export const AnalyzerView: React.FC<AnalyzerViewProps> = ({ onErrorNotice }) => {
  const [inputText, setInputText] = useState<string>(DEMO_PRESETS[0].text);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [currentLog, setCurrentLog] = useState<RequestLogRecord | null>(null);
  const [isSavingVerdict, setIsSavingVerdict] = useState(false);
  const [selectedSpanIdx, setSelectedSpanIdx] = useState<number | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<ToxicityCategory>>(
    () => new Set(CATEGORY_ORDER)
  );
  const [showJson, setShowJson] = useState(false);
  const [jsonlQueue, setJsonlQueue] = useState<Array<{ id: number; text: string }>>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categoryCounts = useMemo(() => {
    const counts: Record<ToxicityCategory, number> = {
      profanity: 0,
      insult: 0,
      derogation_mockery: 0,
      threat_violence: 0,
      hate_speech: 0,
    };
    if (!currentResult) return counts;
    for (const ent of currentResult.entities) {
      if (ent.category in counts) {
        counts[ent.category] += 1;
      }
    }
    return counts;
  }, [currentResult]);

  const toggleCategory = (cat: ToxicityCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const runAnalysis = async (textOverride?: string) => {
    const text = (textOverride ?? inputText).trim();
    if (!text) {
      setErrorMessage("Введите или загрузите текст комментария для анализа.");
      return;
    }

    setErrorMessage(null);
    setIsAnalyzing(true);
    setSelectedSpanIdx(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, includeConfidence: true }),
      });

      const payload = (await response.json()) as AnalysisResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Ошибка сервера при анализе текста.");
      }

      setCurrentResult(payload);
      setActiveCategories(new Set(CATEGORY_ORDER));

      try {
        const logId = await createRequestLog(payload);
        setCurrentLog({
          id: logId,
          text: payload.text,
          entities: payload.entities,
          engine: payload.engine,
          modelVersion: payload.modelVersion,
          latencyMs: payload.latencyMs,
          feedbackStatus: "pending",
          createdAtMs: Date.now(),
        });
      } catch (dbErr) {
        const msg =
          dbErr instanceof Error ? dbErr.message : "Ошибка записи лога в Firestore.";
        onErrorNotice(msg);
        setCurrentLog(null);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Не удалось выполнить запрос."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleVerdict = async (verdict: "confirmed" | "rejected") => {
    if (!currentLog || currentLog.feedbackStatus !== "pending" || isSavingVerdict) {
      return;
    }
    setIsSavingVerdict(true);
    try {
      await submitLogVerdict(currentLog, verdict);
      setCurrentLog({ ...currentLog, feedbackStatus: verdict });
    } catch (err) {
      onErrorNotice(
        err instanceof Error ? err.message : "Не удалось сохранить оценку в базу."
      );
    } finally {
      setIsSavingVerdict(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const raw = await file.text();
      const trimmed = raw.trim();
      if (!trimmed) {
        setErrorMessage("Загруженный файл пуст.");
        return;
      }

      if (file.name.toLowerCase().endsWith(".jsonl")) {
        const parsedSamples: Array<{ id: number; text: string }> = [];
        const lines = trimmed.split(/\r?\n/);
        for (let i = 0; i < lines.length && parsedSamples.length < 25; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as { id?: number; text?: string };
            if (typeof obj.text === "string" && obj.text.trim()) {
              parsedSamples.push({
                id: typeof obj.id === "number" ? obj.id : i,
                text: obj.text.trim(),
              });
            }
          } catch {
            // Skip malformed JSONL line
          }
        }
        if (parsedSamples.length === 0) {
          setErrorMessage("В JSONL-файле не найдено строк с полем text.");
          return;
        }
        setJsonlQueue(parsedSamples);
        setInputText(parsedSamples[0].text.slice(0, 4000));
        setErrorMessage(null);
        return;
      }

      setJsonlQueue([]);
      setInputText(trimmed.slice(0, 4000));
      setErrorMessage(null);
    } catch {
      setErrorMessage("Не удалось прочитать выбранный файл.");
    }
  };

  const selectedEntity =
    currentResult &&
    selectedSpanIdx !== null &&
    currentResult.entities[selectedSpanIdx]
      ? currentResult.entities[selectedSpanIdx]
      : null;

  return (
    <div className="space-y-8">
      {/* Input Workbench */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Анализатор токсичных языковых паттернов
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Введите комментарий или загрузите файл (`.txt`, `.jsonl`) для NER-разметки спанов по 5 категориям.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.jsonl,text/plain,application/json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" />
              Загрузить файл
            </button>
            <button
              type="button"
              onClick={() => {
                setInputText("");
                setCurrentResult(null);
                setCurrentLog(null);
                setErrorMessage(null);
                setJsonlQueue([]);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Очистить
            </button>
          </div>
        </div>

        {/* Preset & Uploaded JSONL sample switcher */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-medium text-slate-500 mr-1">
            Примеры:
          </span>
          {DEMO_PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              onClick={() => {
                setInputText(preset.text);
                setErrorMessage(null);
              }}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inputText === preset.text
                  ? "bg-blue-50 border-blue-200 text-blue-800 font-medium"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {preset.title}
            </button>
          ))}
        </div>

        {jsonlQueue.length > 1 && (
          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              Семплы из файла ({jsonlQueue.length}):
            </span>
            {jsonlQueue.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setInputText(item.text.slice(0, 4000))}
                className={`px-2.5 py-1 text-xs font-mono rounded border whitespace-nowrap shrink-0 cursor-pointer ${
                  inputText === item.text
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                #{item.id}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Вставьте комментарий на русском языке для поиска токсичных фрагментов..."
          className="w-full rounded-lg border border-slate-300 bg-slate-50/50 px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 transition-all"
        />

        <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {inputText.length} / 4000 символов
          </div>

          <button
            type="button"
            disabled={isAnalyzing || !inputText.trim()}
            onClick={() => runAnalysis()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Анализируем текст...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Анализировать текст
              </>
            )}
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMessage}
          </div>
        )}
      </section>

      {/* NER Visualization & Feedback Result */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">
              Результат NER-разметки
            </h2>
            {currentResult && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span aria-hidden="true">·</span>
                <span>
                  Движок:{" "}
                  <strong className="font-medium text-slate-700">
                    {currentResult.engine === "fastapi"
                      ? "Python FastAPI (RuBERT)"
                      : "Демо-резерв (Gemini)"}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {currentResult.latencyMs} мс
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  спанов: {currentResult.entities.length}
                </span>
              </div>
            )}
          </div>

          {currentResult && (
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              {showJson ? "Скрыть JSON" : "Показать JSON"}
            </button>
          )}
        </div>

        {/* Category Filter Legend */}
        <div className="flex flex-wrap items-center gap-2 py-4 border-b border-slate-100">
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const isActive = activeCategories.has(cat);
            const count = categoryCounts[cat];

            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                title={meta.description}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? `${meta.bgClass} ${meta.borderClass} ${meta.textClass}`
                    : "bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{
                    backgroundColor: isActive ? meta.swatchHex : "#CBD5E1",
                  }}
                />
                <span>{meta.labelRu}</span>
                <span className="font-mono tabular-nums opacity-75">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Highlight Canvas */}
        <div className="py-6 min-h-[140px]">
          {isAnalyzing ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-5 bg-slate-100 rounded w-3/4" />
              <div className="h-5 bg-slate-100 rounded w-1/2" />
            </div>
          ) : currentResult ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-5">
                <NerVisualizer
                  text={currentResult.text}
                  entities={currentResult.entities}
                  activeCategories={activeCategories}
                  selectedIndex={selectedSpanIdx}
                  onSelectEntity={setSelectedSpanIdx}
                />
              </div>

              {currentResult.entities.length === 0 ? (
                <p className="text-sm text-slate-600">
                  Токсичных языковых паттернов не обнаружено. Комментарий классифицирован как нейтральный.
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedEntity && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-sm">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-slate-900">
                          «{selectedEntity.span}»
                        </span>
                        <span className="text-slate-400" aria-hidden="true">
                          /
                        </span>
                        <span className="text-slate-700">
                          {CATEGORY_META[selectedEntity.category].labelRu} (
                          <code className="font-mono text-xs">
                            {selectedEntity.category}
                          </code>
                          )
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-600">
                        <span>
                          смещение: [{selectedEntity.start}:{selectedEntity.end}]
                        </span>
                        {typeof selectedEntity.confidence === "number" && (
                          <span>
                            уверенность: {(selectedEntity.confidence * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Compact spans summary list */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-medium">
                          <th className="py-2 pr-4">Фрагмент (span)</th>
                          <th className="py-2 px-4">Категория</th>
                          <th className="py-2 px-4 text-right">Индексы</th>
                          <th className="py-2 pl-4 text-right">Уверенность</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {currentResult.entities.map((ent, idx) => {
                          const meta = CATEGORY_META[ent.category];
                          const isSelected = selectedSpanIdx === idx;
                          return (
                            <tr
                              key={`${ent.start}-${ent.end}-${idx}`}
                              onClick={() =>
                                setSelectedSpanIdx(isSelected ? null : idx)
                              }
                              className={`cursor-pointer transition-colors ${
                                isSelected
                                  ? "bg-blue-50/70"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <td className="py-2.5 pr-4 font-medium text-slate-900">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded border-b ${meta.bgClass} ${meta.borderClass} ${meta.textClass}`}
                                >
                                  {ent.span}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-slate-700">
                                {meta.labelRu}{" "}
                                <span className="font-mono text-slate-400">
                                  ({ent.category})
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                                [{ent.start}:{ent.end}]
                              </td>
                              <td className="py-2.5 pl-4 text-right font-mono tabular-nums text-slate-700">
                                {typeof ent.confidence === "number"
                                  ? `${(ent.confidence * 100).toFixed(1)}%`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {showJson && (
                <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-4 overflow-x-auto">
                  <pre className="text-xs font-mono leading-relaxed">
                    {JSON.stringify(
                      {
                        id: currentResult.id,
                        text: currentResult.text,
                        entities: currentResult.entities,
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-slate-500">
              Нажмите <strong className="text-slate-700">«Анализировать текст»</strong>, чтобы увидеть подсветку токсичных спанов и сохранить лог в базу данных.
            </div>
          )}
        </div>

        {/* Feedback / Active Learning Footer */}
        {currentResult && (
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-slate-600">
              {currentLog?.feedbackStatus === "confirmed" ? (
                <span className="font-medium text-emerald-700">
                  Разметка подтверждена и сохранена в датасет для дообучения.
                </span>
              ) : currentLog?.feedbackStatus === "rejected" ? (
                <span className="font-medium text-rose-700">
                  Разметка отмечена как ошибочная и зафиксирована в базе.
                </span>
              ) : (
                <span>
                  Оцените точность предсказания модели — запись попадёт в датасет для дообучения:
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={
                  !currentLog ||
                  currentLog.feedbackStatus !== "pending" ||
                  isSavingVerdict
                }
                onClick={() => handleVerdict("confirmed")}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  currentLog?.feedbackStatus === "confirmed"
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                Подтвердить разметку
              </button>

              <button
                type="button"
                disabled={
                  !currentLog ||
                  currentLog.feedbackStatus !== "pending" ||
                  isSavingVerdict
                }
                onClick={() => handleVerdict("rejected")}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  currentLog?.feedbackStatus === "rejected"
                    ? "bg-rose-600 text-white border-rose-600"
                    : "bg-white text-rose-700 border-rose-300 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                }`}
              >
                <X className="w-3.5 h-3.5" />
                Отклонить
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
