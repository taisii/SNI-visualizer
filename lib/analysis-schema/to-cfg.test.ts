import { describe, it, expect } from "vitest";
import { buildVCFG } from "@/vcfg-builder";
import { toCFG } from "./to-cfg";
import type { StaticGraph } from "./index";

describe("toCFG", () => {
  it("spec ノードと spec エッジを除去して ns だけ残す", () => {
    const vcfg = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
    );

    const cfg = toCFG(vcfg);

    expect(cfg.nodes.every((n) => n.type === "ns")).toBe(true);
    expect(cfg.edges.every((e) => e.type === "ns")).toBe(true);

    const expectedNodeIds = vcfg.nodes
      .filter((n) => n.type === "ns")
      .map((n) => n.id)
      .sort();
    expect(cfg.nodes.map((n) => n.id).sort()).toEqual(expectedNodeIds);
  });

  it("入力グラフを破壊しない（参照と長さが変わらない）", () => {
    const vcfg: StaticGraph = buildVCFG("skip\nskip\n");
    const origNodesLen = vcfg.nodes.length;
    const origEdgesLen = vcfg.edges.length;

    const cfg = toCFG(vcfg);

    // 入力はそのまま
    expect(vcfg.nodes.length).toBe(origNodesLen);
    expect(vcfg.edges.length).toBe(origEdgesLen);
    // 出力は別インスタンス
    expect(cfg.nodes).not.toBe(vcfg.nodes);
    expect(cfg.edges).not.toBe(vcfg.edges);
  });

  it("既に spec を含まないグラフはそのまま返す", () => {
    const vcfg = buildVCFG("skip\nskip\n");
    const cfg = toCFG(vcfg);
    expect(cfg).toEqual(vcfg);
  });
});
