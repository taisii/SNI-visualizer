import { describe, it, expect } from "vitest";
import type { GraphNode } from "@/lib/analysis-schema";
import { applyInstruction } from "../lib/semantics/apply-instruction";
import { makeRel, type AbsState } from "../lib/core/state";

describe("applyInstruction (cmov)", () => {
  it("joins cond/value and recomputes rel via makeRel", () => {
    const node: GraphNode = {
      id: "n0",
      pc: 0,
      type: "ns",
      label: "0: cmov d c v",
      instruction: "cmov d c v",
    };

    const state: AbsState = {
      regs: new Map([
        ["c", makeRel("Low", "Low")],
        ["v", makeRel("Top", "High")],
      ]),
      mem: new Map(),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: "inf",
    };

    const next = applyInstruction(node, state, "NS");
    const dst = next.regs.get("d");

    expect(dst?.ns).toBe("Top");
    expect(dst?.sp).toBe("High");
    expect(dst?.rel).toBe("Top"); // rel が再計算されることを確認
  });

  it("introduces Diverge on speculative store to mark possible divergence", () => {
    const node: GraphNode = {
      id: "n0",
      pc: 0,
      type: "spec",
      label: "0: store r1, 0",
      instruction: "store r1, 0",
    };
    const base = makeRel("Low", "Low");
    const state: AbsState = {
      regs: new Map([["r1", base]]),
      mem: new Map([["0", base]]),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 2,
    };

    const next = applyInstruction(node, state, "Speculative");
    const memRel = next.mem.get("0");
    expect(memRel?.ns).toBe("Low");
    expect(memRel?.sp).toBe("Low");
    expect(memRel?.rel).toBe("Diverge");
  });

  it("adds Diverge on speculative assign when値が低機密で一致", () => {
    const node: GraphNode = {
      id: "n1",
      pc: 1,
      type: "spec",
      label: "1: assign dst src",
      instruction: "assign dst src",
    };
    const state: AbsState = {
      regs: new Map([
        ["src", makeRel("Low", "Low")],
        ["dst", makeRel("Low", "Low")],
      ]),
      mem: new Map(),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    const dst = next.regs.get("dst");
    expect(dst?.ns).toBe("Low");
    expect(dst?.sp).toBe("Low");
    expect(dst?.rel).toBe("Diverge");
  });

  it("introduces Diverge on speculative load even when addr/value are Low", () => {
    const node: GraphNode = {
      id: "n1a",
      pc: 1,
      type: "spec",
      label: "1: load dst, addr",
      instruction: "load dst addr",
    };
    const base = makeRel("Low", "Low");
    const state: AbsState = {
      regs: new Map([["addr", base]]),
      mem: new Map([["addr", base]]),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    const dst = next.regs.get("dst");
    expect(dst?.ns).toBe("Low");
    expect(dst?.sp).toBe("Low");
    expect(dst?.rel).toBe("Diverge");
  });

  it("introduces Diverge on speculative cmov even when cond/value are Low", () => {
    const node: GraphNode = {
      id: "n1b",
      pc: 1,
      type: "spec",
      label: "1: cmov dst cond src",
      instruction: "cmov dst cond src",
    };
    const base = makeRel("Low", "Low");
    const state: AbsState = {
      regs: new Map([
        ["cond", base],
        ["src", base],
        ["dst", base],
      ]),
      mem: new Map(),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    const dst = next.regs.get("dst");
    expect(dst?.ns).toBe("Low");
    expect(dst?.sp).toBe("Low");
    expect(dst?.rel).toBe("Diverge");
  });

  it("HKSパターンの投機的storeでもLeakを維持する（Low/High -> Leak）", () => {
    const node: GraphNode = {
      id: "n2",
      pc: 2,
      type: "spec",
      label: "2: store r1, addr",
      instruction: "store r1, addr",
    };
    const leakish = makeRel("Low", "High"); // ns=Low, sp=High → Leak
    const state: AbsState = {
      regs: new Map([
        ["r1", leakish],
        ["addr", leakish],
      ]),
      mem: new Map([["addr", leakish]]),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    const memRel = next.mem.get("addr");
    expect(memRel?.ns).toBe("Low");
    expect(memRel?.sp).toBe("High");
    expect(memRel?.rel).toBe("Leak");
  });

  it("beqz の投機実行で High 条件は観測を Leak に格上げする", () => {
    const node: GraphNode = {
      id: "n3",
      pc: 3,
      type: "spec",
      label: "3: beqz cond L1",
      instruction: "beqz cond L1",
    };
    const state: AbsState = {
      regs: new Map([["cond", makeRel("Low", "High")]]),
      mem: new Map(),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    expect(next.obsCtrl.get("3")).toBe("Leak");
  });

  it("Spec 側で High を観測しても NS ベースラインが EqHigh なら Leak に昇格しない", () => {
    const node: GraphNode = {
      id: "n3b",
      pc: 3,
      type: "spec",
      label: "3: beqz cond L1",
      instruction: "beqz cond L1",
    };
    const state: AbsState = {
      regs: new Map([["cond", makeRel("High", "High")]]),
      mem: new Map(),
      obsMem: new Map(),
      obsCtrl: new Map([["3", "EqHigh"]]), // NS 側で既に High を観測済み
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    expect(next.obsCtrl.get("3")).toBe("EqHigh");
  });

  it("jmp の投機実行はターゲット式の Spec 成分を観測に使う", () => {
    const node: GraphNode = {
      id: "n4",
      pc: 4,
      type: "spec",
      label: "4: jmp tgt",
      instruction: "jmp tgt",
    };
    const state: AbsState = {
      regs: new Map([["tgt", makeRel("Low", "High")]]),
      mem: new Map(),
      obsMem: new Map(),
      obsCtrl: new Map(),
      budget: 1,
    };

    const next = applyInstruction(node, state, "Speculative");
    expect(next.obsCtrl.get("4:target:tgt")).toBe("Leak");
  });
});
