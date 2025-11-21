import type { BuildOptions, NormalizedOptions } from "../types";

export function normalizeOptions(
  options: BuildOptions = 20,
): NormalizedOptions {
  const windowSize =
    typeof options === "number" ? options : (options.windowSize ?? 20);
  const speculationMode =
    typeof options === "number"
      ? "stack-guard"
      : options.speculationMode ?? "stack-guard";

  const allowed = ["discard", "stack-guard"] as const;
  if (!allowed.includes(speculationMode as typeof allowed[number])) {
    throw new Error(
      `speculationMode は discard|stack-guard のいずれかを指定してください (got: ${String(
        speculationMode,
      )})`,
    );
  }

  if (windowSize <= 0) {
    throw new Error("windowSize は 1 以上である必要があります");
  }

  return { windowSize, speculationMode };
}
