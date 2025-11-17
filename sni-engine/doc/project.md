# SNI 解析コアエンジン実装仕様書

- 作成日: 2025年11月17日  
- 版数: 1.0  
- 対象: SNI 解析コアエンジン実装担当者 (担当 C)

## 1. 概要

本コンポーネント（SNI 解析コア）の役割は、MuASM 基盤エンジン（担当 B）から受け取った VCFG（仮想制御フローグラフ）上で **抽象解釈 (Abstract Interpretation)** を実行し、投機的実行に起因する情報漏洩（SNI 違反）を検出することである。

解析結果として、

- 各ステップにおける詳細な抽象状態の遷移（トレース）
- 最終的なセキュリティ判定結果

を生成し、Web アプリケーション（担当 A）へ提供する。

## 2. 理論モデル: SNI 関係抽象ドメイン

本エンジンでは、プログラム変数の具体的な値ではなく、  
「非投機的実行（NS）」と「投機的実行（Spec）」における機密レベルの **関係性** を追跡する。

### 2.1 格子構造 \(L_{SNI}^\#\)

全てのレジスタ、メモリ、および観測履歴の値は、以下の 6 つの要素を持つ格子（Lattice）上の値として表現される。

| 抽象値 | 意味 (NS 状態, Spec 状態) | 説明                                                                 | セキュリティ評価                  |
| ------ | ------------------------- | -------------------------------------------------------------------- | --------------------------------- |
| `Bot` (\(\bot\))   | (\(\bot\), \(\bot\)) | 未到達、または初期状態。                                             | 安全                              |
| `EqLow`           | (Low, Low)           | NS / Spec 共に Low 値であり、かつ等価。                              | 安全                              |
| `EqHigh`          | (High, High)         | NS / Spec 共に High 値であり、かつ等価。既存の漏洩であり、新たな投機的漏洩ではない。 | 安全（許容）                      |
| `Diverge`         | (Low, Low')          | NS / Spec 共に Low 値だが、値が異なる可能性がある（誤予測による分岐など）。 | 安全                              |
| `Leak`            | (Low, High)          | SNI 違反。NS では Low だが Spec では High になっている状態、あるいは Spec パスでのみ High 情報が観測された状態。 | 危険（違反）                      |
| `Top` (\(\top\))  | (?, ?)               | 解析不能、または複数の状態の混合。                                   | 危険（安全側に倒す）             |

半順序（\(\sqsubseteq\)）:

```text
Bot < EqLow < EqHigh < Diverge < Leak < Top
```

> 注: 実装上は、Join 操作での振る舞いを定義すれば十分である。

### 2.2 抽象状態 \(\Sigma^\#\)

プログラムの各時点における抽象状態は、以下の 3 つのマップの組で定義される。

- レジスタマップ \(R^\#\): `Map<Register, LatticeValue>`  
  各レジスタが保持する値の関係性。
- メモリマップ \(\Gamma^\#\): `Map<AbsLoc, LatticeValue>`  
  抽象メモリロケーション（変数名や配列名）ごとの値の関係性。
- 観測履歴マップ \(\mathcal{O}^\#\): `Map<ObsID, LatticeValue>`  
  本手法の核心。プログラム中の「観測点（ロード / ストア命令や分岐命令）」ごとに、そこで「何レベルの情報が観測されたか」の履歴を保持する。  
  キー `ObsID` は、命令の ID（PC）または「命令 ID + オペランド」の組み合わせ。

## 3. 抽象解釈アルゴリズム

VCFG 上の不動点計算（Fixed-point Computation）を行う。  
ワークリストアルゴリズムを用いることが推奨される。

### 3.1 解析フロー

1. **初期化**
   - エントリノードの初期状態 \(\sigma_0\):
     - セキュリティポリシー入力が与えられた場合、その指定に従い変数・メモリを Low / High に初期化する。
     - ポリシー未指定時は、入力レジスタのみ `EqLow`、メモリ・その他変数はすべて `EqHigh` とみなす（安全側デフォルト）。
     - その他到達前の値: `Bot`
   - ワークリストにエントリノードを追加。

2. **反復計算**
   - ワークリストからノード \(n\) を取り出す。
   - \(n\) の現在の入力状態 \(S_{in}\) に対し、命令の種類に応じた **転送関数 (Transfer Function)** を適用し、出力状態 \(S_{out}\) を計算する。
   - \(n\) の各後続ノード \(m\) について:
     - エッジの種類（NS / Spec / Rollback）に応じた遷移処理を行う。
     - \(m\) の既存の入力状態と、新しい状態を Join（結合）する。
     - 状態が変化した場合、\(m\) をワークリストに追加する。

3. **終了判定**
   - ワークリストが空になったら終了。
   - \(\mathcal{O}^\#\) 内に `Leak` または `Top` が含まれていれば「SNI 違反 (INSECURE)」、そうでなければ「安全 (SECURE)」と判定。

### 3.2 転送関数 (Transfer Functions)

命令実行による状態更新のルール。ここでは `src` を読み出し `dst` を更新するケースを示す。

#### 共通ロジック

- 新しい値 \(L_{new}\) の計算:
  - 代入 (`dst <- src`):  
    \(L_{new} = R^\#(src)\)
  - 演算 (`dst <- op src1, src2`):  
    \(L_{new} = R^\#(src1) \sqcup R^\#(src2)\)（Join 演算を使用）

#### ロード (`load dst, src_addr`)

1. アドレスのレベル \(L_{addr} = R^\#(src\_addr)\) を取得。
2. メモリの値 \(L_{val} = \Gamma^\#(AbsLoc(src\_addr))\) を取得。
3. **観測の記録**: 現在の実行モード（NS / Spec）に応じて \(\mathcal{O}^\#\) を更新（後述）。
4. \(L_{new} = L_{val} \sqcup L_{addr}\)  
   （アドレスが High なら、読み出した値も High 汚染されるとみなす）。
5. 状態更新: \(R^\#(dst) \leftarrow L_{new}\)

#### ストア (`store src, addr`)

1. アドレスのレベル \(L_{addr} = R^\#(addr)\)、値のレベル \(L_{val} = R^\#(src)\) を取得。
2. **観測の記録**: 現在の実行モードに応じて \(\mathcal{O}^\#\) を更新（NS: `EqHigh` まで、Spec: `EqHigh/Leak` は `Leak` へ）。  
3. メモリ更新: \(\Gamma^\#(AbsLoc(addr)) \leftarrow L_{val} \sqcup L_{addr}\)。

#### 分岐 (`beqz x, l`)

- 条件の抽象評価は行わず、VCFG が持つエッジ（taken / not-taken / spec / rollback）に従って遷移する。条件式そのものは観測には含めない（制御依存は VCFG で表現済み）。

#### 投機バリア (`spbarr`)

- 投機を強制終了させる命令として扱い、現在の投機コンテキストを閉じる。VCFG 上では rollback エッジへ遷移し、\(\mathcal{O}^\#\) は保持する。

#### 条件付き代入 (`x <- e1 ? e2`)

- 制御フローを分岐させない単一命令として扱う。  
- 抽象値の計算: \(L_{new} = R^\#(e2) \sqcup R^\#(e1)\)（条件で High が混入しても値に伝播させる）。  
- 観測扱いにはしない。

### 3.3 遷移と観測のロジック（重要）

本手法では、「非投機的 (NS) パス」と「投機的 (Spec) パス」で状態更新と観測のルールが異なる。  
これにより、「NS で観測済みの High（許容される漏洩）」と「Spec でのみ観測された High（SNI 違反）」を区別する。

#### A. NS エッジ上の遷移 (\(n \xrightarrow{ns} m\))

- 状態更新: 対称的に更新する（通常通り）。
- 観測更新ルール \(\sqcup_{ns}\):
  - 観測された値（アドレス等）が `EqHigh` の場合 → \(\mathcal{O}^\#\) を `EqHigh` に更新。
  - 意味: 「この High 情報は正規の実行パスで観測されたため、漏洩しても SNI 違反ではない（ベースライン）」。

#### B. Spec エッジ上の遷移 (\(n \xrightarrow{spec} m\))

- 状態更新: 非対称に更新する。  
  Spec 実行によってレジスタ値が変更される場合、NS 側の値は維持し、Spec 側の値のみ更新する。  
  結果として、`EqLow` だったレジスタが `Diverge`（値が変わった）や `Leak`（High になった）に遷移する。
- 観測更新ルール \(\sqcup_{sp}\):
  - 観測された値が `EqHigh` または `Leak` の場合 → \(\mathcal{O}^\#\) を `Leak` に更新。
  - 例外: もし \(\mathcal{O}^\#\) の現在値が既に `EqHigh`（NS で観測済み）であれば、`EqHigh` のまま維持する。
  - 意味: 「正規パスで観測されていないのに、投機パスでのみ High 情報が観測された → 違反」。

#### C. Rollback エッジ上の遷移 (\(n \xrightarrow{rollback} m\))

- 投機的実行の影響を破棄する。
  - \(R^\#, \Gamma^\#\): ロールバック先のノード \(m\) が持つ（投機開始前の）状態に戻す（あるいは Merge する）。
  - \(\mathcal{O}^\#\): 観測履歴は破棄せず、そのまま引き継ぐ。投機中に発生した `Leak` の事実は消してはならない。

## 4. 格子演算の定義 (Join Table)

2 つの抽象値 \(L_1, L_2\) を結合する演算 \(L_1 \sqcup L_2\) の定義表。

| \(\sqcup\) | Bot  | EqLow | EqHigh | Diverge | Leak | Top |
|-----------|------|-------|--------|---------|------|-----|
| **Bot**   | Bot  | EqLow | EqHigh | Diverge | Leak | Top |
| **EqLow** | EqLow| EqLow | Top    | Diverge | Leak | Top |
| **EqHigh**| EqHigh| Top  | EqHigh | Top     | Top  | Top |
| **Diverge**| Diverge| Diverge| Top| Diverge | Top  | Top |
| **Leak**  | Leak | Leak  | Top    | Top     | Leak | Top |
| **Top**   | Top  | Top   | Top    | Top     | Top  | Top |

注記:

- `EqLow ⊔ EqHigh = Top` （関係不明 / 矛盾）。
- `EqLow ⊔ Leak = Leak` （安全側に倒すため `Leak` を維持）。

## 5. 出力データ生成

Web UI の仕様書（`AnalysisResult` スキーマ）に従い、以下のデータを生成する。

### 5.1 `steps` 配列の生成

不動点計算の過程（または計算後のトレース再実行）において、各命令実行直後のスナップショットを記録する。

- `stepId`: 連番
- `nodeId`: 対応する VCFG ノード ID
- `executionMode`: 現在のエッジタイプが `spec` なら `"Speculative"`、それ以外は `"NS"`

### 5.2 `state` の構成

`state: AbstractState` の `sections` として、以下の 3 つのセクションを作成する。

1. `id: "regs"` — `data`: \(R^\#\) の内容
2. `id: "mem"` — `data`: \(\Gamma^\#\) の内容
3. `id: "obs"` — `data`: \(\mathcal{O}^\#\) の内容

- Alert 判定:  
  \(\mathcal{O}^\#\) 内に `Leak` 値を持つエントリがある場合、`"obs"` セクションの `alert` フラグを `true` に設定する。
- `isViolation`:  
  当該ステップ内で新たに `Leak` が発生した場合 `true` とする。

### 5.3 値の変換 (DisplayValue)

内部の格子値（Enum 等）を、UI 用オブジェクト `DisplayValue` に変換する。

例:

- `Bot`   → `{ label: "⊥",     style: "neutral" }`
- `EqLow` → `{ label: "EqLow", style: "safe" }`
- `EqHigh`→ `{ label: "EqHigh", style: "warning" }`
- `Leak`  → `{ label: "Leak",  style: "danger" }`
- ほか同様にマッピングする。

## 6. 実装上の注意点

- **VCFG 入力**:  
  担当 B の出力する JSON（VCFG）を受け取るパーサーを実装すること。
- **投機深度**:  
  本エンジンは VCFG の構造に従うだけなので、投機ウィンドウサイズや投機パスの生成ロジック（Always-Mispredict）は担当 B の責務である。  
  解析コアは、与えられたグラフ上を素直に探索すればよい。
- **反復上限 (iterationCap)**:  
  無限ループ防止のため、反復回数の上限（デフォルト 10,000）を設け、到達した場合は `AnalysisResult.error` に `type: "AnalysisError"` を設定する。
- **トレース生成方針**:  
  不動点計算完了後に VCFG を再実行して `ExecutionTrace` を生成する「Replay」方式とする。これにより計算順序非依存の安定した UI 表示を担保する。
- **識別子の正規化**:  
  `ObsID` は命令の行番号（PC）をキーとし、`AbsLoc` は変数名（文字列）で正規化する。オペランド粒度に拡張する場合はスキーマの minor バージョンを更新して周知する。PC は MuASM 基盤（担当 B）が VCFG ノードに必須フィールド `pc` として埋め込むことを前提とする。
