import { describe, it, expect } from "vitest";
import type { AnalyzeOptions } from "@/lib/analysis-engine";

describe("lib/analysis-engine type exports", () => {
  it("should re-export AnalyzeOptions type", () => {
    // This test verifies that AnalyzeOptions is properly re-exported
    // If the type is not exported, TypeScript will fail to compile
    const options: AnalyzeOptions = {
      traceMode: "bfs",
      specWindow: 20,
    };

    expect(options.traceMode).toBe("bfs");
    expect(options.specWindow).toBe(20);
  });

  it("should accept optional traceMode", () => {
    const options: AnalyzeOptions = {
      specWindow: 10,
    };

    expect(options.specWindow).toBe(10);
    expect(options.traceMode).toBeUndefined();
  });

  it("should accept optional specWindow", () => {
    const options: AnalyzeOptions = {
      traceMode: "single-path",
    };

    expect(options.traceMode).toBe("single-path");
    expect(options.specWindow).toBeUndefined();
  });

  it("should accept empty options object", () => {
    const options: AnalyzeOptions = {};

    expect(options).toEqual({});
  });

  it("should allow both traceMode values", () => {
    const bfsOptions: AnalyzeOptions = { traceMode: "bfs" };
    const singlePathOptions: AnalyzeOptions = { traceMode: "single-path" };

    expect(bfsOptions.traceMode).toBe("bfs");
    expect(singlePathOptions.traceMode).toBe("single-path");
  });
});
