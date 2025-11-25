import { describe, expect, it, vi, beforeEach } from "vitest";

import type { StaticGraph } from "@/lib/analysis-schema";
import { analyze } from "../index";

const { buildVCFGMock, analyzeVCFGMock } = vi.hoisted(() => ({
  buildVCFGMock: vi.fn(),
  analyzeVCFGMock: vi.fn(),
}));

vi.mock("@/vcfg-builder", () => ({ buildVCFG: buildVCFGMock }));
vi.mock("@/sni-engine", () => ({ analyzeVCFG: analyzeVCFGMock }));

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

    expect(buildVCFGMock).toHaveBeenCalledWith("source code", {});
    expect(analyzeVCFGMock).toHaveBeenCalledWith(graph, {
      traceMode: "single-path",
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
      specWindow: 10,
    });

    expect(buildVCFGMock).toHaveBeenCalledWith("source code", {});
    expect(analyzeVCFGMock).toHaveBeenCalledWith(graph, {
      traceMode: "bfs",
      maxSteps: 3,
      specWindow: 10,
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
