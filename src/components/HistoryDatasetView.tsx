import React, { useMemo, useState } from "react";
import { Check, Download, Search, X } from "lucide-react";
import {
  CATEGORY_META,
  FeedbackStatus,
  LabeledSampleRecord,
  RequestLogRecord,
} from "../types/toxicity";
import { downloadJsonlFile, submitLogVerdict } from "../lib/firestoreRepo";
import { NerVisualizer } from "./NerVisualizer";

interface HistoryDatasetViewProps {
  logs: RequestLogRecord[];
  labeledSamples: LabeledSampleRecord[];
  loading: boolean;
  onErrorNotice: (msg: string) => void;
}

export const HistoryDatasetView: React.FC<HistoryDatasetViewProps> = ({
  logs,
  labeledSamples,
  loading,
  onErrorNotice,
}) => {
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<RequestLogRecord | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const confirmedCount = useMemo(
    () => labeledSamples.filter((s) => s.verdict === "confirmed").length,
    [labeledSamples]
  );
  const rejectedCount = useMemo(
    () => labeledSamples.filter((s) => s.verdict === "rejected").length,
    [labeledSamples]
  );

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.feedbackStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        log.text.toLowerCase().includes(q) ||
        log.entities.some((e) => e.span.toLowerCase().includes(q))
      );
    });
  }, [logs, statusFilter, searchQuery]);

  const handleQuickVerdict = async (
    log: RequestLogRecord,
    verdict: "confirmed" | "rejected"
  ) => {
    if (log.feedbackStatus !== "pending" || isUpdating) return;
    setIsUpdating(true);
    try {
      await submitLogVerdict(log, verdict);
      setSelectedLog((prev) =>
        prev && prev.id === log.id ? { ...prev, feedbackStatus: verdict } : prev
      );
    } catch (err) {
      onErrorNotice(
        err instanceof Error ? err.message : "Не удалось обновить статус лога."
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleExportConfirmed = () => {
    const confirmed = labeledSamples.filter((s) => s.verdict === "confirmed");
    if (confirmed.length === 0) {
      onErrorNotice(
        "Нет подтверждённых записей для экспорта. Подтвердите хотя бы один результат анализа."
      );
      return;
    }
    downloadJsonlFile(confirmed, "user_labeled_confirmed.jsonl");
  };

  const handleExportAllLabeled = () => {
    if (labeledSamples.length === 0) {
      onErrorNotice("Коллекция размеченных данных пока пуста.");
      return;
    }
    downloadJsonlFile(labeledSamples, "user_labeled_all.jsonl");
  };

  const formatTime = (ms: number) => {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  };

  return (
    <div className="space-y-6">
      {/* Metrics Strip */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Всего запросов в логах
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
            {logs.length}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Подтверждено для обучения
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">
            {confirmedCount}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Отклонено (ошибки модели)
          </div>
          <div className="text-2xl font-bold text-rose-700 mt-1 font-mono tabular-nums">
            {rejectedCount}
          </div>
        </div>
        <div className="p-5 flex flex-col justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">
            Выгрузка в формат train.py
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportConfirmed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Подтверждённые JSONL
            </button>
            <button
              type="button"
              onClick={handleExportAllLabeled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Все ({labeledSamples.length})
            </button>
          </div>
        </div>
      </section>

      {/* Logs & Annotations Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: "all", label: "Все" },
                { id: "confirmed", label: "Подтверждённые" },
                { id: "rejected", label: "Отклонённые" },
                { id: "pending", label: "Ожидают оценки" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по тексту или спану..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-10 bg-slate-100 rounded animate-pulse"
              />
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Записей по выбранному фильтру пока нет. Проанализируйте комментарий на главной вкладке.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Текст комментария</th>
                  <th className="py-3 px-4">Найденные спаны</th>
                  <th className="py-3 px-4">Движок</th>
                  <th className="py-3 px-4">Вердикт</th>
                  <th className="py-3 px-4 text-right">Время</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className={`cursor-pointer transition-colors ${
                      selectedLog?.id === log.id
                        ? "bg-blue-50/60"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="py-3 px-4 max-w-md">
                      <div className="truncate text-slate-900 font-medium">
                        {log.text}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {log.entities.length === 0 ? (
                        <span className="text-slate-400">нейтрально</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {log.entities.slice(0, 3).map((e, idx) => (
                            <span
                              key={idx}
                              className={`px-1.5 py-0.5 rounded border-b text-[11px] font-medium ${
                                CATEGORY_META[e.category]?.bgClass ?? "bg-slate-100"
                              } ${
                                CATEGORY_META[e.category]?.borderClass ??
                                "border-slate-300"
                              }`}
                            >
                              {e.span}
                            </span>
                          ))}
                          {log.entities.length > 3 && (
                            <span className="text-slate-400 font-mono">
                              +{log.entities.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {log.engine === "fastapi" ? "FastAPI" : "Gemini demo"}
                    </td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap">
                      {log.feedbackStatus === "confirmed" ? (
                        <span className="font-medium text-emerald-700">
                          Подтверждено
                        </span>
                      ) : log.feedbackStatus === "rejected" ? (
                        <span className="font-medium text-rose-700">
                          Отклонено
                        </span>
                      ) : (
                        <span className="text-slate-500">Ожидает</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatTime(log.createdAtMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Selected Log Inspection Panel */}
      {selectedLog && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="text-sm font-bold text-slate-900">
                Детали записи
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{selectedLog.modelVersion}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {selectedLog.latencyMs} мс
              </span>
            </div>

            <button
              type="button"
              onClick={() => setSelectedLog(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Закрыть
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
            <NerVisualizer
              text={selectedLog.text}
              entities={selectedLog.entities}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs font-mono text-slate-500">
              {JSON.stringify({
                text: selectedLog.text,
                entities: selectedLog.entities.map(
                  ({ span, start, end, category }) => ({
                    span,
                    start,
                    end,
                    category,
                  })
                ),
              })}
            </div>

            {selectedLog.feedbackStatus === "pending" && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleQuickVerdict(selectedLog, "confirmed")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-white border border-emerald-300 hover:bg-emerald-50 rounded-lg cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  Подтвердить
                </button>
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleQuickVerdict(selectedLog, "rejected")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 rounded-lg cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Отклонить
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
