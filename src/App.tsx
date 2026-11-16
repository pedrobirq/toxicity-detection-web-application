import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  LabeledSampleRecord,
  ModelVersionRecord,
  RequestLogRecord,
} from "./types/toxicity";
import { testFirestoreConnection } from "./lib/firebase";
import {
  downloadJsonlFile,
  seedDefaultModelIfEmpty,
  subscribeLabeledSamples,
  subscribeModels,
  subscribeRequestLogs,
} from "./lib/firestoreRepo";
import { AnalyzerView } from "./components/AnalyzerView";
import { HistoryDatasetView } from "./components/HistoryDatasetView";
import { ModelDeployView } from "./components/ModelDeployView";

type ActiveTab = "analyzer" | "history" | "model";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("analyzer");
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [logs, setLogs] = useState<RequestLogRecord[]>([]);
  const [labeledSamples, setLabeledSamples] = useState<LabeledSampleRecord[]>(
    []
  );
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unsubModels: (() => void) | undefined;
    let unsubLogs: (() => void) | undefined;
    let unsubSamples: (() => void) | undefined;

    const init = async () => {
      await testFirestoreConnection();
      try {
        await seedDefaultModelIfEmpty();
      } catch (err) {
        if (mounted) {
          setDbError(
            err instanceof Error
              ? err.message
              : "Ошибка инициализации коллекции моделей в Firestore."
          );
        }
      }

      if (!mounted) return;

      unsubModels = subscribeModels(
        (items) => setModels(items),
        (err) => setDbError(err.message)
      );

      unsubLogs = subscribeRequestLogs(
        (items) => {
          setLogs(items);
          setLoadingLogs(false);
        },
        (err) => {
          setDbError(err.message);
          setLoadingLogs(false);
        }
      );

      unsubSamples = subscribeLabeledSamples(
        (items) => setLabeledSamples(items),
        (err) => setDbError(err.message)
      );
    };

    init();

    return () => {
      mounted = false;
      unsubModels?.();
      unsubLogs?.();
      unsubSamples?.();
    };
  }, []);

  const handleHeaderExport = () => {
    const confirmed = labeledSamples.filter((s) => s.verdict === "confirmed");
    const target = confirmed.length > 0 ? confirmed : labeledSamples;
    if (target.length === 0) {
      setActiveTab("history");
      setDbError(
        "Пока нет подтверждённой разметки для экспорта. Проанализируйте текст и нажмите «Подтвердить разметку»."
      );
      return;
    }
    downloadJsonlFile(target, "user_labeled_dataset.jsonl");
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Single-Row Header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab("analyzer")}
            className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            ToxicSpan Lab
          </button>

          {/* Zone 2: Clean Text Navigation Links */}
          <nav className="flex items-center gap-6 overflow-x-auto">
            {(
              [
                { id: "analyzer", label: "Анализатор" },
                { id: "history", label: "История и разметка" },
                { id: "model", label: "Модель и деплой" },
              ] as const
            ).map((nav) => {
              const isCurrent = activeTab === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => setActiveTab(nav.id)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isCurrent
                      ? "border-blue-600 text-slate-900"
                      : "border-transparent text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {nav.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <button
            type="button"
            onClick={handleHeaderExport}
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Экспорт JSONL
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {dbError && (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4 text-xs text-amber-950">
            <span className="break-words">{dbError}</span>
            <button
              type="button"
              onClick={() => setDbError(null)}
              className="font-semibold underline shrink-0 cursor-pointer"
            >
              Скрыть
            </button>
          </div>
        )}

        {activeTab === "analyzer" && (
          <AnalyzerView onErrorNotice={(msg) => setDbError(msg)} />
        )}

        {activeTab === "history" && (
          <HistoryDatasetView
            logs={logs}
            labeledSamples={labeledSamples}
            loading={loadingLogs}
            onErrorNotice={(msg) => setDbError(msg)}
          />
        )}

        {activeTab === "model" && (
          <ModelDeployView
            models={models}
            onErrorNotice={(msg) => setDbError(msg)}
          />
        )}
      </main>
    </div>
  );
}
