# SNI検証ツール開発プロジェクト 全体要件定義書

- 作成日: 2025年11月17日
- 更新日: 2025年11月17日 (Rev 2: インターフェース定義の統合)
- 版数: 1.1

## プロジェクト目標

VCFG（仮想制御フローグラフ）と抽象解釈を用いた新規 SNI（投機的非干渉）判定アルゴリズムを実装し、Web ブラウザ上でその動作原理を視覚的にデモンストレーション可能なプロトタイプを完成させること。

## 1. 開発体制と役割分担

本プロジェクトは、以下の 3 つの主要コンポーネントに分割し、3 名体制で開発を行う。各担当は疎結合な設計を維持し、定義されたインターフェースを通じて連携する。

| 担当 | コンポーネント名                      | 主な役割                               | 技術領域                         |
| ---- | ------------------------------------- | -------------------------------------- | -------------------------------- |
| A    | Web アプリケーション (UI/View)       | ユーザーインターフェース、可視化、統合 | React, SVG, UI/UX 設計          |
| B    | MuASM 基盤エンジン (Infrastructure)  | コード解析、VCFG 構築、投機モデル定義  | 言語処理系, グラフ理論, MuASM 仕様 |
| C    | SNI 解析コアエンジン (Core Logic)    | 抽象解釈、不動点計算、SNI 判定ロジック | 形式手法, セキュリティ理論, アルゴリズム |

## 2. システムアーキテクチャ概要

データフローは基本的に

`MuASM 基盤` → `SNI 解析コア` → `Web アプリ`

の順に流れる。VCFG の生成は担当 B、解析は担当 C の一方向依存とする。ブラウザ内には B/C を直列に呼び出す統合ファサード（Analysis Engine モジュール）を置き、Web アプリはこの `analyze()` だけを依存対象とする。

```mermaid
graph TD
    User[ユーザー入力 (Source Code)] --> WebApp

    subgraph "Browser Environment"
        WebApp[Webアプリケーション (担当A)]

        subgraph "Analysis Engine Module"
            MuASMEngine[MuASM基盤 (担当B)]
            SNIEngine[SNI解析コア (担当C)]

            WebApp -- "1. analyze() でコードを送信" --> MuASMEngine
            MuASMEngine -- "VCFG (StaticGraph)" --> SNIEngine

            SNIEngine -- "2. Abstract Interpretation" --> SNIEngine
            SNIEngine -- "3. AnalysisResult JSON" --> WebApp
        end
    end

    WebApp -- "Visualized Result" --> User
```

## 3. 共通インターフェース定義 (AnalysisResult Schema)

本プロジェクトにおける「共通言語」となる、解析エンジン（担当 C）から Web アプリ（担当 A）へ渡される JSON データ構造を以下に定義する。担当 B も VCFG 構造生成時にこのスキーマの一部（`StaticGraph`）を意識する必要がある。**本節と `app/types/analysis-result.ts` をスキーマのソース・オブ・トゥルースとし、他ドキュメントは参照に徹する。**

### 3.1 データ構造概要（共通スキーマ定義）

TypeScript での正式スキーマは `app/types/analysis-result.ts` に集約し、A/B/C 全員が同一の型を import して利用する（型差分を防ぐため）。投機コンテキストを明示するため、投機パス上では必ずノードを複製し `type: "spec"` を付ける（共有ノードは禁止）。

```ts
interface AnalysisResult {
  schemaVersion: "1.0.0";            // スキーマ互換性管理用
  graph: StaticGraph;                // 静的な VCFG 構造
  trace: ExecutionTrace;             // 解析ステップごとの状態遷移
  result: "Secure" | "SNI_Violation"; // 最終判定
  error?: {
    type: "ParseError" | "AnalysisError" | "InternalError";
    message: string;                 // ユーザー表示用エラーメッセージ
    detail?: unknown;                // 開発者向け追加情報 (スタック等)
  };
}
```

### 3.2 詳細定義

#### A. StaticGraph (VCFG 構造)

担当 B が生成し、担当 C が解析に利用し、担当 A が描画するグラフ構造。

