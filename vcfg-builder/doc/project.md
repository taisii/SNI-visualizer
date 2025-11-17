# MuASM 基盤エンジン実装仕様書 (VCFG 構築)

- 作成日: 2025年11月17日  
- 更新日: 2025年11月17日 (Rev 2: ネスト投機対応版)  
- 版数: 1.1  
- 対象: MuASM 基盤エンジン実装担当者 (担当 B)

## 1. 概要

本コンポーネントの役割は、セキュリティ検証用のアセンブリ言語 **MuASM** のソースコードを解析し、  
投機的実行（Speculative Execution）の挙動をモデル化した **仮想制御フローグラフ (VCFG)** を構築して出力することである。

実装者は、入力されたテキストコードをパースし、後述する **Always-Mispredict（常時誤予測）モデル** に従って、

- 通常の実行パス
- 投機的な実行パス（ネストを含む）
- ロールバック動作

をグラフのエッジとして追加する必要がある。

## 2. MuASM 言語仕様

MuASM は、レジスタ、メモリ、およびプログラムカウンタ (`pc`) を持つシンプルなアセンブリ言語である。

### 2.1 基本要素

- **レジスタ (Regs)**  
  変数名として扱われる（例: `r1`, `x`, `size`）。プログラムカウンタ `pc` もレジスタの一種として扱う。
- **値 (Vals)**  
  整数値（例: `0`, `1`, `512`）。
- **式 (Expr)**  
  レジスタ、整数、またはそれらの演算（`+`, `-`, `*`, `&` 等）。  
  例: `x`, `10`, `x + 1`, `base + offset * 8`

### 2.2 命令セット (Instruction Set)

エンジンは以下の 8 種類の命令を認識し、パースする必要がある。各命令はオプションでラベル（行番号や識別子）を持つことができる。

| 命令      | 構文              | 説明           | 動作概要 (標準セマンティクス)                    |
| --------- | ----------------- | -------------- | ------------------------------------------------- |
| `skip`    | `skip`            | 何もしない     | `pc` を進めるのみ。                               |
| 代入      | `x <- e`          | 代入           | 式 `e` を評価し、レジスタ `x` に格納する。       |
| ロード    | `load x, e`       | メモリ読み込み | アドレス `e` から値を読み出し、レジスタ `x` に格納。 |
| ストア    | `store x, e`      | メモリ書き込み | レジスタ `x` の値を、アドレス `e` に書き込む。   |
| 分岐      | `beqz x, l`       | 条件分岐       | レジスタ `x` が 0 ならラベル `l` へ分岐。そうでなければ次の命令へ。 |
| ジャンプ  | `jmp e`           | 無条件ジャンプ | プログラムカウンタを `e`（ラベルまたはアドレス）に変更。 |
| 投機バリア| `spbarr`          | 投機バリア     | 投機的実行を強制終了させる命令（`lfence` 相当）。 |
| 条件付き代入 | `x <- e1 ? e2` | 条件付き代入   | 条件式（または値）`e1` が真（非 0）なら `e2` を `x` に代入 (`cmov` 相当)。制御フロー分岐を発生させない単一命令として扱う。 |

### 2.3 文法定義 (EBNF)

```
Program    ::= Line*
Line       ::= Label? Instr
Label      ::= Identifier ":"
Instr      ::= "skip"
            | Reg "<-" Expr
            | "load" Reg "," Expr
            | "store" Reg "," Expr
            | "beqz" Reg "," LabelRef
            | "jmp" Expr
            | "spbarr"
            | Reg "<-" Expr "?" Expr   // cmov
Expr       ::= Term (("+" | "-" ) Term)*
Term       ::= Factor (("*" | "&") Factor)*
Factor     ::= Reg | Int | "(" Expr ")"
Reg        ::= Identifier
LabelRef   ::= Identifier
Identifier ::= /[A-Za-z_][A-Za-z0-9_]*/
Int        ::= /-?[0-9]+/
Comment    ::= "//" .*                 // 行末コメント（パーサは無視）
Whitespace ::= /[ \t\r\n]+/            // 適宜スキップ
```

## 3. VCFG (仮想制御フローグラフ) 構築仕様

VCFG は、プログラムの命令をノード、実行の遷移をエッジとする有向グラフである。  
本システムでは、通常の制御フローに加え、**「分岐予測ミスによる投機実行」** を明示的なエッジとして表現する。

### 3.1 グラフの構成要素

#### A. ノード (Node)

プログラム内の各命令に対応する。

- `id`: 一意な識別子（例: 命令の行番号やアドレス）
- `instruction` (Optional): パースされた元命令のテキスト。デバッグやツールチップで使う場合にのみ設定する。
- `sourceLine`: ソースコードの行番号
- `specOrigin`: 投機開始元ノード ID。投機ノードを複製した場合に設定する（UI で系譜を提示する際に利用）。
- 本仕様では投機パス上のノードを必ず複製し、`type: "spec"` を付与する（共有ノードは禁止）。UI が投機文脈を確実に強調できるようにするため必須とする。

