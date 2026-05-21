# Command System

D2 Desk の操作は、コマンドパレット専用の仕組みではなく、アプリ操作を統合的に管理する `Command` を中心に扱う。

## 基本方針

- `Command` は「何をするか」を表す。
- ツールバー、ショートカット、Tauri menu、コマンドパレット、将来のコンテキストメニューは「どの経路で呼べるか」を表す。
- どの経路から呼んでも最終的には同じ `Command.run()` を実行する。
- UI 状態、タブ、Monaco editor、ワークスペース状態に依存する command 管理はフロントエンドに置く。
- Go sidecar は D2 ソースに対する処理や補完など、入力と出力が明確な処理に限定する。

## 現在の対応範囲

上部ツールバーのボタン操作は `src/commands.ts` の command 型に従い、`App.tsx` で command として定義する。

現在 command 化されている操作:

- Open Workspace Folder
- Manage Workspaces
- Open D2 File
- Save D2 Source
- Open Current D2 File with `$EDITOR`
- Format Document
- Zoom Out
- Reset Zoom
- Zoom In
- Export SVG
- Export PNG

これらはツールバーとコマンドパレットの両方から同じ command 経由で実行する。

## 残タスク

- 既存ショートカット処理を `executeCommand(commandId)` に寄せる。
  - `Cmd/Ctrl+O`
  - `Cmd/Ctrl+S`
  - `Cmd/Ctrl+Shift+I`
  - `Cmd/Ctrl+-`
  - `Cmd/Ctrl+0`
  - `Cmd/Ctrl++`
  - `Cmd/Ctrl+T`
  - `Cmd/Ctrl+W`
  - `Cmd+P`
  - `Cmd+Shift+O`
  - `F2`
- Monaco `editor.addCommand` も同じ command id を実行する形へ寄せる。
- Tauri menu event も同じ command id をフロントエンドへ渡す形へ寄せる。
- command の `enabled` 判定を boolean から `CommandContext` ベースに拡張する。
- command と表示経路を分ける。
  - `Command`: id, title, category, keywords, enabled, run
  - `Binding`: palette, shortcut, toolbar, menu など
- コマンドパレットに未対応の操作を追加する。
  - Open Workspace File
  - Go to Symbol in File
  - New Tab
  - Close Tab
  - Quit
  - Rename Node
- command id の命名規則を固定する。
  - 例: `file.save`, `workspace.openFolder`, `view.zoomIn`, `editor.format`
- command 定義の単体テストを増やす。
  - 検索順位
  - keyword / shortcut / category 検索
  - enabled 判定
  - binding 生成