```ts
interface StaticGraph {
  nodes: Node[];
  edges: Edge[];
}

interface Node {
  id: string;      // 一意な ID (例: "n0", "n5@spec1")
  pc: number;      // 必須: 命令の行番号/PC。ObsID の安定キーとして利用。
  label: string;   // 表示ラベル (例: "0: load z, a")
  type: "ns" | "spec"; // 投機ノードでは必ず "spec"
  instruction?: string; // (Optional) 元命令のテキスト。デバッグ/ツールチップ用途
  sourceLine?: number; // (Optional) ソースコードの行番号
  specOrigin?: string; // (Optional) 投機開始元ノード ID（複製時に付与）
  x?: number;      // (Optional) 描画用座標ヒント
  y?: number;      // (Optional) 描画用座標ヒント
}

interface Edge {
  source: string;  // 始点ノード ID
  target: string;  // 終点ノード ID
  type: "ns" | "spec" | "rollback"; // エッジ種別（線種に使用）
  label?: string;  // (Optional) ラベル (例: "mispredict")
}
```

#### B. ExecutionTrace (実行トレース)

担当 C が生成する、解析プロセスのスナップショット配列。

```ts
interface ExecutionTrace {
  steps: Step[];
}

interface Step {
  stepId: number;          // 0 からの連番
  nodeId: string;          // 現在実行中の VCFG ノード ID (ハイライト用)
  description: string;     // UI に表示する説明文 (例: "SP: load z, a (addr=EqHigh)")
  executionMode: "NS" | "Speculative"; // 実行モード
  state: AbstractState;    // その時点での抽象状態詳細
  isViolation: boolean;    // このステップで SNI 違反が確定したか
}
```

#### C. AbstractState (抽象状態詳細 - 汎用構造)

担当 C が生成する。特定の手法に依存しないよう、セクションリストとして定義する。

```ts
interface AbstractState {
  sections: StateSection[];
}

interface StateSection {
  id: string;          // 内部識別子 (例: "registers", "obs")
  title: string;       // 表示タイトル (例: "Abstract Registers")
  type: "key-value";   // 表示形式
  data: Record<string, DisplayValue>; // 表示データ
  description?: string; // セクションの説明
  alert?: boolean;      // 異常発生時のフラグ (赤枠表示など)
}

interface DisplayValue {
  label: string;       // 表示文字列 (例: "EqLow", "Leak")
  style: "neutral" | "safe" | "warning" | "danger" | "info"; // 色分け用スタイル
}
```

## 4. 各担当の要件定義

### 4.1 担当 A: Web アプリケーション (UI Implementation)

- 目標: 解析エンジンの内部状態をユーザーに分かりやすく提示し、対話的な検証体験を提供する。
- 主要タスク:
  - 別途定義された「Web アプリケーション仕様書」に基づく画面実装。
  - 定義された `AnalysisResult` JSON を受け取り、VCFG や状態テーブルを描画する。
  - エディタ機能、再生コントロールの実装。
- 依存関係: 解析エンジンの内部ロジックには依存せず、上記の JSON スキーマのみに依存する。
- API 形式: `analyze(sourceCode): Promise<AnalysisResult>` の非同期インターフェースを推奨（メインスレッド直呼び出しを前提にしつつ、将来の WebWorker 移行に備えて非同期を維持）。

### 4.2 担当 B: MuASM 基盤エンジン (MuASM Infrastructure)

- 目標: MuASM コードを計算機が扱える形式に変換し、投機的実行モデル（Always Mispredict）に基づいた制御フローグラフ（VCFG）を構築する。
- 主要タスク:
  - Lexer / Parser: MuASM のテキストをトークン化し、AST（または命令リスト）に変換する。
  - VCFG Builder: 通常の制御フロー（NS エッジ）を構築する。
  - Always Mispredict モデルの実装: 全ての条件分岐命令に対して、投機的実行パス（Spec エッジ）と、そこからの復帰パス（Rollback エッジ）をグラフに追加する。
  - `StaticGraph` 形式でのデータ出力機能の実装。