#### B. エッジ (Edge)

ノード間の遷移を表す。以下の 3 種類（`type`）を区別して実装すること。

- `ns` (Non-Speculative / Normal):  
  通常のプログラム実行順序を表すエッジ（直列実行、正しい分岐、無条件ジャンプなど）。
- `spec` (Speculative):  
  分岐予測ミスによって誤って実行されるパスを表すエッジ。投機実行ウィンドウ `w` の範囲内で生成される。
- `rollback` (Rollback):  
  投機実行が終了（またはウィンドウ上限に到達）し、正しい実行パスに戻る遷移を表すエッジ。

### 3.2 構築アルゴリズム (Always-Mispredict モデル)

グラフ構築エンジンは、ソースコードを解析し、以下のルールに従ってエッジを生成する。  
投機的パスの生成は **再帰的** に行い、投機中の分岐においてもさらなる投機（ネスト）を発生させること。

#### 入力パラメータ

- `Program`: パースされた命令リスト
- `w` (Speculative Window Size): 投機実行の最大ステップ数。デフォルト `w = 20`。投機ネスト時は「親で消費したステップ数」を差し引いた残りの budget を子投機の上限とし、`w_child = min(残り budget, w)` とする。

#### ルール 1: 通常フロー (NS Edges) の構築

全ての命令に対して、標準的な CFG エッジを作成する。

- 非分岐命令:  
  `Current -> Next`
- `jmp target`:  
  `Current -> Target`
- `beqz x, target`:
  - 条件成立時 (Taken): `Current -> Target`
  - 条件不成立時 (Not Taken): `Current -> Next`

#### ルール 2: 投機的フロー (Spec / Rollback Edges) の構築

Always-Mispredict モデルでは、全ての条件分岐命令 (`beqz`) において、予測ミスが発生したと仮定するパスを追加する。

あるノード `Current` が `beqz x, Target`（分岐先 `L_taken`、次の命令 `L_next`）である場合、
以下の 2 つの投機パス生成プロセスを開始する。

##### ケース A: 「分岐しない」と予測してミスするパス

- 前提: 実際は `x == 0`（分岐すべき）だが、予測器が `Next` を選んだ。
- アクション:
  - `Current` から `L_next` へ向かう `spec` エッジを作成。
  - そこから `generateSpeculativePath` を再帰的に呼び出す。
- 正しい合流地点（Rollback 先）: `L_taken`

##### ケース B: 「分岐する」と予測してミスするパス

- 前提: 実際は `x != 0`（分岐すべきでない）だが、予測器が `Target` を選んだ。
- アクション:
  - `Current` から `L_taken` へ向かう `spec` エッジを作成。
  - そこから `generateSpeculativePath` を再帰的に呼び出す。
- 正しい合流地点（Rollback 先）: `L_next`

#### 投機パス生成ロジック (再帰的)

```text
generateSpeculativePath(currentNode, correctReturnNode, remainingWindow)
```

- **終了条件**:
  - `remainingWindow <= 0` または
  - `currentNode` が `spbarr` 命令である場合

  → `currentNode` から `correctReturnNode` へ `rollback` エッジを作成して終了。

- **パスの伸長**:
  - `currentNode` から次の命令 `nextNode` へ `spec` エッジを作成する。
  - `remainingWindow` を 1 減らす。

- **分岐命令 (`beqz`) の扱い (ネストした投機)**:
  - `currentNode` が `beqz` の場合、この投機パス内でもさらに予測ミスが発生する可能性がある。
  - Always-Mispredict の適用: この分岐に対しても、上記「ルール 2」と同様に、分岐予測が外れたと仮定する新たな投機パスを分岐させる（ネストさせる）。
  - ただし、このネストした投機パスの寿命は、親の投機パスの `remainingWindow` に依存する。
  - 同時に、この投機パス内での「予測通りの実行（仮想的な NS パス）」も継続してトレースする。

## 4. データ構造定義 (出力インターフェース)

解析エンジン（担当 C）および Web UI（担当 A）と連携するため、以下の JSON 構造を出力すること。

