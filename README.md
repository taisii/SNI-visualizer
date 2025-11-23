# SNI検証ツール (研究プロトタイプ)

MuASM プログラムに対する投機的非干渉 (SNI) を静的解析し、ブラウザで可視化できるツール群です。VCFG（仮想制御フローグラフ）と抽象解釈を組み合わせ、投機実行でのみ起こる情報漏洩を検出します。

## できること / メリット
- MuASM ソースを入力して SNI 解析を実行し、結果をステップ再生で確認できる。
- 通常/投機/ロールバックの経路を色分けした VCFG を自動描画。
- 抽象状態 (レジスタ・メモリ・観測履歴) を High/Low/Leak で可視化。
- 解析モードを切替可能:
  - **light** (デフォルト): グラフを最小化し、投機長 `specWindow` をエンジン側で管理。
  - **legacy-meta**: 従来の前展開グラフ（後方互換用）。
- CLI でケース一括実行し、CI やベンチに組み込みやすい。

## システム概要
- **Web アプリ**: Next.js 16 + React 19。結果 JSON を受け取り VCFG と抽象状態を表示。左右 2 ペイン（左: 操作/VCFG、右: エディタ/状態）。
- **VCFG Builder**: MuASM をパースして `StaticGraph` を生成。`mode: "legacy-meta" | "light"` をサポート（ファサードのデフォルトは light）。`speculationMode: "discard" | "stack-guard"`（デフォルト discard）。
- **SNI エンジン**: 抽象解釈で Leak 検出。`traceMode (bfs/single-path)`, `specWindow` (light 専用, default 20), `maxSpeculationDepth`, `speculationMode` (default discard) 等を受理。
- **共通スキーマ**: `lib/analysis-schema/index.ts` が `AnalysisResult` / `StaticGraph` の単一正本。

## セットアップと実行
前提: Node.js 18+ / bun。

```bash
bun install
bun run dev      # http://localhost:3000
# 本番
bun run build
bun start
```

### CLI で MuASM ケースを走らせる
```bash
# muasm_case/ 配下を一括解析 (デフォルト bfs, light, discard, specWindow=20)
bun run muasm:run

# light グラフ + specWindow=8 で実行（rollback は discard のまま）
bun run muasm:run --spec-graph-mode light --spec-window 8

# rollback 検証を有効にする
bun run muasm:run --speculation-mode stack-guard
```
オプションは `bun run scripts/run-muasm.ts --help` を参照。

## リポジトリ構成 (抜粋)
```
app/                     # Web UI (analysis ページ)
lib/analysis-schema      # スキーマの正本
lib/analysis-engine      # UI/CLI から呼ぶファサード (VCFG Builder → SNI Engine)
vcfg-builder/            # VCFG 生成ロジック + doc/spec.md, plan.md
sni-engine/              # 抽象解釈コア + doc/spec.md, plan.md
doc/                     # 全体仕様 (project.md), Web 現行仕様/計画 (web-spec.md / web-plan.md)
scripts/run-muasm.ts     # CLI エントリ
```

## 参照ドキュメント
- 現行仕様サマリ: `doc/project.md`
- Web UI 仕様: `doc/web-spec.md`
- SNI エンジン仕様: `sni-engine/doc/spec.md`
- VCFG Builder 仕様: `vcfg-builder/doc/spec.md`
- 改善計画: `doc/web-plan.md`, `sni-engine/doc/plan.md`, `vcfg-builder/doc/plan.md`

## 既知の制約
- ポリシー入力 UI は未実装（CLI/コード経由では指定可）。
- エディタでソース変更時、解析結果は手動で再実行が必要。
- E2E テスト未整備（ユニットテストはあり）。
