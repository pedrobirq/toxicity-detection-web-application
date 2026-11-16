import React, { useMemo } from "react";
import { CATEGORY_META, ToxicEntity, ToxicityCategory } from "../types/toxicity";

interface NerVisualizerProps {
  text: string;
  entities: ToxicEntity[];
  activeCategories?: Set<ToxicityCategory>;
  selectedIndex?: number | null;
  onSelectEntity?: (index: number | null) => void;
}

type TextSegment =
  | { type: "plain"; text: string; key: string }
  | {
      type: "entity";
      text: string;
      entity: ToxicEntity;
      entityIndex: number;
      key: string;
    };

export const NerVisualizer: React.FC<NerVisualizerProps> = ({
  text,
  entities,
  activeCategories,
  selectedIndex = null,
  onSelectEntity,
}) => {
  const segments = useMemo<TextSegment[]>(() => {
    if (!text) return [];

    const filtered = entities
      .map((ent, originalIndex) => ({ ent, originalIndex }))
      .filter(({ ent }) =>
        activeCategories ? activeCategories.has(ent.category) : true
      )
      .filter(
        ({ ent }) =>
          ent.start >= 0 && ent.end > ent.start && ent.end <= text.length
      )
      .sort((a, b) => a.ent.start - b.ent.start || a.ent.end - b.ent.end);

    const out: TextSegment[] = [];
    let cursor = 0;

    for (const { ent, originalIndex } of filtered) {
      if (ent.start < cursor) {
        continue;
      }
      if (ent.start > cursor) {
        out.push({
          type: "plain",
          text: text.slice(cursor, ent.start),
          key: `plain-${cursor}-${ent.start}`,
        });
      }
      out.push({
        type: "entity",
        text: text.slice(ent.start, ent.end),
        entity: ent,
        entityIndex: originalIndex,
        key: `ent-${originalIndex}-${ent.start}-${ent.end}`,
      });
      cursor = ent.end;
    }

    if (cursor < text.length) {
      out.push({
        type: "plain",
        text: text.slice(cursor),
        key: `plain-${cursor}-${text.length}`,
      });
    }

    return out;
  }, [text, entities, activeCategories]);

  if (!text) {
    return null;
  }

  return (
    <div className="text-[17px] leading-[1.95] text-slate-900 whitespace-pre-wrap break-words font-sans">
      {segments.map((seg) => {
        if (seg.type === "plain") {
          return <span key={seg.key}>{seg.text}</span>;
        }

        const meta = CATEGORY_META[seg.entity.category];
        const isSelected = selectedIndex === seg.entityIndex;

        return (
          <mark
            key={seg.key}
            role={onSelectEntity ? "button" : undefined}
            tabIndex={onSelectEntity ? 0 : undefined}
            onClick={() =>
              onSelectEntity?.(isSelected ? null : seg.entityIndex)
            }
            onKeyDown={(e) => {
              if (!onSelectEntity) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectEntity(isSelected ? null : seg.entityIndex);
              }
            }}
            title={`${meta.labelRu} (${seg.entity.category}) [${seg.entity.start}:${seg.entity.end}]`}
            className={`inline-flex items-baseline gap-1.5 px-1.5 py-0.5 mx-0.5 rounded border-b-2 transition-all duration-150 ${
              meta.bgClass
            } ${meta.borderClass} ${meta.textClass} ${
              onSelectEntity ? "cursor-pointer hover:brightness-95" : ""
            } ${
              isSelected
                ? "ring-2 ring-slate-900/80 ring-offset-1"
                : ""
            }`}
          >
            <span className="font-medium">{seg.text}</span>
            <span className="text-[11px] font-mono font-semibold uppercase tracking-tight opacity-85 select-none">
              {meta.shortTagRu}
            </span>
          </mark>
        );
      })}
    </div>
  );
};
