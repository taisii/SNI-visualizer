import { describe, it, expect } from "vitest";
import { initState, makeRel } from "../lib/core/state";

describe("initState with Top/Bot policy", () => {
  it("initializes regs and mem including Top/Bot levels", () => {
    const state = initState({
      regs: { a: "Top", b: "Bot" },
      mem: { m: "Top", z: "Bot" },
    });

    expect(state.regs.get("a")).toEqual(makeRel("Top", "Top"));
    expect(state.regs.get("b")).toEqual(makeRel("Bot", "Bot"));
    expect(state.mem.get("m")).toEqual(makeRel("Top", "Top"));
    expect(state.mem.get("z")).toEqual(makeRel("Bot", "Bot"));
  });
});
