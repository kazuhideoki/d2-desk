# 作るアプリのコンセプト

仮に名前を付けるなら、**D2 Desk** のようなものです。

目的はこの3つです。

1. **D2を覚えやすくする**
2. **日々の図作成を速くする**
3. **テキストと図の対応関係を迷わないようにする**

単なる「左にテキスト、右にSVG」ではなく、**テキスト上の要素と図上の要素を相互に選択・強調できること**を中核機能にします。

---

# 画面構成案

基本画面は以下です。

```text
┌──────────────────────────────┬──────────────────────────────┐
│ 左: D2エディタ                │ 右: 常時プレビュー             │
│                              │                              │
│ ・構文色分け                  │ ・SVGプレビュー                │
│ ・エラー表示                  │ ・ズーム / パン                │
│ ・補完                        │ ・選択中オブジェクト強調        │
│ ・カーソル位置に対応表示       │ ・ホバー中オブジェクト表示       │
│ ・スニペット                  │                              │
├──────────────────────────────┴──────────────────────────────┤
│ 下部: エラー、出力、学習ヒント、オブジェクト情報              │
└─────────────────────────────────────────────────────────────┘
```

右側プレビューは、ただの画像ではなく、**SVGの上に透明な選択レイヤーを重ねる**のがよいです。
これにより、D2のレンダラーが出したSVG内部のDOM構造に強く依存しなくても、図形や線を安定してホバー・選択できます。

---

# 主要機能案

## 1. 左右分割エディタ

左にD2テキスト、右にライブプレビューです。
D2のCLIにはwatchモードがあり、`d2 --watch in.d2 out.svg` のように変更を監視してSVGを更新できます。公式READMEでも、変更時にブラウザ側がlive-reloadされる使い方が説明されています。([GitHub][3])

ただし、今回のアプリではCLIのwatchだけに頼らず、アプリ側で入力を監視して、短い待ち時間を入れて再レンダリングする方が扱いやすいです。

おすすめは以下です。

```text
入力変更
  ↓ 150〜300ms debounce
D2解析
  ↓
エラー診断
  ↓
図の再生成
  ↓
SVG差し替え
  ↓
対応マップ更新
```

---

## 2. IDE風の色分け・補完・エラー表示

エディタは **Monaco Editor** か **CodeMirror 6** が候補です。

Monaco EditorはVS Code由来のブラウザ向けコードエディタで、公式READMEでも「VS Codeの fully featured code editor」と説明されています。([GitHub][4])
D2の公式PlaygroundもMonaco Editorを使っており、SVG操作にはPanzoomを使っています。また、Playgroundではd2.jsによりdagre/elkレイアウトをフロントエンド内で処理し、TALAだけAPI呼び出しになると説明されています。([GitHub][5])

一方で、CodeMirror 6は軽く、拡張しやすく、構文色分け・補完・lint・検索などを柔軟に組み込めます。公式にも、Web用コードエディタであり、多くの編集機能と拡張APIを持つと説明されています。([CodeMirror][6])

結論としては、初期版はこうするのが現実的です。

| 目的            | 推奨            |
| ------------- | ------------- |
| VS Codeっぽい操作感 | Monaco Editor |
| 軽さ・細かい拡張性     | CodeMirror 6  |
| 早くMVPを作る      | Monaco Editor |
| 長期的に独自IDE化する  | CodeMirror 6  |

私は **Tauri + TypeScript + Monaco Editor** から始めるのがよいと考えます。D2 PlaygroundでもMonacoが使われているため、D2との相性を確認しやすいです。

---

## 3. LSP風の言語機能

ここは少し注意が必要です。

D2本体には、Goパッケージとして `d2lsp` が存在し、補完、参照範囲取得、ボード位置取得などIDE向けの関数が用意されています。`GetCompletionItems`、`GetRefRanges`、`GetBoardAtPosition` などが公開されています。([Go Packages][7])

