# 実装整合性改善計画（理論未参照でも読める版）

対象リポジトリ: `/Users/taisii/Projects/Private/research`
注: 2025-11-23 時点で stack-guard / legacy-meta モードは実装から既に削除され、speculationMode は discard 固定、specMode は light 固定になっている（本ドキュメントのタスク 5 は完了扱い）。UI のデバッグ用途として specContext の push/pop ログは残すが、実行セマンティクスは投機カウンタのみに依存する。

## 前提となるモデルの要点（実装者向けの最小まとめ）
- **関係格子の値**: `Bot`, `EqLow`, `Diverge`, `EqHigh`, `Leak`, `Top`。  
  - `Leak` は吸収元（どこと結合しても `Leak`）。  
  - `Diverge ⊔ EqHigh = EqHigh`（Low の分岐に High が混ざれば High に引き上げ）。  
  - `EqHigh ⊔ Leak = Leak`。  
  - `Top` は「解析不能／情報不足」で、違反とは区別する。
- **観測履歴の更新**: NS 実行はベースラインを記録、SP 実行はベースラインからの逸脱を検査。  
  - NS 側: 観測値が High なら履歴を High に上げる（Leak を含む）。  
  - SP 側: ベースラインが Low なのに SP 観測が High なら即 `Leak`。既に `Leak` なら維持。  
  - 履歴マップのマージは通常の join ではなく、この専用規則を使う。
- **違反判定**: 解析途中で `Leak` を見つけたら違反。`Top` は警告または不確定扱いにとどめる。
- **投機ガード**: Pruning-VCFG では rollback を扱わず、投機長カウンタ `specWindow` が 0 未満になる遷移（spec エッジ）を遮断する。NS エッジはモードを維持したまま通過可能。
- **不要モード**: `stack-guard`（投機スタック検証）と `legacy-meta`（前展開グラフ）は廃止済み。残っているのは `speculationMode: "discard"` と `specMode: "light"` の最小構成のみ。

## 変更タスク（優先順）
1. **格子演算を意図どおりに修正**  
   - ファイル: `sni-engine/lib/core/lattice.ts`  
   - 具体: 上記の結合結果に合わせて JOIN テーブルを修正し、`Leak` を吸収元にする。

2. **観測履歴の NS/SP 専用更新を実装**  
   - ファイル: `sni-engine/lib/core/observations.ts`  
   - 具体: NS 更新は「高ければ高へ」、SP 更新は「ベースライン Low なのに High を見たら Leak」という分岐をコード化。  
   - `state-ops.mergeState` は履歴マージで通常 join を使わず、この専用演算を呼ぶ。

3. **違反判定の基準を Leak のみに絞る**  
   - ファイル: `sni-engine/lib/core/state-ops.ts`  
   - 具体: `stateHasViolation` で `Leak` のみを違反、`Top` は警告用に別経路で扱う。UI/テストの期待値も更新。

4. **投機中の NS 逆流をブロック**  
   - ファイル: `sni-engine/lib/analysis/analyze.ts`  
   - 具体: 投機スタックが空でない場合、`ns` エッジへの遷移を原則禁止（rollback 等の明示的経路のみ許可）。  
   - 必要なら VCFG 生成側でも「投機中は spec/rollback のみ」を保証。

5. **不要モードの撤去と一貫化（完了済み）**  
   - スキーマ/型: `lib/analysis-schema/index.ts` から `stack-guard`, `legacy-meta` を削除済み。  
   - 解析: `sni-engine/lib/analysis/analyze.ts` の分岐整理済み（discard 固定）。  
   - ビルダー: `vcfg-builder/lib/options.ts`, `lib/modes/*.ts`, `build-vcfg.ts` の legacy/meta 分岐撤去済み。  
   - UI/CLI/Docs: 本ファイルを含め順次整合中。  
   - テスト: モード依存のケースを削除 or リライト済み（一部確認継続）。

6. **`specWindow` と `maxSpeculationDepth` の役割を明文化**  
   - `specWindow`: 投機継続ステップごとに 1 減算し、0 未満なら投機遷移を遮断。  
   - `maxSpeculationDepth`: ネスト深さの上限（超過時は警告＋新規投機開始をスキップ）。

7. **初期化規則の整合確認**  
   - ファイル: `sni-engine/lib/core/state.ts`  
   - 具体: エントリ以外のデフォルト格子が `EqHigh` になるよう確認/修正。ポリシー指定の優先順位をコメントで明記。  
   - `doc/project.md` に初期化ポリシーの簡潔な記述を追記。

8. **テスト整備**  
   - 新しい格子/観測セマンティクスの単体テスト追加（`sni-engine/tests/*`）。  
   - モード削除後の CLI/VCFG スナップショット更新。  
   - `Top` が違反でなくなるケースの期待値を調整。

9. **ドキュメント更新**  
   - 仕様差分表を `doc/project.md` に追加し、実装が採用する格子演算・観測規則・パラメータ挙動を一目で分かるようにする。  
   - UI 仕様から廃止モードの選択肢を除去し、警告メッセージの方針を最新化。

## 進め方の提案
- まず 1–3 で解析結果の正しさを担保し、その後 5 でモード削除を一括リファクタ。  
- 4 と 6 は挙動の安全面に直結するため、並行で小さく進めてもよい。  
- テスト/ドキュメント更新（8–9）は最後にまとめて適用し、スナップショット崩れを一度に解消する。

## 残課題メモ
- 解析状態キー圧縮（k-limiting）や投機窓の最適化は本計画の外とし、別途検討。  
- `Top` を警告にする場合の UI 表示（色・文言）を決める必要あり。
