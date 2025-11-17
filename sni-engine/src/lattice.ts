import type { DisplayValue } from "../../app/types/analysis-result";

export type LatticeValue =
  | "Bot"
  | "EqLow"
  | "EqHigh"
  | "Diverge"
  | "Leak"
  | "Top";

// 上からの安全順序を表現する配列（インデックスが高さに対応）
const ORDER: LatticeValue[] = ["Bot", "EqLow", "EqHigh", "Diverge", "Leak", "Top"];

// Join 表を仕様通り固定で持つ。計算負荷を避け、表引き一択にする。
const JOIN_TABLE: Record<LatticeValue, Record<LatticeValue, LatticeValue>> = {
  Bot:     { Bot: "Bot",     EqLow: "EqLow", EqHigh: "EqHigh", Diverge: "Diverge", Leak: "Leak", Top: "Top" },
  EqLow:   { Bot: "EqLow",   EqLow: "EqLow", EqHigh: "EqHigh", Diverge: "Diverge", Leak: "Leak", Top: "Top" },
  EqHigh:  { Bot: "EqHigh",  EqLow: "EqHigh", EqHigh: "EqHigh", Diverge: "Top",     Leak: "Top",  Top: "Top" },
  Diverge: { Bot: "Diverge", EqLow: "Diverge", EqHigh: "Top",  Diverge: "Diverge", Leak: "Top",  Top: "Top" },
  Leak:    { Bot: "Leak",    EqLow: "Leak",  EqHigh: "Top",    Diverge: "Top",     Leak: "Leak", Top: "Top" },
  Top:     { Bot: "Top",     EqLow: "Top",   EqHigh: "Top",    Diverge: "Top",     Leak: "Top",  Top: "Top" },
};

export function join(a: LatticeValue, b: LatticeValue): LatticeValue {
  return JOIN_TABLE[a][b];
}

export function lte(a: LatticeValue, b: LatticeValue): boolean {
  return ORDER.indexOf(a) <= ORDER.indexOf(b);
}

export function toDisplay(value: LatticeValue): DisplayValue {
  switch (value) {
    case "Bot":
      return { label: "⊥", style: "neutral", description: "未到達または未初期化" };
    case "EqLow":
      return { label: "EqLow", style: "safe", description: "NS/Spec とも Low で等価" };
    case "EqHigh":
      return { label: "EqHigh", style: "warning", description: "High だが NS/Spec で等価（許容漏洩）" };
    case "Diverge":
      return { label: "Diverge", style: "info", description: "Low だが NS と Spec で値が分岐" };
    case "Leak":
      return { label: "Leak", style: "danger", description: "投機のみで High が観測された可能性" };
    default:
      return { label: "Top", style: "danger", description: "解析不能または複数状態の混合" };
  }
}

export const LATTICE_VALUES: LatticeValue[] = ORDER;