また、D2 parserは壊れた入力でもエラーを集めながら有効なASTを返す設計で、LSPやブラウザクライアント向けにUTF-16位置も扱えます。([Go Packages][8])

ただし、現時点で「すぐ使える完成済みの公式D2 Language Serverバイナリ」が十分に整っているかは、調べた範囲でははっきりしません。公式READMEには「parser、autoformatter、syntax highlightingがあり、LSPなどを計画している」とあります。([GitHub][3])

なので、設計としてはこうするのが安全です。

```text
色分け:
  TextMate grammar / tree-sitter / Monaco tokenizer で行う

補完:
  D2の d2lsp.GetCompletionItems を使う

エラー:
  d2parser / d2lib.Parse / d2lib.Compile の結果を診断表示する

参照ジャンプ:
  d2lsp.GetRefRanges を使う

将来:
  必要なら独自の d2-language-server を作り、LSP 3.17 互換にする
```

LSPは、エディタとLanguage Serverの間で補完・定義ジャンプ・hoverなどをやり取りする標準プロトコルです。公式ページでも、補完、定義ジャンプ、参照検索などの言語機能をエディタ間で共通化するものとして説明されています。([GitHub Microsoft][9])

---

# 左右ハイライトの実現方法

ここが一番重要です。

## やりたいこと

ユーザー要望はこの2つです。

```text
左エディタでカーソルがある場所
  → 右プレビュー上の対応図形・線を強調

右プレビューでマウスが当たっている図形・線
  → 左エディタ上の対応テキストを強調
```

これを安定して実装するには、D2ソースとレンダリング結果の間に **対応マップ** を作る必要があります。

## 対応マップのデータ構造

内部では、こういうデータを持ちます。

```ts
type D2ObjectMap = {
  id: string;
  kind: "shape" | "connection";
  boardPath: string[];
  label?: string;

  sourceRanges: {
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }[];

  preview: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    route?: { x: number; y: number }[];
  };
};
```

D2のレンダリング結果側には、`d2target.Diagram` があり、そこに `shapes` と `connections` が含まれます。`Shape` には `ID`、`Pos`、`Width`、`Height` があり、`Connection` には `ID`、`Src`、`Dst`、`Route` があります。これを使うと、図形・線の位置情報をプレビュー側の選択レイヤーに使えます。([Go Packages][10])

D2のGo APIでは、`d2lib.Compile` が `Diagram` と `Graph` を返し、`d2lib.Parse` はASTを返します。これにより、「ソースの構造」と「レンダリング後の図形情報」を同時に扱えます。([Go Packages][11])

## 実装の流れ

### 左から右へ

```text
1. Monacoのカーソル位置を取得
2. 行・列をD2 backendへ送る
3. AST上でその位置にあるノードを探す
4. D2オブジェクトIDを得る
5. 右プレビューのoverlay上でそのIDを強調
```

### 右から左へ

```text
1. SVG上の透明overlayに mouseover
2. overlay要素の data-d2-id を取得
3. objectMap[id].sourceRanges を取得
4. Monaco Editor上に decoration を表示
5. 必要なら該当行までスクロール
```

## プレビュー側は「SVG本体」ではなく「overlay」で拾う

D2のSVG内部DOMに直接依存すると、D2本体の更新で壊れやすいです。
そのため、SVG本体の上に透明なSVGレイヤーを重ねます。

```text
┌─────────────────────────────┐
│ preview container            │
│ ┌─────────────────────────┐ │
│ │ D2が出したSVG本体        │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 透明なhover/select層     │ │
│ │ data-d2-id付きrect/path │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

図形は透明な `rect`、線は透明な太めの `path` として重ねます。
選択時だけ枠線や背景を出します。

---

# 技術構成案

## 推奨構成

```text
Desktop shell:
  Tauri 2

Frontend:
  TypeScript
  Vite
  React または Svelte
  Monaco Editor
  SVG preview + overlay
  Zustand / Jotai / Svelte store

