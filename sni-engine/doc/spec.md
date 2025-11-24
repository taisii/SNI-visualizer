# SNI-engine 現行仕様サマリ (実装ベース)

- 作成日: 2025-11-17  
- 最終更新: 2025-11-24（実装と整合）  
- 対象: SNI 解析コア利用者・実装担当  
- 根拠: `sni-engine/lib/*.ts`（実装コード）、旧 `project.md` / `requirements-and-plan.md`

本ドキュメントは、理論論文を読んでいない実装担当者でも読めるように、  
**現時点の実装が実際に行っていること** をコードベースから逆算してまとめた仕様書である。  
背景理論が分からなくても、このファイルと `plan.md` だけ読めば実装と今後の修正方針が理解できる。

## 0. このエンジンが何を判定するか

- 想定する攻撃
  - CPU が「投機実行」により、本来は到達しないはずのパスを一時的に実行する。
  - その途中で **秘密情報 (High)** を含むメモリにアクセスし、そのアドレスなどがキャッシュ等を通じて観測されうる。
- エンジンの役割
  - MuASM 由来の **VCFG (Virtual Control Flow Graph)** を入力として受け取り、
  - 「通常実行 (NS)」と「投機実行 (Spec)」の両方を抽象的に追跡し、
  - **投機実行でしか観測されない High 情報があるか** を静的にチェックする。
- 判定結果
  - `result = "Secure"`: 「投機実行だけが追加で漏らす情報」は検出されなかった。
  - `result = "SNI_Violation"`: 投機実行だけで観測できる High 情報があり、SNI 違反の可能性がある。

## 1. 入出力と VCFG モデル

- 入力: `StaticGraph`
  - ノード: `{ id, pc: number, type: "ns" | "spec", instruction?: string, label?: string }`
  - エッジ: `{ source, target, type: "ns" | "spec" }`（Pruning-VCFG）
- 出力: `AnalysisResult`
  - `graph`: そのまま返却
  - `trace.steps`: Worklist による解析順のスナップショット列
  - `result`: `"Secure"` または `"SNI_Violation"`
  - `error?`: 解析不能時の情報

VCFG 上で、実行モード `Mode` は `"NS"` / `"Speculative"` の 2 種類を持つ:

- エントリノードの `type` が `spec` の場合のみ `Speculative` で開始、それ以外は `NS`。
- エッジ遷移時のモード:
  - `ns` エッジ: モード維持
  - `spec` エッジ: 強制的に `Speculative`

## 2. 抽象状態と格子

### 2.1 抽象状態

内部状態型は `AbsState`:

```ts
type RelValue = { ns: LatticeValue; sp: LatticeValue }; // NS/SP の関係ペア

type AbsState = {
  regs: Map<string, RelValue>;    // R#
  mem: Map<string, RelValue>;     // Γ#
  obsMem: Map<string, LatticeValue>;  // O#  : メモリアクセス観測履歴 (単項化)
  obsCtrl: Map<string, LatticeValue>; // J#  : 制御フロー観測履歴 (単項化)
};
```

- `regs`: レジスタ名 → 関係ペア（NS と Spec を別成分で保持）
- `mem`: 抽象メモリロケーション → 関係ペア
- `obsMem`: メモリアクセス（`load` / `store`）ごとの観測履歴  
  - 観測点キー形式（アドレスのみを観測）:
    - `load dst, addr`:  `"${pc}:${addr}"`
    - `store src, addr`: `"${pc}:${addr}"`
- `obsCtrl`: 制御フロー（`beqz/bnez` / `jmp`）ごとの観測履歴  
  - 観測点キー形式:
    - 条件値: `String(pc)`（例: `"12"`）
    - ジャンプターゲット: `"${pc}:target:${expr}"`（`expr` はターゲット式の文字列表現）

UI に渡す際は、`obsMem` と `obsCtrl` をそれぞれ

- `"Memory Observations"` セクション（id: `"obsMem"`, `obsMem` の内容）
- `"Control Observations"` セクション（id: `"obsCtrl"`, `obsCtrl` の内容）

として別々のセクションに分けて返す。これにより、メモリ由来の観測と分岐条件由来の観測を UI 上で一目で区別できる。

### 2.2 格子 `LatticeValue`

実装上の格子値は `Bot | EqLow | EqHigh | Diverge | Leak | Top`。  
順序・Join は `src/lattice.ts` の `ORDER` および `JOIN_TABLE` に従う:

