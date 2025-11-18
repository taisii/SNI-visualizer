import type { Identifier } from "./expr";

// ジャンプ先解決結果の分類
export type JumpResolution =
  | { kind: "pc"; pc: number; label?: Identifier }
  | { kind: "label"; label: Identifier } // ラベルとしては存在するが未解決（前方参照失敗など）
  | { kind: "dynamic" }; // 数値/ラベルに静的解決できない式