D2 engine:
  Go sidecar binary
  oss.terrastruct.com/d2/d2lib
  oss.terrastruct.com/d2/d2parser
  oss.terrastruct.com/d2/d2lsp
  oss.terrastruct.com/d2/d2target

通信:
  Tauri command または stdin/stdout JSON-RPC

保存:
  ローカルファイル
  SQLite: 最近使ったファイル、テンプレート、履歴、設定

出力:
  SVG
  PNG
  PDF
  Markdown埋め込み用コード
```

Tauri 2は、Webフロントエンドを使って小さく速いクロスプラットフォームアプリを作るためのフレームワークです。公式にも、任意のフロントエンドを使え、macOS/Windows/Linuxなどを単一コードベースで対象にできると説明されています。([Tauri][12])

Electronも候補です。ElectronはChromiumとNode.jsを内蔵し、JavaScript/HTML/CSSでmacOS/Windows/Linux向けアプリを作れるフレームワークです。([Electron][13])
ただ、このアプリは「軽いローカルIDE」にしたいので、基本はTauriの方が向いています。

---

# D2 engineの実装案

## 案A: d2 CLIを呼び出す

一番簡単です。

```text
Frontend
  ↓
Tauri
  ↓
d2 CLI
  ↓
SVG
```

メリットは、すぐ作れることです。
デメリットは、左右ハイライトに必要な細かい対応情報が取りづらいことです。

MVPの最初だけなら使えますが、長期的には不十分です。

---

## 案B: d2.jsをフロントエンドで使う

D2 Playgroundは、dagre/elkについてはd2.jsでフロントエンド内レンダリングしていると説明されています。([GitHub][5])

メリットは、Web UIとの相性がよいことです。
デメリットは、TALAがd2.jsでは対応していないためAPI呼び出しになる点と、ソース対応マップをどこまで取れるかの確認が必要な点です。([GitHub][5])

---

## 案C: Go sidecarでD2を扱う

本命です。

```text
Frontend
  ↓ JSON-RPC
Go sidecar
  ├─ parse
  ├─ compile
  ├─ format
  ├─ completion
  ├─ diagnostics
  ├─ object map
  └─ export
```

Go sidecar側でD2のGo APIを直接使います。
D2はGoライブラリとしても使えると公式READMEに書かれており、D2 OracleというAST上の編集APIもあります。([GitHub][3])

この方式なら、エディタ機能とプレビュー機能をきれいに分けられます。

---

# Go sidecarのAPI案

```text
compile
  input:  D2 source, file path, layout, theme
  output: svg, diagram json, objectMap, diagnostics

format
  input:  D2 source
  output: formatted source

complete
  input:  D2 source, line, column
  output: completion items

hover
  input:  D2 source, line, column
  output: help text, object info

nodeAt
  input:  D2 source, line, column
  output: object id, source ranges

refs
  input:  object id
  output: source ranges

export
  input:  D2 source, format
  output: file
