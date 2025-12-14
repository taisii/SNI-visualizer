import { describe, it, expect } from "vitest";
import { formatObservationKey } from "./formatObservationKey";

describe("formatObservationKey", () => {
  describe("obsCtrl section", () => {
    it("should format simple PC key without target", () => {
      const pcToInstr = new Map([[3, "beqz r1, label"]]);
      const result = formatObservationKey("obsCtrl", "3", pcToInstr);
      expect(result).toBe("3: beqz r1, label");
    });

    it("should format simple PC key without instruction", () => {
      const pcToInstr = new Map<number, string>();
      const result = formatObservationKey("obsCtrl", "3", pcToInstr);
      expect(result).toBe("pc=3");
    });

    it("should format PC:target:expr key with instruction", () => {
      const pcToInstr = new Map([[4, "jmp target"]]);
      const result = formatObservationKey("obsCtrl", "4:target:tgt", pcToInstr);
      expect(result).toBe("4: jmp target [target=tgt]");
    });

    it("should format PC:target:expr key without instruction", () => {
      const pcToInstr = new Map<number, string>();
      const result = formatObservationKey("obsCtrl", "4:target:tgt", pcToInstr);
      expect(result).toBe("pc=4 target=tgt");
    });

    it("should handle complex target expressions", () => {
      const pcToInstr = new Map([[5, "jmp [r1+r2]"]]);
      const result = formatObservationKey(
        "obsCtrl",
        "5:target:r1+r2",
        pcToInstr,
      );
      expect(result).toBe("5: jmp [r1+r2] [target=r1+r2]");
    });

    it("should return original key if format doesn't match", () => {
      const pcToInstr = new Map<number, string>();
      const result = formatObservationKey("obsCtrl", "invalid:key", pcToInstr);
      expect(result).toBe("invalid:key");
    });

    it("should handle empty instruction string", () => {
      const pcToInstr = new Map([[3, ""]]);
      const result = formatObservationKey("obsCtrl", "3", pcToInstr);
      expect(result).toBe("pc=3");
    });
  });

  describe("obsMem section", () => {
    it("should format PC:addr key with instruction", () => {
      const pcToInstr = new Map([[1, "load r1, x"]]);
      const result = formatObservationKey("obsMem", "1:x", pcToInstr);
      expect(result).toBe("1: load r1, x [addr=x]");
    });

    it("should format PC:addr key without instruction", () => {
      const pcToInstr = new Map<number, string>();
      const result = formatObservationKey("obsMem", "1:x", pcToInstr);
      expect(result).toBe("pc=1 addr=x");
    });

    it("should handle complex addresses", () => {
      const pcToInstr = new Map([[2, "store [r1+8], r2"]]);
      const result = formatObservationKey("obsMem", "2:[r1+8]", pcToInstr);
      expect(result).toBe("2: store [r1+8], r2 [addr=[r1+8]]");
    });

    it("should return original key if format doesn't match", () => {
      const pcToInstr = new Map<number, string>();
      const result = formatObservationKey("obsMem", "invalid", pcToInstr);
      expect(result).toBe("invalid");
    });
  });

  describe("other sections", () => {
    it("should return key unchanged for non-observation sections", () => {
      const pcToInstr = new Map([[1, "load r1, x"]]);
      const result = formatObservationKey("regs", "r1", pcToInstr);
      expect(result).toBe("r1");
    });

    it("should return key unchanged for unknown sections", () => {
      const pcToInstr = new Map<number, string>();
      const result = formatObservationKey("unknown", "somekey", pcToInstr);
      expect(result).toBe("somekey");
    });
  });

  describe("edge cases", () => {
    it("should handle PC 0", () => {
      const pcToInstr = new Map([[0, "entry"]]);
      const result = formatObservationKey("obsCtrl", "0", pcToInstr);
      expect(result).toBe("0: entry");
    });

    it("should handle large PC values", () => {
      const pcToInstr = new Map([[999, "exit"]]);
      const result = formatObservationKey("obsCtrl", "999", pcToInstr);
      expect(result).toBe("999: exit");
    });

    it("should handle obsCtrl target with colon in expression", () => {
      const pcToInstr = new Map([[3, "jmp label"]]);
      const result = formatObservationKey(
        "obsCtrl",
        "3:target:label:extra",
        pcToInstr,
      );
      // The regex should capture everything after "target:" as the expression
      expect(result).toBe("3: jmp label [target=label:extra]");
    });
  });
});
