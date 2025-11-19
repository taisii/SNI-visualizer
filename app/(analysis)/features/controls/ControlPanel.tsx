import type { TraceMode } from "@/lib/analysis-schema";

type Props = {
  canPrev: boolean;
  canNext: boolean;
  isLoading: boolean;
  isAutoPlay: boolean;
  traceMode: TraceMode;
  currentStep: number;
  maxStep: number;
  onAnalyze: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
  onToggleAutoPlay: () => void;
  onTraceModeChange: (mode: TraceMode) => void;
};

export function ControlPanel({
  canPrev,
  canNext,
  isLoading,
  isAutoPlay,
  traceMode,
  currentStep,
  maxStep,
  onAnalyze,
  onPrev,
  onNext,
  onReset,
  onToggleAutoPlay,
  onTraceModeChange,
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
      <div className="flex items-center gap-2">
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
            <option value="single-path">1経路ずつ（デフォルト）</option>
            <option value="bfs">到達順（BFS）</option>
          </select>
        </label>
        <button
          className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100"
          onClick={onPrev}
          disabled={!canPrev || isLoading}
          type="button"
        >
          Prev
        </button>
        <button
          className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-100"
          onClick={onNext}
          disabled={!canNext || isLoading}
          type="button"
        >
          Next
        </button>
        <button
          className={`rounded px-3 py-1 text-sm font-semibold ${
            isAutoPlay
              ? "bg-amber-200 text-amber-900"
              : "bg-neutral-200 text-neutral-800"
          } disabled:cursor-not-allowed disabled:opacity-60`}
          onClick={onToggleAutoPlay}
          disabled={isLoading || (!canNext && !isAutoPlay)}
          type="button"
        >
          {isAutoPlay ? "停止" : "Auto Play"}
        </button>
      </div>
    </div>
  );
}
