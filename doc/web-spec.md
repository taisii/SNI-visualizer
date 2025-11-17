# Web UI 現行仕様サマリ（実装ベース）

- 作成日: 2025-11-17  
- 対象: Web UI 実装担当 / 研究用デモ利用者  
- 根拠: `app/page.tsx`・`app/components/*.tsx`・`app/lib/analysis-client.ts`・`app/types/analysis-result.ts`

本ドキュメントは「いま動いている Web UI が何をしているか」を実装コードから逆算してまとめた現行仕様書である。  
理論仕様や将来計画は含めず、UI が依存するデータ構造と画面挙動を記述する。

## 0. 役割と全体像

- 目的: MuASM から生成した VCFG と SNI 解析結果をブラウザ上でステップ実行しながら可視化する。  
- 処理フロー:  
  1. 左ペインの MuASM エディタでソース入力。  
  2. 「解析を実行」押下で `analyze(source)` を呼び、VCFG 生成→SNI 解析を実行。  
  3. 返却された `AnalysisResult` を右ペインで可視化（VCFG + 抽象状態）。  
  4. Prev/Next/Auto Play でトレースをコマ送り。違反検出で自動停止。

## 1. データインターフェース

### 1.1 解析呼び出し

UI からの単一ファサード `analyze(sourceCode: string): Promise<AnalysisResult>` を提供する。  
内部で VCFG ビルダーと SNI エンジンを順に呼ぶ。例外発生時は `AnalysisResult.error` を埋めて返し、UI 側は Toast で通知後、結果を破棄する。

### 1.2 AnalysisResult スキーマ（UI が前提する形）

- 互換キー: `schemaVersion = "1.0.0"`
- `graph: StaticGraph` — ノード/エッジと種類（ns/spec/rollback）。投機パスは必ずノード複製。  
- `trace.steps[]` — 各ステップの `{ stepId, nodeId, description, executionMode, state, isViolation }`。  
- `state.sections[]` — 汎用セクション配列。`data` は任意キーに `DisplayValue{ label, style }` を紐付ける。`alert` でセクション単位の強調可。  
- `result` — `"Secure"` または `"SNI_Violation"` をヘッダーでバッジ表示。  
- `error?` — `type/message` を持つ。Toast で surfaced し、画面は未解析状態に戻す。

スキーマの一次ソースは `app/types/analysis-result.ts` を参照し、UI コードは同型にのみ依存する。

## 2. 画面構成と挙動

### 2.1 レイアウト

- ヘッダー + 2 ペイン構成（左: 入力/操作、右: VCFG + 抽象状態）。  
- ダークモードやレスポンシブ特殊処理は現状なし（モバイルは縦積み）。

### 2.2 コンポーネント仕様

- **Header**: 解析結果バッジ (`Secure` / `SNI Violation`) または「未解析」表示。  
- **CodeEditor**: MuASM テキストエリア。デモコードリセットボタン付き。入力変更はソースだけを更新し、解析結果は保持したまま。  
- **ControlPanel**:  
  - 「解析を実行」: 押下で `analyze` 呼び出し。処理中はボタン disabled。  
  - 「リセット」: 結果・ステップ・Auto Play を初期化。  
  - Prev / Next: ステップ境界で活性/非活性を切替。  
  - Auto Play: 800ms 間隔でステップ前進。`isViolation` または末尾到達で自動停止。  
  - ステップ表示: `Step (current+1) / max`。未解析時は `--/--`。
- **VCFGView**: React Flow で VCFG を描画。`type` で色分け（ns=青、spec=橙、rollback=赤）し、`activeNodeId` を太枠＋淡青背景で強調。データが無い場合はプレースホルダ。  
- **StateViewer**: `sections` を反復描画。`alert` で赤枠＋ALERT バッジ、`DisplayValue.style` を色付きバッジで表示。データが無い場合はプレースホルダ。
- **Toast (sonner)**: 解析失敗時にエラー文言を表示し、「再解析」アクションで再実行できる。

### 2.3 レイアウト概要（現行実装の意図）

```
+-------------------------------------------------------+
| ヘッダー (タイトル, 最終判定バッジ)                   |
+---------------------------+---------------------------+
| 左ペイン: 入力と制御      | 右ペイン: 可視化          |
| 1. コードエディタ         | 3. VCFG ビジュアライザ    |
| 2. コントロールパネル     | 4. 抽象ステートビュー     |
+---------------------------+---------------------------+
```

表示上の縦横比は `app/page.tsx` の `lg:grid-cols-2` に依存し、PC で左右2ペイン、モバイルで縦積みになる。

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
