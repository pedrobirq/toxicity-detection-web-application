import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import {
  AnalysisResult,
  LabeledSampleRecord,
  ModelVersionRecord,
  RequestLogRecord,
  ToxicEntity,
  ToxicityCategory,
} from "../types/toxicity";

const MODELS_COLLECTION = "models";
const LOGS_COLLECTION = "request_logs";
const SAMPLES_COLLECTION = "labeled_samples";

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (value && typeof value === "object" && "seconds" in value) {
    return Number((value as { seconds: number }).seconds) * 1000;
  }
  return Date.now();
}

function sanitizeEntitiesForFirestore(
  entities: ToxicEntity[],
  includeConfidence: boolean
): Array<Record<string, unknown>> {
  return entities.slice(0, 64).map((e) => {
    const base: Record<string, unknown> = {
      span: e.span.slice(0, 500),
      start: Math.trunc(e.start),
      end: Math.trunc(e.end),
      category: e.category,
    };
    if (includeConfidence && typeof e.confidence === "number") {
      base.confidence = Number(e.confidence.toFixed(4));
    }
    return base;
  });
}

export async function seedDefaultModelIfEmpty(): Promise<void> {
  try {
    const snap = await getDocs(query(collection(db, MODELS_COLLECTION), limit(1)));
    if (!snap.empty) return;

    const defaultId = "rubert-toxic-detector-v1";
    await setDoc(doc(db, MODELS_COLLECTION, defaultId), {
      name: "RuBertToxicDetector",
      version: "v1.0.0",
      baseModel: "DeepPavlov/rubert-base-cased",
      epoch: 5,
      valMacroF1: 0.784,
      valMicroF1: 0.861,
      perClassF1: {
        profanity: 0.912,
        insult: 0.847,
        derogation_mockery: 0.695,
        threat_violence: 0.768,
        hate_speech: 0.698,
      },
      weightsUri: "models/rubert_toxic_detector/best_model.pt",
      datasetName: "cleaned_deduplicated_dataset.jsonl (6939 примеров)",
      notes:
        "Взвешенная агрегация последних 4 слоёв RuBERT + Multi-Sample Dropout (5 веток) + сглаженные веса классов (power=0.35). Значения F1 можно обновить при регистрации нового чекпоинта.",
      isActive: true,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, MODELS_COLLECTION);
  }
}

export async function createRequestLog(
  result: AnalysisResult
): Promise<string> {
  const logId = crypto.randomUUID();
  const path = `${LOGS_COLLECTION}/${logId}`;
  try {
    await setDoc(doc(db, LOGS_COLLECTION, logId), {
      text: result.text.slice(0, 4000),
      entities: sanitizeEntitiesForFirestore(result.entities, true),
      engine: result.engine,
      modelVersion: result.modelVersion.slice(0, 80),
      latencyMs: Math.max(0, Math.min(300000, Math.trunc(result.latencyMs))),
      feedbackStatus: "pending",
      createdAt: serverTimestamp(),
    });
    return logId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function submitLogVerdict(
  log: RequestLogRecord,
  verdict: "confirmed" | "rejected"
): Promise<void> {
  const logPath = `${LOGS_COLLECTION}/${log.id}`;
  try {
    await updateDoc(doc(db, LOGS_COLLECTION, log.id), {
      feedbackStatus: verdict,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, logPath);
  }

  const sampleId = crypto.randomUUID();
  const samplePath = `${SAMPLES_COLLECTION}/${sampleId}`;
  try {
    await setDoc(doc(db, SAMPLES_COLLECTION, sampleId), {
      text: log.text.slice(0, 4000),
      entities: sanitizeEntitiesForFirestore(log.entities, false),
      verdict,
      sourceLogId: log.id,
      modelVersion: log.modelVersion.slice(0, 80),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, samplePath);
  }
}

export async function registerModelVersion(input: {
  name: string;
  version: string;
  baseModel: string;
  epoch: number;
  valMacroF1: number;
  valMicroF1: number;
  perClassF1: Record<ToxicityCategory, number>;
  weightsUri: string;
  datasetName: string;
  notes?: string;
}): Promise<string> {
  const modelId = crypto.randomUUID();
  const path = `${MODELS_COLLECTION}/${modelId}`;
  try {
    const payload: Record<string, unknown> = {
      name: input.name.trim().slice(0, 120),
      version: input.version.trim().slice(0, 40),
      baseModel: input.baseModel.trim().slice(0, 120),
      epoch: Math.max(1, Math.trunc(input.epoch)),
      valMacroF1: Number(Math.min(1, Math.max(0, input.valMacroF1)).toFixed(4)),
      valMicroF1: Number(Math.min(1, Math.max(0, input.valMicroF1)).toFixed(4)),
      perClassF1: input.perClassF1,
      weightsUri: input.weightsUri.trim().slice(0, 500),
      datasetName: input.datasetName.trim().slice(0, 160),
      isActive: true,
      createdAt: serverTimestamp(),
    };
    if (input.notes && input.notes.trim()) {
      payload.notes = input.notes.trim().slice(0, 1000);
    }
    await setDoc(doc(db, MODELS_COLLECTION, modelId), payload);
    return modelId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function setActiveModelVersion(
  targetId: string,
  allModels: ModelVersionRecord[]
): Promise<void> {
  try {
    await Promise.all(
      allModels.map((m) =>
        updateDoc(doc(db, MODELS_COLLECTION, m.id), {
          isActive: m.id === targetId,
        })
      )
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${MODELS_COLLECTION}/${targetId}`);
  }
}

export function subscribeModels(
  onData: (models: ModelVersionRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const q = query(
    collection(db, MODELS_COLLECTION),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ModelVersionRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name ?? "RuBertToxicDetector"),
          version: String(data.version ?? "v1.0.0"),
          baseModel: String(data.baseModel ?? "DeepPavlov/rubert-base-cased"),
          epoch: Number(data.epoch ?? 1),
          valMacroF1: Number(data.valMacroF1 ?? 0),
          valMicroF1: Number(data.valMicroF1 ?? 0),
          perClassF1: (data.perClassF1 ?? {}) as Record<ToxicityCategory, number>,
          weightsUri: String(data.weightsUri ?? ""),
          datasetName: String(data.datasetName ?? ""),
          notes: typeof data.notes === "string" ? data.notes : undefined,
          isActive: Boolean(data.isActive),
          createdAtMs: toMillis(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, MODELS_COLLECTION);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeRequestLogs(
  onData: (logs: RequestLogRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const q = query(
    collection(db, LOGS_COLLECTION),
    orderBy("createdAt", "desc"),
    limit(150)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: RequestLogRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          text: String(data.text ?? ""),
          entities: Array.isArray(data.entities) ? (data.entities as ToxicEntity[]) : [],
          engine: data.engine === "fastapi" ? "fastapi" : "gemini-fallback",
          modelVersion: String(data.modelVersion ?? ""),
          latencyMs: Number(data.latencyMs ?? 0),
          feedbackStatus:
            data.feedbackStatus === "confirmed" || data.feedbackStatus === "rejected"
              ? data.feedbackStatus
              : "pending",
          createdAtMs: toMillis(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, LOGS_COLLECTION);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeLabeledSamples(
  onData: (samples: LabeledSampleRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const q = query(
    collection(db, SAMPLES_COLLECTION),
    orderBy("createdAt", "desc"),
    limit(200)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LabeledSampleRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          text: String(data.text ?? ""),
          entities: Array.isArray(data.entities) ? (data.entities as ToxicEntity[]) : [],
          verdict: data.verdict === "rejected" ? "rejected" : "confirmed",
          sourceLogId: String(data.sourceLogId ?? ""),
          modelVersion: String(data.modelVersion ?? ""),
          createdAtMs: toMillis(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, SAMPLES_COLLECTION);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function buildJsonlExport(
  samples: Array<{ text: string; entities: ToxicEntity[] }>
): string {
  return samples
    .map((sample, idx) =>
      JSON.stringify({
        id: idx,
        text: sample.text,
        entities: sample.entities.map((e) => ({
          span: e.span,
          start: e.start,
          end: e.end,
          category: e.category,
        })),
      })
    )
    .join("\n");
}

export function downloadJsonlFile(
  samples: Array<{ text: string; entities: ToxicEntity[] }>,
  filename = "user_labeled_dataset.jsonl"
): void {
  const content = buildJsonlExport(samples);
  const blob = new Blob([content], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
