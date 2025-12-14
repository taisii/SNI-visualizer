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
import { ChevronDownIcon } from "lucide-react";
import { formatObservationKey } from "./formatObservationKey";

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

type SectionEntry = {
  key: string;
  value: StateSection["data"][string];
  displayKey: string;
  hasDetail: boolean;
  itemValue: string;
  position: number;
};

const specStackOrder = (key: string) => {
  const n = Number(key.replace(/\D/g, ""));
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

function renderSpecStack(entries: SectionEntry[]) {
  if (entries.length === 0) {
    return (
      <div className="mt-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase text-neutral-500">
          <span className="rounded bg-neutral-200 px-2 py-0.5 font-semibold tracking-wide">
            Top
          </span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>
        <div className="rounded-md border border-dashed border-neutral-200 bg-white px-3 py-3" />
      </div>
    );
  }

  const sorted = [...entries].sort(
    (a, b) => specStackOrder(a.key) - specStackOrder(b.key),
  );

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] uppercase text-neutral-500">
        <span className="rounded bg-neutral-200 px-2 py-0.5 font-semibold tracking-wide">
          Top
        </span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>
      <div className="flex flex-col gap-2">
        {sorted.map((entry) => {
          const depth = specStackOrder(entry.key);
          const isTop = depth === 1;
          return (
            <div
              key={entry.key}
              className="rounded-md border border-blue-100 bg-gradient-to-r from-blue-50 to-white px-3 py-2 shadow-sm"
            >
              <div className="flex items-center justify-between text-[10px] uppercase text-neutral-500">
                <span>depth {depth}</span>
                {isTop ? (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    Top
                  </span>
                ) : (
                  <span className="rounded bg-neutral-200 px-2 py-0.5 text-[10px] text-neutral-700">
                    d{depth}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs font-semibold text-neutral-800">
                {entry.value.label}
              </div>
              {entry.value.description && (
                <div className="text-[11px] text-neutral-600">
                  {entry.value.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StateViewer({ state, graph }: Props) {
  const [openValuesBySection, setOpenValuesBySection] = useState<
    Record<string, string[]>
  >({});
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
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
        状態はここに表示されます
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

  return (
    <div className="flex h-full flex-col gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="text-sm font-semibold text-neutral-800">
        Abstract State
      </div>
      <div className="flex flex-col gap-3">
        {state.sections.map((section) => {
          // 専用 UI: Speculation Stack はセクションごと Accordion で折りたたみ
          if (section.id === "specStack") {
            const entries: SectionEntry[] = Object.entries(section.data).map(
              ([key, value], position) => {
                return {
                  key,
                  value,
                  displayKey: key,
                  hasDetail: false,
                  itemValue: `${section.id}-${key}`,
                  position,
                };
              },
            );
            // Radix Accordion は value を undefined にした瞬間「非制御」扱いに切り替わるため、
            // 閉じるときも空文字を与えて常に「制御」モードを維持する
            const isOpen = !collapsedSections[section.id];
            const accordionValue = isOpen ? section.id : "";
            return (
              <div
                key={section.id}
                className="rounded-lg border border-neutral-200 bg-neutral-50 p-2"
              >
                <Accordion
                  type="single"
                  collapsible
                  value={accordionValue}
                  onValueChange={(v) =>
                    setCollapsedSections((prev) => ({
                      ...prev,
                      [section.id]: !v,
                    }))
                  }
                  className="space-y-0"
                >
                  <AccordionItem value={section.id} className="border-0">
                    <AccordionTrigger className="px-0 py-1 text-sm font-semibold text-neutral-800 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent className="px-0 pb-0">
                      <div className="mt-2 text-xs text-neutral-800">
                        {renderSpecStack(entries)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            );
          }

          const entries: SectionEntry[] = Object.entries(section.data).map(
            ([key, value], position) => {
              const displayKey =
                section.id === "obsMem" || section.id === "obsCtrl"
                  ? formatObservationKey(section.id, key, pcToInstr)
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
            entries.filter((e) => e.hasDetail).map((e) => [e.position, e]),
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
          const detailItemValues = entries
            .filter((e) => e.hasDetail)
            .map((e) => e.itemValue);

          const handleValueChange = (nextValues: string[]) => {
            const opened = nextValues.find((v) => !openValues.includes(v));
            const closed = openValues.find((v) => !nextValues.includes(v));

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

          const isGridSection =
            section.id === "regs" ||
            section.id === "obsMem" ||
            section.id === "obsCtrl";

          return (
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
                <div className="flex items-center gap-2">
                  {section.id === "regs" &&
                    detailItemValues.length > 0 &&
                    (() => {
                      const allOpen =
                        openValues.length === detailItemValues.length;
                      const nextValues = allOpen ? [] : detailItemValues;
                      const rotated = allOpen;
                      return (
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-[11px] text-neutral-700 hover:bg-white"
                          aria-label={allOpen ? "Close all" : "Open all"}
                          onClick={() =>
                            updateSectionOpenValues(
                              section.id,
                              () => nextValues,
                            )
                          }
                        >
                          <ChevronDownIcon
                            className={`size-4 transition-transform ${
                              rotated ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      );
                    })()}
                  {section.alert && (
                    <span className="text-xs font-semibold text-red-700">
                      ALERT
                    </span>
                  )}
                </div>
              </div>
              {section.description && (
                <p className="mt-1 text-xs text-neutral-600">
                  {section.description}
                </p>
              )}
              <div
                className={`mt-2 text-xs text-neutral-800 ${
                  isGridSection
                    ? "grid grid-cols-1 gap-2 md:grid-cols-2"
                    : "space-y-1"
                }`}
              >
                <Accordion
                  type="multiple"
                  className={isGridSection ? "contents" : "space-y-1"}
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
