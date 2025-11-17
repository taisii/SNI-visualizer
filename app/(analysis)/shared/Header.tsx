import type { AnalysisResult } from "@/lib/analysis-schema";

type Props = {
	result: AnalysisResult["result"] | null;
};

const badgeStyles = {
	Secure: "bg-emerald-100 text-emerald-800 border border-emerald-200",
	SNI_Violation: "bg-red-100 text-red-800 border border-red-200",
} as const;

export function Header({ result }: Props) {
	return (
		<header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
			<div className="flex flex-col gap-1">
				<p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
					Speculative Non-Interference Viewer
				</p>
				<h1 className="text-xl font-bold text-neutral-900">SNI 検証ツール</h1>
			</div>
			<div>
				{result ? (
					<span
						className={`rounded-full px-3 py-1 text-sm font-semibold ${badgeStyles[result]}`}
					>
						{result === "Secure" ? "Secure" : "SNI Violation"}
					</span>
				) : (
					<span className="text-sm text-neutral-500">未解析</span>
				)}
			</div>
		</header>
	);
}
