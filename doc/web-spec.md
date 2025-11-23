# Web UI 現行仕様サマリ（実装ベース）

- 作成日: 2025-11-17  
- 対象: Web UI 実装担当 / 研究用デモ利用者  
- 根拠: `app/(analysis)/page.tsx`・`app/(analysis)/features/*`・`lib/analysis-engine/index.ts`・`lib/analysis-schema/index.ts`

本ドキュメントは「いま動いている Web UI が何をしているか」を実装コードから逆算してまとめた現行仕様書である。  
理論仕様や将来計画は含めず、UI が依存するデータ構造と画面挙動を記述する。VCFG ビルダーは `specMode` により legacy-meta / light を切り替え可能（デフォルトは light）で、その仕様やオプションを実装ベースで反映する。プロジェクト全体の俯瞰は `doc/project.md` を参照。

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
- `speculationMode`: `"discard"`（既定）/ `"stack-guard"`  — rollback の扱いを切り替える
- `specMode`: `"light"`（既定） / `"legacy-meta"` — VCFG の形と投機長管理モード。`legacy-meta` は従来どおりビルダー側で投機長を展開し、`light` はグラフを軽量化して投機長を解析エンジンで管理する。
- `specWindow`: 投機長（light モードのみ有効、デフォルト 20）
- `policy`: `{ regs?: Record<string,"Low"|"High">; mem?: Record<string,"Low"|"High"> }`
- `entryRegs`: 解析開始時に EqLow で初期化するレジスタ名の配列
- `entryNodeId`: 開始ノード ID（省略時は先頭ノード）
- `iterationCap` / `maxSteps`: 不動点計算とトレース生成の打ち切り上限（どちらもデフォルト 10,000）
- `maxSpeculationDepth`: 投機コンテキストのネスト深さ上限（デフォルト 20）。閾値を超えると解析は継続するが、該当 `spec-begin` へ入らず警告を発行する。
- ビルダー向け後方互換オプション:
  - `windowSize`: legacy(meta) ビルダーの投機ウィンドウサイズ（デフォルト 20）。`specMode="light"` の場合は無視される。
  - `mode`: ビルダーに直接渡すモード指定（`"meta"|"light"`）。内部で `specMode` に正規化するため、基本は `specMode` を使用する。

### 1.2 AnalysisResult スキーマ（UI が前提する形）

- 互換キー: `schemaVersion = "1.2.0"`
- `graph: StaticGraph` — ノード/エッジと種類（ns/spec/rollback）。`specMode` に応じて 2 形態を取り、結果にも `specMode` として保存する。  
  - `light`（デフォルト）: 各分岐に `spec-begin/spec-end` を 1 組だけ付けた軽量 CFG。投機長は `specWindow` (default 20) を解析エンジンが減算し管理する。  
  - `legacy-meta`: これまで通り NS ノード共有 + `spec-begin/spec-end` メタノードで投機区間を示し、ビルダーが前展開する。  
  `speculationMode` が `discard` の場合は rollback エッジを生成しない。  
- `trace.steps[]` — 各ステップの `{ stepId, nodeId, description, executionMode, state, isViolation, specWindowRemaining? }`。`specWindowRemaining` は light モード時に残り投機長を表示するための任意フィールド。  
- `state.sections[]` — 汎用セクション配列。`data` は任意キーに `DisplayValue{ label, style }` を紐付ける。`alert` でセクション単位の強調可。  
- `result` — `"Secure"` または `"SNI_Violation"` をヘッダーでバッジ表示。  
- `traceMode` — `"bfs"`（到達順）または `"single-path"`（1 経路を連続して展開）。UI デフォルトは後者。  
- `specMode?` / `specWindow?` / `speculationMode?` — 利用モードとパラメータをメタデータとして保持（UI では badge/サイドパネル表示を想定）。  
- `error?` — `type/message` を持つ。Toast で surfaced し、トレースが 1 件以上あれば結果を保持したまま最後のステップを表示する。トレースが空の場合のみ結果を破棄し、画面を未解析状態へ戻す。
- `warnings?` — 致命的ではないが通知したい事項の配列。現状は `MaxSpeculationDepth` のみをサポートし、UI はバッジと Toast でユーザーに周知する（投機モード `discard` / `stack-guard` の別なく上限到達時に発火）。

スキーマの一次ソースは `lib/analysis-schema/index.ts` を参照し、UI コードは同型にのみ依存する。

### 1.3 トレース生成とワークリスト

- ストリーミング方式: 不動点計算ループ中に各ノード遷移で `trace.steps` を逐次追加する。再実行による再生成は行わない。  
- 上限ガード: `iterationCap`（デフォルト 10,000）と `maxSteps`（デフォルト 10,000）の二重上限を持ち、どちらかに到達すると `AnalysisError` を設定して打ち切る。  
- ワークリスト順序: `traceMode` で切り替え。`bfs` は FIFO（到達順）、`single-path` は LIFO により同一経路を優先的に辿る。`traceMode` は結果にメタデータとして保存する。
- 観測 ID の規約: メモリ観測は `"pc:addr"`、制御観測は分岐 PC を文字列化し必要に応じて `"pc:tag"` を付与する。抽象位置 `AbsLoc` は変数名文字列で表現する。

