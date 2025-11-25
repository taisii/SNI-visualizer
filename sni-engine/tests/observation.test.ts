import { describe, it, expect } from "vitest";
import { bottomState } from "../lib/core/state";
import {
  updateMemObsNS,
  updateMemObsSpec,
  updateCtrlObsNS,
  updateCtrlObsSpec,
} from "../lib/core/observations";
import { stateHasViolation } from "../lib/core/state-ops";

describe("observation updates", () => {
  it("Spec observation upgrades from EqLow baseline to Leak when High appears", () => {
    const st = bottomState();
    updateMemObsNS(st, "m0", "EqLow"); // baseline Low
    updateMemObsSpec(st, "m0", "EqHigh"); // speculative High only
    expect(st.obsMem.get("m0")).toBe("Leak");
    expect(stateHasViolation(st)).toBe(true); // Leak triggers violation
  });

  it("control observations propagate Leak in Spec", () => {
    const st = bottomState();
    updateCtrlObsNS(st, "c1", "EqLow");
    updateCtrlObsSpec(st, "c1", "EqHigh");
    expect(st.obsCtrl.get("c1")).toBe("Leak");
    expect(stateHasViolation(st)).toBe(true);
  });

  it("Top in observations is warning-only (no violation)", () => {
    const st = bottomState();
    st.obsMem.set("mX", "Top");
    expect(stateHasViolation(st)).toBe(false);
  });

  it("Top observed in Spec does not escalate to Leak", () => {
    const st = bottomState();
    updateMemObsNS(st, "m1", "EqLow"); // ベースライン Low
    updateMemObsSpec(st, "m1", "Top"); // Spec 側で Top を観測
    expect(st.obsMem.get("m1")).toBe("Top");
    expect(stateHasViolation(st)).toBe(false);
  });

  it("NS で Leak を観測してもベースラインは EqHigh までで違反しない", () => {
    const st = bottomState();
    updateMemObsNS(st, "m2", "Leak"); // High 相当だが NS 側
    expect(st.obsMem.get("m2")).toBe("EqHigh");
    expect(stateHasViolation(st)).toBe(false);
  });

  it("Spec 観測でベースライン Top の場合は Top のまま", () => {
    const st = bottomState();
    st.obsMem.set("m3", "Top"); // 解析不能だが非違反
    updateMemObsSpec(st, "m3", "EqHigh");
    expect(st.obsMem.get("m3")).toBe("Top");
    expect(stateHasViolation(st)).toBe(false);
  });
});
