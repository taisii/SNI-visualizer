import type { BuildOptions, NormalizedOptions } from "../types";

export function normalizeOptions(
  options: BuildOptions = 20,
): NormalizedOptions {
  const windowSize =
    typeof options === "number" ? options : (options.windowSize ?? 20);

  if (windowSize <= 0) {
    throw new Error("windowSize は 1 以上である必要があります");
  }

  return { windowSize };
}
