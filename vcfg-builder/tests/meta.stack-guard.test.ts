import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG speculationMode バリデーション", () => {
  it("discard 以外を指定するとエラーを投げる", () => {
    expect(() =>
      buildVCFG(
        `
beqz x, L
skip
L: skip
`,
        // @ts-expect-error 故意に無効値を渡す
        { speculationMode: "stack-guard" },
      ),
    ).toThrow(/discard のみサポート/);
  });
});
