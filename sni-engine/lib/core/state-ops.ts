import { join } from "./lattice";
import {
  type AbsState,
  type RelValue,
  defaultMemRel,
  defaultRegRel,
  joinSecurity,
  makeRel,
} from "./state";
import { mergeObservation } from "./observations";

export function relJoin(a: RelValue, b: RelValue): RelValue {
  const ns = joinSecurity(a.ns, b.ns);
  const sp = joinSecurity(a.sp, b.sp);
  const relMerged = join(a.rel, b.rel);
  const rel = join(relMerged, makeRel(ns, sp).rel);
  return { ns, sp, rel };
}

export function getReg(state: AbsState, name: string): RelValue {
  return state.regs.get(name) ?? defaultRegRel();
}

export function getMem(state: AbsState, name: string): RelValue {
  return state.mem.get(name) ?? defaultMemRel();
}

export function setReg(state: AbsState, name: string, value: RelValue) {
  state.regs.set(name, value);
}

export function setMem(state: AbsState, name: string, value: RelValue) {
  state.mem.set(name, value);
}

export function seedRegs(state: AbsState, regs: Set<string>) {
  for (const r of regs) {
    if (!state.regs.has(r)) {
      state.regs.set(r, defaultRegRel());
    }
  }
}

export function mergeState(
  dst: AbsState,
  src: AbsState,
  opts: {
    regs?: boolean;
    mem?: boolean;
    obsMem?: boolean;
    obsCtrl?: boolean;
  } = {},
): { changed: boolean } {
  const { regs = true, mem = true, obsMem = true, obsCtrl = true } = opts;
  let changed = false;
  if (regs) {
    for (const [k, v] of src.regs) {
      const cur = dst.regs.get(k) ?? defaultRegRel();
      const n = relJoin(cur, v);
      if (n.ns !== cur.ns || n.sp !== cur.sp || n.rel !== cur.rel) {
        dst.regs.set(k, n);
        changed = true;
      }
    }
  }
  if (mem) {
    for (const [k, v] of src.mem) {
      const cur = dst.mem.get(k) ?? defaultMemRel();
      const n = relJoin(cur, v);
      if (n.ns !== cur.ns || n.sp !== cur.sp || n.rel !== cur.rel) {
        dst.mem.set(k, n);
        changed = true;
      }
    }
  }
  if (obsMem) {
    for (const [k, v] of src.obsMem) {
      const cur = dst.obsMem.get(k) ?? "Bot";
      const n = mergeObservation(cur, v);
      if (n !== cur) {
        dst.obsMem.set(k, n);
        changed = true;
      }
    }
  }
  if (obsCtrl) {
    for (const [k, v] of src.obsCtrl) {
      const cur = dst.obsCtrl.get(k) ?? "Bot";
      const n = mergeObservation(cur, v);
      if (n !== cur) {
        dst.obsCtrl.set(k, n);
        changed = true;
      }
    }
  }
  return { changed };
}

export function stateHasViolation(state: AbsState): boolean {
  for (const v of state.obsMem.values()) {
    if (v === "Leak") return true;
  }
  for (const v of state.obsCtrl.values()) {
    if (v === "Leak") return true;
  }
  return false;
}

export function stateHasTop(state: AbsState): boolean {
  for (const v of state.obsMem.values()) {
    if (v === "Top") return true;
  }
  for (const v of state.obsCtrl.values()) {
    if (v === "Top") return true;
  }
  return false;
}

export function extractObservations(state: AbsState): AbsState {
  const obsOnly = {
    regs: new Map(),
    mem: new Map(),
    obsMem: new Map(state.obsMem),
    obsCtrl: new Map(state.obsCtrl),
  };
  return obsOnly;
}
