import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisResult,
} from "@/lib/analysis-schema";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { parseArgs, runSingleCase } from "./run-muasm";

describe("run-muasm CLI options", () => {
  beforeEach(() => {
  });

  afterEach(() => {
  });

  it("defaults to bfs / stack-guard", () => {
    const parsed = parseArgs([]);
    expect(parsed.options.traceMode).toBe("bfs");
    expect(parsed.options.speculationMode).toBe("stack-guard");
  });

  it("accepts dfs alias (single-path)", () => {
    const parsed = parseArgs(["--trace-mode", "dfs"]);
    expect(parsed.options.traceMode).toBe("single-path");
  });

  it("accepts stack-guard spec mode", () => {
    const parsed = parseArgs(["--spec-mode", "stack-guard"]);
    expect(parsed.options.speculationMode).toBe("stack-guard");
  });

  it("passes modes to analyze()", async () => {
    // create temp muasm file
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "muasm-"));
    const file = path.join(dir, "case.muasm");
    await fs.writeFile(file, "skip\n", "utf8");

    const calls: unknown[] = [];
    const analyzeStub = async (
      source: string,
      opts: Parameters<typeof runSingleCase>[1],
    ): Promise<AnalysisResult> => {
      calls.push({ source, opts });
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph: { nodes: [], edges: [] },
        trace: { steps: [] },
        traceMode: opts.traceMode,
        result: "Secure",
      };
    };

    const ok = await runSingleCase(
      file,
      {
        traceMode: "single-path",
        speculationMode: "discard",
      },
      analyzeStub,
    );

    expect(ok).toBe(true);
    expect(calls[0]).toEqual({
      source: "skip\n",
      opts: {
        traceMode: "single-path",
        speculationMode: "discard",
        windowSize: undefined,
      },
    });
  });
});
