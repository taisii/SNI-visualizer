import { join, type LatticeValue } from "./lattice";

// ns / spec の個別成分（4値）と、その関係を表す格子値を併せて保持する
export type SecurityPoint = "Low" | "High" | "Bot" | "Top";

// Policy が Top/Bot を許容するケースがあるため含めておく
export type SecurityLevel = "Low" | "High" | "Top" | "Bot";

export type RelValue = {
  ns: SecurityPoint;
  sp: SecurityPoint;
  rel: LatticeValue;
};

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
      if (lvl === "Low") {
        regs.set(k, defaultRegRel());
      } else if (lvl === "High") {
        regs.set(k, makeRel("High", "High"));
      } else if (lvl === "Top") {
        regs.set(k, makeRel("Top", "Top"));
      } else {
        regs.set(k, makeRel("Bot", "Bot"));
      }
    }
  }

  if (policy?.mem) {
    for (const [k, lvl] of Object.entries(policy.mem)) {
      if (lvl === "Low") {
        mem.set(k, defaultMemRel());
      } else if (lvl === "High") {
        mem.set(k, makeRel("High", "High"));
      } else if (lvl === "Top") {
        mem.set(k, makeRel("Top", "Top"));
      } else {
        mem.set(k, makeRel("Bot", "Bot"));
      }
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
  return makeRel("Low", "Low");
}

export function defaultMemRel(): RelValue {
  return makeRel("High", "High");
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
    case "Leak":
    case "Diverge":
      // Leak/Diverge など関係専用の値は Top 扱いで潰す
      return "Top";
  }
}

export function joinSecurity(
  a: SecurityPoint,
  b: SecurityPoint,
): SecurityPoint {
  return latticeToSecurity(join(securityToLattice(a), securityToLattice(b)));
}

export function isHighLike(v: SecurityPoint): boolean {
  return v === "High" || v === "Top";
}

// --- RelValue 補助 ---
export function deriveRelation(
  ns: SecurityPoint,
  sp: SecurityPoint,
): LatticeValue {
  if (ns === "Bot" || sp === "Bot") return "Bot";
  if (ns === "Top" || sp === "Top") return "Top";
  if (ns === "High" && sp === "High") return "EqHigh";
  if (ns === "Low" && sp === "Low") return "EqLow";
  if ((ns === "Low" && sp === "High") || (ns === "High" && sp === "Low"))
    return "Leak";
  return "Top";
}

export function makeRel(ns: SecurityPoint, sp: SecurityPoint): RelValue {
  return { ns, sp, rel: deriveRelation(ns, sp) };
}
