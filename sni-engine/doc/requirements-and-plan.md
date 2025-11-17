# SNI解析コア 要件定義・実装計画 (担当C)

- 作成日: 2025-11-17  
- 対象: SNI解析コア実装担当 (担当C)  
- 参照: `README.md`, `doc/project.md`, `sni-engine/doc/project.md`, `app/types/analysis-result.ts`

---

## 1. 目的とスコープ
MuASM基盤エンジン（担当B）が生成する VCFG を入力として抽象解釈を行い、投機的非干渉 (SNI) 違反を検知し、Web UI（担当A）がそのまま描画できる `AnalysisResult` を生成する。

---

## 2. 入出力インターフェース
- **入力**: `StaticGraph` (ノード `id, pc, type`, エッジ `type ∈ {ns,spec,rollback}` を必須)  
- **出力**: `AnalysisResult { schemaVersion, graph, trace, result, error? }`
- **トレース**: `ExecutionTrace.steps[{stepId,nodeId,description,executionMode,state,isViolation}]`
- **抽象状態**: sections 最低3種 `regs / mem / obs` を提供し、`obs` に `Leak` があれば `alert: true`

DoD (入出力):
- 受け取った `graph` を検証し、不正構造なら `error.type = "ParseError"` を返す。
- 生成する `AnalysisResult.schemaVersion` は `ANALYSIS_SCHEMA_VERSION` と一致。
- `trace.steps` が空でない（少なくともエントリ1件）。
- UI が期待するキー (`id`, `label`, `style`) を全 DisplayValue に含める。

---

## 3. 機能要件
1. **格子ドメイン**: `Bot < EqLow < EqHigh < Diverge < Leak < Top` の Join を表2に従い実装。  
2. **抽象状態管理**: `(R#, Γ#, O#)` をマップで保持。キーはレジスタ名 / 抽象メモリ名 / `pc`（ObsID）。  
3. **初期化**: ポリシー未指定時は「入力レジスタ=EqLow」「その他=EqHigh」「未到達=Bot」。  
4. **転送関数**: 命令種別 (assign/load/store/beqz/jmp/spbarr/cmov/skip) を解釈し、エッジ種別に応じて状態更新。  
5. **エッジ別挙動**  
   - NS: 対称更新、観測 High は O# を `EqHigh` へ。  
   - Spec: NS 値を保持し Spec 側のみ更新。観測 High/Leak で O#→`Leak`（既に `EqHigh` は維持）。  
   - Rollback: R#/Γ# を投機開始前へ戻し、O# は保持。  
6. **固定点計算**: ワークリスト方式、`iterationCap=10_000` 超過で `AnalysisError`。  
7. **トレース生成**: 固定点後に Replay で `ExecutionTrace` を構築し決定的な順序を保証。  
8. **違反判定**: O# に `Leak`/`Top` を含めば `result="SNI_Violation"`、ステップ内で新規 Leak が出たら `isViolation=true`。  

DoD (機能):
- Join/比較関数のテストが全パス (表の全組合せ) をカバー。
- Spec/NS/Rollback の各エッジを含むV字型最小グラフで期待通りの状態遷移が再現できる。
- `iterationCap` 超過時に必ず `error.type="AnalysisError"` とし、`result` を未設定にしない。
- `Leak` が発生するサンプルで `obs.alert=true` がセットされる。

---

## 4. 非機能・品質要件
- ブラウザ/Node 18+ 上で同期的に完結（外部I/Oなし）。
- 解析順序に依存しない決定的出力（Replay 方式で担保）。
- 1万反復以内で収束しない場合は安全側にフェイルしエラーを返す。
- 最低3ケースの回帰テスト（安全/Leak検出/投機バリア）を維持。

DoD (非機能):
- 全テストが CI (vitest) で headless 実行可。
- 反復上限到達ケースのテストが存在し、期待通りエラーを返す。
- 主要関数に JSDoc コメントを付与し型情報が IntelliSense で解決できる。

---