- 提供機能（API）:

```ts
parse(code: string): Program;
buildVCFG(sourceCode: string, windowSize?: number): StaticGraph; // parse を内部で呼び出す
```

- 責任範囲: 「どのような順序で命令が実行されうるか（パス）」までは責任を持つが、「値がどうなるか（データ）」には関与しない。

### 4.3 担当 C: SNI 解析コアエンジン (SNI Analysis Core)

- 目標: 構築された VCFG 上で抽象解釈を実行し、SNI 違反（Leak）を検出して、Web アプリ向けの表示データを生成する。
- 主要タスク:
  - 抽象ドメインの実装: SNI 関係格子 \(L_{SNI}^\#\) の定義と格子演算の実装。
  - 抽象解釈（不動点計算）: 担当 B が生成した VCFG を入力とし、各ノードにおける抽象状態を計算する。
  - 観測と判定: 投機的実行パスにおけるメモリアクセスを監視し、\(\mathcal{O}^\#\)（観測履歴）を更新する。`Leak` 検出ロジックの実装。
  - 結果生成: 計算過程をトレースし、`ExecutionTrace` 形式のデータを生成する。抽象値を `DisplayValue` (`label`, `style`) に変換するアダプターの実装。
- 依存関係: 担当 B が作成した VCFG 構造を入力とする。

## 5. 開発の進め方

### フェーズ 1: インターフェース合意 (完了)

本ドキュメントにおける `AnalysisResult` JSON スキーマを 3 者で確定とする。

### フェーズ 2: 個別実装 (並行作業)

- 担当 A: モックデータを用いて UI を作り込む。
- 担当 B: MuASM をパースし、正しい VCFG 構造を出力できるかテストする。
- 担当 C: 手動定義グラフに対し、抽象解釈ロジックが正しく動作するか単体テストする。

### フェーズ 3: エンジン統合 (B + C)

担当 B の出力する VCFG を担当 C が読み込めるように結合する。

### フェーズ 4: 全体統合 (A + B + C)

Web アプリに実際のエンジンを組み込み、動作確認を行う。

## 6. プロジェクトの成功基準

- 問題のケース（ループ＋投機）の再現:  
  `ptr++` を含むループにおいて、投機的実行パスで発生する SNI 違反を正しく検出・表示できること。
- 可視化の正確性:  
  VCFG 上で「投機パス」と「通常パス」が視覚的に区別され、現在実行中のノードが正しくハイライトされること。
- 拡張性:  
  将来的に抽象ドメインを変更（例: 区間解析の追加）した際、担当 C の修正のみで（担当 A の修正なしに）UI に新しい情報が表示されること。

## 7. 追加仕様・運用方針

- 解析トレース生成: 不動点計算完了後に VCFG を再実行して `ExecutionTrace` を生成する「Replay」方式とする（UI のステップ数が計算順序に依存しないようにするため）。
- 反復上限: 無限ループ防止のため、抽象解釈の反復に iterationCap を設ける（デフォルト: 10,000 ステップ）。上限到達時は `error` に `AnalysisError` を設定する。
- 観測/メモリ識別子: ObsID は「命令の PC（ソース行番号）」、AbsLoc は「変数名（文字列）」で正規化する。オペランドを含む拡張が必要になった場合はスキーマの minor バージョンを更新して明示する。
- 配布形態: 現行はブラウザのメインスレッドから解析エンジンを直接呼び出す。負荷が増した場合に備え、Promise ベースの API を維持しておき WebWorker への移行を選択肢として残す。ビルドはブラウザのみで完結する構成を前提とする。
- 回帰テストセット: 最低 3 ケースを保持すること（1) 安全ケース、2) Leak 検出ケース、3) 投機バリア (spbarr) により安全化されるケース）。
- セキュリティポリシー: プログラム実行者が「公開/機密」区分のポリシーを JSON 等で与える。未指定の場合、レジスタは `EqLow`、メモリは `EqHigh` で初期化し、UI で個別に指定されたものがあればそれで上書きする。
