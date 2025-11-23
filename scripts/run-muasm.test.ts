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
  beforeEach(() => {});

  afterEach(() => {});

  it("defaults to bfs", () => {
    const parsed = parseArgs([]);
    expect(parsed.options.traceMode).toBe("bfs");
  });

  it("accepts dfs alias (single-path)", () => {
    const parsed = parseArgs(["--trace-mode", "dfs"]);
    expect(parsed.options.traceMode).toBe("single-path");
  });

  it("rejects non-positive spec-window", () => {
    expect(() => parseArgs(["--spec-window", "0"])).toThrow(
      /spec-window は正の整数/,
    );
  });

  it("passes options to analyze()", async () => {
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
        specWindow: 5,
      },
      analyzeStub,
    );

    expect(ok).toBe(true);
    expect(calls[0]).toEqual({
      source: "skip\n",
      opts: {
        traceMode: "single-path",
        specWindow: 5,
      },
    });
  });
});
