import { describe, it, expect } from "vitest";
import { analyze } from "../index";

describe("analysis-engine analyze (integration)", () => {
  it("runs with default single-path traceMode", async () => {
    const res = await analyze("skip\n");
    expect(res.traceMode).toBe("single-path");
    expect(res.error).toBeUndefined();
  });

  it("honors provided traceMode/specWindow options", async () => {
    const res = await analyze("skip\n", { traceMode: "bfs", specWindow: 7 });
    expect(res.traceMode).toBe("bfs");
    expect(res.specWindow).toBe(7);
  });

  it("returns AnalysisError when specWindow is non-positive", async () => {
    const res = await analyze("skip\n", { specWindow: 0 });
    expect(res.error?.type).toBe("AnalysisError");
    expect(res.result).toBe("SNI_Violation");
  });

  it("surfaces Top warnings from engine", async () => {
    const res = await analyze("beqz cond, L\nL: skip\n", {
      policy: { regs: { cond: "Top" } },
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toBe("Secure");
    expect(res.warnings?.some((w) => w.type === "TopObserved")).toBe(true);
  });
});
