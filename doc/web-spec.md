# Web UI 現行仕様サマリ（実装ベース）

- 作成日: 2025-11-17  
- 対象: Web UI 実装担当 / 研究用デモ利用者  
- 根拠: `app/(analysis)/page.tsx`・`app/(analysis)/features/*`・`lib/analysis-engine/index.ts`・`lib/analysis-schema/index.ts`

本ドキュメントは「いま動いている Web UI が何をしているか」を実装コードから逆算してまとめた現行仕様書である。  
理論仕様や将来計画は含めず、UI が依存するデータ構造と画面挙動を記述する。VCFG ビルダーは meta 版のみを提供しており、その仕様やオプションを実装ベースで反映する。

## 0. 役割と全体像

- 目的: MuASM から生成した VCFG と SNI 解析結果をブラウザ上でステップ実行しながら可視化する。  
- 処理フロー:  
  1. 左ペイン上部の操作パネルで「解析を実行」を押下。  
  2. 右ペインの MuASM エディタ（Accordion で折りたたみ可）でソース編集。編集しても既存結果は保持。  
  3. 返却された `AnalysisResult` を左ペイン下部の VCFG と右ペイン下部の抽象状態で可視化。  
  4. Prev/Next/Auto Play でトレースをコマ送り。違反検出で自動停止。

## 1. データインターフェース

### 1.1 解析呼び出し

UI からの単一ファサード `analyze(sourceCode: string, options?: AnalyzeOptions): Promise<AnalysisResult>` を提供する（実装: `app/(analysis)/features/analysis-runner/services/analyze.ts` → `lib/analysis-engine/index.ts`）。  
内部で VCFG ビルダーと SNI エンジンを順に呼ぶ。`buildVCFG` が例外を投げた場合は `AnalysisResult.error` を埋めて返し、UI 側は Toast で通知後、結果を破棄する（画面は「未解析」に戻る）。

`AnalyzeOptions`（実装: `lib/analysis-engine/index.ts` → `sni-engine/index.ts` → `sni-engine/lib/analysis/analyze.ts`）で受け付ける項目:
- `traceMode`: `"single-path"`（UI デフォルト）または `"bfs"`  
- `policy`: `{ regs?: Record<string,"Low"|"High">; mem?: Record<string,"Low"|"High"> }`
- `entryRegs`: 解析開始時に EqLow で初期化するレジスタ名の配列
- `entryNodeId`: 開始ノード ID（省略時は先頭ノード）
- `iterationCap` / `maxSteps`: 不動点計算とトレース生成の打ち切り上限
- VCFG ビルダー向けオプション（UI も透過的に渡す）:
  - `windowSize`: 投機ウィンドウサイズ（デフォルト 20）

### 1.2 AnalysisResult スキーマ（UI が前提する形）

- 互換キー: `schemaVersion = "1.0.0"`
- `graph: StaticGraph` — ノード/エッジと種類（ns/spec/rollback）。VCFG は meta 表現のみで、NS ノードを共有し分岐ごとに `spec-begin/spec-end` メタノードを spec エッジで挟む（spec ノードは meta ノードのみ生成）。  
- `trace.steps[]` — 各ステップの `{ stepId, nodeId, description, executionMode, state, isViolation }`。  
- `state.sections[]` — 汎用セクション配列。`data` は任意キーに `DisplayValue{ label, style }` を紐付ける。`alert` でセクション単位の強調可。  
- `result` — `"Secure"` または `"SNI_Violation"` をヘッダーでバッジ表示。  
- `traceMode` — `"bfs"`（到達順）または `"single-path"`（1 経路を連続して展開）。UI デフォルトは後者。  
- `error?` — `type/message` を持つ。Toast で surfaced し、画面は未解析状態に戻す。

スキーマの一次ソースは `lib/analysis-schema/index.ts` を参照し、UI コードは同型にのみ依存する。

### 1.3 トレース生成とワークリスト

- ストリーミング方式: 不動点計算ループ中に各ノード遷移で `trace.steps` を逐次追加する。再実行による再生成は行わない。  
- 上限ガード: `iterationCap`（デフォルト 10,000）と `maxSteps`（デフォルト 500）の二重上限を持ち、どちらかに到達すると `AnalysisError` を設定して打ち切る。  
- ワークリスト順序: `traceMode` で切り替え。`bfs` は FIFO（到達順）、`single-path` は LIFO により同一経路を優先的に辿る。`traceMode` は結果にメタデータとして保存する。
- 観測 ID の規約: メモリ観測は `"pc:addr"`、制御観測は分岐 PC を文字列化し必要に応じて `"pc:tag"` を付与する。抽象位置 `AbsLoc` は変数名文字列で表現する。

