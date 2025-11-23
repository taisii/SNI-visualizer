# SNI検証ツール (研究プロトタイプ)

MuASM プログラムに対する投機的非干渉 (SNI) を静的解析し、ブラウザで可視化できるツール群です。VCFG（仮想制御フローグラフ）と抽象解釈を組み合わせ、投機実行でのみ起こる情報漏洩を検出します。

## できること / メリット
- MuASM ソースを入力して SNI 解析を実行し、結果をステップ再生で確認できる。
- 通常/投機の経路を色分けした軽量 VCFG を自動描画（spec-begin メタノードのみ付与、rollback/spec-end は生成しない）。
- 抽象状態 (レジスタ・メモリ・観測履歴) を High/Low/Leak で可視化。
- 解析パラメータは `traceMode (bfs/single-path)` と投機長 `specWindow` のみ（投機モードは固定）。
- CLI でケース一括実行し、CI やベンチに組み込みやすい。

## システム概要
- **Web アプリ**: Next.js 16 + React 19。結果 JSON を受け取り VCFG と抽象状態を表示。左右 2 ペイン（左: 操作/VCFG、右: エディタ/状態）。
- **VCFG Builder**: MuASM をパースして `StaticGraph` を生成。現在は `mode: "light"` のみ（spec-begin メタノードだけを付与）。
- **SNI エンジン**: 抽象解釈で Leak 検出。`traceMode (bfs/single-path)` と `specWindow` (default 20) を受理し、Pruning-VCFG 上で投機長カウンタが尽きたら探索を打ち切る。
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
# muasm_case/ 配下を一括解析 (デフォルト traceMode=bfs, specWindow=20)
bun run muasm:run

# 投機長を変更して実行
bun run muasm:run --spec-window 8

# トレースモードを DFS(single-path) で実行
bun run muasm:run --trace-mode single-path
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