## 5. 実装モジュール構成
- `src/types.ts` … 内部用型（格子値 Enum、State 構造）、`AnalysisResult` の再エクスポート。
- `src/lattice.ts` … 格子値・Join・比較・DisplayValueマッピング。
- `src/state.ts` … 状態操作ユーティリティ（clone/merge/updateReg/updateMem/updateObs、Leak検出）。
- `src/graph.ts` … VCFG入力の検証と索引構築。
- `src/transfer.ts` … MuASM命令の軽量パースと命令別転送関数。
- `src/fixpoint.ts` … ワークリスト固定点計算、iterationCap管理。
- `src/trace.ts` … Replay による `ExecutionTrace` 生成、`description` 付与、`isViolation` 判定。
- `src/index.ts` … 公開API `analyze(graph, options?)`（将来 `analyzeFromSource` 追加余地）。

DoD (モジュール):
- 各モジュールに対応する単体テストファイルを作成 (`__tests__/lattice.test.ts` 等)。
- `src/index.ts` の公開APIが型定義と一致し、型チェック/テストをパス。

---

## 6. テスト計画
1. Join表網羅テスト  
2. 安全直線コード: Leakなし→`Secure`、alert=false  
3. 投機のみで High 観測が発生: `SNI_Violation`、最初の観測ステップで `isViolation=true`  
4. `spbarr` による投機打ち切り: Leakなしで Secure  
5. ネスト投機を含むグラフ: Rollback 動作と O# 引き継ぎを検証  
6. iterationCap 到達: `AnalysisError` を返す

DoD (テスト):
- 上記6ケースが red/green 明確な期待値を持ち、CI で自動実行。
- 少なくとも1ケースで `Spec`/`ns`/`rollback` エッジの三種が同時に登場。

---

## 7. 実装計画（フェーズ別）
### フェーズ1 土台・型/格子/状態（TDDベース）
- `src/types.ts` で格子値 Enum、内部 State 型、`AnalysisResult` 再エクスポートを定義（型の単一出典は `app/types/analysis-result.ts`）。  
- `src/lattice.ts` に Join/比較/DisplayValue マッピングを実装し、Join表全組合せのスナップショットテストを先置き。  
- `src/state.ts` に State 操作用ユーティリティ（clone/merge/updateReg/updateMem/updateObs、Leak検出）を用意。  
- `tsc --noEmit` を型スモークとして CI に組み込み。  
- DoD: Join表網羅テストと stateユーティリティの基本テストが green、`tsc --noEmit` が無警告、型の出典が `app/types/analysis-result.ts` に限定されていることを `rg` スクリプトで確認できる。  

### フェーズ2 転送関数・観測処理
- `src/transfer.ts` で MuASM 命令テキストの軽量パース（8命令）と観測点抽出を実装。  
- NS/Spec/Rollback で転送挙動を切替え、Spec では NS 値維持＋Specのみ更新、観測 High/Leak で O#→`Leak` ルールを実装。  
- 未知命令・未解釈オペランドは安全側 `Top` にフォールバック。  
- 先に red テストを配置:  
  1) 8命令を含む最小グラフでレジスタ/メモリ/観測が期待通り更新される。  
  2) Spec エッジでのみ値が変わり Diverge/Leak に遷移するケース。  
  3) Rollback で R#/Γ# が戻り O# が保持されるケース。  
- DoD: 上記テストが green、Spec/NS/Rollback 全種を含む遷移テストが通過。  

### フェーズ3 固定点計算＋Replayトレース
- `src/fixpoint.ts` にワークリスト固定点計算を実装し、iterationCap=10_000 を超えた場合に `AnalysisError` を返す。  
- `src/trace.ts` に Replay 方式で `ExecutionTrace` を生成し、`description`/`executionMode`/`isViolation`/`alert` を付与。  
- 代表シナリオを red で用意: 安全直線 / 投機のみLeak / `spbarr` 打ち切り / ネスト投機 / iterationCap 超過。  
- DoD: 5つのシナリオ統合テストが green。特に iterationCap 到達時に `error.type="AnalysisError"` が復帰し、`result` が未設定にならないことを確認。  

### フェーズ4 公開API・安全ガード
- `src/index.ts` に公開関数 `analyze(graph, options?)` を実装（options: policy, iterationCap, maxSteps）。  
- VCFG入力検証 (`src/graph.ts`) で必須フィールド欠落や不正エッジ種別を `ParseError` として早期検出。  
- Node API への依存を避ける（WebWorker対応のため純TS）。`rg '(fs|path|process)' src` がヒットしないようにする。  
- DoD: `tsc --noEmit` / lint / 全テスト green。最小モック呼び出しの E2E スモーク（モックVCFG→analyze→AnalysisResult 型チェック）が green。  

