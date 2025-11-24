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

  it("does not introduce Diverge on speculative store with consistent value", () => {
    const node: GraphNode = {
      id: "n0",
      pc: 0,
      type: "spec",
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
    expect(memRel?.rel).toBe("EqLow");
    expect(memRel?.sp).toBe("Low");
    expect(memRel?.ns).toBe("Low");
  });
});
