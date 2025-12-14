# アーキテクチャと責務

本ドキュメントでは、SNI Visualizer のハイレベルなアーキテクチャを定義し、各コンポーネントの**責務 (Responsibilities)** と**境界 (Boundaries)** に焦点を当てて解説します。詳細な実装ロジックについては、ソースコードを直接参照してください。

## システム概要

本システムは、ユーザーが記述した MuASM コードに対し、投機的非干渉 (SNI) を満たしているかどうかを検証・可視化するものです。

```mermaid
graph TD
    User[ユーザー / Web ブラウザ]
    
    subgraph "Web UI (app/)"
        Editor[コードエディタ]
        Visualizer[VCFG & 状態可視化]
        Runner[解析ランナー (Facade)]
    end
    
    subgraph "コアロジック"
        Builder["VCFG ビルダー (vcfg-builder/)"]
        Engine["SNI エンジン (sni-engine/)"]
    end
    
    subgraph "共有ライブラリ (lib/)"
        Schema[解析スキーマ & 型定義]
    end

    User -->|コード編集| Editor
    User -->|再生操作| Visualizer
    Editor -->|ソースコード| Runner
    Runner -->|MuASM| Builder
    Builder -->|StaticGraph| Engine
    Engine -->|AnalysisResult| Visualizer
    Schema -.->|インターフェース定義| Runner & Builder & Engine
```

## コンポーネントの責務

### 1. Web UI (`app/(analysis)/*`)
- **責務**: 純粋な可視化とユーザーインタラクション。
- **範囲**:
    - エディタ、再生操作、解析オプションの React 状態管理。
    - React Flow を用いた `StaticGraph` (VCFG) の描画。
    - ステップごとの `AbstractState` の変化のレンダリング。
    - **禁止事項**: ここに解析ロジックを実装**しない**こと。UI はあくまで `AnalysisResult` の薄いコンシューマ（利用者）であるべきです。

### 2. VCFG ビルダー (`vcfg-builder/`)
- **責務**: ソースコードをパースし、制御フローグラフを構築する。
- **範囲**:
    - MuASM テキストを AST (抽象構文木) にパースする。
    - ノード（命令）とエッジ（制御フロー）から成る `StaticGraph` を構築する。
    - 制御フローの種類（通常、投機的）を扱う。
    - **境界**: 入力は `string` (コード)、出力は `StaticGraph` (ノード/エッジ情報)。

### 3. SNI エンジン (`sni-engine/`)
- **責務**: コアとなるセキュリティ解析を実行する。
- **範囲**:
    - `StaticGraph` 上で抽象解釈を実行する。
    - 抽象状態（レジスタ、メモリ、観測）を維持管理する。
    - `Leak` (SNI 違反) を検出する。
    - UI が再生するための実行ステップの線形リスト (`Trace`) を生成する。
    - **境界**: 入力は `StaticGraph` + `Options`、出力は `AnalysisResult` (トレース/判定結果)。

### 4. 共通スキーマ (`lib/analysis-schema/`)
- **責務**: コンポーネント間の「契約 (Contract)」を定義する。
- **範囲**:
    - `Instruction`, `StaticGraph`, `AnalysisResult`, `AbstractState` などの型定義。
    - これらの型は **API 定義** として機能します。ここを変更すると全コンポーネントに影響します。
    - エンジンと UI が、互いの内部ロジックを直接参照することなく、データの形状について合意することを保証します。

## 主要な境界 (Key Boundaries)

### UI <-> エンジン
- UI はエンジンを「`analyze(code) -> Result`」というブラックボックス関数として扱います。
- エンジンは、DOM や React、あるいは結果がどのように表示されるかについて一切関知しません。

### 静的解析 <-> 動的状態
- `vcfg-builder` は**静的**な構造（地図）を作成します。
- `sni-engine` はその構造の上で、**動的**な性質（通った経路や変数の値）を計算します。

## 理論と背景
本システムで実装されている SNI、論理、判断 (Judgments) の理論的定義については、`doc/theory/` 以下のドキュメントを参照してください。
