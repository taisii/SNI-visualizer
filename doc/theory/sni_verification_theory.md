# 投機的非干渉（SNI）検証のための関係的抽象解釈：仮想制御フロー（VCFG）上での観測履歴セマンティクスの形式化と考察

## 第I章：分析基盤としての仮想制御フロー（VCFG）の構築

投機的実行を伴うプログラムのセキュリティ特性、特に投機的非干渉（Speculative Non-Interference, SNI）を静的解析の枠組みで健全に（Soundly）検証するには、まず解析の対象となるプログラムのグラフ表現を適切に定義する必要があります。従来の静的解析で用いられる標準的な制御フローグラフ（Control Flow Graph, CFG）は、プログラムの非投機的（逐次的）な実行パスのみを表現するため、投機的実行によってのみ到達可能な「不正な」パスをモデル化できません。

### 1.1. 基礎構造：CFGからVCFGへ

標準的なCFGを $G = (N, E)$ と定義します。ここで、$N$ は基本ブロックまたは個別の命令に対応するノードの集合であり、$E$ はそれらの間の制御フローを示すエッジの集合です。

SNI検証の課題は、beqz（Branch if Equal to Zero）のような条件分岐命令において、プロセッサが分岐条件の評価完了を待たずに（あるいは誤って予測し）、CFGの $E$ には存在しないパスを投機的に実行しうる点にあります。この投機的実行と、その後の（誤予測だった場合の）ロールバックを静的にモデル化するため、「仮想制御フロー（Virtual Control Flow）」の概念に基づき、CFGを拡張した**仮想制御フローグラフ（Virtual Control Flow Graph, VCFG）**を分析基盤として導入します。

### 1.2. 仮想ノードとエッジ：投機的パスとロールバックの明示的モデリング

VCFGは、投機的実行セマンティクスをグラフ構造に明示的にエンコードしたものです。VCFG $G_{VCFG}$ は、タプル $(N \cup N_{virt}, E_{ns} \cup E_{sp})$ として定義されます。

* **ノード ($N \cup N_{virt}$):**
    * $N$: 従来のCFGノード（命令または基本ブロック）の集合。
    * $N_{virt}$: 投機的実行の開始（vn_start）や終了およびロールバック（vn_stop）といった、実行のセマンティクスを制御するための仮想ノードの集合。
* **エッジ ($E_{ns} \cup E_{sp}$):**
    * $E_{ns}$ (Non-Speculative Edges): 「非投機的エッジ」の集合。これは従来のCFGエッジ $E$ に相当し、プロセッサによってコミットされる正規の実行パスを表します。
    * $E_{sp}$ (Speculative Edges): 「投機的エッジ」の集合。これは $E$ には存在しない、投機的にのみ実行されうる仮想的な制御フローを表します。

この $E_{ns}$ と $E_{sp}$ へのグラフ構造の明示的な分離が、本提案手法の核心です。なぜなら、第III章で詳述する通り、SNIの「ベースライン（NS）からの逸脱（SP）」という関係的性質を捉えるために、NSエッジとSPエッジで異なる抽象変換関数（$F_{ns}$ と $F_{spec}$）を適用する必要があるからです。グラフ構造がセマンティクスを分離していなければ、異なる関数を適用することは原理的に不可能です。

### 1.3. 「問題のケース」におけるVCFGの具体化

「問題のケース」（機密情報がNS実行によってレジスタにロードされ、SP実行によって観測されるループ構造）をVCFGでモデル化します。
このケースのループ終端には `beqz y, Loop_End` という分岐命令が存在します。

* **NSパス ($E_{ns}$):** 非投機的実行では、y の値（EqLow、すなわち0と仮定）に基づき、分岐は成立します。したがって、beqz ノード $n$ から Loop_End ノード $n_{end}$ へ向かう 1本の $E_{ns}$ エッジ  $(n, n_{end}) \in E_{ns}$ が生成されます。
* **SPパス ($E_{sp}$):** プロセッサがこの分岐を誤予測し、投機的にループを続行すると仮定します。この（非正規の）実行パスをモデル化するため、beqz ノード $n$ からループの先頭ノード $m$ へ戻る 1本の $E_{sp}$ エッジ  $(n, m) \in E_{sp}$ が生成されます。

