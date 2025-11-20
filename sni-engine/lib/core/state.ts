import { join, type LatticeValue } from "./lattice";

// ns / spec の個別成分は Leak/Diverge を取り得ない 4 値に限定する
export type SecurityPoint = "Low" | "High" | "Bot" | "Top";

export type SecurityLevel = "Low" | "High";

export type RelValue = { ns: SecurityPoint; sp: SecurityPoint };

export type InitPolicy = {
  regs?: Record<string, SecurityLevel>;
  mem?: Record<string, SecurityLevel>;
};

export type AbsState = {
  regs: Map<string, RelValue>;
  mem: Map<string, RelValue>;
  // メモリアクセスに関する観測履歴 (MEMLEAK 用)
  obsMem: Map<string, LatticeValue>;
  // 分岐やジャンプに関する観測履歴 (CTRLLEAK 用)
  obsCtrl: Map<string, LatticeValue>;
};

export function bottomState(): AbsState {
  return {
    regs: new Map(),
    mem: new Map(),
    obsMem: new Map(),
    obsCtrl: new Map(),
  };
}

export function cloneState(src: AbsState): AbsState {
  return {
    regs: new Map(src.regs),
    mem: new Map(src.mem),
    obsMem: new Map(src.obsMem),
    obsCtrl: new Map(src.obsCtrl),
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
  const regs = new Map<string, RelValue>();
  const mem = new Map<string, RelValue>();
  const obsMem = new Map<string, LatticeValue>();
  const obsCtrl = new Map<string, LatticeValue>();

  for (const r of entryRegs) {
    regs.set(r, defaultRegRel());
  }

  if (policy?.regs) {
    for (const [k, lvl] of Object.entries(policy.regs)) {
      regs.set(
        k,
        lvl === "Low" ? defaultRegRel() : { ns: "High", sp: "High" },
      );
    }
  }

  if (policy?.mem) {
    for (const [k, lvl] of Object.entries(policy.mem)) {
      mem.set(
        k,
        lvl === "Low" ? defaultMemRel() : { ns: "High", sp: "High" },
      );
    }
  }

  return { regs, mem, obsMem, obsCtrl };
}

/**
 * 仕様上「エントリ以外=EqHigh」を既定値とする。
 * 未到達ノードでは state 自体が存在しないため Bot のまま。
 */
export function defaultLattice(): LatticeValue {
  return "EqHigh";
}

export function defaultRegRel(): RelValue {
  return { ns: "Low", sp: "Low" };
}

export function defaultMemRel(): RelValue {
  return { ns: "High", sp: "High" };
}

// --- SecurityPoint と LatticeValue の橋渡し ---
export function securityToLattice(v: SecurityPoint): LatticeValue {
  switch (v) {
    case "Low":
      return "EqLow";
    case "High":
      return "EqHigh";
    case "Bot":
      return "Bot";
    case "Top":
    default:
      return "Top";
  }
}

export function latticeToSecurity(v: LatticeValue): SecurityPoint {
  switch (v) {
    case "EqLow":
      return "Low";
    case "EqHigh":
      return "High";
    case "Bot":
      return "Bot";
    case "Top":
    default:
      // Leak/Diverge など関係専用の値は Top 扱いで潰す
      return "Top";
  }
}

export function joinSecurity(a: SecurityPoint, b: SecurityPoint): SecurityPoint {
  return latticeToSecurity(join(securityToLattice(a), securityToLattice(b)));
}

export function isHighLike(v: SecurityPoint): boolean {
  return v === "High" || v === "Top";
}
