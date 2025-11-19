import { join, toDisplay } from "../core/lattice";
import type { AbsState } from "../core/state";

export function stateToSections(state: AbsState) {
  const regs: Record<string, ReturnType<typeof toDisplay>> = {};
  const mem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsMem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsCtrl: Record<string, ReturnType<typeof toDisplay>> = {};

  for (const [k, v] of state.regs) {
    const joined = join(v.ns, v.sp);
    regs[k] = {
      ...toDisplay(joined),
      detail: { ns: v.ns, sp: v.sp, join: joined },
    };
  }
  for (const [k, v] of state.mem) {
    const joined = join(v.ns, v.sp);
    mem[k] = {
      ...toDisplay(joined),
      detail: { ns: v.ns, sp: v.sp, join: joined },
    };
  }
  for (const [k, v] of state.obsMem) obsMem[String(k)] = toDisplay(v);
  for (const [k, v] of state.obsCtrl) obsCtrl[String(k)] = toDisplay(v);

  const hasMemViolation = Array.from(state.obsMem.values()).some(
    (v) => v === "Leak" || v === "Top",
  );
  const hasCtrlViolation = Array.from(state.obsCtrl.values()).some(
    (v) => v === "Leak" || v === "Top",
  );

  return {
    sections: [
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
    ],
  };
}
