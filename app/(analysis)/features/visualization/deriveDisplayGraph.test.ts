import { describe, it, expect } from "vitest";
import { buildVCFG } from "@/vcfg-builder";
import { deriveDisplayGraph } from "./deriveDisplayGraph";

describe("deriveDisplayGraph", () => {
  it("mode=vcfg では入力グラフをそのまま返す", () => {
    const vcfg = buildVCFG("skip\nskip\n");
    const out = deriveDisplayGraph(vcfg, "vcfg");
    expect(out).toEqual(vcfg);
  });

  it("mode=cfg で spec ノードと spec エッジを除去したグラフを返す", () => {
    const vcfg = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
    );
    const out = deriveDisplayGraph(vcfg, "cfg");
    expect(out).not.toBeNull();
    if (!out) return;

    expect(out.nodes.every((n) => n.type === "ns")).toBe(true);
    expect(out.edges.every((e) => e.type === "ns")).toBe(true);
  });

  it("null を渡した場合は null を返す", () => {
    expect(deriveDisplayGraph(null, "cfg")).toBeNull();
  });
});
