"use client";

import { useCallback, useState } from "react";
import type {
  AbstractState,
  StateSection,
  StaticGraph,
} from "@/lib/analysis-schema";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type Props = {
  state: AbstractState | null;
  graph: StaticGraph | null;
};

const badgeColors: Record<StateSection["data"][string]["style"], string> = {
  neutral: "bg-neutral-200 text-neutral-800",
  safe: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
};

const makeBadgeClass = (
  style: StateSection["data"][string]["style"],
  size: "normal" | "small" = "normal",
) =>
  `min-w-[56px] rounded px-2 py-0.5 text-center font-semibold ${
    size === "small" ? "text-[10px]" : "text-[11px]"
  } ${badgeColors[style]}`;

const detailStyleOf = (
  value: string | undefined,
): StateSection["data"][string]["style"] => {
  switch (value) {
    case "Low":
    case "EqLow":
      return "safe";
    case "High":
    case "EqHigh":
      return "warning";
    case "Leak":
    case "Top":
      return "danger";
    case "Diverge":
      return "info";
    default:
      return "neutral";
  }
};

export function StateViewer({ state, graph }: Props) {
  const [openValuesBySection, setOpenValuesBySection] = useState<
    Record<string, string[]>
  >({});

  const updateSectionOpenValues = useCallback(
    (sectionId: string, updater: (values: string[]) => string[]) => {
      setOpenValuesBySection((prev) => {
        const current = prev[sectionId] ?? [];
        const next = updater(current);
        if (next === current) return prev;
        return { ...prev, [sectionId]: next };
      });
    },
    [],
  );

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-neutral-200 bg-white text-sm text-neutral-500">
        ステート情報がここに表示されます
      </div>
    );
  }

  const pcToInstr = new Map<number, string>();
  if (graph) {
    for (const n of graph.nodes) {
      if (!pcToInstr.has(n.pc)) {
        const text = n.instruction ?? n.label ?? "";
        pcToInstr.set(n.pc, text);
      }
    }
  }

  const formatObservationKey = (sectionId: string, key: string): string => {
    if (!graph) return key;

    if (sectionId === "obsMem") {
      const m = key.match(/^(\d+):(.*)$/);
      if (!m) return key;
      const pc = Number(m[1]);
      const addr = m[2];
      const instr = pcToInstr.get(pc);
      if (instr && instr.length > 0) {
        return `${pc}: ${instr} [addr=${addr}]`;
      }
      return `pc=${pc} addr=${addr}`;
    }

    if (sectionId === "obsCtrl") {
      const pc = Number(key);
      if (Number.isNaN(pc)) return key;
      const instr = pcToInstr.get(pc);
      if (instr && instr.length > 0) {
        return `${pc}: ${instr}`;
      }
      return `pc=${pc}`;
    }

    return key;
  };

  return (
    <div className="flex h-full flex-col gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="text-sm font-semibold text-neutral-800">抽象状態</div>
      <div className="flex flex-col gap-3">
        {state.sections.map((section) => (
          <div
            key={section.id}
            className={`rounded-lg border p-2 ${
              section.alert
                ? "border-red-200 bg-red-50"
                : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-neutral-800">
                {section.title}
              </div>
              {section.alert && (
                <span className="text-xs font-semibold text-red-700">
                  ALERT
                </span>
              )}
            </div>
            {section.description && (
              <p className="mt-1 text-xs text-neutral-600">
                {section.description}
              </p>
            )}
            <div
              className={`mt-2 text-xs text-neutral-800 ${
                section.id === "regs" ||
                section.id === "obsMem" ||
                section.id === "obsCtrl"
                  ? "grid grid-cols-1 gap-2 md:grid-cols-2"
                  : "space-y-1"
              }`}
            >
              {(() => {
                const entries = Object.entries(section.data).map(
                  ([key, value], position) => {
                    const displayKey =
                      section.id === "obsMem" || section.id === "obsCtrl"
                        ? formatObservationKey(section.id, key)
                        : key;

                    return {
                      key,
                      value,
                      displayKey,
                      hasDetail: Boolean(value.detail),
                      itemValue: `${section.id}-${key}`,
                      position,
                    };
                  },
                );

                const detailByPosition = new Map(
                  entries
                    .filter((e) => e.hasDetail)
                    .map((e) => [e.position, e]),
                );

                const pairMap = new Map<string, string | null>();
                for (const entry of entries) {
                  if (!entry.hasDetail) continue;
                  const partnerPos =
                    entry.position % 2 === 0
                      ? entry.position + 1
                      : entry.position - 1;
                  const partner = detailByPosition.get(partnerPos);
                  pairMap.set(entry.itemValue, partner?.itemValue ?? null);
                }

                const openValues = openValuesBySection[section.id] ?? [];

                const handleValueChange = (nextValues: string[]) => {
                  const opened = nextValues.find(
                    (v) => !openValues.includes(v),
                  );
                  const closed = openValues.find(
                    (v) => !nextValues.includes(v),
                  );

                  let adjusted = nextValues;

                  if (opened) {
                    const pair = pairMap.get(opened);
                    if (pair && !adjusted.includes(pair)) {
                      adjusted = [...adjusted, pair];
                    }
                  } else if (closed) {
                    const pair = pairMap.get(closed);
                    if (pair) {
                      adjusted = adjusted.filter((v) => v !== pair);
                    }
                  }

                  updateSectionOpenValues(section.id, () => adjusted);
                };

                return (
                  <Accordion
                    type="multiple"
                    className={
                      section.id === "regs" ||
                      section.id === "obsMem" ||
                      section.id === "obsCtrl"
                        ? "contents"
                        : "space-y-1"
                    }
                    value={openValues}
                    onValueChange={handleValueChange}
                  >
                    {entries.map(
                      ({ key, value, displayKey, hasDetail, itemValue }) => {
                        const isMismatched =
                          value.detail && value.detail.ns !== value.detail.sp;
                        const summaryStyle = isMismatched
                          ? "danger"
                          : value.style;
                        const summaryLabel = isMismatched
                          ? "Danger"
                          : value.label;
                        const badgeClass = makeBadgeClass(summaryStyle);
                        if (!hasDetail) {
                          return (
                            <div
                              key={key}
                              className="flex items-center gap-2 rounded-lg bg-white px-2 py-1"
                            >
                              <span className="font-mono text-[11px] text-neutral-700">
                                {displayKey}
                              </span>
                              <span className="flex-1" />
                              <span className={badgeClass}>{summaryLabel}</span>
                            </div>
                          );
                        }

                        return (
                          <AccordionItem
                            key={key}
                            value={itemValue}
                            className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
                          >
                            <AccordionTrigger className="px-2 py-1 hover:no-underline">
                              <span className="font-mono text-[11px] text-neutral-700">
                                {displayKey}
                              </span>
                              <span className="flex-1" />
                              <span className={badgeClass}>{summaryLabel}</span>
                            </AccordionTrigger>
                            <AccordionContent className="px-2 pb-2">
                              <div className="grid grid-cols-2 gap-2 text-[10px] text-neutral-700">
                                {(["ns", "sp"] as const).map((k) => {
                                  const val = value.detail?.[k];
                                  const detailClass = makeBadgeClass(
                                    detailStyleOf(val),
                                    "small",
                                  );
                                  return (
                                    <div
                                      key={k}
                                      className="flex items-center justify-between gap-1 rounded bg-neutral-50 px-2 py-1"
                                    >
                                      <span className="font-mono text-[10px] text-neutral-600">
                                        {k}:
                                      </span>
                                      <span className={detailClass}>{val}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      },
                    )}
                  </Accordion>
                );
  })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
