import type { BuildOptions, NormalizedOptions } from "../types";

export function normalizeOptions(
  options: BuildOptions = 20,
): NormalizedOptions {
  const mode = typeof options === "number" ? "meta" : (options.mode ?? "meta");
  const rawWindow = typeof options === "number" ? options : options.windowSize;
  const windowSize = mode === "meta" ? (rawWindow ?? 20) : undefined;
  const speculationMode =
    typeof options === "number"
      ? "discard"
      : (options.speculationMode ?? "discard");

  const allowed = ["discard", "stack-guard"] as const;
  if (!allowed.includes(speculationMode as (typeof allowed)[number])) {
    throw new Error(
      `speculationMode は discard|stack-guard のいずれかを指定してください (got: ${String(
        speculationMode,
      )})`,
    );
  }

  if (mode === "meta") {
    if ((windowSize ?? 0) <= 0) {
      throw new Error("windowSize は 1 以上である必要があります");
    }
  }

  return { mode, windowSize, speculationMode };
}
