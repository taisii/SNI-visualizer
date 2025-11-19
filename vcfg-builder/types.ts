export type BuildOptions =
  | number
  | {
      windowSize?: number;
    };

export type NormalizedOptions = {
  windowSize: number;
};
