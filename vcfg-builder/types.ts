export type BuildOptions =
  | number
  | {
      windowSize?: number;
      speculationMode?: "discard" | "stack-guard";
    };

export type NormalizedOptions = {
  windowSize: number;
  speculationMode: "discard" | "stack-guard";
};
