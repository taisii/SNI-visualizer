export type BuildMode = "meta" | "light";

export type BuildOptions =
  | number
  | {
      windowSize?: number;
      speculationMode?: "discard" | "stack-guard";
      mode?: BuildMode;
    };

export type NormalizedOptions = {
  mode: BuildMode;
  windowSize?: number;
  speculationMode: "discard" | "stack-guard";
};
