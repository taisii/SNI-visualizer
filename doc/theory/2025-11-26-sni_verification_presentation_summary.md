# 投機的非干渉（SNI）検証：仮想制御フローグラフ上の関係抽象解釈

**日付:** 2025年11月26日

## 1. 導入・背景

### 目的
投機的実行が生むサイドチャネル攻撃（Spectre）に対する静的検証手法を提示することを目的とする。

### SNI (Speculative Non-Interference) の定義
高機密な部分（High）のみが異なる2つの初期状態から実行を開始した時、観測者が観測できる情報（Low）に差がないこと。

$$ \sigma_1 \approx_L \sigma_2 \implies \mathcal{O}(\sigma_1) = \mathcal{O}(\sigma_2) $$

### 攻撃者モデル (SPECTECTOR)
SNI では、以下のサイドチャネルを通じて情報を観測できると仮定する。

1.  **MEMLEAK:** `load` / `store` 命令のターゲットアドレス。
2.  **CTRLLEAK:** `beqz` / `jmp` 命令によるプログラムカウンタの遷移（制御フロー）。

---

## 2. 既存の課題：ループとパス爆発

### SPECTECTORの課題
SPECTECTORの論文では、シンボリック実行を使ってすべての実行パスを列挙した上で SNI を満たしているかを比較するアルゴリズムが提案されている。しかし、シンボリック実行は **パス爆発問題** を抱えており、特にループ構造を持つプログラムの検証が困難である。

**例:**
```asm
    w <- 0
Loop:
    w <- w+x
    x <- x-1
    y <- x=0
    beqz y,Loop
```
上記のコードでは、`x` の初期値によってループの回数が変化する（x=1なら1周、x=2なら2周...）。シンボリック実行ではこれら全てのパスを考慮しようとするため、解析が発散しやすい。

---

## 3. 以前の失敗：ループ展開仮説の論理的破綻

### 仮説：鳩の巣原理による不動点収束
ループを展開し、パス爆発が起こらない形に変換するアプローチを検討した。
「SNI違反の検出は少しの展開で発見できることが多い」という経験則から、健全にSNI違反を検出できる展開回数を決定できるのではないかと考えた。

**仮説 $H_0$:**
$k=|Regs|+1$ 回のループ展開で安全なら、元のプログラムも安全である。

**根拠:**
- 各レジスタの機密度を $L = \{Low, High\}$ で管理。
- 機密度は $Low \to High$ に単調増加すると仮定（単調性）。
- 1回のループですべてのレジスタの機密度が変化しなかったら不動点に達したとみなす。
  $$ \Sigma_n = \Sigma_{n+1} \Rightarrow \Sigma_{\infty} = \Sigma_n $$
- レジスタは有限個（$|Regs|$）なので、鳩の巣原理により高々 $|Regs|$ ステップで収束するはずである。

### 破綻するケース
単純なCFG構築と展開では、以下のようなケースで正しく判定できないことが判明した。

#### ケース1：条件付き代入 (`cmov`)
`cmov` が機密情報を流す場合、特定の回数（閾値）までは機密度が変化せず、閾値を超えた瞬間に High が流入する「遅延汚染」が発生しうる。解析器が早期に不動点と誤判定し、展開を打ち切ってしまうリスクがある。

![cmov_cfg](./images/cmov_cfg.png)

#### ケース2：複雑なループ
共有本体に複数のバックエッジが交差する「絡み合い」構造など、単純なループ展開では動作が未定義となる複雑な構造が存在する。

![nested_cfg](./images/nested_cfg.png)

#### ケース3：ポインタとセキュリティポリシー
ポインタ変数の具体値の変化を見ない場合、ある回数までは Low 領域のみをアクセスしていたポインタが、数回後に High 領域に到達して MEMLEAK を起こすようなケースを見逃す。

![ptr_cfg](./images/ptr_cfg.png)

---

## 4. 提案手法：VCFG 上の関係抽象解釈

### 方針転換
有限回ループ展開＋SPECTECTOR 前処理（Declassiflow等）の路線は漏洩を見逃すため破棄。
新しい方針として、**VCFG（Virtual Control Flow Graph）** を用いた **関係抽象解釈** を提案する。多少の偽陽性を許容しつつ、パス爆発を起こさずに高速に判定することを目指す。

### アプローチの全体像
1.  **構造化:** 投機パスを明示した **VCFG** を構築し、探索する。
2.  **抽象化:** 非投機 (NS) / 投機 (SP) の **関係** を保持する抽象状態を流し、不動点を計算する。
3.  **検証:** 観測履歴を投機と非投機で比較し、投機側だけの High 観測を **Leak** と判定する。

**メリット:** パス爆発は起こらず、高速に判定可能。
**制約:** 抽象化による偽陽性（False Positive）の可能性、反例トレース生成の困難さ。

### 4.1 VCFG (Virtual Control Flow Graph)

投機実行の挙動をグラフで表現する。Wuらによる "Abstract Interpretation under Speculative Execution" [2] から着想を得ているが、目的の違いにより構造が異なる。

#### 先行研究との比較
*   **先行研究 (Wu et al.):** キャッシュサイドチャネル（キャッシュミス）の検証が目的。投機の副作用が正規実行に及ぼす影響を見るため、投機パスから正規パスへの「ロールバックエッジ」が存在する。
*   **提案手法:** SNI（機密情報の観測）の検証が目的。投機中に Leak が発生すればその時点で違反即アウトとなるため、投機結果を正規パスにマージする必要がない。したがって **ロールバックエッジは不要** であり、投機ウィンドウの限界または安全確認時点で切り捨てる構造を採用。

