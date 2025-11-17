import type { AnalysisResult } from "../types/analysis-result";

export type ControlState = {
  canPrev: boolean;
  canNext: boolean;
  maxStep: number;
};

export function deriveControlState(result: AnalysisResult | null, currentStep: number): ControlState {
  const steps = result?.trace.steps ?? [];
  const maxStep = steps.length > 0 ? steps.length : 0;
  return {
    canPrev: currentStep > 0,
    canNext: steps.length > 0 && currentStep < steps.length - 1,
    maxStep,
  };
}
