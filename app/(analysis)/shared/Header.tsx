import type { AnalysisResult } from "@/lib/analysis-schema";

type Props = {
  result: AnalysisResult["result"] | null;
  error?: AnalysisResult["error"];
  warnings?: AnalysisResult["warnings"];
  rightSlot?: React.ReactNode;
};

const badgeStyles = {
  Secure: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  SNI_Violation: "bg-red-100 text-red-800 border border-red-200",
} as const;

export function Header({ result, error, warnings, rightSlot }: Props) {
  const hasWarnings = Boolean(warnings && warnings.length > 0);
  const hasTopWarning = Boolean(
    warnings?.some((w) => w.type === "TopObserved"),
  );
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Speculative Non-Interference Viewer
        </p>
        <h1 className="text-xl font-bold text-neutral-900">SNI 検証ツール</h1>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-end gap-1 text-sm">
        {error ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800 border border-amber-200">
            解析未完了 (Error)
          </span>
        ) : result ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${badgeStyles[result]}`}
            >
              {result === "Secure" ? "Secure" : "SNI Violation"}
            </span>
            {hasWarnings && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                {hasTopWarning ? "警告: Top を含む" : "警告あり"}
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-neutral-500">未解析</span>
        )}
        {hasTopWarning && (
          <p className="text-xs text-amber-700">
            解析不能 (Top) を含む観測があり、結果は不確定です。
          </p>
        )}
        </div>
        {rightSlot}
      </div>
    </header>
  );
}