## 2. 画面構成と挙動

### 2.1 レイアウト

- ヘッダー + 2 ペイン構成（左: 操作 + VCFG、右: コード + 抽象状態）。  
- 左ペインの最上部に操作パネルを固定配置（`position: sticky; top: 1.5rem` 相当）。その下に VCFGView が `flex-1` で画面下端まで伸びるように配置される。  
- 右ペイン上部に MuASM コードエディタ（Accordion で折りたたみ可）を配置し、その下に StateViewer。  
- ダークモードやレスポンシブ特殊処理は現状なし（モバイルは縦積み）。

### 2.2 コンポーネント仕様

- **Header**: 解析結果バッジ (`Secure` / `SNI Violation`) または「未解析」表示。  
- **ControlPanel**:  
  - 「解析を実行」: 押下で `analyze` 呼び出し。処理中はボタン disabled。  
  - 「リセット」: 結果・ステップ・Auto Play を初期化。  
  - Prev / Next: ステップ境界で活性/非活性を切替。  
  - Auto Play: 800ms 間隔でステップ前進。`isViolation` または末尾到達で自動停止。  
  - ステップ表示: `Step (current+1) / max`。未解析時は `--/--`。
- **CodeEditor**: MuASM テキストエリアを単一 Accordion で折りたたみ可能にしたもの。デモコードリセットボタン付き。入力変更はソースだけを更新し、解析結果は保持したまま。  
- **VCFGView**: React Flow で VCFG を描画。`type` で色分け（ns=青、spec=橙、rollback=赤）し、`activeNodeId` を太枠＋淡青背景で強調。VCFG は meta 仕様で生成されるため、NS ノード共有＋ spec-begin/end メタノード構造を描画する。データが無い場合はプレースホルダ。左ペイン下部に配置し、`flex-1` + `min-h` で列の残り高さを占有する。  
- **StateViewer**: `sections` を反復描画。`alert` で赤枠＋ALERT バッジ、`DisplayValue.style` を色付きバッジで表示。データが無い場合はプレースホルダ。右ペイン下部に配置。
- **Toast (sonner)**: 解析失敗時にエラー文言を表示し、「再解析」アクションで再実行できる。

### 2.3 レイアウト概要（現行実装の意図）

```
+-------------------------------------------------------+
| ヘッダー (タイトル, 最終判定バッジ)                   |
+---------------------------+---------------------------+
| 左ペイン: 操作 + VCFG     | 右ペイン: 入力 + 状態     |
| 1. コントロールパネル     | 3. コードエディタ (Accordion) |
|    (sticky top)           | 4. 抽象ステートビュー     |
| 2. VCFG ビジュアライザ    |                           |
|    (flex-1 で縦に拡張)    |                           |
+---------------------------+---------------------------+
```

表示上の縦横比は `app/(analysis)/page.tsx` の `lg:grid-cols-2` に依存し、PC で左右2ペイン、モバイルで縦積みになる。

### 2.3 ステート管理

- React state: `source`, `result`, `currentStep`, `isAutoPlay`, `isLoading`。  
- `deriveControlState(result, currentStep)` で Prev/Next 活性と最大ステップを計算。  
- 解析成功時に `currentStep` を 0 にリセット。結果消失時はステップも 0 に戻す防御を実装。

### 2.4 ユーザーフロー（現行）

1. 初期表示: デモコード入り、結果なし → 右ペインはプレースホルダ。  
2. 解析実行: 成功でステップ 0 を表示。失敗で Toast（結果は破棄）。  
3. ステップ送り: Prev/Next/Auto Play で `trace.steps` を遷移し、VCFG/State を同期表示。  
4. 違反検出 or 最終ステップ: Auto Play が自動停止。手動 Next は末尾で無効化。  
5. リセット: 結果とステップを初期化し、入力のみ維持。

## 3. 現行の既知制約

- コード編集時も結果は保持されるため、ソースとトレースが不整合になりうる（解析の再実行は手動）。  
- ポリシー入力 UI は未実装。`analyze` もポリシー引数なしで呼び出している。  
- テスト（Vitest/Playwright）や Storybook は未整備。  

補足: 解析失敗時は Toast を表示しつつ `setResult(null)` で結果を破棄し、右ペインはプレースホルダ表示に戻るのが現行挙動。

以上を現行挙動の「事実」として固定し、今後の改善は別紙 `web-plan.md` に記載する。
