# ディレクトリ再編計画（コロケーション / デコロケーション指針）

最終目的は、機能単位でのコロケーションを徹底しつつ、複数コンポーネント間で共有する契約（スキーマ・API）をデコロケーションして独立させることにより、A/B/C 各担当の変更衝突と依存方向を明確化することである。

- スコープ: 本リポジトリ全体（`app/`, `sni-engine/`, `vcfg-builder/`, 共有ドキュメント）。
- 根拠: `sni-engine/src/analysis.ts` が `../../app/types/analysis-result` を直接参照し逆依存が発生している (1-10 行)、`app/lib/analysis-client.ts` が UI 直下でエンジンを直参照している (1-2 行)。これによりビルド順序と Next.js 側のバンドル境界が曖昧になっている。

## 1. 現状課題の整理
- **型の所在が UI 配下に偏在**: 共通スキーマ `app/types/analysis-result.ts` をエンジン側も import しており、UI → コアという依存方向が逆転する。型変更が Next.js のビルドに巻き込まれる。
- **機能別コロケーション不足**: `app/components/*` と `app/lib/*` がすべて 1 フラット階層で、MuASM エディタ/VCFG ビュー/Control パネル等の関係性が見えにくい。fixtures も `app/fixtures/` に孤立。
- **結合ファサードの所在が曖昧**: `app/lib/analysis-client.ts` が UI 直下で VCFG Builder → SNI エンジンを直列呼び出ししており、「計算エンジン」の責務を別パッケージとして切り出せていない。
- **テストのデコロケーション不完全**: エンジンのテストは `sni-engine/tests`、VCFG のテストは `vcfg-builder/src/index.test.ts` と配置が揺れており、コードとの距離が一定でない。

## 2. 目標ディレクトリ構造（案）

```
apps/
  web/                      # Next.js UI アプリ
    app/
      (analysis)/           # 機能フォルダ。ページ + 機能単位のコロケーション
        page.tsx
        layout.tsx
        features/
          editor/           # MuASM エディタ (CodeEditor 他)
          controls/         # ControlPanel + deriveControlState
          visualization/    # VCFGView, StateViewer
          analysis-runner/  # UI 専用ファサード、モック/fixtures
            services/analyze.ts
            fixtures/mock-analysis-result.ts
        shared/             # 画面共通 UI (Header, Toaster 配置など)
      globals.css
    components/ui/          # 純粋 UI プリミティブ (Accordion, Sonner など)
    lib/                    # UI 汎用 util (cn)
    public/
packages/
  analysis-schema/          # AnalysisResult / StaticGraph の TS 型と JSON Schema
  analysis-engine/          # VCFG Builder + SNI Engine を束ねる node/browser 両用ファサード
  vcfg-builder/             # 既存コードを移動（tsconfig paths 更新）
    src/
    tests/                  # src 直下から移動し隣接配置
  sni-engine/
    src/
    tests/
docs/                       # 既存 doc/ 配下を移動 or symlink（任意）
```

- **コロケーション**: `apps/web/app/(analysis)/features/*` に UI と周辺ロジックをまとめ、テスト・fixtures も各機能直下に置く。ビジュアライザとステートビューのスタイル/ロジックは `visualization` に集約。
- **デコロケーション**: `analysis-schema` を単独パッケージ化し、UI/エンジン双方がここにだけ依存する。`analysis-engine` で VCFG Builder と SNI エンジンの組み合わせを包み、UI からは一段だけ import すれば済むようにする。

## 3. 移行ステップ（フェーズ分割）

1) **境界の切り出し**
   - `app/types/analysis-result.ts` を `packages/analysis-schema/src/index.ts` に移設し、パスエイリアスを更新（tsconfig/biome/vitest）。
   - `sni-engine` / `vcfg-builder` / `app` からの import を一括置換して型依存方向を一本化。

2) **エンジン結合部のパッケージ化**
   - 現行の `app/lib/analysis-client.ts` を `packages/analysis-engine/src/index.ts` へ移動。
   - API は `analyze(source: string, options?)` とし、UI からは `packages/analysis-engine` のみ参照。

3) **UI の機能別コロケーション**
   - `app/page.tsx` と関連コンポーネントを `apps/web/app/(analysis)/features/*` へ移動。
   - `ControlPanel` が依存する `deriveControlState` を `features/controls/lib/deriveControlState.ts` に隣接化。
   - `mock-analysis-result.ts` を `features/analysis-runner/fixtures/` に移し、Playwright/Vitest UI テストを追加する場合も同ディレクトリに配置。

4) **テストの隣接化**
   - `sni-engine/tests` を `sni-engine/src/__tests__` に移動し、モジュール単位のスコープを明確化。
   - `vcfg-builder/src/index.test.ts` を `vcfg-builder/src/__tests__/index.test.ts` に移動し、ビルド資産とテストの距離を一定にする。

5) **実行・ビルドパイプライン更新**
   - `package.json` の scripts を monorepo 仕様（例: `turbo` または単純な `pnpm -r`) に更新。
   - Next の `tsconfig.json` とルート `tsconfig.base.json` を分割し、`packages/*` を参照するように設定。
   - ※本フェーズは将来的なビジョンとしての改善案であり、直近のスプリントでは実行しない。

## 4. リスクと回避策
- **型移設時の循環参照**: `analysis-schema` は純 TS 型・JSON Schema のみに限定し、ロジックを持たせないことで循環を防ぐ。
- **Next.js のビルド対象拡大**: `packages/*` を `transpilePackages` に登録し、不要なサーバーバンドルを避ける。ブラウザ実行が不要なモジュールは `analysis-engine` 内でエントリ分離（node/browser）する。
- **Path alias ずれによるテスト失敗**: Biome/Vitest/Next で共通に使う `tsconfig.base.json` を用意し、エイリアス解決を一箇所に集約。

## 5. 完了条件
- UI から見る依存が `analysis-engine` 経由の単一路となっていること。
- 解析スキーマの単一正本が `packages/analysis-schema` に移り、UI/エンジン双方が同パッケージ経由で参照していること。
- 機能別フォルダ内にコンポーネント・hooks・fixtures・テストが揃い、フラットな `app/components` / `app/lib` に分析機能特有のコードが残っていないこと。