### フェーズ5 テスト整備・契約テスト
- 単体: lattice/state/transfer/fixpoint/trace/graph を分割。  
- スナップショット: 代表グラフ（安全/if/loop/ネスト投機/spbarr）の JSON を期待値と比較。  
- 契約テスト: 担当Bの出力サンプルVCFGをフィクスチャ化し、担当Aに渡せる `AnalysisResult` 形式を生成できることを検証。  
- カバレッジ: 主要分岐（Spec/NS/Rollback、iterationCap分岐、Leak検出）が網羅されることをレポート。  
- DoD: `bun test` が green、スナップショットがCIで安定、契約テストフィクスチャがリポジトリに含まれ自動実行。  

### フェーズ6 パフォーマンス・運用ガード
- `windowSize` デフォルト20、オプション上限を設けノード爆発を防ぐ警告をログ/返却。  
- 時間計測用の軽量計測フックをオプション提供（デフォルトOFF）。  
- 10kノード相当の合成VCFGで O(n·w) の時間・メモリに収まるか負荷テストを実施。  
- DoD: 10k行・window20 の負荷テストが <5s で通過し、ノード/エッジ数が O(n·w) 上限内であることをテストが検証。警告ログ出力を確認。  

---

## 8. オープン事項
1. 命令テキストの正規形（特に load/store/cmov のオペランド表現）を担当Bと確定する。  
2. セキュリティポリシー入力フォーマット（例: `{regs:{r1:"Low"}, mem:{arr:"High"}}`）をどこで受け取るか。  
3. `error.detail` に含める内部情報の粒度（デバッグ vs 最小開示）の合意。  

DoD (オープン事項解消):
- 3項目すべてに決定内容が記録され、`doc/project.md` か本ファイルに反映されている。

---

## 9. 命令テキスト正規形（担当B合意案の取り込み）
`vcfg-builder/doc/project.md` の EBNF (§2.3, 行53-73) を C 側の前提として採用する。抽象解釈の転送関数は以下の表記を正規形として受け付ける。

- 基本形: `Reg "<-" Expr` / `load Reg, Expr` / `store Reg, Expr` / `beqz Reg, Label` / `jmp Expr` / `spbarr` / `Reg "<-" Expr "?" Expr` / `skip`
- オペランド:
  - `Reg` は `/[A-Za-z_][A-Za-z0-9_]*/`
  - 即値は `/ -?[0-9]+ /`（10進）
  - `Expr` は `Term (("+"|"-") Term)*`、`Term` は `Factor (("*"|"&") Factor)*`、`Factor` は `Reg | Int | "(" Expr ")"` を許容
  - カンマは `load/store/beqz` で必須。空白は任意。行末コメント `// ...` はパーサが無視。
- 参考サンプル:
  - `r1 <- r2 + 4`
  - `load r3, r1 + 8`
  - `store r4, arr & 255`
  - `beqz r1, L1`
  - `r1 <- flag ? secret`

この前提に対し、担当Bが表記を変更する場合は EBNF を更新し、本節を同期する（変更時はC側転送関数のテストフィクスチャも更新すること）。

---

## 10. セキュリティポリシー入力の扱い（UI集約）
- ポリシー入力源: Web UI（担当A）がユーザから受け取り、`analyze` 呼び出し時の `options.policy` に渡す。  
- 形式（暫定）:

```ts
type SecurityLevel = "Low" | "High";
type Policy = {
  regs?: Record<string, SecurityLevel>;
  mem?: Record<string, SecurityLevel>;
};

analyze(graph: StaticGraph, options?: { policy?: Policy; iterationCap?: number; maxSteps?: number }): AnalysisResult;
```

- C側の初期化: policy 未指定時は「入力レジスタのみ EqLow、それ以外 EqHigh、未到達 Bot」という既定値を維持。policy があればそれを優先し、未知キーはデフォルトにフォールバックする。
- DoD への反映:
  - `src/index.ts` の公開シグネチャに `policy` を含める。
  - `policy` を適用した初期化の単体テスト（Low/High の両方）を追加し、未指定時の既定値と挙動差分を検証。
  - Web UI から受け取った JSON をそのまま `options.policy` に渡すモック E2E を 1 本追加。