```

`compile` の戻り値は、例えばこうです。

```json
{
  "svg": "<svg>...</svg>",
  "diagnostics": [
    {
      "message": "unexpected token",
      "range": {
        "startLine": 12,
        "startColumn": 4,
        "endLine": 12,
        "endColumn": 10
      }
    }
  ],
  "objects": [
    {
      "id": "api.server",
      "kind": "shape",
      "label": "API Server",
      "sourceRanges": [
        {
          "file": "main.d2",
          "startLine": 4,
          "startColumn": 1,
          "endLine": 4,
          "endColumn": 11
        }
      ],
      "preview": {
        "x": 120,
        "y": 80,
        "width": 160,
        "height": 80
      }
    }
  ]
}
```

---

# 学習しやすくする機能

D2を覚える目的があるので、単なるエディタより、学習補助を入れると価値が出ます。

## 1. 右クリックで「この要素の書き方を見る」

図形を右クリックすると、該当するD2コードと説明を出します。

```text
shape: cylinder
style.fill: "#f5f5f5"
```

のように、その場で意味を説明します。

## 2. テンプレート集

最初に作るべきテンプレートは以下です。

| テンプレート  | 用途                      |
| ------- | ----------------------- |
| システム構成図 | API、DB、Queue、Userなど     |
| ネットワーク図 | VPC、Subnet、Firewallなど   |
| ER図     | Table、Column、Relation   |
| シーケンス図  | request/response        |
| 状態遷移図   | state、event             |
| タスク分解図  | project、task、dependency |

D2は公式にも、コンテナ、テーブル、シーケンス図、UMLクラス図、Markdown、コードスニペットなどを扱える機能が紹介されています。([D2 Documentation][1])

## 3. 入力補助パレット

コマンドパレットでこういう操作をできるようにします。

```text
Add shape
Add connection
Change shape type
Apply theme
Switch layout engine
Export SVG
Export PNG
Format document
Open examples
```

---

# 日々の作業で便利にする機能

## 必須

```text
・ローカルファイルを開く / 保存
・最近使ったファイル
・自動保存
・SVG / PNG / PDF出力
・クリップボードへSVGコピー
・Markdown用の埋め込みコードコピー
・テーマ切り替え
・レイアウトエンジン切り替え
・検索 / 置換
・整形
```

D2は公式にSVG/PNG/PDF出力をサポートしています。([GitHub][3])

## あると強い

```text
・Git差分プレビュー
・before / afterの図比較
・複数.d2ファイルのワークスペース
・importsの依存関係表示
・アイコンURLのキャッシュ
・チートシート
・スニペット管理
・図形一覧パネル
・アウトラインパネル
```

---

# D2 Studioから参考にする点

D2 Studioから参考にするとよいのは、以下です。

| D2 Studioの方向性 | デスクトップ版での取り込み方                |
| ------------- | ----------------------------- |
| IDEとしてのD2体験   | ローカルIDEとして再設計                 |
| 複数ボード         | layers/scenarios/stepsの切り替えUI |
| GUI操作とテキスト同期  | 最初はプロパティ編集だけ実装                |
| ホストされた重いレイアウト | ローカルD2 + optional TALA        |
| チーム共同編集       | 初期版では不要                       |
| アセット管理        | ローカルアイコン管理として実装               |

D2 Studioは、GUI操作をテキストに同期したり、色選択や透明度調整をテキストへ書き戻したりできることを特徴として説明しています。([Terrastruct][2])
この発想はかなり良いので、デスクトップ版でも **「右側で選んだ要素のプロパティを変更すると、左側のD2コードが変わる」** ところまで行けると強いです。

ただし、初期版でドラッグ移動まで入れると重くなります。まずは以下で十分です。

```text
・図形を選ぶ
・右ペインにプロパティ表示
・shape / fill / stroke / label / icon を編集
・D2コードへ反映
```

---

# 実装上の難所

## 1. ソース位置と図形IDの対応

最大の難所です。

特に以下が難しいです。

```text
・同じ図形が複数箇所で参照される
・connectionのIDが見た目と一致しにくい
・importされたファイル
・glob
・labelとIDが違う
・container内の子要素
・layers / scenarios / steps
```

対策は、D2のAST、d2lspの参照範囲、d2targetの図形IDを組み合わせることです。

## 2. 壊れたD2入力

入力中は常に文法が壊れます。
そのため、壊れた状態でもできるだけプレビューやエラー表示を維持する必要があります。

D2 parserは、壊れた入力でも複数エラーを扱い、言語ツールが動き続けられるようにする設計が説明されています。([Go Packages][8])

## 3. D2 APIの安定性

D2のGoパッケージは、調べた時点ではv0.7.1で、Go Packages上でも「Stable version」は未チェックです。([Go Packages][7])
そのため、D2内部APIに依存しすぎると、将来の更新で壊れる可能性があります。

対策は以下です。

```text
・D2 engineをsidecarに閉じ込める
・frontendはD2内部APIを知らない
・sidecar APIだけを自分たちの安定インターフェースにする
・D2 versionを固定する
・更新時にcompat testを回す
```

---

# MVP案

最初の実装範囲はこれでよいです。

## MVP 1: 基本エディタ

```text
・Tauri desktop app
・左 Monaco Editor
・右 SVG preview
・D2 source保存
・live preview
・エラー表示
・format
・SVG/PNG/PDF export
```

## MVP 2: 左右対応ハイライト

```text
・D2 compile時にobjectMap生成
・shape/connectionのoverlay生成
・左カーソル → 右強調
・右hover → 左強調
・右click → 左の該当箇所へジャンプ
```

## MVP 3: IDE機能

```text
・補完
・hover説明
・参照ハイライト
・アウトライン
・スニペット
・テンプレート
```

## MVP 4: 学習支援

```text
・チートシート
・例から始める
・選択中コードの説明
・プロパティ編集
・テーマ比較
・レイアウト比較
```

---

# 最終的な推奨構成

結論はこれです。

```text
Desktop:
  Tauri 2

