## テスト、動作検証

- テスト
  - フロントエンド/TypeScript は純粋関数の単体テストを追加する。`utils`、`tabs`、`workspaces`、`d2Language` などの公開済み関数など
  - Go sidecar は `compile`、`renameNode`、`nodeAt`、`complete` などの入出力が明確な関数の単体テストを追加する。
- 動作検証を求められた時は `tauri:dev:app` を実行し、Computer Use で実際の挙動を確認すること。
  - その後、ユーザーが手動確認することもあるので特に指示がなければ起動したアプリはそのままにしておき、立ち上げたのはどのアプリであるか伝えること。
