import type { LatticeValue } from "./lattice";

export type SecurityLevel = "Low" | "High";

export type RelValue = { ns: LatticeValue; sp: LatticeValue };

export type InitPolicy = {
	regs?: Record<string, SecurityLevel>;
	mem?: Record<string, SecurityLevel>;
};

export type AbsState = {
	regs: Map<string, RelValue>;
	mem: Map<string, RelValue>;
	// メモリアクセスに関する観測履歴 (MEMLEAK 用)
	obsMem: Map<string, LatticeValue>;
	// 分岐やジャンプに関する観測履歴 (CTRLLEAK 用、現状は未使用で常に空)
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
				lvl === "Low" ? defaultRegRel() : { ns: "EqHigh", sp: "EqHigh" },
			);
		}
	}

	if (policy?.mem) {
		for (const [k, lvl] of Object.entries(policy.mem)) {
			mem.set(
				k,
				lvl === "Low" ? defaultMemRel() : { ns: "EqHigh", sp: "EqHigh" },
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
	return { ns: "EqLow", sp: "EqLow" };
}

export function defaultMemRel(): RelValue {
	return { ns: "EqHigh", sp: "EqHigh" };
}