提案手法における静的解析は、この $G_{VCFG}$ 上のノード $N$ に関する抽象状態 $\Sigma^\#$ を求める不動点計算として実行されます。

## 第II章：SNI検証のための抽象ドメインの定義

SNI検証の最大の障壁は、その形式的な性質にあります。SNIは「単一の実行」に関する性質（Safety Property）ではなく、「複数の実行トレース間の関係性」を問う ハイパープロパティ（Hyperproperty） 、より厳密には「2-ハイパープロパティ」であるためです。

### 2.1. 課題：単項解析の限界と関係的ハイパープロパティ

従来のテイント解析のような「単項的（Unary）解析」はSNI検証において理論的な限界を持ちます。単項解析は「現在、レジスタ $a$ が汚染されている（Tainted）」という単一の状態しか保持できません。しかしSNI違反の判定には、「$a$ が なぜ （NSかSPか）、 いつ 汚染されたのか」という 履歴 と、NS実行（ベースライン）とSP実行（逸脱）の 関係性 が必要です。

したがって、SNIを健全に検証する抽象ドメインは、単一の状態を抽象化するのではなく、2つのセマンティクス（NSとSP）における状態の 関係性 をモデル化する**関係的抽象ドメイン（Relational Abstract Domain）**でなければなりません。

### 2.2. 関係的「値」ドメイン ( $L_{SNI}^\#$ )： $\langle v_{ns}, v_{sp} \rangle$ の抽象化

プログラムの「値」（レジスタやメモリアドレス）の状態を関係的に抽象化するため、関係抽象ドメイン $L_{SNI}^\#$ を導入します。これは、ある変数 $v$ の非投機的な値 $v_{ns}$ と投機的な値 $v_{sp}$ のペア $\langle v_{ns}, v_{sp} \rangle$ の機密レベル（Low/High）の関係性を抽象化するものです。
このドメインの核心は、SNI違反を安全な差分（Diverge）と危険な差分（Leak）として明示的に区別する点にあります。Leak（$\approx \langle \text{Low}, \text{High} \rangle$）を検出することが、SNI違反の検出に他なりません。

**表1：関係抽象ドメイン $L_{SNI}^\#$ のセマンティクス**

| 抽象値 (Abstract Value) | NS状態 ($v_{ns}$) | SP状態 ($v_{sp}$) | 意味（状態として） (Meaning as a State) | 意味（観測履歴として） (Meaning as an Observation History) |
| :--- | :--- | :--- | :--- | :--- |
| $\bot$ | $\bot$ | $\bot$ | 到達不能 (Unreachable) | 一度も観測されていない (Never observed) |
| EqLow | Low | Low | NS/SP共にLow（等価） | NSパスで観測済み（Lowアドレス） |
| EqHigh | High | High | NS/SP共にHigh（等価） | NSパスで観測済み（Highアドレス） |
| Diverge | Low | Low (diff) | NS/SP共にLow（異なる可能性） | SPパスでのみ観測（Lowアドレス） |
| Leak | Low | High | SNI違反の状態 | SNI違反の観測（SPパスでのみ観測、かつHighアドレス） |
| $\top$ | ? | ? | 不明（違反の可能性） | 不明（違反の可能性） |

### 2.3. 抽象「履歴」ドメイン：観測履歴マップ ( $\mathcal{O}^\#$ と $\mathcal{J}^\#$ )

SNI検証の判定をレジスタやメモリの「最終状態」（$R^\#$, $\Gamma^\#$）ではなく、「観測の履歴」（$\mathcal{O}^\#$）に基づいて行うという点が重要な洞察です。SNIはトレースに関する性質であるため、このアプローチは形式的定義に忠実です。

ここで、SPECTECTOR の定義とユーザーの洞察に基づき、この履歴ドメインを拡張します。SPECTECTOR のアルゴリズムは、2種類の漏洩を個別に検証します。

* **MEMLEAK:** load/store 命令による「メモリアドレス」の観測漏洩。
* **CTRLLEAK:** jmp/beqz 命令による「制御フロー」（分岐ターゲットや条件）の観測漏洩。

2 で提案された $\mathcal{O}^\#$ は、メモリアドレスの観測履歴であり MEMLEAK の検証に対応します。しかし、CTRLLEAK を検証するには、ユーザーの指摘通り、別の履歴が必要です。
したがって、我々の完全な抽象ドメインは、2種類の履歴マップを含まなければなりません。