```text
Bot < EqLow < Diverge < EqHigh < Leak < Top
```

意味づけ（実装が前提にしている直観）は以下の通り:

- `Bot`: 未到達・未初期化（Map に存在しないキーは `Bot` と見なす）
- `EqLow`: NS/Spec とも Low で等価
- `EqHigh`: NS/Spec とも High で等価（「既に許容された漏洩」的な扱い）
- `Diverge`: NS/Spec とも Low だが値が分岐し得る
- `Leak`: NS/Spec 間で High 情報の非対称な観測が生じている可能性（吸収元）
- `Top`: 解析不能・複数状態の混合（安全側に倒す）

### 2.3 初期化ポリシ

`initState(policy?, entryRegs?)` に基づき:

- レジスタ (RelValue):
  - `entryRegs` に含まれるレジスタは `{ns: EqLow, sp: EqLow}`。
  - `policy.regs[k] === "Low"` → `{EqLow, EqLow}`、`"High"` → `{EqHigh, EqHigh}`。
  - それ以外の未設定レジスタは Map 未登録（利用時に `{EqLow, EqLow}` と解釈）。
- メモリ (RelValue):
  - `policy.mem[k] === "Low"` → `{EqLow, EqLow}`、`"High"` → `{EqHigh, EqHigh}`。
  - 未指定ロケーションは `{EqHigh, EqHigh}` を既定値とみなす。

## 2.1 投機モード

- 実装は Pruning-VCFG を前提とし、エッジ種別は `ns` / `spec` のみ。rollback や spec-end は生成しない。
- 投機長は単一カウンタ `specWindow`（デフォルト 20）で管理し、0 未満になる spec エッジは探索しない。NS エッジではカウンタを減算しない。
- `specMode` は `"light"` 固定。分岐ごとに `spec-begin` を 1 つ挿入するだけで、投機長の展開は行わない。
- デバッグ用に `specContext.id` を push/pop したログスタックをトレースに含めるが、実行セマンティクスには影響しない。

## 3. 転送関数 (命令セマンティクス)

命令文は `node.instruction`（なければ `label`）の先頭トークンでオペコードを判定する。  
現行実装が対応しているオペコードは:

- `skip` / 空文字列: 何もしない
- `assign dst src`
- `op dst a b`
- `load dst addr`
- `store src addr`
- `cmov dst cond src`
- `spbarr`
- `beqz` / `bnez` / `jmp`（制御フローのみ、状態は変化させない）

### 3.1 NS / Spec の状態更新

`Mode` に応じて更新規則が変わる:

- NS モード (`Mode = "NS"`)
  - レジスタ・メモリとも **NS 成分と SP 成分の両方** を同じセマンティクスで更新（対称更新）。
- Spec モード (`Mode = "Speculative"`)
  - **SP 成分だけ** を更新し、NS 成分は保持する（非対称更新）。
  - レジスタ・メモリの演算は成分ごとに `join` で行う（例: `relJoin`）。

これにより、レジスタ/メモリでは NS/SP の関係をペアで保持し、Spec 側の変化が NS 側を汚染しない形で表現される。

### 3.2 load/store と観測 `obs` (O#)

`load` / `store` の際、メモリアクセス観測 `obsMem` を次のように更新する:

- 値計算: 成分ごとに `join(L_val, L_addr)` を取り、結果を `regs` / `mem` に格納。
- 観測レベルの決定（**アドレスのみを見る**）:
  - NS 観測: `L_addr.ns` が `EqHigh/Leak/Top` → `observed = EqHigh`、それ以外 = `EqLow`
  - Spec 観測: `L_addr.sp` が `EqHigh/Leak/Top` → `observed = EqHigh`、それ以外 = `EqLow`
- `observed` を NS/Spec 用の更新関数に渡す:

```ts
// NS: Low/High を区別して「ベースライン」を記録
updateMemObsNS(state, obsId, observed) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  const next = observed は EqHigh 系 ? "EqHigh" : "EqLow";
  state.obsMem.set(obsId, join(prev, next));
}

// Spec: High 相当なら Leak、Low 相当なら EqLow を蓄積
updateMemObsSpec(state, obsId, observed) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  if (observed は EqHigh 系) {
    const next = prev === "EqHigh" ? "EqHigh" : "Leak";
    state.obsMem.set(obsId, join(prev, next));
  } else {
    state.obsMem.set(obsId, join(prev, "EqLow"));
  }
}
```

