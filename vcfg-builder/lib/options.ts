import type { BuildOptions, NormalizedOptions } from "../types";

export function normalizeOptions(
  options: BuildOptions = 20,
): NormalizedOptions {
  const windowSize =
    typeof options === "number" ? options : (options.windowSize ?? 20);
  const mode =
    typeof options === "number" ? "expanded" : (options.mode ?? "expanded");

  if (windowSize <= 0) {
    throw new Error("windowSize は 1 以上である必要があります");
  }

  return { windowSize, mode };
}
