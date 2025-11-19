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
});