## 2. 画面構成と挙動

### 2.1 レイアウト

- ヘッダー + 2 ペイン構成（左: 操作 + VCFG、右: コード + 抽象状態）。  
- 左ペインの最上部に操作パネルを固定配置（`position: sticky; top: 1.5rem` 相当）。その下に VCFGView が `flex-1` で画面下端まで伸びるように配置される。  
- 右ペイン上部に MuASM コードエディタ（Accordion で折りたたみ可）を配置し、その下に StateViewer。  
- ダークモードやレスポンシブ特殊処理は現状なし（モバイルは縦積み）。

### 2.2 コンポーネント仕様

- **Header**: 解析結果バッジ (`Secure` / `SNI Violation`) または「未解析」表示。`warnings` が返る場合は警告ピルを追加し、`MaxSpeculationDepth` では「投機ネスト上限により一部探索停止」のサブテキストを表示する。  
- **ControlPanel**:  
  - 「解析を実行」: 押下で `analyze` 呼び出し。処理中はボタン disabled。  
  - 「リセット」: 結果・ステップ・Auto Play を初期化。  
  - Prev / Next: ステップ境界で活性/非活性を切替。  
  - Auto Play: 800ms 間隔でステップ前進。`isViolation` または末尾到達で自動停止。  
  - ステップ表示: `Step (current+1) / max`。未解析時は `--/--`。
  - 投機モード選択: `discard` / `stack-guard` をセレクトで切替。  
- **CodeEditor**: MuASM テキストエリアを単一 Accordion で折りたたみ可能にしたもの。デモコードリセットボタン付き。入力変更はソースだけを更新し、解析結果は保持したまま。  
- **VCFGView**: React Flow で VCFG を描画。`type` で色分け（ノード: ns=青・spec=橙／エッジ: ns=グレー・spec=橙・rollback=赤）し、`activeNodeId` を太枠＋淡青背景で強調。`specMode` が light（デフォルト）の場合は spec-begin/end を最小限に付与した CFG を描画し、legacy-meta の場合は従来どおり NS 共有＋ spec-begin/end メタノード構造を描画する。データが無い場合はプレースホルダ。左ペイン下部に配置し、`flex-1` + `min-h` で列の残り高さを占有する。  
- **StateViewer**: `sections` を反復描画。`alert` で赤枠＋ALERT バッジ、`DisplayValue.style` を色付きバッジで表示。データが無い場合はプレースホルダ。右ペイン下部に配置。投機スタック表示はスタックが非空ならモードに関係なく描画され、`MaxSpeculationDepth` 警告は両モードで発生しうる（深さ上限で新規 spec-begin への突入をスキップ）。
- **Toast (sonner)**: 解析失敗時にエラー文言を表示し、「再解析」アクションで再実行できる。`warnings` は Warning Toast で告知し、JSON 文字列化したシグネチャで重複送出を抑止する。

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
- 解析成功時に `currentStep` を 0 にリセット。結果消失時はステップも 0 に戻す防御を実装。`AnalysisResult.error` が返ってもトレースが残る場合は `result` を保持し、`currentStep` を末尾へジャンプさせる。

### 2.4 ユーザーフロー（現行）

1. 初期表示: デモコード入り、結果なし → 右ペインはプレースホルダ。  
2. 解析実行: 成功でステップ 0 を表示。`AnalysisError` が返っても部分結果があれば最後のステップまでジャンプし Toast で通知、完全失敗時のみ結果を破棄。  
3. ステップ送り: Prev/Next/Auto Play で `trace.steps` を遷移し、VCFG/State を同期表示。  
4. 違反検出 or 最終ステップ: Auto Play が自動停止。手動 Next は末尾で無効化。  
5. リセット: 結果とステップを初期化し、入力のみ維持。

## 3. 現行の既知制約

- コード編集時も結果は保持されるため、ソースとトレースが不整合になりうる（解析の再実行は手動）。  
- ポリシー入力 UI は未実装。`analyze` もポリシー引数なしで呼び出している。  
- UI の自動テストは `app/(analysis)/features/visualization/*.test.ts` のユニットテストのみで、Playwright などによる E2E や Storybook は未整備。  

補足: 解析失敗時は Toast でエラー内容を通知し、Partial Trace がある場合は結果を保持して最後のステップを表示する。完全失敗のみ `setResult(null)` で未解析に戻る。

以上を現行挙動の「事実」として固定し、今後の改善は別紙 `web-plan.md` に記載する。
