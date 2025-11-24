import { describe, expect, it } from "vitest";
import { join, toDisplay, LATTICE_VALUES } from "../lib/core/lattice";

const lv = LATTICE_VALUES;

const expected = {
  Bot: {
    Bot: "Bot",
    EqLow: "EqLow",
    Diverge: "Diverge",
    EqHigh: "EqHigh",
    Leak: "Leak",
    Top: "Top",
  },
  EqLow: {
    Bot: "EqLow",
    EqLow: "EqLow",
    Diverge: "Diverge",
    EqHigh: "EqHigh",
    Leak: "Leak",
    Top: "Top",
  },
  Diverge: {
    Bot: "Diverge",
    EqLow: "Diverge",
    Diverge: "Diverge",
    EqHigh: "EqHigh",
    Leak: "Leak",
    Top: "Top",
  },
  EqHigh: {
    Bot: "EqHigh",
    EqLow: "EqHigh",
    Diverge: "EqHigh",
    EqHigh: "EqHigh",
    Leak: "Leak",
    Top: "Top",
  },
  Leak: {
    Bot: "Leak",
    EqLow: "Leak",
    Diverge: "Leak",
    EqHigh: "Leak",
    Leak: "Leak",
    Top: "Top",
  },
  Top: {
    Bot: "Top",
    EqLow: "Top",
    EqHigh: "Top",
    Diverge: "Top",
    Leak: "Top",
    Top: "Top",
  },
} as const;

describe("join table", () => {
  for (const a of lv) {
    for (const b of lv) {
      it(`${a} ⊔ ${b} = ${expected[a][b]}`, () => {
        expect(join(a, b)).toBe(expected[a][b]);
      });
    }
  }
});

describe("toDisplay", () => {
  it("maps Bot to neutral label", () => {
    expect(toDisplay("Bot")).toMatchObject({ label: "Bot", style: "neutral" });
  });
  it("maps Leak to danger", () => {
    expect(toDisplay("Leak").style).toBe("danger");
  });

  it("treats Top as absorbing when joined with Leak", () => {
    expect(join("Top", "Leak")).toBe("Top");
    expect(join("Leak", "Top")).toBe("Top");
  });
});