Frontend:
  TypeScript
  Vite
  Monaco Editor
  React または Svelte
  SVG preview
  SVG overlay for hit testing
  Pan/Zoom library

Backend:
  Go sidecar
  D2 Go libraries
    - d2lib
    - d2parser
    - d2lsp
    - d2target
    - d2oracle

Protocol:
  JSON-RPC over stdin/stdout
  または Tauri command bridge

Rendering:
  Go sidecarでcompile
  SVG + Diagram JSON + ObjectMapを返す

Highlight:
  editor position → object id → preview overlay
  preview hover → object id → source ranges → editor decoration

Storage:
  local files
  SQLite for settings/templates/recent files/cache

Export:
  SVG
  PNG
  PDF
  Markdown snippet
```

一番大事なのは、**SVGをただ表示するだけでなく、D2の構造情報をアプリ側で持つこと**です。
この設計にすると、左と右の相互ハイライト、補完、エラー表示、プロパティ編集、学習支援まで自然につながります。

[1]: https://d2lang.com/ "Home | D2 Documentation"
[2]: https://terrastruct.com/d2-studio/ "Terrastruct | D2 Studio"
[3]: https://github.com/terrastruct/d2 "GitHub - terrastruct/d2: D2 is a modern diagram scripting language that turns text to diagrams. · GitHub"
[4]: https://github.com/microsoft/monaco-editor "GitHub - microsoft/monaco-editor: A browser based code editor · GitHub"
[5]: https://github.com/terrastruct/d2-playground "GitHub - terrastruct/d2-playground: An online runner to play, learn, and create with D2, the modern diagram scripting language that turns text to diagrams. · GitHub"
[6]: https://codemirror.net/ "CodeMirror"
[7]: https://pkg.go.dev/oss.terrastruct.com/d2/d2lsp "d2lsp package - oss.terrastruct.com/d2/d2lsp - Go Packages"
[8]: https://pkg.go.dev/oss.terrastruct.com/d2/d2parser "d2parser package - oss.terrastruct.com/d2/d2parser - Go Packages"
[9]: https://microsoft.github.io/language-server-protocol/ "Official page for Language Server Protocol"
[10]: https://pkg.go.dev/oss.terrastruct.com/d2/d2target "d2target package - oss.terrastruct.com/d2/d2target - Go Packages"
[11]: https://pkg.go.dev/oss.terrastruct.com/d2/d2lib?utm_source=chatgpt.com "d2lib package - oss.terrastruct.com/d2/d2lib"
[12]: https://v2.tauri.app/ "Tauri 2.0 | Tauri"
[13]: https://electronjs.org/ "Build cross-platform desktop apps with JavaScript, HTML, and CSS | Electron"
