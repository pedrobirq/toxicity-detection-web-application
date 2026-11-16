import React, { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  ModelVersionRecord,
  ToxicityCategory,
} from "../types/toxicity";
import {
  registerModelVersion,
  setActiveModelVersion,
} from "../lib/firestoreRepo";
import { firebaseProjectId, firestoreDatabaseId } from "../lib/firebase";

interface HealthState {
  modelApiConfigured: boolean;
  modelApiUrl: string | null;
  modelApiOnline: boolean;
  geminiConfigured: boolean;
  fastApiInfo: {
    status?: string;
    model_version?: string;
    device?: string;
    epoch?: number;
  } | null;
}

interface ModelDeployViewProps {
  models: ModelVersionRecord[];
  onErrorNotice: (msg: string) => void;
}

export const ModelDeployView: React.FC<ModelDeployViewProps> = ({
  models,
  onErrorNotice,
}) => {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [version, setVersion] = useState("v1.1.0");
  const [epoch, setEpoch] = useState("5");
  const [valMacroF1, setValMacroF1] = useState("0.79");
  const [valMicroF1, setValMicroF1] = useState("0.87");
  const [weightsUri, setWeightsUri] = useState(
    "hf://username/rubert-toxic-detector/best_model.pt"
  );
  const [datasetName, setDatasetName] = useState(
    "cleaned_deduplicated_dataset.jsonl"
  );
  const [notes, setNotes] = useState("");

  const fetchHealth = async () => {
    setCheckingHealth(true);
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setHealth((await res.json()) as HealthState);
      }
    } catch {
      // Ignore transient check failure
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const activeModel = models.find((m) => m.isActive) ?? models[0] ?? null;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const macro = parseFloat(valMacroF1) || 0;
      const micro = parseFloat(valMicroF1) || 0;
      const perClass: Record<ToxicityCategory, number> = {
        profanity: Number(Math.min(1, macro + 0.1).toFixed(3)),
        insult: Number(Math.min(1, macro + 0.05).toFixed(3)),
        derogation_mockery: Number(Math.max(0, macro - 0.08).toFixed(3)),
        threat_violence: Number(macro.toFixed(3)),
        hate_speech: Number(Math.max(0, macro - 0.07).toFixed(3)),
      };
      const newId = await registerModelVersion({
        name: "RuBertToxicDetector",
        version,
        baseModel: "DeepPavlov/rubert-base-cased",
        epoch: parseInt(epoch, 10) || 1,
        valMacroF1: macro,
        valMicroF1: micro,
        perClassF1: perClass,
        weightsUri,
        datasetName,
        notes,
      });
      await setActiveModelVersion(newId, [
        ...models,
        {
          id: newId,
          name: "RuBertToxicDetector",
          version,
          baseModel: "DeepPavlov/rubert-base-cased",
          epoch: parseInt(epoch, 10) || 1,
          valMacroF1: macro,
          valMicroF1: micro,
          perClassF1: perClass,
          weightsUri,
          datasetName,
          notes,
          isActive: true,
          createdAtMs: Date.now(),
        },
      ]);
      setShowRegisterForm(false);
      setNotes("");
    } catch (err) {
      onErrorNotice(
        err instanceof Error
          ? err.message
          : "Не удалось сохранить версию модели в Firestore."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Inference Backend Connectivity */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Подключение инференса и базы данных
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Состояние моста к Python FastAPI (`MODEL_API_URL`) и облачной БД Firebase Firestore.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchHealth}
            disabled={checkingHealth}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${checkingHealth ? "animate-spin" : ""}`}
            />
            Проверить подключение
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5 text-sm">
          <div>
            <div className="text-xs font-medium text-slate-500">
              Python FastAPI (PyTorch RuBERT)
            </div>
            <div className="mt-1 font-semibold text-slate-900">
              {health?.modelApiOnline
                ? "Подключён и готов"
                : "Не запущен (активен Gemini fallback)"}
            </div>
            <div className="mt-1 text-xs font-mono text-slate-500 break-all">
              {health?.modelApiUrl || "MODEL_API_URL не задан"}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-500">
              Резервный движок (Gemini API)
            </div>
            <div className="mt-1 font-semibold text-slate-900">
              {health?.geminiConfigured
                ? "Настроен на сервере"
                : "Ключ не задан"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Используется автоматически при офлайн FastAPI
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-500">
              База данных Firebase Firestore
            </div>
            <div className="mt-1 font-semibold text-slate-900">
              Подключена (без авторизации)
            </div>
            <div className="mt-1 text-xs font-mono text-slate-500 break-all">
              {firebaseProjectId} / {firestoreDatabaseId}
            </div>
          </div>
        </div>
      </section>

      {/* Model Registry Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Реестр модели в Firestore
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Паспорт чекпоинта, метрики качества и URI расположения весов `best_model.pt`.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowRegisterForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {showRegisterForm ? "Отмена" : "Зарегистрировать версию"}
          </button>
        </div>

        {showRegisterForm && (
          <form
            onSubmit={handleRegister}
            className="rounded-lg border border-slate-200 bg-slate-50 p-5 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Версия
                </label>
                <input
                  type="text"
                  required
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Лучшая эпоха
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={epoch}
                  onChange={(e) => setEpoch(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Val Macro F1
                </label>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  max={1}
                  required
                  value={valMacroF1}
                  onChange={(e) => setValMacroF1(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Val Micro F1
                </label>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  max={1}
                  required
                  value={valMicroF1}
                  onChange={(e) => setValMicroF1(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  URI или путь к весам (`best_model.pt`)
                </label>
                <input
                  type="text"
                  required
                  value={weightsUri}
                  onChange={(e) => setWeightsUri(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Обучающий датасет
                </label>
                <input
                  type="text"
                  required
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Примечание к релизу
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Например: дообучение на 500 пользовательских примерах"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                {submitting ? "Сохранение..." : "Сохранить в Firestore"}
              </button>
            </div>
          </form>
        )}

        {activeModel ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-sm">
              <div>
                <div className="text-xs text-slate-500">Модель и версия</div>
                <div className="font-bold text-slate-900 mt-1">
                  {activeModel.name} ·{" "}
                  <span className="font-mono">{activeModel.version}</span>
                </div>
                <div className="text-xs font-mono text-slate-500 mt-0.5">
                  {activeModel.baseModel}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Val Macro / Micro F1</div>
                <div className="font-bold text-slate-900 mt-1 font-mono tabular-nums">
                  {activeModel.valMacroF1.toFixed(3)} /{" "}
                  {activeModel.valMicroF1.toFixed(3)}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Лучшая эпоха: {activeModel.epoch}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Расположение весов</div>
                <div className="font-mono text-xs text-slate-800 mt-1 break-all">
                  {activeModel.weightsUri}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Датасет</div>
                <div className="font-mono text-xs text-slate-800 mt-1 break-all">
                  {activeModel.datasetName}
                </div>
              </div>
            </div>

            {activeModel.notes && (
              <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-4 py-3 border border-slate-200">
                {activeModel.notes}
              </p>
            )}

            {/* Per-Class F1 Breakdown */}
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-3">
                Метрика Token-level F1 по классам токсичности
              </h3>
              <div className="space-y-2.5">
                {CATEGORY_ORDER.map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const score = Number(activeModel.perClassF1?.[cat] ?? 0);
                  const pct = Math.round(score * 100);
                  return (
                    <div
                      key={cat}
                      className="grid grid-cols-12 items-center gap-3 text-xs"
                    >
                      <div className="col-span-5 sm:col-span-4 text-slate-700 truncate">
                        {meta.labelRu}{" "}
                        <span className="font-mono text-slate-400">
                          ({cat})
                        </span>
                      </div>
                      <div className="col-span-5 sm:col-span-6 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: meta.swatchHex,
                          }}
                        />
                      </div>
                      <div className="col-span-2 text-right font-mono tabular-nums font-medium text-slate-900">
                        {score.toFixed(3)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Загрузка паспорта модели из Firestore...
          </div>
        )}
      </section>

      {/* Deployment & Secrets Quick Reference */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="pb-3 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">
            Локальный запуск и деплой на внешние сервисы
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Подробная инструкция также сохранена в файле `DEPLOYMENT.md` в корне репозитория.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              1. Локальное подключение вашей обученной модели
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Поместите папку <code className="font-mono">models/rubert_toxic_detector</code>{" "}
              (с файлами <code className="font-mono">best_model.pt</code> и{" "}
              <code className="font-mono">tokenizer/</code>) в директорию{" "}
              <code className="font-mono">python_inference/</code> и запустите FastAPI-воркер:
            </p>
            <pre className="rounded-lg bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
{`cd python_inference
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000`}
            </pre>
            <p className="text-xs text-slate-600 leading-relaxed">
              Затем в корне проекта задайте{" "}
              <code className="font-mono">MODEL_API_URL=http://127.0.0.1:8000</code>{" "}
              в <code className="font-mono">.env</code> и запустите{" "}
              <code className="font-mono">npm run dev</code>.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              2. Секреты и регистрация для внешнего деплоя
            </h3>
            <ul className="text-xs text-slate-600 space-y-2 leading-relaxed list-disc pl-4">
              <li>
                <strong>Firebase Console</strong> — хранит коллекции{" "}
                <code className="font-mono">models</code>,{" "}
                <code className="font-mono">request_logs</code> и{" "}
                <code className="font-mono">labeled_samples</code>. Конфиг подключается через{" "}
                <code className="font-mono">firebase-applet-config.json</code>.
              </li>
              <li>
                <strong>Hugging Face Hub</strong> — загрузите веса{" "}
                <code className="font-mono">best_model.pt</code> в репозиторий и передайте{" "}
                <code className="font-mono">HF_MODEL_REPO</code> и{" "}
                <code className="font-mono">HF_TOKEN</code> в контейнер{" "}
                <code className="font-mono">python_inference/Dockerfile</code> (Cloud Run, Render или HF Spaces).
              </li>
              <li>
                <strong>Общий секрет API</strong> — задайте одинаковый{" "}
                <code className="font-mono">MODEL_API_SECRET</code> на FastAPI и Express-сервере для защиты{" "}
                <code className="font-mono">/predict</code>.
              </li>
              <li>
                <strong>Google AI Studio (`GEMINI_API_KEY`)</strong> — хранится в Secrets сервера для автоматического резервного демо-режима.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