#### VCFGの構成
VCFG $G = (N, E)$ は、非投機 (ns) と投機 (sp) の集合に分割される。

$$
\begin{aligned}
N &= N_{ns} \sqcup N_{sp} \\
E &= E_{ns} \sqcup E_{sp}
\end{aligned}
$$

1.  通常の CFG を作成 ($N_{ns}, E_{ns}$)。
2.  投機実行が始まりうる分岐命令ごとに、投機開始ノード $N_{sp}$ と投機エッジ $E_{sp}$ を追加。
3.  誤予測した先のノードへエッジを繋ぐ。

![VCFG](./images/VCFG.png)

### 4.2 抽象状態と関係格子

#### 関係格子 $\mathcal{L}_{SNI}$
非投機実行 ($v_{ns}$) と投機実行 ($v_{sp}$) のセキュリティレベルのペア $\langle v_{ns}, v_{sp} \rangle$ を抽象化する。

$$ \mathcal{L} = \{\bot, EqLow, Diverge, EqHigh, Leak, \top\} $$
順序: $\bot \sqsubseteq EqLow \sqsubseteq Diverge \sqsubseteq EqHigh \sqsubseteq Leak \sqsubseteq \top$

| 要素 | 意味 $\langle v_{ns}, v_{sp} \rangle$ | 説明 |
| :--- | :--- | :--- |
| $EqLow$ | $\langle Low, Low \rangle$ | NS/SP共に低機密で一致（安全） |
| $Diverge$ | $\langle Low, Low \rangle_{\text{diff}}$ | NS/SP共に低機密だが値が乖離（安全） |
| $EqHigh$ | $\langle High, High \rangle$ | NS/SP共に高機密（観測不能により安全） |
| **Leak** | $\langle Low, High \rangle$ | NSはLowだがSPでHighが混入 (**SNI違反**) |

#### 拡張抽象状態 $\sigma^\#$
各ノードにおける抽象状態は以下の5つ組で定義される。

$$ \sigma^\# = \langle R^\#, M^\#, \mathcal{O}^\#, \mathcal{J}^\#, w^\# \rangle $$

*   $R^\#, M^\#$: レジスタ・メモリ環境。NS/SPの値の関係性を追跡。
*   $\mathcal{O}^\#$: **MEMLEAK** 用の観測履歴。
*   $\mathcal{J}^\#$: **CTRLLEAK** 用の制御観測履歴。
*   $w^\#$: 投機ウィンドウ（リソース）管理。

### 4.3 遷移関数 $\mathcal{T}$
現在の状態と命令を受け取り、次の状態を計算する。

1.  **情報の伝播 (情報フロー):**
    *   投機実行中は、**非対称更新** を行う（NS成分は維持し、SP成分のみ更新）。
    *   投機による不確定性は $\delta_{spec}$ (Diverge) として注入される。
2.  **安全性の監視 (Violations):**
    *   メモリアクセスや分岐時に履歴 ($\mathcal{O}^\#, \mathcal{J}^\#$) を更新。
    *   更新則 $\uplus$: `H_base` (既存) が `EqLow` なのに、新たな観測 `v_obs` が `Leak` なら、即座に **Leak**判定。
3.  **停止性の保証 (Resource):**
    *   投機リソース $w^\#$ を消費。0になったら解析打ち切り（Pruning）。

---

## 5. ケーススタディ

実装: [SNI-visualizer](https://github.com/taisii/SNI-visualizer)

### 5.1 単純ループ (SNI違反の例)
```asm
Loop:
  load z, a
  load a, c
  beqz y, Loop
```
1周目で終了すべきところを投機的に2周目に入ると、`load z, a` で `m(m(c))` (High情報) が漏洩し、SNI違反として検出される。

### 5.2 シンボリック実行で問題となるケース
（前述の `w <- w+x` のループ）
SPECTECTORではパス爆発するが、本手法では抽象状態が変化しなくなった時点で停止するため、高速に検証可能。

### 5.3 条件付き代入 (`cmov`) のケース
ループ展開では検出できなかった例も扱えるが、`cmov` の扱い（悪い方をとる）により、実際には脆弱でない場合も警告が出る（偽陽性）可能性がある。

---

## 6. 今後の展望

*   **値を抽象化して持つ:**
    *   レジスタなどが持つ「値」そのものも抽象化（区間解析など）して持てれば、ポインタ演算やループ回数依存の挙動をより正確に扱える可能性がある。
    *   ただし、シンボリック実行に近づくため、計算コストとのトレードオフや設計の明確化が必要。
*   **メモリ更新関数とセキュリティポリシー:**
    *   抽象アドレスへの書き込み（Weak Update）の定義の精緻化。
*   **検証:**
    *   更に多様なケースでの実験と、アルゴリズムの健全性の証明。

---

## 参考文献

1.  Paul Kocher et al. "Spectre attacks: Exploiting speculative execution." S&P'19.
2.  Marco Guarnieri and Jose F. Morales. "spectector/spectector." https://github.com/spectector/spectector.
3.  Meng Wu and Chao Wang. "Abstract Interpretation under Speculative Execution." arXiv:1904.11170, 2019.
