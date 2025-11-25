export type BuildMode = "light";

export type BuildOptions = {
  speculationMode?: "discard";
  mode?: BuildMode;
};

export type NormalizedOptions = {
  mode: BuildMode;
  speculationMode: "discard";
};
