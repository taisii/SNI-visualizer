# AST 共有計画（SNI エンジン側）

目的: VCFG から受け取る命令を AST ベースで処理し、文字列再パースによる `unsupported instruction` を解消する。

## 受け取り仕様
- `StaticGraph["nodes"]` に `instructionAst?: Instruction` が添付される（VCFG ビルダーが付与）。AST 型は共有モジュール `muasm-ast` に集約。  
- 当面は後方互換のため `instructionAst` が無い場合は従来の文字列パスをフォールバック。

## 実装ステップ（SNI）
1. 型参照  
- AST 型 (`Instruction`, `Expr`, `Identifier`) は共有モジュール `muasm-ast` から import する。  
   - `app/types/analysis-result` の Graph ノード型に `instructionAst?: Instruction` を反映。
2. 命令適用ロジックの切替  
   - `applyInstruction` を AST スイッチに書き換え（`op` に応じて各フィールドを参照）。  
   - 既存の文字列パスは `instructionAst` がない場合のみに限定し、テストでカバー。
3. 観測 ID／制御観測  
   - `beqz` は AST の `cond`・`targetPc` を使用。  
   - `load/store` はアドレス式からレジスタ名を取り出す現状仕様を維持（式サポートが必要か検討）。
4. テスト更新  
   - `sni-engine/tests/analysis.test.ts` を AST 付き Graph で組み立てるケースに置き換え。  
   - 文字列フォールバック用の最小ケースを 1 つ残し後方互換を確認。

## 移行・リスク
- Optional フィールドにより段階的導入可能。  
- AST に切り替えることで構文バリエーション（カンマ有無、`<-`）の差異が吸収される。  
- UI には影響なし（`instruction` は従来通り表示用）。
