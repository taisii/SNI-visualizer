import type { StateSection } from "@/lib/analysis-schema";
import { join, toDisplay } from "../core/lattice";
import type { AbsState } from "../core/state";
import { securityToLattice } from "../core/state";

type SpecStack = readonly string[] | undefined;

export type SpecContextInfo = {
  id: string;
  assumption?: string;
  originLabel?: string;
  originNodeId?: string;
};

type StateToSectionsOptions = {
  specStack?: SpecStack;
  specContextInfo?: Map<string, SpecContextInfo>;
  /**
   * 投機パスを「観測だけ残して廃棄」するためのフラグ。
   * true のとき regs/mem セクションを生成しない。
   */
  dropNonObservables?: boolean;
};

export function stateToSections(
  state: AbsState,
  options: StateToSectionsOptions = {},
) {
  const { specStack, specContextInfo, dropNonObservables = false } = options;
  const regs: Record<string, ReturnType<typeof toDisplay>> = {};
  const mem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsMem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsCtrl: Record<string, ReturnType<typeof toDisplay>> = {};
  const stackData: Record<string, ReturnType<typeof toDisplay>> = {};
  const budgetData: Record<string, ReturnType<typeof toDisplay>> = {};

  for (const [k, v] of state.regs) {
    const joined = join(securityToLattice(v.ns), securityToLattice(v.sp));
    regs[k] = {
      ...toDisplay(joined),
      detail: { ns: v.ns, sp: v.sp },
    };
  }
  for (const [k, v] of state.mem) {
    const joined = join(securityToLattice(v.ns), securityToLattice(v.sp));
    mem[k] = {
      ...toDisplay(joined),
      detail: { ns: v.ns, sp: v.sp },
    };
  }
  for (const [k, v] of state.obsMem) obsMem[String(k)] = toDisplay(v);
  for (const [k, v] of state.obsCtrl) obsCtrl[String(k)] = toDisplay(v);
  if (specStack && specStack.length > 0) {
    const depth = specStack.length;
    specStack.forEach((ctx, idx) => {
      const level = depth - idx;
      const info = specContextInfo?.get(ctx);
      const baseLabel = info?.originLabel ?? ctx;
      const assumption = info?.assumption;
      const label = baseLabel ?? ctx;
      stackData[`d${level}`] = {
        label,
        style: "info",
        description: assumption ? `仮定: ${assumption}` : undefined,
      };
    });
  }
  // budget 表示（Spec モード時のみ有意。NS は inf）
  budgetData.w = {
    label: state.budget === "inf" ? "∞" : String(state.budget),
    style: "info",
    description: "残り投機ステップ（Pruning-VCFG）",
  };

  const hasMemViolation = Array.from(state.obsMem.values()).some(
    (v) => v === "Leak",
  );
  const hasCtrlViolation = Array.from(state.obsCtrl.values()).some(
    (v) => v === "Leak",
  );

  const sections: StateSection[] = [
    {
      id: "obsMem",
      title: "Memory Observations",
      type: "key-value" as const,
      data: obsMem,
      alert: hasMemViolation,
    },
    {
      id: "obsCtrl",
      title: "Control Observations",
      type: "key-value" as const,
      data: obsCtrl,
      alert: hasCtrlViolation,
    },
  ];

  if (!dropNonObservables) {
    sections.unshift({
      id: "mem",
      title: "Memory",
      type: "key-value" as const,
      data: mem,
    });
    sections.unshift({
      id: "regs",
      title: "Registers",
      type: "key-value" as const,
      data: regs,
    });
  }

  sections.push({
    id: "specStack",
    title: "Speculation Stack",
    type: "key-value" as const,
    data: stackData,
  });
  if (state.budget !== "inf") {
    sections.push({
      id: "specBudget",
      title: "Speculation Budget",
      type: "key-value" as const,
      data: budgetData,
    });
  }

  return { sections };
}
