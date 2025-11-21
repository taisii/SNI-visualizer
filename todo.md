# TODO

- UI にポリシー入力フォームが無いため、ドキュメント仕様（`doc/web-spec.md` の options.policy 記述）どおりに `policy` を渡せていない。左ペインに Low/High を設定するフォームを追加し、`app/(analysis)/features/analysis-runner/services/analyze.ts` から `AnalyzeOptions.policy` へ中継する UI 実装が必要。
- MuASM コードエディタでテキストが変更されたら直ちに過去の解析結果 (`result`/`trace`/`currentStep`) をクリアするようにする。仕様（`doc/web-spec.md` 2.3 ユーザーフロー）では編集と結果の不整合を防ぐために必須挙動としているが、現状 `onChange` はソース文字列の更新のみで結果リセットを行っていない（app/page.tsx あたり）。
