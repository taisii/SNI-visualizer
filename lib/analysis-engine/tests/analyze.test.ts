import { describe, expect, it, vi, beforeEach } from "vitest";

import type { StaticGraph } from "@/lib/analysis-schema";
import { analyze } from "../index";

var buildVCFGMock: ReturnType<typeof vi.fn>;
var analyzeVCFGMock: ReturnType<typeof vi.fn>;

vi.mock("@/vcfg-builder", () => {
  buildVCFGMock = vi.fn();
  return { buildVCFG: buildVCFGMock };
});

vi.mock("@/sni-engine", () => {
  analyzeVCFGMock = vi.fn();
  return { analyzeVCFG: analyzeVCFGMock };
});

describe("analysis-engine analyze", () => {
  beforeEach(() => {
    buildVCFGMock.mockReset();
    analyzeVCFGMock.mockReset();
  });

  it("デフォルトで traceMode=single-path をエンジンに渡す", async () => {
    const graph: StaticGraph = { nodes: [], edges: [] };
    buildVCFGMock.mockReturnValue(graph);
    analyzeVCFGMock.mockResolvedValue({
      schemaVersion: "1.2.0",
      graph,
      trace: { steps: [] },
      traceMode: "single-path",
      result: "Secure",
    });

    await analyze("source code");

    expect(buildVCFGMock).toHaveBeenCalledWith("source code", {
      mode: "light",
      windowSize: undefined,
      speculationMode: "discard",
    });
    expect(analyzeVCFGMock).toHaveBeenCalledWith(graph, {
      traceMode: "single-path",
      speculationMode: "discard",
      specMode: "light",
    });
  });

  it("traceMode とその他オプションを透過的に渡す", async () => {
    const graph: StaticGraph = { nodes: [], edges: [] };
    buildVCFGMock.mockReturnValue(graph);
    analyzeVCFGMock.mockResolvedValue({
      schemaVersion: "1.2.0",
      graph,
      trace: { steps: [] },
      traceMode: "bfs",
      result: "Secure",
    });

    await analyze("source code", {
      traceMode: "bfs",
      maxSteps: 3,
      windowSize: 10,
      speculationMode: "discard",
    });

    expect(buildVCFGMock).toHaveBeenCalledWith("source code", {
      mode: "meta",
      windowSize: 10,
      speculationMode: "discard",
    });
    expect(analyzeVCFGMock).toHaveBeenCalledWith(graph, {
      traceMode: "bfs",
      maxSteps: 3,
      speculationMode: "discard",
      specMode: "legacy-meta",
    });
  });

  it("light モードでは builder に mode を渡し、specWindow をエンジンへ渡す", async () => {
    const graph: StaticGraph = { nodes: [], edges: [] };
    buildVCFGMock.mockReturnValue(graph);
    analyzeVCFGMock.mockResolvedValue({
      schemaVersion: "1.2.0",
      graph,
      trace: { steps: [] },
      traceMode: "single-path",
      result: "Secure",
    });

    await analyze("src", {
      specMode: "light",
      specWindow: 5,
      speculationMode: "stack-guard",
    });

    expect(buildVCFGMock).toHaveBeenCalledWith("src", {
      mode: "light",
      windowSize: undefined,
      speculationMode: "stack-guard",
    });
    expect(analyzeVCFGMock).toHaveBeenCalledWith(graph, {
      specMode: "light",
      specWindow: 5,
      traceMode: "single-path",
      speculationMode: "stack-guard",
    });
  });

  it("ParseError でも traceMode を結果に残す", async () => {
    const err = new Error("parse failed");
    err.name = "ParseError";
    buildVCFGMock.mockImplementation(() => {
      throw err;
    });

    const res = await analyze("broken code", { traceMode: "bfs" });

    expect(analyzeVCFGMock).not.toHaveBeenCalled();
    expect(res.traceMode).toBe("bfs");
    expect(res.error?.type).toBe("ParseError");
  });
});
