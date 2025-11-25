import type { BuildOptions, NormalizedOptions } from "../types";

export function normalizeOptions(
  options: BuildOptions = {},
): NormalizedOptions {
  const mode = options.mode ?? "light";
  const speculationMode = options.speculationMode ?? "discard";

  if (speculationMode !== "discard") {
    throw new Error(
      `speculationMode は discard のみサポートされます (got: ${String(
        speculationMode,
      )})`,
    );
  }

  return { mode, speculationMode };
}
