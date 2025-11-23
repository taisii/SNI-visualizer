# VCFG Builder 仕様（現行実装）

非エンジニア向けに、現在動いている VCFG Builder の挙動をまとめています。MuASM ソースコードを入力すると、UI と解析コアがそのまま使える静的グラフ（StaticGraph）を返します。実装は `vcfg-builder/lib/*` に配置されています。

## 1. 入力
- **対象言語**: MuASM テキスト。空行・行末コメント（`//` 以降）は無視し、ラベルは次の命令にひも付けます（`Loop:` のみの行も可）。重複ラベルはパース時点でエラーになります。`beqz` のラベル解決は前方参照もサポートします。参照: `muasm-ast/lib/parser.ts`。
- **サポート命令**（8 種類）: `skip`、代入 `x <- e`、`load x, e`、`store x, e`、`beqz x, L`、`bnez x, L`、`jmp e`、`spbarr`、条件付き代入 `x <- e1 ? e2`。構文とトークナイズは `muasm-ast/lib/parser.ts`。
- **ジャンプ解決**: `jmp` 先は整数リテラルまたはラベルでなければエラー。レジスタや式がラベルに解決できない場合は例外を投げます。参照: `muasm-ast/lib/parser.ts`、`vcfg-builder/lib/modes/*`。
- **パラメータ**:  
  - `mode`: `"meta"`（ビルダー直呼び時の後方互換デフォルト）/ `"light"`。UI・CLI などファサードのデフォルトは `light`。meta は従来の前展開、light は spec-begin/end だけを付与する軽量モード（投機長は解析エンジン `specWindow` に委譲）。
  - `windowSize`（投機ウィンドウ長）デフォルト 20。`mode="meta"` のときのみ使用し、0 以下は例外。  
- `speculationMode`: `"discard"`（デフォルト）/ `"stack-guard"`。discard のとき **spec-end ノードと rollback エッジを生成しない**。参照: `vcfg-builder/lib/options.ts`。

## 2. 出力（StaticGraph）
- **スキーマの正本**: `StaticGraph`/`AnalysisResult` の正式スキーマは `doc/project.md` §3 と `lib/analysis-schema/index.ts` をソース・オブ・トゥルースとする。本書は生成ポリシーと実装上の挙動のみを要約する。
- **ノード生成ポリシー**: 各命令に ID `n{pc}` を付与し、フィールドはスキーマに沿って埋める（例: `pc`、`label`、`type`、`sourceLine`）。参照: `vcfg-builder/lib/build-vcfg.ts`、`vcfg-builder/lib/modes/meta.ts`。
- **エッジ生成ポリシー**: `type` は `ns` / `spec` / `rollback` を使用し、重複はセットで排除。分岐の ns エッジは通過条件（例: `x == 0` / `x != 0`）をラベルに付与し、spec エッジも条件ラベルを付与する。discard モードでは rollback エッジを出力しない。参照: `vcfg-builder/lib/graph-builder.ts`。
- **返却単位**: `buildVCFG` はグラフ構造のみを返す。`schemaVersion` 付与とエラーハンドリングは上位ファサード `analyze()`（`lib/analysis-engine/index.ts`）で行う。

## 3. 処理フロー
1. **パース**  
   - ラベル表と命令列を構築し、`beqz` の分岐先 PC を事前解決します。未定義ラベルや無効トークンは `ParseError`（sourceLine 付き）で失敗。参照: `muasm-ast/lib/parser.ts`。

2. **通常パスのグラフ化**  
   - 全命令を通常ノードとして登録。`jmp` は解決先へ 1 本、`beqz` / `bnez` は条件をラベルに持つ 2 本、その他は次行へのフォールスルーを張ります。参照: `vcfg-builder/lib/modes/meta.ts`。

3. **投機パスの展開**  
   - meta モード: NS ノードを共有しつつ、分岐ごとに `spec-begin` / `spec-end` のメタノード（`type:"spec"`）を追加して投機領域をマーキング。予算ゼロまたは `spbarr` で `rollback`。分岐内部でも `beqz` や `jmp` を再帰的に辿り、予算をデクリメントしながら `spec` エッジを追加する。参照: `vcfg-builder/lib/modes/meta.ts`。`speculationMode="discard"` の場合は `spec-end` / `rollback` を生成しない。
   - light モード: 先読み展開せず、各分岐に spec-begin/end を 1 組だけ追加。spec-begin からは taken/untaken 双方へ `spec` エッジを張り、即時 rollback 可能な `spec-end`（+ rollback）を 1 本だけ生成する。投機長の管理は解析エンジンの `specWindow` に委譲。`speculationMode="discard"` では spec-end / rollback を生成しない。参照: `vcfg-builder/lib/modes/light.ts`。

4. **ロールバックの安全側制御**  
   - ロールバック先 PC が存在しない場合（例: プログラム末尾を超える場合）はエッジを張らずに終了し、無効 ID への遷移を防ぎます。`speculationMode="discard"` では rollback 自体を出力しない。参照: `vcfg-builder/lib/modes/meta.ts`。

## 4. エラーと制約
- `mode="meta"` のとき `windowSize <= 0` で例外（予防的ガード）。`vcfg-builder/lib/options.ts`。
- `jmp` の解決不可、ラベル未定義、重複ラベル、無効トークン、式の構文エラーはいずれも `ParseError` 派生の例外で通知。`muasm-ast/lib/parser.ts`、`vcfg-builder/lib/modes/*`。
- meta: NS ノードは共有し、投機区間を示すメタノードのみ `type:"spec"` で追加します。

## 5. 既知の挙動・制限
- `jmp` のターゲットが即値・ラベル以外（実行時値など）の場合は未対応でエラーになります。`vcfg-builder/lib/modes/*`。
- 分岐直後の最初の spec エッジには条件ラベルを付けるが、それ以降の spec エッジと rollback エッジにはラベルを付与しない。rollback は discard モードでは生成されない。
- 出力度はグラフ構造のみに限定され、解析結果（secure/violation 判定や実行トレース）は別サービスで生成します。`lib/analysis-schema/index.ts:10-33`。
