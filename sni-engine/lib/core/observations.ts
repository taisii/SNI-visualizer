import { join, type LatticeValue } from "./lattice";
import type { AbsState } from "./state";

// MEMLEAK: メモリアクセス観測の NS 側更新
export function updateMemObsNS(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  const next =
    observed === "EqHigh" || observed === "Leak" || observed === "Top"
      ? "EqHigh"
      : "EqLow";
  state.obsMem.set(obsId, join(prev, next));
}

// MEMLEAK: メモリアクセス観測の Spec 側更新
export function updateMemObsSpec(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  if (observed === "EqHigh" || observed === "Leak" || observed === "Top") {
    const next = prev === "EqHigh" ? "EqHigh" : "Leak"; // baseline High のみ非違反
    state.obsMem.set(obsId, join(prev, next));
  } else if (observed === "EqLow") {
    state.obsMem.set(obsId, join(prev, "EqLow"));
  }
}

// CTRLLEAK: 制御フロー観測の NS 側更新
export function updateCtrlObsNS(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  const next =
    observed === "EqHigh" || observed === "Leak" || observed === "Top"
      ? "EqHigh"
      : "EqLow";
  state.obsCtrl.set(obsId, join(prev, next));
}

// CTRLLEAK: 制御フロー観測の Spec 側更新
export function updateCtrlObsSpec(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  if (observed === "EqHigh" || observed === "Leak" || observed === "Top") {
    const next = prev === "EqHigh" ? "EqHigh" : "Leak";
    state.obsCtrl.set(obsId, join(prev, next));
  } else if (observed === "EqLow") {
    state.obsCtrl.set(obsId, join(prev, "EqLow"));
  }
}
