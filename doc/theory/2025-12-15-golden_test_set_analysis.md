# ゴールデンテストセット分析レポート

日付: 2025-12-15
対象: `muasm_case/handmade/` 配下のテストケース群

## 1. 概要

本レポートは、SNI (Speculative Non-Interference) 検証アルゴリズムの健全性と定義整合性を確認するために作成された「ゴールデンテストセット」の分析結果をまとめたものである。これらは、投機的実行に特有の脆弱性（Violation）と、SNI定義上セキュアとされるケース（Suppression）の両方を網羅するように設計されている。

## 2. テストケース構成と分析

作成・収集されたテストケースを、その検証目的ごとに4つのカテゴリに分類し分析する。

### カテゴリA: 投機的リーク (SNI Violation)
投機的実行パスにおいてのみ発生する情報漏洩。これらは **正しく検知（Violation）されなければならない**。

| ファイル名 | 概要 | 結果 | 本質的意義 |
| :--- | :--- | :--- | :--- |
| `ctrlleak_spec_cond_high.muasm` | 分岐条件が Secret に依存し、投機パスへ進む | **Violation** | **[基本]** Control-based Specter v1 の最小構成。これを検知できなければ SNI 検証器として機能しない。 |
| `nested_speculation_leak.muasm` | 二重の分岐予測ミスの奥で Secret をロード | **Violation** | **[深度]** 投機コンテキストスタックがネストした投機深さを正しく追跡できているかの証明。 |
| `aliasing_store_load.muasm` | 投機的パスでのみ発生するメモリ Store/Load のエイリアス | **Violation** | **[メモリ]** 「どこに書き込むか不明」なストアが、その後のロードに波及・汚染するかを検査。抽象解釈の精度（Weak Update）が問われる重要ケース。 |
| `loop_counter_cutoff.muasm` | ループで命令数を稼いだ後のリーク | **Violation** | **[範囲]** 投機ウィンドウを「長さ（ステップ数）」で定義する本プロジェクト特有の境界値テスト。 |

### カテゴリB: ベースライン更新による抑制 (Secure Suppression)
SNI の定義「投機的実行が、非投機的実行（NS）よりも多くの情報を漏らさない」に基づくケース。NS 側でも同様にリークする場合、それは既存の脆弱性であり、投機起因ではないため SNI としては **Secure** と判定されるべきである。

| ファイル名 | 概要 | 結果 | 本質的意義 |
| :--- | :--- | :--- | :--- |
| `secure_ns_leak_linear.muasm` | 直線的コードで Secret を無条件にリーク | **Secure** | **[定義]** NS実行で観測履歴が Low->High に更新されることで、SP実行での同等の観測が「追加漏洩ではない」と判定されるメカニズムの確認。 |
| `secure_ns_leak_loop.muasm` | ループ内で繰り返し Secret をリーク | **Secure** | **[定義]** 複数回のリーク観測があっても、ベースライン更新が追従することを確認。 |
| `baseline_high_suppresses_leak.muasm` | 既存ケース。NSでHigh観測済み | **Secure** | 同上。 |

### カテゴリC: 投機ウィンドウ外 (Window Cutoff)
リーク箇所が投機ウィンドウ（`W_max`）よりも遠い場所にあるケース。Pruning モデルを採用しているため、これは **Secure** となる（"見逃し" ではなく "仕様としての無視"）。

| ファイル名 | 概要 | 結果 | 本質的意義 |
| :--- | :--- | :--- | :--- |
| `specwindow_cutoff.muasm` | 多くの `skip` 命令の後にリークを配置 | Violation* | *設定された specWindow 次第で変化する。十分小さい Window 設定下では Secure となり、探索打ち切りが機能していることを示す。 |

### カテゴリD: 安全なコード (Secure Baseline)
そもそも Secret が観測点に到達しないコード。

| ファイル名 | 概要 | 結果 | 本質的意義 |
| :--- | :--- | :--- | :--- |
| `secure_low_only.muasm` | Public データのみを扱う | **Secure** | **[健全性]** 過過剰な汚染（Taint Explosion）が起きていないかの確認。 |

### カテゴリE: 実践的ガジェット (Real-world Gadgets)
実際の Spectre 脆弱性攻撃コード（およびその対策）を模したケース。

| ファイル名 | 概要 | 結果 | 本質的意義 |
| :--- | :--- | :--- | :--- |
| `spectre_v1_bounds_check.muasm` | 古典的な Spectre V1 (Bounds Check Bypass) | **Violation** | **[実用]** 最も有名な投機的脆弱性パターンを正しく検出できることを実証。 |
| `spectre_v1_1_bounds_check_store.muasm` | Spectre V1.1 (Bounds Check Bypass Store) | **Violation** | **[実用]** 投機的書込み（Store）による汚染伝播を検出。攻撃者が任意の場所に値を書き込める脅威を検知。 |
| `spectre_v1_mitigated_barrier.muasm` | Spectre V1 + 投機バリア (spbarr) | **Secure** | **[健全性/実用]** 適切な緩和策（Barrier）が挿入されていれば、正しく Secure と判定できることを実証（False Positive ではない）。 |

## 3. 分析と総評

### SNIの本質を捉えているか？
今回整備したゴールデンセット（カテゴリA〜D）に加え、**カテゴリE (実践的ガジェット)** の検証結果は、本ツールが単なる理論モデル上の正しさだけでなく、現実の脅威（Spectre）に対して有効であることを強く示唆している。
特に `spectre_v1_mitigated_barrier` が Secure と判定されたことは、ユーザーが求めていた「健全性を保ちつつ、できるだけセキュア（対策済みなら安全）と判定する」能力を証明している。

### エッジケースの網羅性
`aliasing_store_load` において、当初 NS 側でエイリアスが発生してしまい Secure 判定となった（そしてそれを修正した）経緯は、**「投機的パスのみで発生する事象」** を作ることの難しさと重要性を示唆している。このテストケースは、エンジンのメモリエイリアス解析（May-Alias）の健全性を担保する上で非常に価値が高い。

### 結論
現在のテストセットは、本プロジェクトが目指す「SPECTECTOR 準拠の SNI 定義（ただし Length ベース）」を検証するための最小十分なセット（Canonical Set）となっていると評価できる。さらに、Spectre V1/V1.1 などの実脆弱性パターンをもカバーしており、ツールとしての実用性評価のベースラインとしても機能する。
