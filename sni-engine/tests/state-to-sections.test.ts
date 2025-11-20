import { describe, it, expect } from "vitest";
import { stateToSections } from "../lib/analysis/state-to-sections";
import type { AbsState } from "../lib/core/state";

function makeState(): AbsState {
  return {
    regs: new Map([
      ["r", { ns: "Low", sp: "High" }],
      ["b", { ns: "Bot", sp: "Low" }],
    ]),
    mem: new Map(),
    obsMem: new Map(),
    obsCtrl: new Map(),
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
});
