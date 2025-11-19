# SNI検証ツール 現行仕様サマリ

- 作成日: 2025-11-17  
- 最終更新: 2025-11-18（実装ベースに更新）  
- スキーマ正本: `lib/analysis-schema/index.ts`

本ドキュメントは「現在の実装が何をしているか」を俯瞰する概要書です。将来計画は `Doc/web-plan.md` や `sni-engine/doc/plan.md` を参照してください。

## 1. プロジェクト概要
- 目的: MuASM プログラムに対する投機的非干渉 (SNI) 検証を行い、結果をブラウザで可視化する研究プロトタイプ。
- 中核技術: VCFG（仮想制御フローグラフ） + 抽象解釈 + Always-Mispredict 投機モデル。
- 主要コンポーネント:
  - Web UI (Next.js) — `app/(analysis)/*`
  - VCFG ビルダー — `vcfg-builder/lib/*`（エントリ `lib/build-vcfg.ts`、meta 仕様のみ）
  - SNI 解析コア — `sni-engine/lib/analysis/analyze.ts`
  - 共通スキーマ / ファサード — `lib/analysis-schema`, `lib/analysis-engine`

データフローは「MuASM 文字列 → buildVCFG() → analyzeVCFG() → AnalysisResult → Web UI」。

## 2. 実装の現状
- スキーマ: `StaticGraph` / `AnalysisResult` を `lib/analysis-schema/index.ts` に集約。ノードは AST (`instructionAst`) を保持。
- VCFG ビルダー (`vcfg-builder/lib/build-vcfg.ts`):
  - MuASM をパースし NS/spec/rollback 辺を生成。デフォルト投機ウィンドウは 20。
  - モード: `meta`（NS ノード共有＋`spec-begin/spec-end` メタノードを spec/rollback で接続）。
  - ノードに `instructionAst` を埋め、文字列表示用の `instruction` も保持。
- 解析コア (`sni-engine/lib/analysis/analyze.ts`):
  - AST を優先して命令を評価（文字列はフォールバック）。  
  - NS/SP 二成分の抽象状態と観測履歴 `obsMem` / `obsCtrl` を保持し、Leak 判定に使用。  
  - ワークリストは `traceMode` で BFS / LIFO 切替。`iterationCap`=10,000, `maxSteps`=500 で打ち切り。  
  - 解析中に `trace.steps` を逐次生成し UI へ返却。
- Web UI (`app/(analysis)/page.tsx` ほか):
  - `analyze(source, { traceMode })` を直接呼び出し、VCFG と抽象状態を描画。  
  - Prev/Next/Auto Play、トレースモード切替（single-path デフォルト / bfs）。右ペイン: MuASM エディタ（Accordion で折りたたみ可）＋ 抽象状態ビュー。  
  - 解析失敗時は Toast 表示＋結果クリア（未解析に戻る）。ポリシー入力 UI は未実装。  
  - 入力編集時も結果保持（既知制約）。
- テスト:
  - `vcfg-builder/tests` — AST 付与・投機展開を検証。  
  - `sni-engine/tests` — Leak 判定、rollback、cap 超過、未知命令エラーなど。  
  - `lib/analysis-engine/tests` — traceMode デフォルト伝播など。  
  - UI の UT/E2E は未整備。

## 3. 共通スキーマ（要点）
- `StaticGraph`: ノード `{ id, pc, type(ns|spec), label, instruction, instructionAst?, specOrigin?, x?, y? }`、エッジ `{ source, target, type(ns|spec|rollback), label? }`
- `AnalysisResult`: `{ schemaVersion="1.0.0", graph, trace{steps}, traceMode, result("Secure"|"SNI_Violation"), error? }`
- `TraceStep`: `{ stepId, nodeId, description, executionMode("NS"|"Speculative"), state(AbstractState), isViolation }`
- `AbstractState.sections[]`: 汎用セクション配列。`DisplayValue { label, style, detail? }` で色分け。

## 4. 現行 UI 挙動
- 左ペイン: コントロール（解析/Prev/Next/AutoPlay/Reset、traceMode 選択）と VCFG (React Flow, flex-1 で列の残り高さを占有)。  
  - 入力変更時も結果は残るため、再解析は手動。  
- 右ペイン: MuASM エディタ（Accordion 折りたたみ）と抽象状態ビュー。`activeNodeId` に同期してハイライト。  
- Auto Play: 800ms 間隔で前進し、違反検出 or 末尾で停止。  
- エラー時: Toast 表示し結果を破棄。

## 5. 既知の制約・未対応
- ポリシー入力 UI なし（エンジン側は `policy` オプションを受理）。  
- 入力編集と結果の不整合が起こり得る（再解析が必要）。  
- UI テスト未整備。  
- 大規模グラフ向けレイアウト自動調整、WebWorker 実行は未実装。

## 6. 成否確認の現状
- 投機パスを含むプログラムで Leak を検出できることをユニットテストで確認（`sni-engine/tests/analysis.test.ts`）。  
- VCFG が meta 仕様（`spec-begin/spec-end` メタノード + rollback）で生成されることを回帰テストで確認（`vcfg-builder/tests/meta.test.ts`, `vcfg-builder/tests/integration.test.ts`）。  
- UI レイヤは `app/(analysis)/features/visualization/elkLayout.test.ts` などのユニットテストでグラフ入力・レイアウトオプションを検証し、画面全体は手動確認ベース（E2E 自動化は未着手）。

## 7. 今後の計画
- UI 改善・新機能は `Doc/web-plan.md` を参照（ポリシー入力、編集時の結果クリア等）。  
- コアの拡張・リスクは `sni-engine/doc/spec.md` および `sni-engine/doc/plan.md` に記載。  
- テスト自動化（UI E2E, Storybook）は未着手。

## 8. リファレンス
- スキーマ: `lib/analysis-schema/index.ts`
- ファサード: `lib/analysis-engine/index.ts`
- VCFG ビルダー: `vcfg-builder/lib/build-vcfg.ts`
- 解析コア: `sni-engine/lib/analysis/analyze.ts`
- Web UI: `app/(analysis)/*`
- 計画関連: `Doc/web-plan.md`, `sni-engine/doc/plan.md`
