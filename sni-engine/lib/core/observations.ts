import { join, type LatticeValue } from "./lattice";
import type { AbsState } from "./state";
// 観測履歴の一般マージ（経路合流用）: 格子の結合に従う
export function mergeObservation(
  current: LatticeValue,
  incoming: LatticeValue,
): LatticeValue {
  return join(current, incoming);
}

// NS 側更新（ベースライン構築）: 文献 4.4.2 の規則を実装
export function updateObservationNS(
  prev: LatticeValue,
  observed: LatticeValue,
): LatticeValue {
  // High 相当(Leak を含む)はベースラインを EqHigh に引き上げる
  const normalized = observed === "Leak" ? "EqHigh" : observed;
  if (normalized === "EqHigh") return "EqHigh";
  return mergeObservation(prev, normalized);
}

// SP 側更新（逸脱検査）: 文献 4.4.2 の規則を実装
export function updateObservationSpec(
  prev: LatticeValue,
  observed: LatticeValue,
): LatticeValue {
  if (prev === "Leak") return "Leak"; // 吸収律
  if (observed === "Leak") return "Leak";
  if ((prev === "EqLow" || prev === "Bot") && observed === "EqHigh")
    return "Leak";
  if (prev === "Top" || observed === "Top") return "Top";
  // それ以外は安全側に寄せるだけで、Leak にはしない
  return mergeObservation(prev, observed);
}

// MEMLEAK: メモリアクセス観測の NS 側更新
export function updateMemObsNS(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  const next = updateObservationNS(prev, observed);
  state.obsMem.set(obsId, next);
}

// MEMLEAK: メモリアクセス観測の Spec 側更新
export function updateMemObsSpec(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  const next = updateObservationSpec(prev, observed);
  state.obsMem.set(obsId, next);
}

// CTRLLEAK: 制御フロー観測の NS 側更新
export function updateCtrlObsNS(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  const next = updateObservationNS(prev, observed);
  state.obsCtrl.set(obsId, next);
}

// CTRLLEAK: 制御フロー観測の Spec 側更新
export function updateCtrlObsSpec(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  const next = updateObservationSpec(prev, observed);
  state.obsCtrl.set(obsId, next);
}
