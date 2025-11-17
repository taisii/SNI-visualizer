# TODO

- UI/解析ファサードが `policy` 引数を受け取らないため、ドキュメント仕様（options.policy で Low/High を渡す）に未整合。`app/lib/analysis-client.ts` と呼び出し元で `analyze(sourceCode, { policy })` を受け取り、`sni-engine` の `AnalyzeOptions.policy` に引き渡す仕組みを実装する。
- MuASM コードエディタでテキストが変更されたら直ちに過去の解析結果 (`result`/`trace`/`currentStep`) をクリアするようにする。仕様（doc/webapp.md:189-192）では編集と結果の不整合を防ぐために必須挙動としているが、現状 `onChange` はソース文字列の更新のみで結果リセットを行っていない（app/page.tsx:19-123）。
