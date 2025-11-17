# Web UI 改善計画（ロードマップ）

- 作成日: 2025-11-17  
- 対象: Web UI 実装担当 (担当 A)  
- 関連: `web-spec.md`

本ドキュメントは `web-spec.md` に記載した「現行仕様」を出発点とし、今後の改善項目をフェーズ分けで整理する。  
各タスクは UI コードの実装状況（例: `app/page.tsx`, `app/components/*`, `app/lib/analysis-client.ts`）を根拠にしている。

## フェーズ 0: 仕様凍結とベースライン
- `web-spec.md` をソース・オブ・トゥルースとして維持する。  
- 現行挙動の回帰基準を用意する（簡易サンプルでのスナップショットでも可）。  
- 目的: 以降の変更による挙動差分を検出しやすくする。

## フェーズ 1: UX 一貫性の確保（軽微改修）
1. **入力変更で結果をクリア**  
   - 今は `CodeEditor` の `onChange` でソースのみ更新し結果は残存（`app/page.tsx:100-114`）。  
   - 方針: 編集開始で `setResult(null); setCurrentStep(0);` を行い、トレースの不整合を防ぐ。  
   - DOD: 編集→右ペインがプレースホルダに戻り、再解析まで Prev/Next は無効。
2. **エラー時のUI挙動のテスト追加**  
   - 現状は例外時に `setResult(null)` で VCFG/State をクリアしプレースホルダに戻している（`app/page.tsx:45-69`）。  
   - 方針: この挙動を E2E で回帰テストし、ボタン活性（Prev/Next/Auto Play が無効化されること）も確認する。  
   - DOD: 解析失敗フィクスチャで、Toast 表示と同時に画面が「未解析」表示に戻ることを Playwright で確認。
3. **Auto Play のガード改善**  
   - 末尾停止と違反停止は実装済み (`app/page.tsx:28-43`)。  
   - 方針: `result` 消失時も interval を確実にクリアし、ステップ 0 に戻すテストを追加。  
   - DOD: Playwright で Auto Play 中にリセット→ interval が止まることを確認。

## フェーズ 2: 機能拡張
1. **ポリシー入力 UI の追加**  
   - 解析呼び出しは `analyze(source)` のみでポリシー未対応 (`app/lib/analysis-client.ts:23-33`)。  
   - 方針: Low/High を指定できるフォーム（regs/mem）を左ペインに追加し、`analyze(source, { policy })` に拡張。  
   - DOD: ポリシー未入力で従来通り動作し、指定時にエンジンへ渡されていることがモックで確認できる。
2. **ステップジャンプ（ノードクリック連携）**  
   - 現状 VCFG ノードクリックは未実装 (`app/components/VCFGView.tsx` は表示のみ)。  
   - 方針: `nodeId -> 最新ステップ` のマップを構築し、ノードクリックでステップにジャンプ。  
   - DOD: モックトレースで任意ノードをクリックし、StateViewer が対応ステップに切り替わる E2E。
3. **ローディングインジケータ**  
   - `isLoading` はボタンの disable のみに利用 (`app/components/ControlPanel.tsx:31-77`)。  
   - 方針: 右ペインにスケルトンやスピナー表示を追加し、解析中の UI 状態を明示。  
   - DOD: 解析中は Prev/Next/Auto Play が押せず、右ペインに「解析中」プレースホルダが出る。

## フェーズ 3: 品質保証と開発体験
1. **ユニットテスト整備 (Vitest/RTL)**  
   - `deriveControlState` の境界、`StateViewer` の alert バッジ、`VCFGView` の色分けをカバー。  
2. **E2E (Playwright)**  
   - 解析成功パス、解析失敗リカバリ、Auto Play 停止、リセット挙動をシナリオ化。  
3. **Storybook スモーク**  
   - `mockAnalysisResult` を使った VCFG/State の視覚確認用ストーリー。

## フェーズ 4: パフォーマンス/将来拡張
- WebWorker 化や大規模グラフ描画（レイアウト計算のオフロード）を検証。  
- `fitViewOptions` やノード初期座標の自動計算を導入し、ノード数増でも視認性を確保。  
- 需要に応じてダークテーマを導入、配色を `DisplayValue.style` に合わせてトークン化。

## トラッキングのすすめ
- 作業前に `web-spec.md` をアップデートし、差分が仕様に反映されることを確認する。  
- フェーズごとにテスト観点をチェックリスト化し、CI フロー（`bun x vitest` / `bun run lint` など）に組み込む。
