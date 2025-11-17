"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "../components/ui/sonner";
import { CodeEditor, createInitialSource } from "./components/CodeEditor";
import { ControlPanel } from "./components/ControlPanel";
import { Header } from "./components/Header";
import { StateViewer } from "./components/StateViewer";
import { VCFGView } from "./components/VCFGView";
import { analyze } from "./lib/analysis-client";
import { deriveControlState } from "./lib/controls";
import type { AnalysisResult } from "./types/analysis-result";

const AUTO_PLAY_INTERVAL_MS = 800;

export default function Home() {
	// 現時点ではバックエンド未接続のモック解析。エンジン連携はこれから実装予定。
	const [source, setSource] = useState<string>(createInitialSource);
	const [result, setResult] = useState<AnalysisResult | null>(null);
	const [currentStep, setCurrentStep] = useState(0);
	const [isAutoPlay, setIsAutoPlay] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	const activeStep = useMemo(
		() => result?.trace.steps.at(currentStep) ?? null,
		[result, currentStep],
	);
	const controlState = useMemo(
		() => deriveControlState(result, currentStep),
		[result, currentStep],
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

	const handleAnalyze = async () => {
		setIsLoading(true);
		setIsAutoPlay(false);
		try {
			const analysis = await analyze(source);
			if (analysis.error) {
				throw new Error(analysis.error.message ?? "解析でエラーが発生しました");
			}
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
			setResult(null);
		} finally {
			setIsLoading(false);
		}
	};

	const handlePrev = () => {
		setCurrentStep((s) => Math.max(0, s - 1));
	};

	const handleNext = () => {
		if (!result) return;
		setCurrentStep((s) => Math.min(result.trace.steps.length - 1, s + 1));
	};

	const handleReset = () => {
		setResult(null);
		setCurrentStep(0);
		setIsAutoPlay(false);
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
			<Header result={result?.result ?? null} />
			<Toaster richColors position="bottom-right" />
			<main className="grid flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-2">
				<section className="flex flex-col gap-3">
					<CodeEditor value={source} onChange={(val) => setSource(val)} />
					<ControlPanel
						canPrev={controlState.canPrev}
						canNext={controlState.canNext}
						isLoading={isLoading}
						isAutoPlay={isAutoPlay}
						currentStep={currentStep}
						maxStep={controlState.maxStep}
						onAnalyze={handleAnalyze}
						onPrev={handlePrev}
						onNext={handleNext}
						onReset={handleReset}
						onToggleAutoPlay={() => setIsAutoPlay((v) => !v)}
					/>
				</section>

				<section className="flex flex-col gap-3">
					<div className="flex h-1/2 flex-col gap-2">
						<VCFGView
							graph={result?.graph ?? null}
							activeNodeId={activeStep?.nodeId ?? null}
						/>
						<div className="text-xs text-neutral-600">
							現在ステップ: {activeStep ? activeStep.description : "未解析"}
						</div>
					</div>
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
