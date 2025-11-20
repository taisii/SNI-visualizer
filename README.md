# SNI検証ツール開発プロジェクト

MuASM プログラムに対する投機的非干渉 (SNI) 検証アルゴリズムを実装し、ブラウザ上で可視化する研究プロトタイプ。VCFG（仮想制御フローグラフ）と抽象解釈を中核に、解析エンジンと Web UI を疎結合に統合する。

## ゴールと成否基準
- 投機的実行を含むケース（例: `ptr++` ループ）で SNI 違反を検出・表示できる。
- VCFG 上で通常/投機/ロールバックのパスが明示され、現在ノードを的確にハイライトできる。
- 抽象ドメインを差し替えても UI 変更が最小で済むデータ駆動設計を維持する。
- 最低 3 ケースの回帰テスト（安全 / Leak 検出 / 投機バリア）を保持する。

## システム構成
- **Web アプリ (担当A)**: Next.js 16 + React 19。解析結果 JSON を受け取り、VCFG/状態テーブル/ステップ再生 UI を描画。
- **MuASM 基盤エンジン / VCFG Builder (担当B)**: MuASM をパースし、Always-Mispredict モデルで通常・投機・ロールバックのエッジを持つ VCFG を生成。現在は meta (メタノード) 仕様のみをサポート。
- **SNI 解析コア (担当C)**: VCFG 上で抽象解釈を実行し、格子 \(L_{SNI}^\#\) を用いて Leak を検知。ExecutionTrace を生成して UI へ返す。
- **データフロー**: `MuASM 基盤` → `VCFG Builder` → `SNI 解析コア` → `Web アプリ`。

## 共通インターフェース (AnalysisResult 抜粋)
型定義の単一出典は `lib/analysis-schema/index.ts`。A/B/C すべてここを import する。
- `schemaVersion`: `"1.0.0"`
- `graph: StaticGraph` — meta 仕様に合わせ、通常命令ノードは共有しつつ `spec-begin/spec-end` メタノード（`type: "spec"`）と `rollback` エッジで投機区間を表現。
- `trace: ExecutionTrace` — `steps[{stepId,nodeId,description,executionMode,state,isViolation}]`
- `result`: `"Secure"` \| `"SNI_Violation"`
- `error?`: `{type,message,detail?}`
- `AbstractState.sections`: 任意セクション配列（例: regs, mem, obs）。`DisplayValue {label, style}` で色付け。

## Webアプリ UI要点
- 左ペイン: MuASM エディタ + 解析/再生コントロール（Prev/Next/Reset/Auto Play）。
- 右ペイン: VCFG ビジュアライザ（type に応じて色分け）と汎用ステートビューワ（セクション配列をデータ駆動描画）。
- 投機フェーズは赤系で強調し、Leak を含むセクションは警告色とアラート枠で表示。

## VCFG 生成の指針 (MuASM 基盤)
- 命令セット: `skip`, 代入, `load`, `store`, `beqz`, `bnez`, `jmp`, `spbarr`, 条件付き代入 (`cmov` 相当)。比較演算子 (`<`, `<=`, `=`, `!=` 等) や 16進リテラルもサポート。
- Always-Mispredict: 全分岐で誤予測パスを生成。ネスト投機を許容し、投機ウィンドウ `w` デフォルト 20（親子で残り budget を継承）。
- エッジ種別: `ns`（通常）、`spec`（誤予測/投機）、`rollback`（復帰）。投機区間は `spec-begin/spec-end` メタノード (`type: "spec"`) を通じてマーキングし、通常命令ノードは共有する。

## 抽象解釈コアの要点
- 格子値: `Bot < EqLow < EqHigh < Diverge < Leak < Top`。`Leak`/`Top` を含む観測で違反判定。
- ワークリストによる固定点計算 + `iterationCap = 10,000`。終了後に「Replay」方式で ExecutionTrace を生成。
- 3 マップ \(R^\#, \Gamma^\#, \mathcal{O}^\#\) を追跡し、Spec エッジでは NS を保持したまま Spec 側のみ更新して差分（Leak/Diverge）を検出。

## リポジトリ構造（現行）
```
.
├ app/                        # Next.js アプリ（分析 UI は (analysis)/ 配下にコロケート）
├ lib/
│ ├ analysis-schema/          # AnalysisResult/StaticGraph 型の単一正本
│ └ analysis-engine/          # UI から呼ぶ薄いファサード (VCFG Builder → SNI Engine)
├ sni-engine/                 # SNI 解析コア
│ ├ doc/                      # spec.md, plan.md
│ └ lib/                      # 解析ロジック実装
├ vcfg-builder/               # MuASM VCFG ビルダー
│ ├ doc/                      # spec.md, plan.md
│ └ lib/                      # VCFG 生成ロジック
├ muasm-ast/                  # MuASM AST 定義
├ components/                 # 共通 UI コンポーネント
├ doc/                        # プロジェクト要件・Web仕様・計画ドキュメント (web-spec.md, web-plan.md)
├ public/                     # 静的アセット
└ bun.lock / package.json     # 依存管理
```

## セットアップ / 実行
前提: Node.js 18+ 推奨（Next.js 16 互換）。bun を使う場合は `bun` コマンドでも可。

```bash
bun install      
bun run dev      # http://localhost:3000 で開発サーバ

# 本番ビルド
bun run build
bun start
```

## MuASM ケースの実行 (CLI)
SPECTECTOR 由来の MuASM ケースは `scripts/run-muasm.ts` から一括実行できます。引数を省略すると `muasm_case/` ディレクトリ配下の `.muasm` ファイルを順に解析し、結果を標準出力へ整形表示します。

```bash
# 例: すべてのケースを実行
bun run muasm:run

# 例: spectector_case 配下だけ解析し、投機ウィンドウを 8 に変更
bun run muasm:run muasm_case/spectector_case --window-size 8
```

オプション一覧は `bun run scripts/run-muasm.ts --help` で確認できます。`--trace-mode single-path` を指定するとワークリストが深さ優先で処理され、`--window-size <n>` で投機ウィンドウを上書きできます。


## 参照ドキュメント
- 全体要件・データスキーマ: `doc/project.md`
- Web UI 仕様: `doc/web-spec.md`
- SNI 解析コア仕様: `sni-engine/doc/spec.md`
- MuASM 基盤/VCFG 仕様: `vcfg-builder/doc/spec.md`

## 今後のタスク例
- VCFG Builder の投機ウィンドウ/ネスト挙動を単体テストで検証。
- 抽象解釈コアの格子演算と iterationCap 超過時のエラーハンドリングを実装。
- UI でアラートセクションのアクセシビリティ向上（点滅・スクリーンリーダ対応）を検討。
- 回帰テスト 3 ケースを CI に組み込む。
