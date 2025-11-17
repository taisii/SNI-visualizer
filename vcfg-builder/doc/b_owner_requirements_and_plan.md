# 担当B 要件定義書 & 実装計画書（MuASM/MuAz 基盤エンジン / VCFG Builder）

## 1. 目的とスコープ
- MuASM（MuAz）ソースをパースし、Always-Mispredict＋ネスト投機を含む VCFG（ノード複製・rollback 込み）を生成して、SNI 解析コアおよび Web UI がそのまま利用できる `StaticGraph` を提供する。参照: `README.md` 11, 31; `doc/project.md` 55, 86。
- スコープ: Lexer/Parser、VCFG 構築（ns/spec/rollback エッジ、投機ウィンドウ）、ラベル解決、出力整形（`StaticGraph` 型適合）、基盤エラー（ParseError）生成。データ/抽象解釈は担当Cの責務外。
- API: `parse(code: string): Program`; `buildVCFG(sourceCode: string, windowSize = 20): StaticGraph` をエクスポート。内部でパースとラベル解決を行い、ノード ID には spec 文脈IDを付与。参照: `doc/project.md` 104; `vcfg-builder/doc/project.md` 174。
- 入出力制約: ノードは投機パスで必ず複製し `type: "spec"` を付与（共有禁止）、エッジ種別は `"ns" | "spec" | "rollback"`、PC は 0 始まり連番を基本とし `pc` を ObsID 安定キーとする。参照: `app/types/analysis-result.ts` 24; `vcfg-builder/doc/project.md` 183; `README.md` 20。
- 投機モデル: 全 `beqz` に対し「とらない/とる」両方のミスパスを生成し、各パスは再帰的に spec を伸張。バジェット枯渇または `spbarr` で rollback を張る。ネスト投機は親の残ウィンドウを継承。参照: `vcfg-builder/doc/project.md` 129, 148, 155。
- 品質/受入条件:
  - 既知の 3 系統回帰ケース（安全/Leak検出/spbarrで安全）を VCFG 単体テストで再現できる構造を出力。参照: `README.md` 74。
  - `AnalysisResult` スキーマ互換 (`schemaVersion: "1.0.0"`) を満たす。参照: `app/types/analysis-result.ts` 1。
  - 10k 行程度の入力でも O(n)～O(n·w) で終わる単一パス生成（w=投機ウィンドウ、デフォルト20）。
- 非スコープ: 抽象解釈、UI 描画、ブラウザ統合、セキュリティポリシー解釈。

## 2. 実装計画
### フェーズ1 設計/骨組み（TDDベース）
- `vcfg-builder/src` にエントリ `index.ts` を新設。型は `app/types/analysis-result.ts` を直接 import し単一出典に揃える。
- AST 定義（Instr 種別 8 つ＋ラベルテーブル）とエラー型（ParseError）を準備。
- 先に型スナップショットテスト（`tsd` もしくは `tsc --noEmit` を CI で回す）を用意する。
- DOD: 型テストがパスし、`app/types/analysis-result.ts` 以外の型出典が無いことを `rg` で確認するスクリプトがグリーン。

### フェーズ2 パーサ実装（TDD）
- トークナイザ → LL(1) 風再帰下降で 8 命令をサポート（文法は `vcfg-builder/doc/project.md` 53 以降）。  
- コメント/空白スキップ、ラベル収集と二段階解決（前方参照対応）。  
- 失敗時に `ParseError` を構築し上位へ。
- 先に以下のテストを red で置く:  
  1) 全 8 命令を含むサンプルで正しい AST を返す。  
  2) 前方参照ラベルを解決する。  
  3) 行末コメントが無視される。  
  4) 無効トークンで `ParseError` が返る。
- DOD: 上記 4 本のテストがグリーン。`bun test parser` が CI で成功。

### フェーズ3 VCFG Builder（TDD）
- ノード配列を PC 順に生成 (`id = n{pc}`、`label = "${pc}: ${text}"`)。
- NS エッジ: `jmp`/`beqz`/fallthrough を網羅（taken/not-taken ラベル付け）。
- Spec 生成: `beqz` ごとに specContextId を払い出し、2 系統ミスパスを `traceSpeculative` で再帰展開。rollback 先を正規パスに張る。  
- 予算と `spbarr` で終了＋ rollback、ネスト `beqz` も同一 `budget-1` で再帰。
- 重複ノード/エッジ防止のセット管理で安定化。
- 先に以下のサンプルでグラフ構造スナップショットを置く（red で開始）：  
  - 線形（spec なし）  
  - if（単分岐）  
  - ループ（fallthrough + back edge）  
  - ネスト投機（入れ子 beqz）  
  - `spbarr` を含むケース（rollback 早期終端）
- DOD: 上記 5 スナップショットテストがグリーン。ノード/エッジ重複検出テストも通過。

### フェーズ4 出力整形/型安全化
- `StaticGraph` へマッピングし、`schemaVersion` は上位ファサードで設定しやすいよう型を公開。  
- WebWorker 運用を想定し、Node API 非依存の純 TS に限定。
- 先に型の E2E スモークテスト（モック入力→`buildVCFG`→`StaticGraph` 型チェック）を red で置く。
- DOD: `tsc --noEmit` が無警告で通過し、`rg '(process|fs|path)' src` がヒットゼロ。E2E スモーク（型整合＆簡易実行）がグリーン。

### フェーズ5 テスト
- 単体: パーサ（各命令/ラベル/エラー）、VCFG（線形・if・ループ・ネスト投機・spbarr）。  
- スナップショット: 既定例のグラフ JSON を期待値と比較。  
- 解析コアとの契約テストは担当Cと合同で後続実施。
- DOD: `bun test` が全てグリーン。カバレッジ報告でパーサ主要分岐と spec 展開分岐が網羅。スナップショットが CI で安定。契約テスト用モック（VCFG 入力→ダミー解析器）がリポジトリに含まれ CI で実行される。

### フェーズ6 運用/パフォーマンス
- `windowSize` デフォルト 20、上限チェックと警告フラグでノード爆発を抑制。  
- 大規模入力でも O(n·w) を維持し、メモリはノード・エッジ数に比例するのみ。
- 先に負荷テストをスキップマーク付きで用意し、実装後に解除して計測。
- DOD: 10k 行・window 20 の合成入力を用いた性能テストが <5s で通過し、警告ログ出力を確認。ノード/エッジ数が O(n·w) 上限内であることをテストが検証。

## 3. リスクと対策
- 投機ノード爆発（長ループ × 大 window）: window 上限と警告。  
- ラベル未解決/無限再帰: パーサ段階の検証＋ spec 展開で budget ガード。  
- 型乖離: `app/types/analysis-result.ts` を唯一の型出典とし、共有パス alias で強制。

## 4. 直近の優先タスク
1. `vcfg-builder/src/index.ts` に AST/型スケルトンと `parse/buildVCFG` シグネチャを設置。  
2. トークナイザ＋ラベル解決パーサを実装し、最小線形プログラムでスモークテスト。  
3. spec/rollback 展開ロジックを疑似コード通り移植し、ネスト投機テストを追加。