```ts
// VCFG 出力スキーマ (AnalysisResult.graph の StaticGraph と同形)
// 型の単一出典: `app/types/analysis-result.ts`

interface VCFG {
  nodes: VCFGNode[];
  edges: VCFGEdge[];
}

interface VCFGNode {
  id: string;       // "n0", "n3@spec1" など（コンテキスト込みで一意）
  pc: number;       // 必須: ソース行番号/命令カウンタ。ObsID の安定キー。
  label: string;    // "0: beqz r1, end" (表示用ラベル)
  instruction?: string; // (Optional) 元命令のテキスト。デバッグ/テスト用
  type: "ns" | "spec"; // 投機パスでは必ず "spec" を設定（共有禁止）
  sourceLine?: number;
  specOrigin?: string; // 投機開始元ノード ID（複製時に付与）
}

interface VCFGEdge {
  source: string;   // 始点ノード ID
  target: string;   // 終点ノード ID
  type: "ns" | "spec" | "rollback"; // エッジの種類
  label?: string;   // "mispredict", "taken", "not taken" など
}
```

## 5. 実装例 (疑似コード)

```ts
function buildVCFG(sourceCode: string, windowSize = 20): VCFG {
  const instructions = parseMuASM(sourceCode);

  const nodes: VCFGNode[] = instructions.map((inst, idx) => ({
    id: `n${idx}`,
    pc: idx,
    label: `${idx}: ${inst.text}`,
    instruction: inst,
    type: "ns",
  }));

  const edges: VCFGEdge[] = [];

  // 通常のエッジ構築
  instructions.forEach((inst, idx) => {
    const currentNodeId = `n${idx}`;

    if (inst.op === "jmp") {
      edges.push({
        source: currentNodeId,
        target: `n${resolveLabel(inst.target)}`,
        type: "ns",
      });
    } else if (inst.op === "beqz") {
      // NS: Taken
      edges.push({
        source: currentNodeId,
        target: `n${resolveLabel(inst.target)}`,
        type: "ns",
        label: "taken",
      });

      // NS: Not Taken
      edges.push({
        source: currentNodeId,
        target: `n${idx + 1}`,
        type: "ns",
        label: "not-taken",
      });

      // Speculative Execution (Always Mispredict)
      // Case A: Mispredict as Not Taken -> 正しい戻り先は Taken 先
      traceSpeculative(idx + 1, resolveLabel(inst.target), windowSize, currentNodeId, createSpecNodeId());

      // Case B: Mispredict as Taken -> 正しい戻り先は Next
      traceSpeculative(resolveLabel(inst.target), idx + 1, windowSize, currentNodeId, createSpecNodeId());
    } else if (inst.op !== "ret" && idx < instructions.length - 1) {
      edges.push({
        source: currentNodeId,
        target: `n${idx + 1}`,
        type: "ns",
      });
    }
  });

  // 投機パスの再帰的トレース
  function traceSpeculative(
    currentIndex: number,
    rollbackIndex: number,
    budget: number,
    fromNodeId: string,
    specContextId: string,
  ) {
    const currentInst = instructions[currentIndex];
    const targetNodeId = `n${currentIndex}@${specContextId}`;

    // 投機専用ノードを生成（既にある場合は再利用）
    if (!nodes.find(n => n.id === targetNodeId)) {
      nodes.push({
        id: targetNodeId,
        pc: currentIndex,
        label: `${currentIndex}: ${currentInst.text}`,
        type: "spec",
        sourceLine: currentInst.sourceLine,
        specOrigin: fromNodeId,
      });
    }

    edges.push({
      source: fromNodeId,
      target: targetNodeId,
      type: "spec",
    });

    // budget を消費しきった、または spbarr に到達した場合は「最後に訪れた投機ノード」からロールバックする
    if (budget - 1 <= 0 || currentInst.op === "spbarr") {
      edges.push({
        source: targetNodeId,
        target: `n${rollbackIndex}`,
        type: "rollback",
      });
      return;
    }

    // ネストした投機の処理 (Branch within Speculation)
    if (currentInst.op === "beqz") {
      traceSpeculative(resolveLabel(currentInst.target), rollbackIndex, budget - 1, targetNodeId, specContextId);
      traceSpeculative(currentIndex + 1, rollbackIndex, budget - 1, targetNodeId, specContextId);
    } else if (currentInst.op === "jmp") {
      traceSpeculative(resolveLabel(currentInst.target), rollbackIndex, budget - 1, targetNodeId, specContextId);
    } else {
      traceSpeculative(currentIndex + 1, rollbackIndex, budget - 1, targetNodeId, specContextId);
    }
  }

  let specCounter = 0;
  function createSpecNodeId() {
    return `spec${specCounter++}`;
  }

  return { nodes, edges };
}
```

## 6. まとめ

担当 B は、`beqz` 命令に遭遇した際、常に投機的なパス（予測ミスパス）を生成する必要がある。  
また、その投機パスの中でさらに `beqz` が出現した場合も、投機ウィンドウ（`budget`）が残っている限り、再帰的に投機パスを分岐（ネスト）させる必要がある。

これにより、複雑な制御フローにおける投機的実行の挙動を網羅的にグラフ化することが可能になり、SNI 解析コア（担当 C）はこの VCFG を入力として抽象解釈を行うことができる。