このため:

- NS で High 観測があれば `obsMem` に `EqHigh` ベースラインが残る。
- 同じ観測点で Spec 側が High を観測しても、既に `EqHigh` であれば新規漏洩とはみなさない。
- NS では Low / ⊥ だった観測点で、Spec 側が High を観測した場合に `Leak` が立つ。

### 3.3 beqz/bnez/jmp と CTRLLEAK

`beqz` / `bnez` / `jmp` 命令では、レジスタやメモリの値は変更せず、  
**制御フローに関する観測履歴 `obsCtrl`** のみを更新する。

- `beqz cond, label` / `bnez cond, label`:
  - 条件レジスタ `cond` の格子値を取得し、それを `observed` とみなす（方向情報は現状記録しない）。
- `jmp ...`:
  - **ターゲット式の格子値を観測する**。`obsId = "\<pc>:target:\<expr>"`（`expr` は式を文字列化したもの）。
  - NS 観測では `L_target.ns`、Spec 観測では `L_target.sp` を `observed` として扱う。

更新規則はメモリ観測と同様で、NS/Spec で関数を分けている:

```ts
updateCtrlObsNS(state, obsId, observed) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  const next = observed は EqHigh 系 ? "EqHigh" : "EqLow";
  state.obsCtrl.set(obsId, join(prev, next));
}

updateCtrlObsSpec(state, obsId, observed) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  if (observed は EqHigh 系) {
    const next = prev === "EqHigh" ? "EqHigh" : "Leak";
    state.obsCtrl.set(obsId, join(prev, next));
  } else {
    state.obsCtrl.set(obsId, join(prev, "EqLow"));
  }
}
```

したがって:

- NS の `beqz/bnez` で条件が High であることが「許容漏洩」としてベースラインに乗ることはある。
- 同じ PC で Spec の `beqz/bnez` が High 条件を観測しても、それが既に NS で High なら新規漏洩とはみなさない。
- NS で Low / ⊥ だった条件が Spec 側で High になった場合に、CTRLLEAK (`Leak`) として検出される。

## 4. 不動点計算と違反判定

- 解析はワークリストによる最小不動点計算:
  - 各 (nodeId, mode) ごとに `AbsState` を保持。
  - 各ステップで `applyInstruction` → `mergeState` → 後続ノードを再度 enqueue。
- 打ち切り条件:
  - 反復回数 `iterations > iterationCap` → `AnalysisError`。
  - トレース長 `stepId > maxSteps` → `AnalysisError`。

### 4.1 Violation 判定

- `stateHasViolation(state)` は `state.obsMem` / `state.obsCtrl` のいずれかに `Leak` が含まれるかだけを見る（`Top` は警告・不確定扱いに留める）。
- 解析全体としては、トレース中に 1 度でも `isViolation=true` なステップがあれば `result = "SNI_Violation"`。

## 5. 理論仕様との主な差分

より精密な数式レベルの定義（ハイパープロパティとしての SNI など）は別の研究ノートで扱うが、  
実装担当者はそれを読まなくてもよい。ここでは、その理論と比べた「現行実装」の主な差分だけを列挙する:

- 観測履歴:
  - O# (メモリ観測) と J# (制御フロー観測) の 2 種類を実装しているが、いずれも観測値を High/Low の 2 値レベルにまとめている。
  - 制御観測については「分岐条件レジスタの High/Low」のみを見ており、分岐ターゲットアドレスそのものの関係性までは追跡していない。
- 精度:
  - 実装は「NS ベースライン（EqLow/EqHigh）と Spec 観測の差分」に基づいて Leak を検出するが、  
    理論的にはさらに細かい格子やトレースレベルの区別があり得る（例: 分岐ごとのシンボリックターゲット）。

このように、現行エンジンは「投機実行でのみ追加で観測される High 情報（メモリ/制御）」を検出する範囲で SNI 違反を報告するが、  
より精密なトレース同値性などはカバーしていない。詳しい拡張方針は `plan.md` を参照。

以上を前提として、「今後どこまで理論仕様に寄せていくか」「どう段階的に修正するか」は `plan.md` に記載する。  
実装を変更するときは、まず本ファイル（現行仕様）を確認し、そのうえで `plan.md` のフェーズに沿って差分を導入していく想定である。
