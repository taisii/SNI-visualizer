import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
} from "lucide-react";
import type { TraceMode, SpecRunMode } from "@/lib/analysis-schema";
import type { SpeculationMode } from "@/sni-engine";

type Props = {
  canPrev: boolean;
  canNext: boolean;
  isLoading: boolean;
  isAutoPlay: boolean;
  traceMode: TraceMode;
  speculationMode: SpeculationMode;
  currentStep: number;
  maxStep: number;
  onAnalyze: () => void;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onReset: () => void;
  onToggleAutoPlay: () => void;
  onTraceModeChange: (mode: TraceMode) => void;
  onSpeculationModeChange: (mode: SpeculationMode) => void;
  specMode: SpecRunMode;
  specWindow: number;
  onSpecModeChange: (mode: SpecRunMode) => void;
  onSpecWindowChange: (value: number) => void;
};

export function ControlPanel({
  canPrev,
  canNext,
  isLoading,
  isAutoPlay,
  traceMode,
  speculationMode,
  currentStep,
  maxStep,
  onAnalyze,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onReset,
  onToggleAutoPlay,
  onTraceModeChange,
  onSpeculationModeChange,
  specMode,
  specWindow,
  onSpecModeChange,
  onSpecWindowChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-center gap-2">
        <button
          className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-300"
          onClick={onAnalyze}
          disabled={isLoading}
          type="button"
        >
          {isLoading ? "解析中…" : "解析を実行"}
        </button>
        <button
          className="rounded border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100"
          onClick={onReset}
          type="button"
        >
          リセット
        </button>
        <div className="ml-auto text-xs text-neutral-600">
          {maxStep === 0
            ? "Step -- / --（未解析）"
            : `Step ${currentStep + 1} / ${maxStep}`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-neutral-700">
          トレースモード:
          <select
            className="ml-2 rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            value={traceMode}
            onChange={(e) =>
              onTraceModeChange(e.target.value as "bfs" | "single-path")
            }
            disabled={isLoading}
          >
            <option value="single-path">DFS</option>
            <option value="bfs">BFS</option>
          </select>
        </label>
        <label className="text-xs text-neutral-700">
          投機モード:
          <select
            className="ml-2 rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            value={speculationMode}
            onChange={(e) =>
              onSpeculationModeChange(
                e.target.value as SpeculationMode,
              )
            }
            disabled={isLoading}
          >
            <option value="discard">復帰なし</option>
            <option value="stack-guard">スタック検証</option>
          </select>
        </label>
        <label className="text-xs text-neutral-700">
          グラフ/長さ管理:
          <select
            className="ml-2 rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            value={specMode}
            onChange={(e) =>
              onSpecModeChange(e.target.value as SpecRunMode)
            }
            disabled={isLoading}
          >
            <option value="legacy-meta">従来(meta)</option>
            <option value="light">軽量(light)</option>
          </select>
        </label>
        {specMode === "light" && (
          <label className="text-xs text-neutral-700">
            投機長 (light):
            <input
              className="ml-2 w-20 rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
              type="number"
              min={1}
              value={specWindow}
              onChange={(e) => onSpecWindowChange(Number(e.target.value))}
              disabled={isLoading}
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            className="rounded border border-neutral-300 p-1 text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
            onClick={onFirst}
            disabled={!canPrev || isLoading}
            type="button"
            title="最初へ"
          >
            <ChevronsLeft size={16} />
          </button>
          <button
            className="rounded border border-neutral-300 p-1 text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
            onClick={onPrev}
            disabled={!canPrev || isLoading}
            type="button"
            title="前へ"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className={`rounded border p-1 ${
              isAutoPlay
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-neutral-300 text-neutral-800"
            } disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400`}
            onClick={onToggleAutoPlay}
            disabled={isLoading || (!canNext && !isAutoPlay)}
            type="button"
            title={isAutoPlay ? "停止" : "自動再生"}
          >
            {isAutoPlay ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="rounded border border-neutral-300 p-1 text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
            onClick={onNext}
            disabled={!canNext || isLoading}
            type="button"
            title="次へ"
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="rounded border border-neutral-300 p-1 text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
            onClick={onLast}
            disabled={!canNext || isLoading}
            type="button"
            title="最後へ"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
