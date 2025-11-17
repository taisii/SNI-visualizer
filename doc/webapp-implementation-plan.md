# Webアプリ詳細要件定義書 & 実装計画（担当A）

## 位置付け
- 本書は `doc/webapp.md` の概要仕様を踏まえ、担当A（Webアプリ担当）が実装に着手するための詳細要件と段階的な実装計画を整理したもの。
- 参照スキーマ: `app/types/analysis-result.ts`

## 要件定義（UI / Webアプリ）
- **クライアント完結**: ブラウザ内の JS/WASM のみで解析・可視化を実行し、バックエンド通信は行わない。
- **疎結合インターフェース**: エンジンとは `analyze(sourceCode): Promise<AnalysisResult>` のみで結合し、UI は `AnalysisResult` スキーマにのみ依存する。
- **画面構成**: ヘッダー + 左右2ペイン（左: MuASMエディタ＋操作、右: VCFGビジュアライザ＋ステートビューワ）。ヘッダーに最終判定バッジを表示。
- **エディタ**: デモ用 `ptr++` ループをプリセット。編集時は解析結果をクリアして整合性を保つ。
- **コントロールパネル**: 解析実行／Prev／Next／Reset／Auto Play／現在ステップ情報。ステップ境界でボタン活性を切替。
- **VCFGビジュアライザ**: `graph.nodes/edges` を `type` 別に色分けし、`nodeId` が現在ステップのものを強調。`rollback` エッジは点線。描画ライブラリは React Flow（パッケージ: `@xyflow/react`）を採用し、既に依存関係として導入済みであることを前提とする。
- **ステートビューワ**: `AbstractState.sections` を表形式で描画し、`alert` 付きセクションを警告表示。`DisplayValue.style` に基づきバッジ色を決定。
- **エラーUX**: `AnalysisResult.error` 受領時に Toast を表示し、再解析ボタンを提供。ローディング中は操作を無効化しプレースホルダを表示。
- **アクセシビリティ / 拡張**: 色分けはセマンティッククラスで実装し、将来のグラフライブラリ差し替えや WebWorker 化に備えた抽象化を維持。

## 実装計画（担当A）
1. **レイアウト骨格の構築**
   - App Router 上でヘッダーと2ペインレイアウトを実装。ダークモード対応は不要（ライトテーマ固定）。
   - 共通型として `AnalysisResult` を import し、Props/State を型安全に定義。
   - **DOD**: 
     - E2E: Playwright で初期表示のヘッダーと左右2ペインの存在を検証するテストが通る。
     - Unit: Layout コンポーネントで `AnalysisResult` 型の Props を受け取ると型エラーが出ないこと（tsc）。

2. **状態管理の設計**
   - `analysisResult | null`, `currentStep`, `isAutoPlay`, `isLoading`, `error` を React state で保持。
   - `steps` 長と `currentStep` からボタン活性・ハイライト対象を算出するユーティリティを用意。
   - **DOD**:
     - Unit: `getControlState()`（仮）に対して境界値テスト（step 0 / last / 空配列）を Vitest でカバー。
     - Type-check: `tsc --noEmit` が state 型エラーなく通る。

3. **コンポーネント分割と実装順**
   - `Header`（タイトル＋判定バッジ）
   - `CodeEditor`（プリセット入力・変更で結果クリア）
   - `ControlPanel`（解析と再生ボタン群）
   - `VCFGView`（React Flow / `@xyflow/react` を標準採用。ノード/エッジの style マッピングとレイアウト設定を抽象化しておき、将来のレイアウトアルゴリズム変更に対応）
   - `StateViewer`（セクションテーブル＋スタイルバッジ＋alert枠）
   - `Toast`（エラー表示と再解析ボタン）
   - **DOD**:
     - Unit: `StateViewer` が `alert:true` のセクションで警告クラスを付与することをスナップショットで確認。
     - Integration: `VCFGView` にモック `graph` を与えた時、React Flow ノード/エッジ数が入力と一致することをテスト。

4. **エンジン連携スタブ**
   - `app/lib/analysis-client.ts` を新規作成し、`analyze(sourceCode)` を Promise でラップ。将来の WebWorker 化を見据え、呼び出し側は非同期 API のみに依存させる。
   - **DOD**:
     - Unit: `analysis-client` をモックし、成功/失敗の両ケースで Promise が解決/拒否することをテスト。
     - Integration: UI からモッククライアント呼び出し時に Loader → 結果表示 → エラートースト が期待通り遷移する Playwright テスト。

5. **再生ロジック/インタラクション**
   - `Auto Play` は `setInterval` で `currentStep` をインクリメントし、`isViolation` で自動停止。インターバルは定数化。
   - （オプション）ノードクリックで該当ステップへジャンプできるよう、`nodeId`→最新ステップのインデックスを事前構築。
   - **DOD**:
     - Unit: Auto Play ハンドラが `isViolation:true` を検知して interval を `clearInterval` することを spy で確認。
     - E2E: Playwright で Auto Play を開始→終端で停止し、`currentStep` が最大値で固定されることを検証。

6. **エラー・ローディング体験**
   - ローディング中は各ボタンを disabled、右ペインはプレースホルダを表示。
   - Toast を閉じてもステップUIを無効化したままにし、再解析でリカバリする動線を用意。
   - **DOD**:
     - E2E: 解析失敗をモックし、Toast が表示され再解析ボタンでリトライできることを確認。

7. **テストと検証**
   - ユニット: `StateViewer` のバッジ色マッピングと `ControlPanel` の活性条件を React Testing Library でテスト。
   - フィクスチャ: モック `AnalysisResult` を `fixtures/` に置き、ステップ進行と違反検出表示をスナップショット検証。
   - ストーリー: 主要コンポーネントを Storybook で視覚確認できるようにし、UI 崩れを早期検知。
   - **DOD**:
     - `bun x vitest run` で単体テストが全てパス。
     - `bun run lint` で ESLint/型チェックを含む CI 想定ジョブが通過。

## 次のアクション候補
1. `app/page.tsx` をレイアウト骨格に差し替えるスケルトン実装
2. `fixtures/` にモック AnalysisResult を追加し、VCFGView/StateViewer のプロトタイプ描画を確認
3. `analysis-client.ts` を作成し、解析→表示までのエラーハンドリングフローを一巡させる
