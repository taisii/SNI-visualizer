# VCFG Builder 仕様（現行実装）

非エンジニア向けに、現在動いている VCFG Builder の挙動をまとめています。MuASM ソースコードを入力すると、UI と解析コアがそのまま使える静的グラフ（StaticGraph）を返します。実装は `vcfg-builder/lib/*` に配置されています。

## 1. 入力
- **対象言語**: MuASM テキスト。空行・行末コメント（`//` 以降）は無視し、ラベルは次の命令にひも付けます（`Loop:` のみの行も可）。重複ラベルはパース時点でエラーになります。`beqz` のラベル解決は前方参照もサポートします。参照: `muasm-ast/lib/parser.ts`。
- **サポート命令**（8 種類）: `skip`、代入 `x <- e`、`load x, e`、`store x, e`、`beqz x, L`、`bnez x, L`、`jmp e`、`spbarr`、条件付き代入 `x <- e1 ? e2`。構文とトークナイズは `muasm-ast/lib/parser.ts`。
- **ジャンプ解決**: `jmp` 先は整数リテラルまたはラベルでなければエラー。レジスタや式がラベルに解決できない場合は例外を投げます。参照: `muasm-ast/lib/parser.ts`、`vcfg-builder/lib/modes/*`。
- **パラメータ**:  
  - `mode`: `"light"` のみ。分岐ごとに spec-begin メタノードを 1 つ追加する軽量モード（投機長は解析エンジン `specWindow` に委譲）。
- `speculationMode`: `"discard"` 固定。rollback/spec-end は生成しない。参照: `vcfg-builder/lib/options.ts`。

## 2. 出力（StaticGraph）
- **スキーマの正本**: `StaticGraph`/`AnalysisResult` の正式スキーマは `doc/project.md` §3 と `lib/analysis-schema/index.ts` をソース・オブ・トゥルースとする。本書は生成ポリシーと実装上の挙動のみを要約する。
- **ノード生成ポリシー**: 各命令に ID `n{pc}` を付与し、フィールドはスキーマに沿って埋める（例: `pc`、`label`、`type`、`sourceLine`）。参照: `vcfg-builder/lib/build-vcfg.ts`。
- **エッジ生成ポリシー**: `type` は `ns` / `spec` を使用し、重複はセットで排除。分岐の ns エッジは通過条件（例: `x == 0` / `x != 0`）をラベルに付与し、spec エッジも条件ラベルを付与する。rollback/spec-end は生成しない。参照: `vcfg-builder/lib/modes/light.ts`。
- **返却単位**: `buildVCFG` はグラフ構造のみを返す。`schemaVersion` 付与とエラーハンドリングは上位ファサード `analyze()`（`lib/analysis-engine/index.ts`）で行う。

## 3. 処理フロー
1. **パース**  
   - ラベル表と命令列を構築し、`beqz` の分岐先 PC を事前解決します。未定義ラベルや無効トークンは `ParseError`（sourceLine 付き）で失敗。参照: `muasm-ast/lib/parser.ts`。

2. **通常パスのグラフ化**  
   - 全命令を通常ノードとして登録。`jmp` は解決先へ 1 本、`beqz` / `bnez` は条件をラベルに持つ 2 本、その他は次行へのフォールスルーを張ります。参照: `vcfg-builder/lib/modes/light.ts`。

3. **投機パスのマーキング（light 固定）**  
   - 先読み展開せず、各分岐に spec-begin メタノードを 1 つだけ追加。spec-begin から taken/untaken 双方へ `spec` エッジを張る。rollback/spec-end は生成しない（投機長管理は解析エンジンの `specWindow` に委譲）。参照: `vcfg-builder/lib/modes/light.ts`。

4. **ロールバックの安全側制御**  
   - 現行モードでは rollback エッジを生成しないため、無効 ID への遷移検査は ns/spec エッジのみで行う。

## 4. エラーと制約
- `mode` は light 固定。`speculationMode` が `discard` 以外の場合は例外。`vcfg-builder/lib/options.ts`。
- `jmp` の解決不可、ラベル未定義、重複ラベル、無効トークン、式の構文エラーはいずれも `ParseError` 派生の例外で通知。`muasm-ast/lib/parser.ts`、`vcfg-builder/lib/modes/*`。

## 5. 既知の挙動・制限
- `jmp` のターゲットが即値・ラベル以外（実行時値など）の場合は未対応でエラーになります。`vcfg-builder/lib/modes/*`。
- 分岐直後の最初の spec エッジには条件ラベルを付けるが、それ以降の spec エッジにはラベルを付与しない。
- 出力度はグラフ構造のみに限定され、解析結果（secure/violation 判定や実行トレース）は別サービスで生成します。`lib/analysis-schema/index.ts:10-33`。
