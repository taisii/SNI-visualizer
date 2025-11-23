# 実行計画（Pruning-VCFG 対応 / 投機スタック簡素化）

## ゴール
- Pruning-VCFG（rollback なし・投機カウンタ方式）の理論を実装に反映し、SNI 検証の健全性と停止性を揃える。
- UI/CLI/ドキュメントを同じ前提に一本化し、不要オプションを除去した最小構成にする。
- デバッグ利便性のため、実行セマンティクスはカウンタ方式に移行しつつ「可視化用スタック情報」を残す設計を固める。

## 合意事項（設計ポリシー）
- **実行セマンティクス**: rollback を解析対象から除外し、投機長は単一カウンタ `w` で管理する（理論 4.1, 4.3 に従う）。
- **UI 互換性**: 解析中に保持する「投機コンテキスト履歴（push/pop）」はセマンティクスに影響させず、トレースログ用メタデータとして記録を継続する。UI 右下のスタック表示はこのメタ情報から描画する。
- **API 方針**: `specMode` / `speculationMode` は実質固定値のため公開 API から除去し、`specWindow` と `traceMode` のみを残す。

## タスク一覧
1. **解析コアのカウンタ化**
   - `sni-engine/lib/analysis/analyze.ts`: ContextStack / specWindowStack を単一カウンタに置換し、rollback 分岐を削除。状態キーも `mode + nodeId + w` に簡素化。
   - `state-to-sections` から `specStack` 依存を外し、代わりに残り `w` を表示する。
2. **可視化用スタックの保持**
   - 解析セマンティクスとは独立に「訪問した spec-begin ID を push/pop するだけのログスタック」を維持し、`ExecutionTrace` にメタデータとして格納。UI はこのログを用いて右下表示を継続。
3. **VCFG/スキーマ整合**
   - `lib/analysis-schema/index.ts`: `GraphEdge.type` を `"ns" | "spec"` に縮約し、`speculationMode/specMode` を型から削除。
   - `vcfg-builder/lib/modes/light.ts`: `specContext` の付与が不要なら削除し、メタデータを残す場合は「UI 用ログ専用」であることをコメントで明示。
4. **API 呼び出し側の掃除**
   - `lib/analysis-engine/index.ts`, `app/(analysis)/page.tsx`, `scripts/run-muasm.ts`: 不要オプションを受け取らない形に刷新し、旧オプションを渡している呼び出しを削除。
5. **テスト再構成**
   - rollback/stack-guard 系テストを削除または無効化。
   - 追加: (a) spec-begin で w リセット、(b) w<0 で Prune、(c) Leak 検出で即終了、(d) ns エッジは投機中でも通過するが `mode` は Speculative 維持、(e) Top は警告のみ。
   - UI 側: ELK レイアウトの基本順序検証を軽量ケースで復活。
6. **ドキュメント更新**
   - `doc/project.md`, `doc/web-spec.md`, `sni-engine/doc/spec.md` をカウンタ方式＋ログスタック併用の方針に更新。
   - `doc/implementation-alignment.md` のタスク完了状況を反映。

## 成果物
- コード: 解析エンジン・ビルダー・UI/CLI の一貫した API とセマンティクス。
- テスト: 上記タスク 5 に対応するユニット/スナップショット。
- 文書: 更新済み仕様書と整合計画。

## リスクと対策
- UI スタック表示がセマンティクスと乖離するリスク → 「ログ専用」コメントとテストで意図を固定。
- API 破壊的変更の周知漏れ → `CHANGELOG` / `README` に互換性メモを追加（別タスクとして追記予定）。

## スケジュール（目安）
1. コアカウンタ化＋ログスタック実装（0.5d）
2. API 整理と VCFG/スキーマ整合（0.5d）
3. テスト再構成（0.5d）
4. ドキュメント整合・最終確認（0.25d）
