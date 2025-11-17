import type { LatticeValue } from "./lattice";

export type SecurityLevel = "Low" | "High";

export type InitPolicy = {
  regs?: Record<string, SecurityLevel>;
  mem?: Record<string, SecurityLevel>;
};

export type AbsState = {
  regs: Map<string, LatticeValue>;
  mem: Map<string, LatticeValue>;
  obs: Map<number, LatticeValue>;
};

export function bottomState(): AbsState {
  return { regs: new Map(), mem: new Map(), obs: new Map() };
}

export function cloneState(src: AbsState): AbsState {
  return {
    regs: new Map(src.regs),
    mem: new Map(src.mem),
    obs: new Map(src.obs),
  };
}

/**
 * 初期化ルール:
 * - entryRegs に指定されたレジスタは EqLow で初期化（ポリシーで上書き可）
 * - policy 指定があれば Low->EqLow, High->EqHigh を設定
 * - それ以外の未設定項目は Map に含めない（意味的に Bot 扱い）
 */
export function initState(
  policy?: InitPolicy,
  entryRegs: string[] = [],
): AbsState {
  const regs = new Map<string, LatticeValue>();
  const mem = new Map<string, LatticeValue>();
  const obs = new Map<number, LatticeValue>();

  for (const r of entryRegs) {
    regs.set(r, "EqLow");
  }

  if (policy?.regs) {
    for (const [k, lvl] of Object.entries(policy.regs)) {
      regs.set(k, lvl === "Low" ? "EqLow" : "EqHigh");
    }
  }

  if (policy?.mem) {
    for (const [k, lvl] of Object.entries(policy.mem)) {
      mem.set(k, lvl === "Low" ? "EqLow" : "EqHigh");
    }
  }

  return { regs, mem, obs };
}

/**
 * 仕様上「エントリ以外=EqHigh」を既定値とする。
 * 未到達ノードでは state 自体が存在しないため Bot のまま。
 */
export function defaultLattice(): LatticeValue {
  return "EqHigh";
}
