import type { Instruction as MuasmInstruction } from "../../muasm-ast";

export const ANALYSIS_SCHEMA_VERSION = "1.0.0" as const;

export type TraceMode = "bfs" | "single-path";

export type AnalysisResult = {
	/** 互換性管理のためのスキーマバージョン */
	schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
	/** VCFG の静的構造（投機パスではノードを複製し type:"spec" を付与する。共有は禁止） */
	graph: StaticGraph;
	/** コマ送り表示用の実行トレース */
	trace: ExecutionTrace;
	/** トレースの生成モード（表示やデバッグ向けメタデータ） */
	traceMode: TraceMode;
	/** 最終判定 */
	result: "Secure" | "SNI_Violation";
	/** 解析エラー情報（UI は message をユーザー向けに表示） */
	error?: AnalysisError;
};

export type AnalysisError = {
	type: "ParseError" | "AnalysisError" | "InternalError";
	message: string;
	detail?: unknown;
};

// ---------- Graph ----------

export type StaticGraph = {
	nodes: GraphNode[];
	edges: GraphEdge[];
};

export type GraphNode = {
	id: string; // 例: "n0"
	label: string; // 例: "0: load z, a"
	pc: number; // 必須: 命令の行番号/PC。ObsID の安定キー。
	type: "ns" | "spec"; // 投機パス上のノードは必ず複製し spec を設定する（共有禁止）
	sourceLine?: number;
	specOrigin?: string; // 投機開始元ノード ID（複製時に付与）
	instruction?: string; // 任意: 元命令の生テキスト。デバッグ/ツールチップ用
	// MuASM の構造化 AST。VCFG ビルダーが付与し、SNI エンジンが優先的に利用する。
	instructionAst?: MuasmInstruction;
	x?: number;
	y?: number;
};

export type GraphEdge = {
	source: string;
	target: string;
	type: "ns" | "spec" | "rollback";
	label?: string;
};

// ---------- Trace ----------

export type ExecutionTrace = {
	steps: TraceStep[];
};

export type TraceStep = {
	stepId: number;
	nodeId: string;
	description: string;
	executionMode: "NS" | "Speculative";
	state: AbstractState;
	isViolation: boolean;
};

// ---------- Abstract State (UI 用の汎用セクション構造) ----------

export type AbstractState = {
	sections: StateSection[];
};

export type StateSection = {
	id: string;
	title: string;
	type: "key-value"; // 将来 list / graph 等を追加可
	data: Record<string, DisplayValue>;
	description?: string;
	alert?: boolean;
};

export type DisplayLattice =
	| "Bot"
	| "EqLow"
	| "EqHigh"
	| "Diverge"
	| "Leak"
	| "Top";

export type DisplayValue = {
	label: string;
	style: "neutral" | "safe" | "warning" | "danger" | "info";
	description?: string;
	// 関係的値の詳細表示用（任意）
	detail?: {
		ns: DisplayLattice;
		sp: DisplayLattice;
		join: DisplayLattice;
	};
};
