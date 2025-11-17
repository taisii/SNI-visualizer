"use client";

import type { AbstractState, StateSection, StaticGraph } from "../types/analysis-result";
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

export function StateViewer({ state, graph }: Props) {
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
              section.alert ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-neutral-800">{section.title}</div>
              {section.alert && <span className="text-xs font-semibold text-red-700">ALERT</span>}
            </div>
            {section.description && <p className="mt-1 text-xs text-neutral-600">{section.description}</p>}
            <div
              className={`mt-2 text-xs text-neutral-800 ${
                section.id === "regs" || section.id === "obsMem" || section.id === "obsCtrl"
                  ? "grid grid-cols-1 gap-2 md:grid-cols-2"
                  : "space-y-1"
              }`}
            >
              <Accordion
                type="multiple"
                className={section.id === "regs" || section.id === "obsMem" || section.id === "obsCtrl" ? "contents" : "space-y-1"}
              >
                {Object.entries(section.data).map(([key, value]) => {
                  const displayKey =
                    section.id === "obsMem" || section.id === "obsCtrl"
                      ? formatObservationKey(section.id, key)
                      : key;
                  const hasDetail = Boolean(value.detail);
                  const itemValue = `${section.id}-${key}`;

                  const commonBox = (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-lg bg-white px-2 py-1"
                    >
                      <span className="font-mono text-[11px] text-neutral-700">{displayKey}</span>
                      <span className="flex-1" />
                      <span
                        className={`min-w-[56px] rounded px-2 py-0.5 text-center text-[11px] font-semibold ${badgeColors[value.style]}`}
                      >
                        {value.label}
                      </span>
                    </div>
                  );

                  if (!hasDetail) return commonBox;

                  return (
                    <AccordionItem
                      key={key}
                      value={itemValue}
                      className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
                    >
                      <AccordionTrigger className="px-2 py-1 hover:no-underline">
                        <span className="font-mono text-[11px] text-neutral-700">{displayKey}</span>
                        <span className="flex-1" />
                        <span
                          className={`min-w-[56px] rounded px-2 py-0.5 text-center text-[11px] font-semibold ${badgeColors[value.style]}`}
                        >
                          {value.label}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-2 pb-2">
                        <div className="grid grid-cols-3 gap-2 text-[10px] text-neutral-700">
                          {(["ns", "sp", "join"] as const).map((k) => {
                            const val = value.detail?.[k];
                            return (
                              <div key={k} className="flex items-center justify-between gap-1 rounded bg-neutral-50 px-2 py-1">
                                <span className="font-mono text-[10px] text-neutral-600">{k}:</span>
                                <span
                                  className={`min-w-[44px] rounded px-2 py-0.5 text-center text-[10px] font-semibold ${badgeColors[value.style]}`}
                                >
                                  {val}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
