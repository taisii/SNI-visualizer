# VCFG Builder 仕様（現行実装）

非エンジニア向けに、現在動いている VCFG Builder の挙動をまとめています。MuASM ソースコードを入力すると、UI と解析コアがそのまま使える静的グラフ（StaticGraph）を返します。実装は `vcfg-builder/lib/*` に配置されています。

## 1. 入力
- **対象言語**: MuASM テキスト。空行・行末コメント（`//` 以降）は無視し、ラベルは次の命令にひも付けます（`Loop:` のみの行も可）。重複ラベルはパース時点でエラーになります。`beqz` のラベル解決は前方参照もサポートします。参照: `muasm-ast/lib/parser.ts`。
- **サポート命令**（8 種類）: `skip`、代入 `x <- e`、`load x, e`、`store x, e`、`beqz x, L`、`jmp e`、`spbarr`、条件付き代入 `x <- e1 ? e2`。構文とトークナイズは `muasm-ast/lib/parser.ts`。
- **ジャンプ解決**: `jmp` 先は整数リテラルまたはラベルでなければエラー。レジスタや式がラベルに解決できない場合は例外を投げます。参照: `muasm-ast/lib/parser.ts`、`vcfg-builder/lib/modes/*`。
- **パラメータ**: `windowSize`（投機ウィンドウ長）デフォルト 20。0 以下は即時例外。参照: `vcfg-builder/lib/options.ts`。

## 2. 出力（StaticGraph）
- **スキーマの正本**: `StaticGraph`/`AnalysisResult` の正式スキーマは `doc/project.md` §3 と `lib/analysis-schema/index.ts` をソース・オブ・トゥルースとする。本書は生成ポリシーと実装上の挙動のみを要約する。
- **ノード生成ポリシー**: 各命令に ID `n{pc}` を付与し、フィールドはスキーマに沿って埋める（例: `pc`、`label`、`type`、`sourceLine`）。参照: `vcfg-builder/lib/build-vcfg.ts`、`vcfg-builder/lib/modes/*`。
- **エッジ生成ポリシー**: `type` は `ns` / `spec` / `rollback` を使用し、重複はセットで排除。参照: `vcfg-builder/lib/graph-builder.ts`。
- **返却単位**: `buildVCFG` はグラフ構造のみを返す。`schemaVersion` 付与とエラーハンドリングは上位ファサード `analyze()`（`lib/analysis-engine/index.ts`）で行う。

## 3. 処理フロー
1. **パース**  
   - ラベル表と命令列を構築し、`beqz` の分岐先 PC を事前解決します。未定義ラベルや無効トークンは `ParseError`（sourceLine 付き）で失敗。参照: `muasm-ast/lib/parser.ts`。

2. **通常パスのグラフ化**  
   - 全命令を通常ノードとして登録。`jmp` は解決先へ 1 本、`beqz` は taken / not-taken の 2 本、その他は次行へのフォールスルーを張ります。参照: `vcfg-builder/lib/modes/expanded.ts`・`vcfg-builder/lib/modes/meta.ts`。

3. **投機パスの展開（モード別）**  
   - expanded: 分岐ごとに「とらない側」「とる側」を別コンテキスト（`spec0`, `spec1`, ...）で再帰展開し、投機ノードを複製。予算ゼロまたは `spbarr` で `rollback`。
   - meta: NS ノードを共有しつつ、分岐ごとに `spec-begin` / `spec-end` のメタノード（`type:"spec"`）を追加して投機領域をマーキング。予算ゼロまたは `spbarr` で `rollback`。

4. **ロールバックの安全側制御**  
   - ロールバック先 PC が存在しない場合（例: プログラム末尾を超える場合）はエッジを張らずに終了し、無効 ID への遷移を防ぎます。参照: `vcfg-builder/lib/modes/*`。

## 4. エラーと制約
- `windowSize <= 0` で例外（予防的ガード）。`vcfg-builder/lib/options.ts`。
- `jmp` の解決不可、ラベル未定義、重複ラベル、無効トークン、式の構文エラーはいずれも `ParseError` 派生の例外で通知。`muasm-ast/lib/parser.ts`、`vcfg-builder/lib/modes/*`。
- expanded: 投機ノードの ID は `<通常ID>@specN` で一意化し、同一コンテキスト内での重複挿入はスキップします。
- meta: NS ノードは共有し、投機区間を示すメタノードのみ `type:"spec"` で追加します。

## 5. 既知の挙動・制限
- `jmp` のターゲットが即値・ラベル以外（実行時値など）の場合は未対応でエラーになります。`vcfg-builder/lib/modes/*`。
- 投機・ロールバックエッジにはラベル（例: mispredict/taken）を付けていません。UI 表示は `type` とノード ID のみで判別します。
- 出力度はグラフ構造のみに限定され、解析結果（secure/violation 判定や実行トレース）は別サービスで生成します。`lib/analysis-schema/index.ts:10-33`。
