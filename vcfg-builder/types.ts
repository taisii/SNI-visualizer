export type VCFGMode = "expanded" | "meta";

export type BuildOptions =
  | number
  | {
      windowSize?: number;
      mode?: VCFGMode;
    };

export type NormalizedOptions = {
  windowSize: number;
  mode: VCFGMode;
};
