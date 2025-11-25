import type { DisplayValue } from "@/lib/analysis-schema";

export type LatticeValue =
  | "Bot"
  | "EqLow"
  | "Diverge"
  | "EqHigh"
  | "Leak"
  | "Top";

// 表示や列挙のための固定順序（安全順の全順序ではない点に注意）
const ORDER: LatticeValue[] = [
  "Bot",
  "EqLow",
  "Diverge",
  "EqHigh",
  "Leak",
  "Top",
];

// Join 表を仕様通り固定で持つ。計算負荷を避け、表引き一択にする。
const JOIN_TABLE: Record<LatticeValue, Record<LatticeValue, LatticeValue>> = {
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
      return {
        label: "Bot",
        style: "neutral",
        description: "未到達または未初期化",
      };
    case "EqLow":
      return {
        label: "Low",
        style: "safe",
        description: "NS/Spec とも Low で等価",
      };
    case "EqHigh":
      return {
        label: "High",
        style: "warning",
        description: "High だが NS/Spec で等価（許容漏洩）",
      };
    case "Diverge":
      return {
        label: "Diverge",
        style: "info",
        description: "Low だが NS と Spec で値が分岐",
      };
    case "Leak":
      return {
        label: "Leak",
        style: "danger",
        description: "投機のみで High が観測された可能性",
      };
    default:
      return {
        label: "Top",
        style: "danger",
        description: "解析不能または複数状態の混合",
      };
  }
}

export const LATTICE_VALUES: LatticeValue[] = ORDER;
