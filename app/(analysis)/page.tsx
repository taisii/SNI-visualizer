"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { CodeEditor, createInitialSource } from "./features/editor/CodeEditor";
import { ControlPanel } from "./features/controls/ControlPanel";
import { Header } from "./shared/Header";
import { StateViewer } from "./features/visualization/StateViewer";
import { VCFGView } from "./features/visualization/VCFGView";
import { analyze } from "./features/analysis-runner/services/analyze";
import { deriveControlState } from "./features/controls/control-state";
import {
  deriveDisplayGraph,
  type GraphViewMode,
} from "./features/visualization/deriveDisplayGraph";
import type {
  AnalysisError,
  AnalysisResult,
  TraceMode,
} from "@/lib/analysis-schema";

const AUTO_PLAY_INTERVAL_MS = 800;

// エラー発生時に積み上がったトーストをまとめて閉じるためのヘルパー。
const resetWarningsToast = (ref: { current: string | null }) => {
  toast.dismiss();
  if (ref.current) ref.current = null;
};

export default function Home() {
  const [source, setSource] = useState<string>(createInitialSource);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<AnalysisError | undefined>(
    undefined,
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [traceMode, setTraceMode] = useState<TraceMode>("single-path");
  const [specWindow, setSpecWindow] = useState(20);
  const [graphView, setGraphView] = useState<GraphViewMode>("vcfg");
  const pendingBfsRetryRef = useRef(false);
  const lastWarningsToastRef = useRef<string | null>(null);

  const activeStep = useMemo(
    () => result?.trace.steps.at(currentStep) ?? null,
    [result, currentStep],
  );
  const controlState = useMemo(
    () => deriveControlState(result, currentStep),
    [result, currentStep],
  );
  const displayGraph = useMemo(
    () => deriveDisplayGraph(result?.graph ?? null, graphView),
    [result?.graph, graphView],
  );
  const warnings = result?.warnings ?? null;
  const warningsSignature = useMemo(
    () => (warnings ? JSON.stringify(warnings) : null),
    [warnings],
  );

  useEffect(() => {
    // Auto Play インターバル制御
    if (!isAutoPlay) return;
    const id = setInterval(() => {
      setCurrentStep((prev) => {
        if (!result) return prev;
        const steps = result.trace.steps;
        const next = Math.min(prev + 1, steps.length - 1);
        if (steps[next]?.isViolation || next === steps.length - 1) {
          setIsAutoPlay(false);
        }
        return next;
      });
    }, AUTO_PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAutoPlay, result]);

  useEffect(() => {
    if (!warnings || warnings.length === 0) {
      lastWarningsToastRef.current = null;
      return;
    }
    if (
      warningsSignature &&
      warningsSignature === lastWarningsToastRef.current
    ) {
      return;
    }
    lastWarningsToastRef.current = warningsSignature;
    const topWarnings = warnings.filter((w) => w.type === "TopObserved");
    if (topWarnings.length > 0) {
      toast.warning("解析不能 (Top) を含む観測が検出されました", {
        description:
          "結果は不確定です。プログラムやポリシーを見直してください。",
      });
      return;
    }
    toast.warning("解析に警告があります");
  }, [warnings, warningsSignature]);

  const formatAnalysisError = (error: AnalysisError) => {
    const detailRaw = error.detail;
    const detail =
      detailRaw === undefined
        ? undefined
        : typeof detailRaw === "string"
          ? detailRaw
          : JSON.stringify(detailRaw, null, 2);
    const parts = [`type: ${error.type}`];
    if (detail) {
      parts.push(`detail: ${detail}`);
    }
    return parts.join("\n");
  };

  const handleAnalyze = async (modeOverride?: TraceMode) => {
    resetWarningsToast(lastWarningsToastRef);
    setIsLoading(true);
    setIsAutoPlay(false);
    try {
      const modeToUse = modeOverride ?? traceMode;
      const analysis = await analyze(source, {
        traceMode: modeToUse,
        specWindow,
      });
      if (analysis.error) {
        setAnalysisError(analysis.error);
        const description = formatAnalysisError(analysis.error);
        const isMaxSteps = Boolean(
          analysis.error.detail &&
            typeof analysis.error.detail === "object" &&
            (analysis.error.detail as Record<string, unknown>).maxSteps !==
              undefined,
        );
        const hasPartialResults = analysis.trace.steps.length > 0;

        if (hasPartialResults) {
          // 部分的な解析結果を表示するため result をセットする
          setResult(analysis);
          // 最後のステップを表示
          setCurrentStep(analysis.trace.steps.length - 1);
        } else {
          setResult(null);
        }

        toast.error(analysis.error.message ?? "解析でエラーが発生しました", {
          description,
          action: {
            label: isMaxSteps ? "BFS で再解析" : "詳細コピー",
            onClick: () => {
              if (isMaxSteps) {
                if (!pendingBfsRetryRef.current) {
                  pendingBfsRetryRef.current = true;
                  setTraceMode("bfs");
                  void handleAnalyze("bfs");
                }
                return;
              }
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard.writeText(description);
              }
            },
          },
        });

        return;
      }
      setAnalysisError(undefined);
      setResult(analysis);
      setCurrentStep(0);
    } catch (e) {
      const message = e instanceof Error ? e.message : "解析に失敗しました";
      toast.error(message, {
        action: {
          label: "再解析",
          onClick: () => {
            void handleAnalyze();
          },
        },
      });
      setAnalysisError({
        type: "AnalysisError",
        message,
      });
      setResult(null);
      resetWarningsToast(lastWarningsToastRef);
    } finally {
      setIsLoading(false);
      pendingBfsRetryRef.current = false;
    }
  };

  const handleFirst = () => {
    setCurrentStep(0);
  };

  const handlePrev = () => {
    setCurrentStep((s) => Math.max(0, s - 1));
  };

  const handleNext = () => {
    if (!result) return;
    setCurrentStep((s) => Math.min(result.trace.steps.length - 1, s + 1));
  };

  const handleLast = () => {
    if (!result) return;
    setCurrentStep(result.trace.steps.length - 1);
  };

  const handleReset = () => {
    setResult(null);
    setAnalysisError(undefined);
    setCurrentStep(0);
    setIsAutoPlay(false);
    setGraphView("vcfg");
    resetWarningsToast(lastWarningsToastRef);
  };

  // 結果がないのに currentStep が進んでしまった場合のガード
  useEffect(() => {
    if (!result) {
      setCurrentStep(0);
    } else if (currentStep >= result.trace.steps.length) {
      setCurrentStep(Math.max(0, result.trace.steps.length - 1));
    }
  }, [result, currentStep]);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100 text-neutral-900">
      <Header
        result={result?.result ?? null}
        error={analysisError}
        warnings={result?.warnings}
      />
      <Toaster richColors position="bottom-right" />
      <main className="grid flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 lg:min-h-[calc(100vh-140px)]">
          <div className="sticky top-6 z-10">
            <ControlPanel
              canPrev={controlState.canPrev}
              canNext={controlState.canNext}
              isLoading={isLoading}
              isAutoPlay={isAutoPlay}
              currentStep={currentStep}
              maxStep={controlState.maxStep}
              onAnalyze={() => handleAnalyze()}
              onFirst={handleFirst}
              onPrev={handlePrev}
              onNext={handleNext}
              onLast={handleLast}
              onReset={handleReset}
              onToggleAutoPlay={() => setIsAutoPlay((v) => !v)}
              traceMode={traceMode}
              onTraceModeChange={(mode) => setTraceMode(mode)}
              specWindow={specWindow}
              onSpecWindowChange={(val) =>
                setSpecWindow(Number.isFinite(val) && val > 0 ? val : 1)
              }
            />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <VCFGView
              graph={displayGraph}
              activeNodeId={activeStep?.nodeId ?? null}
              activeMode={activeStep?.executionMode}
              title={graphView === "cfg" ? "CFG" : "VCFG"}
              actionSlot={
                <div className="inline-flex overflow-hidden rounded border border-neutral-200 bg-white text-xs font-medium text-neutral-700 shadow-sm">
                  <button
                    type="button"
                    className={`px-2 py-1 transition ${
                      graphView === "vcfg"
                        ? "bg-neutral-900 text-white"
                        : "hover:bg-neutral-100"
                    }`}
                    onClick={() => setGraphView("vcfg")}
                    disabled={!result}
                  >
                    VCFG
                  </button>
                  <button
                    type="button"
                    className={`border-l border-neutral-200 px-2 py-1 transition ${
                      graphView === "cfg"
                        ? "bg-neutral-900 text-white"
                        : "hover:bg-neutral-100"
                    }`}
                    onClick={() => setGraphView("cfg")}
                    disabled={!result}
                  >
                    CFG
                  </button>
                </div>
              }
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <CodeEditor value={source} onChange={(val) => setSource(val)} />
          <div className="flex-1">
            <StateViewer
              state={activeStep?.state ?? null}
              graph={result?.graph ?? null}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
