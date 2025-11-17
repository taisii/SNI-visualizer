# AST 共有計画（VCFG ビルダー側）

目的: MuASM の構文解析結果を SNI エンジンでも再利用できるようにする。現状は `instr.text` を文字列で受け渡し、SNI 側が再トークナイズしているため、構文バリエーション（例: `secret <- temp`）で `unsupported instruction` が発生する。

## 変更方針
- `parse()` の戻り値に含まれる命令 AST (`instr`) をグラフに同梱する。
- `StaticGraph` ノードに新フィールド `instructionAst`（型: `Instruction`）を追加して埋める（型は `muasm-ast` 共有モジュールに移動済み）。
- 既存の `instruction` 文字列は UI 表示用に残しつつ、判定エンジンは `instructionAst` を参照する。

## 実装ステップ（VCFG）
1. 型定義拡張  
   - `app/types/analysis-result` の `StaticGraph["nodes"]` に `instructionAst?: Instruction` を追加。  
- AST 型は共有モジュール `muasm-ast` から取得する。
2. ノード生成部の変更  
   - `vcfg-builder/src/vcfg.ts` で `addNode` 呼び出しに `instructionAst: item.instr` を追加。  
   - エッジ生成などの挙動は現状維持。
3. エクスポート整理  
   - `vcfg-builder/src/index.ts` で AST 型 (`Instruction`, `Expr` など) を再エクスポートし、SNI 側が型を依存できるようにする。
4. テスト  
   - 既存のスナップショット／構築テストは `instructionAst` が付与されているかを追加検証。  
   - 互換性: `instructionAst` が無くても動くよう optional とし、段階的に移行。

## 移行計画
- フロントエンドは従来どおり `instruction` を UI 表示に使えるためブレークはしない。  
- SNI エンジンが AST を読み始めたら、文字列ベースのパスを順次削除可能。
