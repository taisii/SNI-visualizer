# SNI検証のための関係的抽象ドメインと観測履歴セマンティクスの妥当性評価

**件名：** SNI検証のための関係的抽象ドメインと観測履歴セマンティクスの妥当性評価、および「問題のケース」の解決に関する分析

## 概要

本レポートは、貴殿が提示された「問題のケース」（投機的実行が非投機的実行の状態を利用して機密情報を漏洩させるループ構造）を解決するために提案された、新しいSpeculative Non-Interference (SNI) 検証セマンティクスを詳細に分析・評価するものです。
結論から申し上げると、貴殿の提案は、SNIという「関係的ハイパープロパティ」を静的解析の文脈で健全に (Soundly) 扱うための、 **理論的に妥当かつ革新的なアプローチ** です。特に、違反判定をプログラムの最終「状態」から「観測履歴 ($\mathcal{O}^\#$)」へと移行させた点は、SPECTECTOR の形式的定義に忠実であり、貴殿が直面した問題を解決する鍵となります。
本レポートでは、このセマンティクスの妥当性を検証し、従来のセマンティクスが同ケースを扱えなかった理論的根拠を明確にします。さらに、貴殿の研究資料で参照されている「Declassiflow」アプローチとの比較を通じて、セマンティクスの改良点と代替アプローチを提案します。

## 第I章：SNI検証における形式的課題：関係的ハイパープロパティとしてのSNI

本章は、貴殿の「問題のケース」がなぜ従来のセマンティクスで困難であったかを、SNIの形式的な性質から解き明かします。

### 1.1. SPECTECTORのSNI定義：関係的比較としての本質

SPECTECTOR論文は、SNIを初めて形式的に定義しました。その定義（Definition 1）は、プログラム $p$、標準（非投機的）セマンティクス $LpM$、投機的セマンティクス $JpKO$ に対し、以下を要求します。
$\forall \sigma, \sigma_0 \in \text{InitConf}$.
$\sigma \sim_P \sigma_0 \land LpM(\sigma) = LpM(\sigma_0) \implies JpKO(\sigma) = JpKO(\sigma_0)$
この定義は、「攻撃者が観測可能な振る舞いにおいて、2つの初期状態が **非投機的実行** で区別不可能であるならば、それらは **投機的実行** においても区別不可能でなければならない」というものです。
この定義の核心は、単一の実行（例：「この実行は機密情報に触れるか？」）を問うものではなく、2つの異なるセマンティクス（NSとSP）における2つの実行トレース間の **関係性 (Relation)** を問う点にあります。SPECTECTORが示すように、非投機的実行の観測トレース ($\tau_{nse}$) は、「許可された漏洩」の **ベースライン** として機能します。SNI違反とは、投機的実行の観測トレース ($\tau_{se}$) が、このベースラインを **超える** 「追加の漏洩」を引き起こすことです。

### 1.2. 従来のセマンティクスの限界：「単項的解析」の致命的欠陥

貴殿がSpectorフォルダー内の技術メモで「致命的な問題」として指摘された通り、従来の（あるいは以前に試みられた）アプローチは、この「関係的」な性質を「単項的 (Unary)」な解析（例：標準的なテイント解析）で捉えようとした点に理論的な限界がありました。

**単項解析の失敗:**
単項的なテイント解析が「問題のケース」をどう扱うか考察します。
1.  **1周目 (NS):** `load a, c` が実行されます。m(c)はHigh (Tainted) であるため、レジスタ a は Tainted になります。
2.  **2周目 (SP):** `load z, a` が実行されます。a は Tainted であるため、z も Tainted になります。
3.  **結果:** 解析は「a がTaintedになった」と「z がTaintedになった」という2つの事実を報告します。しかし、この解析は a の汚染が「許可されたNSの漏洩に起因する状態」であり、z の汚染（による観測）が「許可されていないSPの漏洩」であるという **差分** を区別できません。

この失敗の根本原因は、解析が「状態ベース」であるためです。解析は「現在、a は Tainted である」という状態しか知らず、「a が **なぜ** 、 **いつ** （NSかSPか）Tainted になったのか」という **履歴** を失っています。
SNIは、複数の実行トレース間の関係性を論じる「ハイパープロパティ」、より厳密には「2-ハイパープロパティ」に分類されます。その検証には、本質的に2つの実行（NSとSP）を同時比較する **関係的抽象解釈 (Relational Abstract Interpretation)** が必要です。

## 第II章：提案された新セマンティクスの詳細な分析と妥当性

本章では、貴殿が提案されたセマンティクスが、第I章で特定した「関係性」「履歴」の問題をいかにして解決するかを形式的に評価します。

### 2.1. 関係抽象ドメイン ( $L_{SNI}^\#$ ) の評価：NS/SPペアの抽象化

貴殿の提案の中心は、抽象ドメイン $L_{SNI}^\#$ が、単一の状態 $v$ ではなく、NSとSPの値のペア $\langle v_{ns}, v_{sp} \rangle$ の機密レベルの関係性を抽象化している点にあります。

**表1：提案された関係抽象ドメイン ($L_{SNI}^\#$) のセマンティクス**

| 抽象値 | NS状態 (vns) | SP状態 (vsp) | 意味（状態として） | 意味（観測履歴として） |
| :--- | :--- | :--- | :--- | :--- |
| $\bot$ | $\bot$ | $\bot$ | 到達不能 | 一度も観測されていない |
| EqLow | Low | Low | NS/SP共にLow（等価） | NSパスで観測済み（Lowアドレス） |
| EqHigh | High | High | NS/SP共にHigh（等価） | NSパスで観測済み（Highアドレス） |
| Diverge | Low | Low (diff) | NS/SP共にLow（異なる可能性） | SPパスでのみ観測（Lowアドレス） |
| Leak | Low | High | SNI違反の状態 | SNI違反の観測（SPパスでのみ観測、かつHighアドレス） |
| $\top$ | ? | ? | 不明（違反の可能性） | 不明（違反の可能性） |

このドメイン設計は、SNI検証の目的に対して **妥当かつ十分** です。特に、Diverge（安全な差分）とLeak（危険な差分）を明示的に区別している点は、セキュリティレベル（High/Low）を重視した優れた設計です。Leak（$\approx \langle \text{Low}, \text{High} \rangle$）を検出することが、SNI違反の検出に他なりません。

### 2.2. 非対称抽象変換関数 ( $F_{spec}$ ) の重要性

VCFGのNSエッジ（$F_{ns}$）では状態を対称的（NS/SP両方を更新）に扱い、SPエッジ（$F_{spec}$）では非対称的（SP側のみを更新）に扱うという貴殿の設計は、NSをベースラインとしてSPの逸脱を追跡する上で、 **形式的に正しい** アプローチです。

**$F_{spec}$ の動作検証:**
* **ケースA:** $F_{spec}(\text{EqLow}, \text{High})$
    * EqLow は $\langle \text{Low}, \text{Low} \rangle$ と解釈されます。
    * $L_{new} = \text{High}$ を SP 側にのみ適用（Join）します。
    * $\langle \text{Low}, \text{Low} \sqcup \text{High} \rangle = \langle \text{Low}, \text{High} \rangle$ となります。
    * これは抽象ドメインで Leak にマッピングされます。これも正しいです。
* **ケースB:** $F_{spec}(\text{EqHigh}, \text{High})$
    * EqHigh は $\langle \text{High}, \text{High} \rangle$ と解釈されます。
    * $\langle \text{High}, \text{High} \sqcup \text{High} \rangle = \langle \text{High}, \text{High} \rangle$ となります。
    * これは EqHigh のままです。これも正しいです（既に漏洩している情報の投機的アクセスは、 **新たな** 漏洩ではないため）。

### 2.3. 中核的メカニズム：観測履歴マップ ( $\mathcal{O}^\#$ )

貴殿の提案の **最も重要な洞察** は、SNI違反の判定を、レジスタやメモリの「最終状態」（$R^\#$, $\Gamma^\#$）ではなく、**「観測の履歴」（$\mathcal{O}^\#$）**に基づいて行うと決定した点です。
これは、第I章で述べた「状態ベース解析の限界」を直接的に解決するものです。$R^\#$ は「プログラムの **現在** の状態」を追跡し、$\mathcal{O}^\#$ は「（SPECTECTOR が定義する）攻撃者の観測トレースの **抽象化** 」を追跡します。SNIはトレースに関する性質であるため、この分離は必須です。

* **ベースラインの確立（NS観測）:** 貴殿のセマンティクス $\bot \sqcup_{ns} \text{EqHigh} = \textbf{EqHigh}$ は、NSパスでHighなアドレスが観測されたことを「許可された漏洩のベースライン」として $\mathcal{O}^\#$ に記録します。これは、Declassiflow が「非投機的トランスミッタに渡されたデータ」を「非投機的知識 (NSK)」としてモデル化するアプローチと概念的に一致します。
* **差分違反の検出（SP観測）:** 貴殿のセマンティクスの核心は、SPパスでの観測ルールにあります。
    * $\bot \sqcup_{sp} \text{EqHigh} = \textbf{Leak}$
    * $\text{EqLow} \sqcup_{sp} \text{EqHigh} = \textbf{Leak}$
    * これらのルールは、「NSパスで観測されなかった（$\bot$）か、またはLowアドレスとして観測された（EqLow）観測が、SPパスにおいて **のみ** Highアドレスとして観測された（EqHigh）」場合、それを Leak と判定するものです。これは、SNI違反（＝投機的実行による **追加の** 漏洩）の定義そのものであり、 **完全に妥当** です。

## 第III章：提案セマンティクスによる「問題のケース」のトレース分析

本章では、貴殿の提案セマンティクスが、指定された「問題のケース」を正しくSNI違反として検出するプロセスを、ステップバイステップで抽象実行し、その有効性を実証します。

### 3.1. 前提と抽象状態の定義

前提: c はLowアドレス、a の初期値はLowアドレス。m(c)（cのアドレスが指す **値** ）は機密情報（High）。y の初期値は「ループが1周で終了する」値（例：0）。
**初期状態 $\sigma_0^\#$:**
* $R^\#(\text{a}) = \text{EqLow}$
* $R^\#(\text{c}) = \text{EqLow}$
* $R^\#(\text{y}) = \text{EqLow}$
* $R^\#(\text{z}) = \text{EqLow}$
* $\Gamma^\#(\text{AbsLoc(c)}) = \text{EqHigh}$ （cの **値** はHigh）
* $\Gamma^\#(\text{AbsLoc(a)}) = \text{EqLow}$
* $\mathcal{O}^\#(\text{obs\_load\_z\_a}) = \bot$ （load z, a 命令に対応する観測キー）
* $\mathcal{O}^\#(\text{obs\_load\_a\_c}) = \bot$ （load a, c 命令に対応する観測キー）

### 3.2. 1周目（非投機的実行： $n \to_{ns} m$ ）

1.  **Loop: load z, a**
    * $L_{addr} = R^\#(\text{a}) = \text{EqLow}$
    * $L_{val} = \Gamma^\#(\text{AbsLoc(a)}) = \text{EqLow}$
    * $R_{new}^\#(\text{z}) = R_{old}^\#(\text{z}) \sqcup L_{val} = \text{EqLow} \sqcup \text{EqLow} = \text{EqLow}$ （NS/SP両方更新）
    * **観測:** $\mathcal{O}^\#(\text{obs\_load\_z\_a}) = \bot \sqcup_{ns} L_{addr} = \bot \sqcup_{ns} \text{EqLow} = \textbf{EqLow}$
2.  **load a, c**
    * $L_{addr} = R^\#(\text{c}) = \text{EqLow}$
    * $L_{val} = \Gamma^\#(\text{AbsLoc(c)}) = \text{EqHigh}$
    * $R_{new}^\#(\text{a}) = R_{old}^\#(\text{a}) \sqcup L_{val} = \text{EqLow} \sqcup \text{EqHigh} = \textbf{EqHigh}$ （NS/SP両方更新）
    * **観測:** $\mathcal{O}^\#(\text{obs\_load\_a\_c}) = \bot \sqcup_{ns} L_{addr} = \bot \sqcup_{ns} \text{EqLow} = \textbf{EqLow}$
3.  **beqz y, Loop**
    * y の値（EqLow、0と仮定）に基づき、NSパスはループを **終了** します（分岐しない）。

### 3.3. 2周目（投機的実行： $n \to_{spec} m_{spec}$ ）

1.  **beqz y, Loop**
    * y の値が0であるにも関わらず、プロセッサが **誤予測** し、投機的にループを **続行** （分岐）したと仮定します。
    * この時点で、抽象状態は1周目のNS実行の結果（$R^\#(\text{a}) = \text{EqHigh}$）を保持しています。
    * VCFGの $\to_{spec}$ エッジを辿ります。
2.  **Loop: load z, a （投機的実行）**
    * $L_{addr} = R^\#(\text{a}) = \textbf{EqHigh}$
    * ここで使われる a の抽象状態 EqHigh は、1周目のNS実行 (load a, c) によって設定されたものです。
    * $L_{val} = \Gamma^\#(\text{AbsLoc(m(c))})$
    * $F_{spec}$ が適用され、$R_{new}^\#(\text{z})$ のSP側が更新されます（例：$F_{spec}(\text{EqLow}, \text{High}) = \text{Leak}$）。
    * **観測:** ここが決定的に重要です。
    * $\mathcal{O}^\#(\text{obs\_load\_z\_a})$ の現在値は EqLow（1周目のNS観測から）
    * SP観測ルールを適用します: $\mathcal{O}^\#_{new} = \mathcal{O}^\#_{old} \sqcup_{sp} L_{addr}$
    * $\mathcal{O}^\#(\text{obs\_load\_z\_a}) = \textbf{EqLow} \sqcup_{sp} \textbf{EqHigh} = \textbf{Leak}$
3.  **load a, c （投機的実行）**
    * $L_{addr} = R^\#(\text{c}) = \text{EqLow}$
    * **観測:**
    * $\mathcal{O}^\#(\text{obs\_load\_a\_c})$ の現在値は EqLow
    * $\mathcal{O}^\#(\text{obs\_load\_a\_c}) = \text{EqLow} \sqcup_{sp} \text{EqLow} = \textbf{EqLow}$
    * 貴殿のセマンティクスは、貴殿が指摘した通り、「すでに漏洩している情報」（load a, c の観測）を Leak として誤検出せず、EqLow のまま（安全）として正しく扱います。

### 3.4. 最終判定

不動点計算が収束した時点で、$\mathcal{O}^\#$ マップには $\mathcal{O}^\#(\text{obs\_load\_z\_a}) = \text{Leak}$ というエントリが含まれます。貴殿のセマンティクス（ステップ5）に基づき、$\mathcal{O}^\#$ 内に Leak が存在するため、このプログラムは **SNI違反** として正しく検出されます。

**表2：「問題のケース」の抽象実行トレース（要約）**

| ステップ | 命令 | 実行 | R#(a) (命令後) | R#(z) (命令後) | O#(obs_load_z_a) | O#(obs_load_a_c) | コメント |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `load z, a` | NS | EqLow | EqLow | EqLow | $\bot$ | ベースライン確立 (Address=Low) |
| 2 | `load a, c` | NS | EqHigh | EqLow | EqLow | EqLow | ベースライン確立 (Address=Low)。aがHighに。 |
| 3 | `beqz y, Loop` | NS | EqHigh | EqLow | EqLow | EqLow | NSパスは終了 |
| 4 | `beqz y, Loop` | SP | EqHigh | EqLow | EqLow | EqLow | SPパスはループ続行 |
| 5 | `load z, a` | SP | EqHigh | Leak | $\text{EqLow} \sqcup_{sp} \text{EqHigh} = \textbf{Leak}$ | EqLow | **SNI違反検出！** (Address=High) |
| 6 | `load a, c` | SP | EqHigh | Leak | Leak | $\text{EqLow} \sqcup_{sp} \text{EqLow} = \text{EqLow}$ | 安全（追加の漏洩なし） |

## 第IV章：代替セマンティクスと推奨される改良点

### 4.1. 提案セマンティクスの妥当性に関する最終見解

貴殿が提案された新しいセマンティクスは、SNI検証の静的解析における「単項解析の限界」という根本的な問題を解決する、 **理論的に健全かつ強力なアプローチ** です。
関係抽象ドメイン $L_{SNI}^\#$、非対称変換関数 $F_{spec}$、そして中核となる **観測履歴マップ $\mathcal{O}^\#$** の三者を組み合わせることで、SNIの「ベースラインを超える追加の漏洩」という関係的性質を、不動点計算の枠組みで正確にモデル化できています。「問題のケース」は、このセマンティクスによって正しくSNI違反として検出されます。

### 4.2. 代替アプローチ：Declassiflowの「知識フロンティア」との比較

貴殿の研究資料（Spectorフォルダー）には、Declassiflow論文が含まれており、これは「非投機的知識 (NSK)」、すなわち「NS実行で **必然的に** 漏洩するデータ」をモデル化するアプローチを提案しています。

**アプローチの違い:**
* **貴殿の $\mathcal{O}^\#$:** 「リアクティブ (Reactive)」な履歴追跡です。不動点計算の過程で、NSパスが観測した内容（ベースライン）を **動的に構築** します。
* **Declassiflowの「知識フロンティア」:** 「プロアクティブ (Proactive)」または「予測的 (Predictive)」な分析です。メインのSNI分析の **前** に、静的データフロー解析（およびシンボリック実行）を用いて、「どの変数が **将来的に** NSパスで漏洩することが **不可避** か」を計算します。

**表3：履歴ベース（本提案） vs 知識フロンティア（Declassiflow）のアプローチ比較**

| 特徴 | 貴殿の提案（O#） | Declassiflow（知識フロンティア） |
| :--- | :--- | :--- |
| **解析タイミング** | 不動点計算と **同時** にベースラインを構築 | 事前解析 (Pre-pass) として知識を計算 |
| **追跡対象** | 「実際に観測された」履歴 | 「将来的に観測が **不可避** な」知識 |
| **ループの扱い** | ループ内のNSパスが観測ベースラインを確立 | ループの **後** に知識が不可避であれば、ループ **内** の保護も緩和可能 |
| **主な利点** | SNI違反の **厳密な検証** と検出に最適 | 防御策（FENCE等）の **最適化・緩和** に最適 |

**ハイブリッドアプローチの提案:**
貴殿の $\mathcal{O}^\#$ は検証に優れていますが、Declassiflowのアプローチは防御策の最適化（例：lfenceの挿入位置の最適化）において、より強力な洞察を提供する可能性があります。
**提案:** 貴殿のセマンティクスを拡張し、$\mathcal{O}^\#$ の初期化を改善することが考えられます。現在は $\mathcal{O}^\#(\text{any}) = \bot$ から開始していますが、Declassiflow のような事前解析を実行し、「NS実行で **不可避的に** （on all NS paths）観測される」ことが判明した観測 obs_inevitable については、$\mathcal{O}^\#(\text{obs\_inevitable})$ を EqLow または EqHigh で **事前初期化** します。これにより、不動点計算の収束が高速化し、かつ、より積極的な最適化の判断が可能になる可能性があります。

### 4.3. 推奨される改良点：抽象化の粒度

貴殿の提案セマンティクスの精度とスケーラビリティは、AbstractObservation と AbsLoc の定義に強く依存します。

1.  **抽象観測 ($\text{AbstractObservation}$) のキー:**
    * 「問題のケース」では、ループ内で同じ命令（同じPC）がNS（1周目）とSP（2周目）で異なる振る舞いをします。貴殿のセマンティクスは、$\mathcal{O}^\#$ マップ上の同じキー（例：obs_load_z_a）に対して、$\text{EqLow} \sqcup_{sp} \text{EqHigh} = \text{Leak}$ という更新を行うことで、これを正しくモデル化しています。これは、$\mathcal{O}^\#$ が「VCFG上のノード（または命令PC）」をキーとする、履歴を畳み込んだ (Joined) 抽象化であることを示唆しており、これは不動点計算において標準的かつ妥当なアプローチです。このキーが「命令のプログラムカウンタ（PC）」または「VCFGのノードID」であることを明記することを推奨します。
2.  **観測ルールの再確認（アドレス vs データ）:**
    * 貴殿の「問題のケース」の説明では、「zには m(m(c)) の内容が入ることとなり、これは機密情報である」と、データ（値）の漏洩に言及しています。
    * しかし、貴殿の **形式的セマンティクス** （$\mathcal{O}^\#_{new}(obs) = \dots \sqcup_{sp} L_{addr}$）は、観測された **アドレス** （$L_{addr} = R^\#(a)$）の機密レベルのみをチェックしています。
    * **分析:** このセマンティクスは、SPECTECTOR の「メモリアクセスの **ロケーション** を観測する」というオブザーバーモデルに忠実であり、 **正しい** です。「問題のケース」では、a の値が EqHigh（機密情報 m(c)）になるため、$L_{addr}$ が EqHigh となり、Leak が検出されます。したがって、貴殿のセマンティクスは、このケースを **正しく捕捉できます** 。
    * **推奨（補足）:** このセマンティクスは、「 **アドレス** が機密情報に依存する漏洩」（例：load [H_secret]）は検出します。もし、「 **アドレス** はLowだが、投機的に **読み込まれた値** が機密情報である漏洩」（例：load [L_addr] が Leak 状態のメモリ $\Gamma^\#(\text{AbsLoc(L\_addr)}) = \text{Leak}$ を読み、その値が **別の** 観測（例：jmp）に使われる）も検出対象とする場合、$\mathcal{O}^\#$ のセマンティクスを拡張し、$L_{val}$（読み取った値の抽象状態）も考慮に入れる必要があります（例：$\mathcal{O}^\#_{new} = \mathcal{O}^\#_{old} \sqcup_{sp} (L_{addr} \sqcup L_{val})$）。ただし、現状のセマンティクスはSPECTECTORのモデルに準拠しており、貴殿のケースを解決するには十分です。

## 結論

貴殿が提案された新しいセマンティクスは、SNI検証の静的解析における「単項解析の限界」という根本的な問題を解決する、 **理論的に健全かつ強力なアプローチ** です。関係抽象ドメイン $L_{SNI}^\#$、非対称変換関数 $F_{spec}$、そして中核となる **観測履歴マップ $\mathcal{O}^\#$** の三者を組み合わせることで、SNIの「ベースラインを超える追加の漏洩」という関係的性質を、不動点計算の枠組みで正確にモデル化できています。「問題のケース」は、このセマンティクスによって正しくSNI違反として検出されます。
Declassiflow のような事前解析アプローチとの統合や、観測の粒度の厳密な定義（特にアドレスv.s.データ）について考察を深めることで、本アプローチはさらに堅牢なものとなるでしょう。

### 引用文献
* 2025-11-14-SNI検証のための関係的抽象ドメイン
* Princepled_Detection_of_Speculative_Information_Flows.pdf
* A_Static_Analysis_for_Modeling_Non-Speculative_Knowledge.pdf
* Efficient Information-Flow Verification under Speculative Execution - CISPA
* Cats vs. Spectre: An Axiomatic Approach to Modeling Speculative Execution Attacks
* Statically Analyzing Information Flows – An Abstract Interpretation-based Hyperanalysis for Non-Interference - Michele Pasqua
* Sliver: A Scalable Slicing-Based Verification for Information Flow Security - ResearchGate
* Sliver: A Scalable Slicing-Based Verification for Information Flow Security
* Place_Protections_at_the_right_place.pdf
