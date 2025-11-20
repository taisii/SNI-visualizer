# SNI検証ツール 現行仕様サマリ

- 作成日: 2025-11-17  
- 最終更新: 2025-11-20（実装ベースを再確認）  
- スキーマ正本: `lib/analysis-schema/index.ts`

本ドキュメントは「現在の実装が何をしているか」を俯瞰する概要書です。UI の詳細仕様は `doc/web-spec.md`、将来計画は `doc/web-plan.md` や `sni-engine/doc/plan.md` を参照してください。

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
- スキーマ: `StaticGraph` / `AnalysisResult` を `lib/analysis-schema/index.ts` に集約。ノードは AST (`instructionAst`) を保持し、UI・エンジン双方が同一構造に依存する。
- VCFG ビルダー (`vcfg-builder/lib/build-vcfg.ts`): MuASM をパースし meta 仕様の VCFG を生成。デフォルト投機ウィンドウは 20 で、NS ノードを共有し spec-begin/spec-end メタノードを介して spec/rollback を張る。
- 解析コア (`sni-engine/lib/analysis/analyze.ts`): AST 優先で命令を評価し、NS/SP 二成分の抽象状態と観測履歴を保持。ワークリスト順序は `traceMode` で BFS/LIFO を切替える。`iterationCap`=10,000、`maxSteps`=10,000 に達すると `AnalysisError` として打ち切る。`maxSpeculationDepth`（デフォルト 20）を超えると `MaxSpeculationDepth` 警告を積んで該当 spec-begin をスキップするが、それ以外は継続する。
- Web UI (`app/(analysis)/*`): `doc/web-spec.md` の仕様に従い、`analyze(source, options)` の薄いファサードで VCFG/抽象状態を描画する。ポリシー入力 UI は未配線で、入力編集時に結果を保持する制約が残っている。詳細な UI 挙動は `doc/web-spec.md` を参照。
- テスト: `vcfg-builder/tests` で AST 付与や投機展開、`sni-engine/tests` で漏洩検出やガード、`lib/analysis-engine/tests` で traceMode 伝播などをカバー。UI も `app/(analysis)/features/visualization/*.test.ts` で色分けやレイアウトをユニットテストしているが、E2E 自動化は未整備。
- 抽象状態 Σ#: `regs`, `mem`, `obsMem`（メモリ観測）, `obsCtrl`（制御観測）の 4 成分を保持。`trace.steps` はワークリスト走査中に逐次追加され、固定点到達/途中打ち切りのいずれでもそのログを返却する。

## 3. 共通スキーマ（要点）
- `StaticGraph`: ノード `{ id, pc, type(ns|spec), label, instruction, instructionAst?, specOrigin?, x?, y? }`、エッジ `{ source, target, type(ns|spec|rollback), label? }`
- `AnalysisResult`: `{ schemaVersion="1.1.0", graph, trace{steps}, traceMode, result("Secure"|"SNI_Violation"), error?, warnings? }`
- `TraceStep`: `{ stepId, nodeId, description, executionMode("NS"|"Speculative"), state(AbstractState), isViolation }`
- `AbstractState.sections[]`: 汎用セクション配列。`DisplayValue { label, style, detail? }` で色分けし、`obsMem` と `obsCtrl` でメモリ/制御観測を分けて表示する。

## 4. 現行 UI 挙動
UI レイアウトやユーザーフローの詳細は `doc/web-spec.md` に集約する。ここでは差分検出に重要なポイントのみ示す。
- 入力変更時も結果が保持される既知制約があり、`web-plan.md` フェーズ 1 で改善予定。
- 解析エラー時は `AnalysisResult.error` がセットされ、トレースが残っていれば UI が最後のステップまで表示しつつ Toast で通知する。完全失敗時のみ結果をクリアする。

## 5. 既知の制約・未対応
- ポリシー入力 UI 未実装。解析コアは `policy` を受理するが UI から渡されていない。
- 入力編集→再解析までの不整合リスクあり。
- UI E2E 自動テストと WebWorker 化は未着手。ユニットテストは一部存在する。

## 6. 成否確認とテスト
- VCFG 生成と SNI 解析のユニットテストは上述の各ディレクトリで維持。解析コアには cap 超過・未知命令などの回帰テストがある。
- UI については `app/(analysis)/features/visualization/elkLayout.test.ts` や `VCFGView.test.ts` で色分け・レイアウトロジックを確認。E2E は計画中。

## 7. 今後の計画 / 参照
- UI 改善: `doc/web-plan.md`
- コア拡張・リスク: `sni-engine/doc/spec.md`, `sni-engine/doc/plan.md`
- データスキーマ: `lib/analysis-schema/index.ts`
- 解析ファサード: `lib/analysis-engine/index.ts`
- VCFG ビルダー: `vcfg-builder/lib/build-vcfg.ts`
- Web UI 実装: `app/(analysis)/*`
