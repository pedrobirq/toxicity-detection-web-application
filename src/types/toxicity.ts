export type ToxicityCategory =
  | "profanity"
  | "insult"
  | "derogation_mockery"
  | "threat_violence"
  | "hate_speech";

export interface ToxicEntity {
  span: string;
  start: number;
  end: number;
  category: ToxicityCategory;
  confidence?: number;
}

export type InferenceEngine = "fastapi" | "gemini-fallback";
export type FeedbackStatus = "pending" | "confirmed" | "rejected";

export interface AnalysisResult {
  id: number;
  text: string;
  entities: ToxicEntity[];
  engine: InferenceEngine;
  modelVersion: string;
  latencyMs: number;
}

export interface RequestLogRecord {
  id: string;
  text: string;
  entities: ToxicEntity[];
  engine: InferenceEngine;
  modelVersion: string;
  latencyMs: number;
  feedbackStatus: FeedbackStatus;
  createdAtMs: number;
}

export interface LabeledSampleRecord {
  id: string;
  text: string;
  entities: ToxicEntity[];
  verdict: "confirmed" | "rejected";
  sourceLogId: string;
  modelVersion: string;
  createdAtMs: number;
}

export interface ModelVersionRecord {
  id: string;
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
  isActive: boolean;
  createdAtMs: number;
}

export interface CategoryMeta {
  key: ToxicityCategory;
  labelRu: string;
  shortTagRu: string;
  description: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  swatchHex: string;
}

export const CATEGORY_ORDER: ToxicityCategory[] = [
  "profanity",
  "insult",
  "derogation_mockery",
  "threat_violence",
  "hate_speech",
];

export const CATEGORY_META: Record<ToxicityCategory, CategoryMeta> = {
  profanity: {
    key: "profanity",
    labelRu: "Ненормативная лексика",
    shortTagRu: "мат",
    description: "Обсценная лексика, бранные слова и ругательства общего характера без прямой адресации личности.",
    bgClass: "bg-amber-100/90",
    borderClass: "border-amber-600",
    textClass: "text-amber-950",
    swatchHex: "#D97706",
  },
  insult: {
    key: "insult",
    labelRu: "Прямое оскорбление",
    shortTagRu: "оскорбление",
    description: "Прямые оскорбления личности, унижение характера, внешности или интеллекта.",
    bgClass: "bg-rose-100/90",
    borderClass: "border-rose-600",
    textClass: "text-rose-950",
    swatchHex: "#E11D48",
  },
  derogation_mockery: {
    key: "derogation_mockery",
    labelRu: "Насмешка и ярлык",
    shortTagRu: "насмешка",
    description: "Уничижительные ярлыки, саркастические выражения, язвительное коверкание слов.",
    bgClass: "bg-violet-100/90",
    borderClass: "border-violet-600",
    textClass: "text-violet-950",
    swatchHex: "#7C3AED",
  },
  threat_violence: {
    key: "threat_violence",
    labelRu: "Угроза насилия",
    shortTagRu: "угроза",
    description: "Угрозы физической расправой, причинением вреда или пожелания смерти.",
    bgClass: "bg-red-100/95",
    borderClass: "border-red-600",
    textClass: "text-red-950",
    swatchHex: "#DC2626",
  },
  hate_speech: {
    key: "hate_speech",
    labelRu: "Язык вражды",
    shortTagRu: "вражда",
    description: "Дискриминационные высказывания и ксенофобия по расовому, национальному или гендерному признаку.",
    bgClass: "bg-orange-100/90",
    borderClass: "border-orange-600",
    textClass: "text-orange-950",
    swatchHex: "#EA580C",
  },
};

export const DEMO_PRESETS: Array<{ title: string; text: string }> = [
  {
    title: "Пример из датасета (мат + оскорбление)",
    text: '" БЛЯДЬ ДАЖЕ ПРИ БРЕЖНЕВЕ ТАКОГО НЕ БЫЛО!!!! ((((( " говно ебаное',
  },
  {
    title: "Угроза насилия",
    text: "Я убью тебя и всю твою семью",
  },
  {
    title: "Язык вражды",
    text: "Все негры должны быть убиты",
  },
  {
    title: "Оскорбление и насмешка",
    text: "Ну и бред ты несешь, клоун, просто позорище какое-то",
  },
  {
    title: "Нейтральный комментарий",
    text: "Спасибо за подробный разбор задачи, презентация получилась очень понятной.",
  },
];