1.  **メモリ観測履歴 ($\mathcal{O}^\#$):** MEMLEAK 検証用。
    * $\mathcal{O}^\# : K_{obs} \to L_{SNI}^\#$
    * $K_{obs}$ はメモリ観測キー（例：load/store 命令のプログラムカウンタ（PC））。
    * 値は $L_{SNI}^\#$ の格子（表1）であり、その観測点での「メモリアドレス」の抽象化された関係履歴を示します。
2.  **制御フロー観測履歴 ($\mathcal{J}^\#$):** CTRLLEAK 検証用。（本レポートによる形式的拡張）。
    * $\mathcal{J}^\# : K_{ctrl} \to L_{SNI}^\#$
    * $K_{ctrl}$ は制御フロー観測キー（例：beqz/jmp 命令のPC）。
    * 値は $L_{SNI}^\#$ の格子であり、その観測点での「ジャンプターゲットアドレス」または「分岐条件の値」の抽象化された関係履歴を示します。

## 第III章：VCFG上の抽象解釈と検出アルゴリズムの形式化

本章では、第I章のグラフ（$G_{VCFG}$）と第II章のドメイン（$L_{SNI}^\#$, $\mathcal{O}^\#$, $\mathcal{J}^\#$）を用い、提案手法の検出アルゴリズム全体を、「Monotone Framework」に基づく不動点計算アルゴリズムとして厳密に形式化します。

### 3.1. 抽象状態空間 ( $\Sigma^\#$ ) の定義

VCFG $G_{VCFG} = (N, E_{ns} \cup E_{sp})$ 上のデータフロー解析を定義します。各ノード $n \in N$ における局所抽象状態 $s_n^\#$ は、値の状態と履歴の状態の直積（Product Domain）として定義されます。

$$s_n^\# = (R_n^\#, \Gamma_n^\#, \mathcal{O}_n^\#, \mathcal{J}_n^\#) \in \Sigma_{Local}^\#$$

ここで、各コンポーネントは以下の写像です。
* $R_n^\#$ (レジスタ状態): $Reg \to L_{SNI}^\#$
* $\Gamma_n^\#$ (メモリ状態): $AbsLoc \to L_{SNI}^\#$
* $\mathcal{O}_n^\#$ (メモリ観測履歴): $K_{obs} \to L_{SNI}^\#$
* $\mathcal{J}_n^\#$ (制御フロー観測履歴): $K_{ctrl} \to L_{SNI}^\#$

「履歴を失う」という単項解析の欠点を克服するため、履歴マップ（$\mathcal{O}^\#$, $\mathcal{J}^\#$）自体を抽象状態の一部として定義し、ノード間で伝播させます。これにより、解析は状態ベースでありながら、トレース（履歴）の性質を保持することが可能になります。
グローバル抽象状態 $\Sigma^\#$ は、全ノードからその局所状態への写像 $\Sigma^\# : N \to \Sigma_{Local}^\#$ であり、各コンポーネントの点ごとの順序（pointwise order）により、完全束（complete lattice）をなします。

### 3.2. 抽象変換関数 (Abstract Transfer Functions)

VCFG上のデータフローを定義するグローバル変換関数 $F^\# : \Sigma^\# \to \Sigma^\#$ を、各ノード $n$ での局所的な計算 $F_n^\#$ として定義します。ノード $n$ の新しい状態は、VCFG上でそのノードに流入する全ての先行ノード $p$ の状態を join したものとして計算されます。

$$F_n^\#(\Sigma^\#) = \bigsqcup_{p \in pred_{ns}(n)} F_{ns}(\Sigma^\#(p), p \to n) \quad \sqcup \quad \bigsqcup_{p \in pred_{sp}(n)} F_{spec}(\Sigma^\#(p), p \to n)$$

ここで $\sqcup$ は $\Sigma_{Local}^\#$ 上の join 演算子（各コンポーネントの $L_{SNI}^\#$ 上の $\sqcup$）です。$pred_{ns}(n)$ は $n$ への $E_{ns}$ エッジを持つ先行ノード集合、$pred_{sp}(n)$ は $E_{sp}$ エッジを持つ先行ノード集合です。

### 3.3. 変換関数のセマンティクス (NS vs SP)

SNI（NSからのSPの逸脱）をモデル化するため、エッジの種類に応じて異なる変換関数を適用します。

#### 3.3.1. 対称的変換 ( $F_{ns}$ )

$E_{ns}$ エッジ上の変換 $F_{ns}$ は、命令のセマンティクスを対称的に適用します。これは、NSパス（コミットされるパス）では、NS状態とSP状態の両方が同じように更新されるべき、という直観に対応します。

**例：load a, c (cがHigh) の実行。**
* 入力状態: $R^\#(a) = \text{EqLow}$ （$\approx \langle L, L \rangle$）
* 適用: $L_{val} = \text{EqHigh}$ （$\approx \langle H, H \rangle$）
* 出力状態: $R_{new}^\#(a) = R_{old}^\#(a) \sqcup L_{val} = \text{EqLow} \sqcup \text{EqHigh} = \textbf{EqHigh}$ （$\approx \langle H, H \rangle$）

#### 3.3.2. 非対称的変換 ( $F_{spec}$ )

$E_{sp}$ エッジ上の変換 $F_{spec}$ は、命令のセマンティクスを非対称的に、すなわちSP側にのみ適用します。NS側はベースラインとして維持されます。

**例：load a, c (cがHigh) の実行。**
* 入力状態: $R^\#(a) = \text{EqLow}$ （$\approx \langle L, L \rangle$）
* 適用: $L_{val} = \text{EqHigh}$ （$\approx \langle H, H \rangle$）
* 出力状態: $R_{new}^\#(a)$ は $\langle v_{ns}, v_{sp} \rangle$ として、$\langle L, L \sqcup H \rangle = \langle L, H \rangle$ となります。
* 抽象ドメイン $L_{SNI}^\#$（表1）において、$\langle L, H \rangle$ は Leak にマッピングされます。

この非対称性が、SNIの「ベースライン（NS）を超える追加の漏洩」という関係的定義を、抽象解釈の枠組みで形式的に捉える鍵となります。

### 3.4. 観測履歴の更新： $\sqcup_{obs}$ 演算子

$F_{ns}$ および $F_{spec}$ の実行時、命令が観測可能（load, store, beqz, jmp）な場合、対応する履歴マップ（$\mathcal{O}^\#$ または $\mathcal{J}^\#$）も更新されなければなりません。この更新は、SNI検証に特化した join 演算子を用いて行われます。

* $\sqcup_{ns}$ (ベースライン設定): $F_{ns}$ 実行時に使用され、観測された内容を「許可された漏洩のベースライン」として履歴に記録します。
* $\sqcup_{sp}$ (違反検出): $F_{spec}$ 実行時に使用され、現在の観測がベースライン（$\mathcal{H}^\#(k)$）から逸脱していないかを検査します。

以下に、$\mathcal{O}^\#$ と $\mathcal{J}^\#$ の両方に適用可能な、観測履歴マップ $\mathcal{H}^\# \in \{\mathcal{O}^\#, \mathcal{J}^\#\}$ の統一的な更新セマンティクスを示します。

**表2：観測履歴マップ ($\mathcal{H}^\#$) の更新セマンティクス**

| 演算 (Operation) | 観測キー k | 現在の履歴値 H#(k) | 新たな観測値 vobs# | 更新後の履歴値 Hnew#(k) | セマンティクス (Semantics) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NS観測 ($\sqcup_{ns}$)** | $\forall k$ | $\bot$ | EqHigh | EqHigh | NSでHighを観測 (ベースライン設定) |
| ($F_{ns}$ 実行時) | $\forall k$ | EqLow | EqHigh | EqHigh | NSで観測値がLからHに変化 (ベースライン更新) |
| **SP観測 ($\sqcup_{sp}$)** | $\forall k$ | $\bot$ | EqHigh | Leak | **SNI違反** : NSで未観測のものがSPでHigh |
| ($F_{spec}$ 実行時) | $\forall k$ | EqLow | EqHigh | Leak | **SNI違反** : NSでLowのものがSPでHigh |
| ($F_{spec}$ 実行時) | $\forall k$ | EqHigh | EqHigh | EqHigh | 安全: 既にNSで漏洩済み (追加漏洩なし) |
| ($F_{spec}$ 実行時) | $\forall k$ | EqLow | EqLow | EqLow | 安全: NS/SP共にLow (追加漏洩なし) |

### 3.5. 検出アルゴリズムの全体像：不動点計算

提案手法の検出アルゴリズムは、VCFG $G_{VCFG}$ 上でのグローバル変換関数 $F^\#$ に関する**最小不動点（Least Fixed Point, LFP）**を求めるプロセスとして数学的に定義されます。

**アルゴリズム 1: SNI検証のための不動点アルゴリズム**

1.  **初期化:**
    * $W \leftarrow \{n_{start}\}$ (Worklist に開始ノードを追加)
    * $\forall n \in N, \Sigma^\#(n) \leftarrow \bot_{\Sigma_{Local}^\#}$ (全ノードの状態を $\bot$ で初期化)
    * $\Sigma^\#(n_{start}) \leftarrow s_{initial}^\#$ (開始ノードの初期状態を設定)
2.  **反復計算 (Worklist アルゴリズム):**
    * while $W \neq \emptyset$ do
        * $n \leftarrow W.pop()$
        * $\forall s \in succ_{ns}(n)$ (NSエッジの伝播) do
            * $state_{old} \leftarrow \Sigma^\#(s)$
            * $state_{new} \leftarrow state_{old} \sqcup F_{ns}(\Sigma^\#(n), n \to s)$
            * if $state_{new} \neq state_{old}$ then
                * $\Sigma^\#(s) \leftarrow state_{new}$
                * $W.push(s)$
            * end if
        * $\forall s \in succ_{sp}(n)$ (SPエッジの伝播) do
            * $state_{old} \leftarrow \Sigma^\#(s)$
            * $state_{new} \leftarrow state_{old} \sqcup F_{spec}(\Sigma^\#(n), n \to s)$
            * if $state_{new} \neq state_{old}$ then
                * $\Sigma^\#(s) \leftarrow state_{new}$
                * $W.push(s)$
            * end if
    * end while
3.  **違反判定:**
    * $\Sigma_{LFP}^\# \leftarrow \Sigma^\#$ (収束した不動点)
    * if $\exists n \in N, \exists k \in K_{obs}$ s.t. $(\Sigma_{LFP}^\#(n).\mathcal{O}^\#)(k) = \text{Leak}$
    * or $\exists n \in N, \exists k' \in K_{ctrl}$ s.t. $(\Sigma_{LFP}^\#(n).\mathcal{J}^\#)(k') = \text{Leak}$
    * then return **SNI Violation**
    * else return **SNI Secure**
    * end if

## 第IV章：中核的洞察の検証：MEMLEAKとCTRLLEAKの履歴分離

本章では、ユーザーの「CTRLLEAKには別の履歴が必要ではないか」という重要な洞察について深掘りし、それが第III章で形式化したアルゴリズムにおいてなぜ形式的に正しいのかを論証します。

### 4.1. MEMLEAKの検証：メモリ観測履歴 ( $\mathcal{O}^\#$ ) の役割

SPECTECTOR における MEMLEAK プロシージャは、load または store 命令によって観測される「メモリアドレス」のトレースを検証します。具体的には、2つの実行の非投機的トレースが等しいにも関わらず（$obsEqv(\tau|_{nse})$）、投機的トレースが異なる（$\neg obsEqv(\tau|_{se})$）場合を検出します。
$\mathcal{O}^\#$ マップは、まさにこの「メモリアドレス」の観測履歴を関係的に抽象化するために設計されています。

* **観測キー ($K_{obs}$):** load/store 命令のPCに対応します。
* **観測値 ($v_{obs}^\#$):** アクセスされる「アドレス」の抽象関係状態（$L_{SNI}^\#$）です。

したがって、$\mathcal{O}^\#$ は MEMLEAK を検証するために特化された履歴であり、表2で定義された更新ルール（特に $\text{EqLow} \sqcup_{sp} \text{EqHigh} = \text{Leak}$）は、SPECTECTOR の MEMLEAK プロシージャの抽象解釈による健全な（sound）実装となっています。

### 4.2. CTRLLEAKの検証：制御フロー観測履歴 ( $\mathcal{J}^\#$ ) の必要性

ユーザーの洞察は、CTRLLEAK に関して決定的に重要です。SPECTECTOR の CTRLLEAK プロシージャは、symPc(se)、すなわち「分岐条件やジャンプターゲット」の観測トレースの差分を検証します。これは、メモリアクセスとは完全に異なる観測チャネルです。
$\mathcal{O}^\#$ マップはメモリアドレスの履歴のみを保持するため、CTRLLEAK 違反（例：NSでは常にターゲットAにジャンプするが、SPでは秘密情報に依存してターゲットBにジャンプする）を検出することはできません。

したがって、提案手法を SPECTECTOR の定義と等価な完全性を持つように拡張するためには、CTRLLEAK を検証するための専用の履歴マップ $\mathcal{J}^\#$ が 必須 となります。これはユーザーの洞察を形式的に裏付けるものです。
$\mathcal{J}^\#$ のセマンティクスは以下のように定義されます。

* **観測キー ($K_{ctrl}$):** beqz/jmp 命令のPCに対応します。
* **観測値 ($v_{obs}^\#$):** 「分岐ターゲットのアドレス」または「分岐条件に使われるレジスタ値」の抽象関係状態（$L_{SNI}^\#$）です。

JMP や BEQZ 命令を処理する抽象変換関数 $F_{ns}$ / $F_{spec}$ は、$\mathcal{O}^\#$ の代わりに $\mathcal{J}^\#$ を、表2の更新ルール（$\sqcup_{ns}, \sqcup_{sp}$）に従って更新します。
この $\mathcal{O}^\#$（メモリ履歴）と $\mathcal{J}^\#$（制御履歴）の分離、およびそれぞれに対する第III章の不動点アルゴリズムの適用こそが、ユーザーの洞察を組み込んだ「検出アルゴリズム」の完全な姿です。

## 第V章：具体的トレースによる検証：「問題のケース」のステップバイステップ分析

本章では、第III章で形式化したアルゴリズム 1 が、「問題のケース」をいかにして正しく Leak と判定するか、具体的な実行トレースを示します。

### 5.1. 前提と初期状態

* **VCFG:** beqz y, Loop_End ノード $n$ から、Loop_End への $E_{ns}$ エッジと、Loop の先頭 $m$ への $E_{sp}$ エッジが存在します。
* **初期状態 $\Sigma^\#(n_{start}) = (R_0^\#, \Gamma_0^\#, \mathcal{O}_0^\#, \mathcal{J}_0^\#)$:**
    * $R_0^\#(a) = \text{EqLow}$, $R_0^\#(c) = \text{EqLow}$, $R_0^\#(y) = \text{EqLow}$
    * $\Gamma_0^\#(\text{AbsLoc(c)}) = \text{EqHigh}$ (cが指す 値 はHigh)
    * $\mathcal{O}_0^\#(\text{obs\_load\_z\_a}) = \bot$, $\mathcal{O}_0^\#(\text{obs\_load\_a\_c}) = \bot$

### 5.2. 1周目 (NS実行)： $E_{ns}$ エッジの走査

アルゴリズム 1 の Worklist に $n_{start}$ が投入され、NSパス（$E_{ns}$）の走査が開始されます。

1.  **load z, a (NS実行):**
    * 適用関数: $F_{ns}$（対称的）, $\sqcup_{ns}$
    * 観測アドレス: $L_{addr} = R^\#(a) = \text{EqLow}$
    * 履歴更新: $\mathcal{O}^\#(\text{obs\_load\_z\_a}) \leftarrow \bot \sqcup_{ns} \text{EqLow} = \textbf{EqLow}$ (表2 ルール：ベースライン設定)
    * 状態更新: $R^\#(z) \leftarrow \text{EqLow}$
2.  **load a, c (NS実行):**
    * 適用関数: $F_{ns}$（対称的）, $\sqcup_{ns}$
    * 観測アドレス: $L_{addr} = R^\#(c) = \text{EqLow}$
    * 観測値: $L_{val} = \Gamma^\#(\text{AbsLoc(c)}) = \text{EqHigh}$
    * 状態更新: $R_{new}^\#(a) \leftarrow R_{old}^\#(a) \sqcup L_{val} = \text{EqLow} \sqcup \text{EqHigh} = \textbf{EqHigh}$ ($F_{ns}$ は対称的)
    * 履歴更新: $\mathcal{O}^\#(\text{obs\_load\_a\_c}) \leftarrow \bot \sqcup_{ns} \text{EqLow} = \textbf{EqLow}$
3.  **beqz y, Loop_End (NS実行):**
    * $y$ の値が EqLow (0) であるため、$E_{ns}$ パスは Loop_End へ進み、このパスは終了します。Loop_End ノードが Worklist に追加されます。

### 5.3. 2周目 (SP実行)： $E_{sp}$ エッジの走査

Worklist は beqz ノード $n$ から $E_{sp}$ エッジ（Loop の先頭 $m$ へ向かう）も処理します。このパスには、1周目のNS実行の結果（$R^\#(a) = \text{EqHigh}$, $\mathcal{O}^\#(\text{obs\_load\_z\_a}) = \text{EqLow}$）が入力状態として伝播します。

1.  **load z, a (SP実行):**
    * 適用関数: $F_{spec}$（非対称的）, $\sqcup_{sp}$
    * 観測アドレス: $L_{addr} = R^\#(a) = \textbf{EqHigh}$。この EqHigh は、1周目のNS実行によって設定された状態です。
    * 履歴更新 (核心部): $\mathcal{O}^\#$ マップを $\sqcup_{sp}$ で更新します。
    * $\mathcal{O}_{new}^\#(\text{obs\_load\_z\_a}) \leftarrow \mathcal{O}_{old}^\#(\text{obs\_load\_z\_a}) \sqcup_{sp} L_{addr}$
    * $\mathcal{O}_{new}^\#(\text{obs\_load\_z\_a}) \leftarrow \textbf{EqLow} \sqcup_{sp} \textbf{EqHigh} = \textbf{Leak}$
    * この更新は、表2の「SNI違反：NSでLowのものがSPでHigh」のルールに合致し、Leak が生成されます。
2.  **load a, c (SP実行):**
    * 適用関数: $F_{spec}$（非対称的）, $\sqcup_{sp}$
    * 観測アドレス: $L_{addr} = R^\#(c) = \text{EqLow}$
    * 履歴更新: $\mathcal{O}_{new}^\#(\text{obs\_load\_a\_c}) \leftarrow \mathcal{O}_{old}^\#(\text{obs\_load\_a\_c}) \sqcup_{sp} L_{addr}$
    * $\mathcal{O}_{new}^\#(\text{obs\_load\_a\_c}) \leftarrow \textbf{EqLow} \sqcup_{sp} \textbf{EqLow} = \textbf{EqLow}$
    * これは表2の「安全：NS/SP共にLow」のルールに合致し、Leak にはなりません。このセマンティクスは「すでに追加の漏洩がない」アクセスを正しく安全と判定します。

### 5.4. 分析結果と最終判定

アルゴリズムは最終的に不動点に達します。収束したグローバル状態 $\Sigma_{LFP}^\#$ には、$\mathcal{O}^\#(\text{obs\_load\_z\_a}) = \text{Leak}$ というエントリが含まれます。
アルゴリズム 1 のステップ3（違反判定）に基づき、$\mathcal{O}^\#$ マップ内に Leak が存在するため、このプログラムは **SNI Violation** として正しく報告されます。

**表3：「問題のケース」の形式的抽象実行トレース（要約）**

| ステップ | 命令 | VCFG Edge | 適用関数 | R#(a) (命令後) | O#(obs_load_z_a) | O#(obs_load_a_c) | コメント |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `load z, a` | $E_{ns}$ | $F_{ns}$, $\sqcup_{ns}$ | EqLow | $\bot \sqcup_{ns} \text{EqLow} = \textbf{EqLow}$ | $\bot$ | ベースライン確立 (Address=Low) |
| 2 | `load a, c` | $E_{ns}$ | $F_{ns}$, $\sqcup_{ns}$ | $\text{EqLow} \sqcup \text{EqHigh} = \textbf{EqHigh}$ | EqLow | $\bot \sqcup_{ns} \text{EqLow} = \textbf{EqLow}$ | ベースライン確立。aがHighに。 |
| 3 | `beqz y, End` | $E_{ns}$ | $F_{ns}$ | EqHigh | EqLow | EqLow | NSパスは終了 |
| 4 | `beqz y, End` | $E_{sp}$ | (N/A) | EqHigh | EqLow | EqLow | SPパスはループ続行 (誤予測) |
| 5 | `load z, a` | $E_{sp}$ | $F_{spec}$, $\sqcup_{sp}$ | EqHigh | $\text{EqLow} \sqcup_{sp} \textbf{EqHigh} = \textbf{Leak}$ | EqLow | **SNI違反検出！** (Address=High) |
| 6 | `load a, c` | $E_{sp}$ | $F_{spec}$, $\sqcup_{sp}$ | EqHigh | Leak | $\text{EqLow} \sqcup_{sp} \text{EqLow} = \text{EqLow}$ | 安全（追加の漏洩なし） |

## 第VI章：結論と展望

### 6.1. 結論

本レポートは、ユーザーから提示された重要な洞察（MEMLEAK と CTRLLEAK の検証における履歴の分離）に基づき、投機的非干渉（SNI）を検証するための拡張された静的解析アルゴリズムを形式化しました。
本手法の核心は、以下の概念を数学的に統合した点にあります。

* **VCFG（仮想制御フローグラフ）:** 投機的パス（$E_{sp}$）と非投機的パス（$E_{ns}$）を明示的に分離したグラフ構造。
* **関係的抽象ドメイン ($L_{SNI}^\#$):** NS状態とSP状態の関係性（EqLow, EqHigh, Leak）を抽象化する格子。
* **非対称な抽象変換 ($F_{spec}$):** $E_{sp}$ エッジ上でSP状態のみを更新し、「NSベースラインからの逸脱」をモデル化する関数。
* **分離された観測履歴 ($\mathcal{O}^\#$, $\mathcal{J}^\#$):** ユーザーの洞察と SPECTECTOR の定義に基づき、MEMLEAK 用のメモリ観測履歴 ($\mathcal{O}^\#$) と CTRLLEAK 用の制御フロー観測履歴 ($\mathcal{J}^\#$) を分離。
* **履歴更新セマンティクス ($\sqcup_{sp}$):** 「NSで観測されなかった（またはLowだった）ものがSPでHighとして観測される」事象を Leak として検出する専用演算子。

これらの要素を組み合わせ、VCFG上の最小不動点（LFP）計算アルゴリズム（アルゴリズム 1）として提案手法全体を数学的に定義しました。さらに、この形式化されたアルゴリズムが、提示された「問題のケース」を Leak として正しく検出するプロセスを、具体的なトレース（表3）によって実証しました。

### 6.2. 関連研究と今後の展望

本レポートで形式化した手法は、関連する最先端の研究と以下の点で関係します。

* **Declassiflow との比較:** Declassiflow は、「NS実行で 必然的に 漏洩する知識（NSK）」を特定するために 事前解析 （Pre-pass）を実行する「プロアクティブ」なアプローチです。対照的に、本レポートの手法（$\mathcal{O}^\#$, $\mathcal{J}^\#$）は、不動点計算と 同時 にベースラインを 動的 に構築する「リアクティブ」なアプローチであり、異なる精度と計算量のトレードオフを持ちます。
* **LightH との比較:** LightH は、 検出 ではなく 防御（Hardening） を目的とした、異なる（ただし関連する）不動点アルゴリズムです。LightH が採用する「ビットレベルのテイント追跡」は、本レポートの $L_{SNI}^\#$（High/Low）よりも粒度の細かいドメインを採用しています。これは、将来的に $L_{SNI}^\#$ をより詳細なドメイン（例：ビットレベルの格子）に置き換えることで、解析精度をさらに向上させる有望な研究の方向性を示唆しています。
* **今後の課題:** 本レポートで導入した $\mathcal{J}^\#$（制御フロー履歴）の抽象化の粒度（例：ジャンプターゲットアドレスの完全な関係性を追跡するか、単に High/Low のみを区別するか）が、CTRLLEAK 検出の精度と解析のスケーラビリティに与える影響について、さらなる評価が求められます。

### 引用文献
* Abstract-Interpretation-under-Speculative-Execution.pdf
* 2025-11-15-SNI違反検出セマンティクスの妥当性検証
* Princepled_Detection_of_Speculative_Information_Flows.pdf
* Place_Protections_at_the_right_place.pdf
