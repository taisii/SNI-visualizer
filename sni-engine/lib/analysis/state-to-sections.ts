import type { StateSection } from "@/lib/analysis-schema";
import { join, toDisplay } from "../core/lattice";
import type { AbsState } from "../core/state";
import { securityToLattice } from "../core/state";

type SpecStack = readonly string[] | undefined;

export function stateToSections(state: AbsState, specStack?: SpecStack) {
  const regs: Record<string, ReturnType<typeof toDisplay>> = {};
  const mem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsMem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsCtrl: Record<string, ReturnType<typeof toDisplay>> = {};
  const stackData: Record<string, ReturnType<typeof toDisplay>> = {};

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
      stackData[`d${level}`] = {
        label: ctx,
        style: "info",
      };
    });
  }

  const hasMemViolation = Array.from(state.obsMem.values()).some(
    (v) => v === "Leak" || v === "Top",
  );
  const hasCtrlViolation = Array.from(state.obsCtrl.values()).some(
    (v) => v === "Leak" || v === "Top",
  );

  const sections: StateSection[] = [
    {
      id: "regs",
      title: "Registers",
      type: "key-value" as const,
      data: regs,
    },
    { id: "mem", title: "Memory", type: "key-value" as const, data: mem },
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

  if (specStack && specStack.length > 0) {
    sections.push({
      id: "specStack",
      title: "Speculation Stack",
      type: "key-value" as const,
      data: stackData,
      description: "トップが d1。Stack Guard モードで表示されます。",
    });
  }

  return { sections };
}
