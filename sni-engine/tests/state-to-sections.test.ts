import { describe, it, expect } from "vitest";
import { stateToSections } from "../lib/analysis/state-to-sections";
import type { AbsState } from "../lib/core/state";

function makeState(): AbsState {
  return {
    regs: new Map([
      ["r", { ns: "Low", sp: "High", rel: "Leak" }],
      ["b", { ns: "Bot", sp: "Low", rel: "Top" }],
    ]),
    mem: new Map(),
    obsMem: new Map(),
    obsCtrl: new Map(),
    budget: "inf",
  };
}

describe("stateToSections", () => {
  it("keeps ns/sp as security points and join as lattice", () => {
    const sections = stateToSections(makeState()).sections;
    const regs = sections.find((s) => s.id === "regs")?.data ?? {};
    const r = regs.r;
    expect(r.detail?.ns).toBe("Low");
    expect(r.detail?.sp).toBe("High");

    const b = regs.b;
    expect(b.detail?.ns).toBe("Bot");
    expect(b.detail?.sp).toBe("Low");
  });

  it("adds specStack section when stack is given", () => {
    const stack = ["specA", "specB"];
    const sections = stateToSections(makeState(), {
      specStack: stack,
    }).sections;
    const specSection = sections.find((s) => s.id === "specStack");
    expect(specSection).toBeDefined();
    expect(specSection?.data.d2.label).toBe("specA");
    expect(specSection?.data.d1.label).toBe("specB");
  });

  it("includes empty specStack section when stack is omitted", () => {
    const sections = stateToSections(makeState()).sections;
    const specSection = sections.find((s) => s.id === "specStack");
    expect(specSection).toBeDefined();
    expect(Object.keys(specSection?.data ?? {}).length).toBe(0);
  });

  it("injects spec context metadata when provided", () => {
    const stack = ["ctxBegin", "ctxNested"];
    const info = new Map([
      [
        "ctxBegin",
        {
          id: "ctxBegin",
          originLabel: "beqz x, L1",
          assumption: "x == 0",
        },
      ],
      [
        "ctxNested",
        {
          id: "ctxNested",
          originLabel: "bnez y, L2",
          assumption: "y != 0",
        },
      ],
    ]);

    const sections = stateToSections(makeState(), {
      specStack: stack,
      specContextInfo: info,
    }).sections;

    const specSection = sections.find((s) => s.id === "specStack");
    expect(specSection).toBeDefined();
    expect(specSection?.data.d2.label).toBe("beqz x, L1");
    expect(specSection?.data.d2.description).toBe("仮定: x == 0");
    expect(specSection?.data.d1.label).toBe("bnez y, L2");
    expect(specSection?.data.d1.description).toBe("仮定: y != 0");
  });

  it("omits budget section for non-speculative (infinite) budget", () => {
    const sections = stateToSections(makeState()).sections;
    const budgetSection = sections.find((s) => s.id === "specBudget");
    expect(budgetSection).toBeUndefined();
  });

  it("shows budget section when budget is finite", () => {
    const finite = makeState();
    finite.budget = 3;
    const sections = stateToSections(finite).sections;
    const budgetSection = sections.find((s) => s.id === "specBudget");
    expect(budgetSection).toBeDefined();
    expect(budgetSection?.data.w.label).toBe("3");
  });
});
