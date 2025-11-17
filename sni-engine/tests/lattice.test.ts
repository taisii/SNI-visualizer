import { describe, expect, it } from "vitest";
import { join, toDisplay, LATTICE_VALUES } from "../src/lattice";

const lv = LATTICE_VALUES;

const expected = {
  Bot: {
    Bot: "Bot",
    EqLow: "EqLow",
    EqHigh: "EqHigh",
    Diverge: "Diverge",
    Leak: "Leak",
    Top: "Top",
  },
  EqLow: {
    Bot: "EqLow",
    EqLow: "EqLow",
    EqHigh: "EqHigh",
    Diverge: "Diverge",
    Leak: "Leak",
    Top: "Top",
  },
  EqHigh: {
    Bot: "EqHigh",
    EqLow: "EqHigh",
    EqHigh: "EqHigh",
    Diverge: "Top",
    Leak: "Top",
    Top: "Top",
  },
  Diverge: {
    Bot: "Diverge",
    EqLow: "Diverge",
    EqHigh: "Top",
    Diverge: "Diverge",
    Leak: "Top",
    Top: "Top",
  },
  Leak: {
    Bot: "Leak",
    EqLow: "Leak",
    EqHigh: "Top",
    Diverge: "Top",
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
  it("maps Bot to neutral symbol", () => {
    expect(toDisplay("Bot")).toMatchObject({ label: "⊥", style: "neutral" });
  });
  it("maps Leak to danger", () => {
    expect(toDisplay("Leak").style).toBe("danger");
  });
});
