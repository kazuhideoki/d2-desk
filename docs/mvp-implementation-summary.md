# MVP実装サマリ

このブランチでは、`docs/plan-overview.md` の方針に沿って、D2 Deskの初期MVPを実装した。

## 実装範囲

- Tauri 2 + React + TypeScript + Viteでデスクトップアプリの土台を作成
- Monaco Editorを使ったD2編集画面を実装
- Go sidecarでD2のcompile / format / nodeAt / complete / exportを扱う構成を追加
- 左にエディタ、右にSVGプレビューを表示する2ペインUIを実装
- D2ソースと図形の対応情報を使い、エディタ側とプレビュー側の相互ハイライトを実装
- SVG / PNG / PDF出力、D2ファイルの読み込み、ソース保存、整形、テーマ切り替え、ズーム操作を追加

## 構成

```text
Frontend:
  src/App.tsx
  src/App.css
  Monaco Editor
  SVG preview + transparent overlay

Desktop bridge:
  src-tauri/src/lib.rs
  Tauri command: sidecar_call

D2 engine:
  sidecar/main.go
  oss.terrastruct.com/d2/d2lib
  oss.terrastruct.com/d2/d2format
  oss.terrastruct.com/d2/d2lsp
  oss.terrastruct.com/d2/d2svg
```

Tauri側は `sidecar_call` でJSONを受け取り、バンドル済みのGo sidecarがあればそれを実行する。バイナリがない開発時は `go run ./sidecar` にフォールバックする。

## プレビューとハイライト

プレビューはD2が生成したSVG本体の上に、透明なSVG overlayを重ねている。D2のSVG内部DOMには直接依存せず、Go sidecarから返す図形座標と線のrouteを使って、プレビュー側のhit targetを作る。

エディタ側では、カーソル位置から `nodeAt` を呼び出して対応するD2 object IDを取得する。プレビュー側では、overlay上の図形または線をhover / clickしたときに同じIDを使い、Monaco decorationで対応するソース範囲を強調する。

## 安定化した点

- D2表記が壊れた場合でも、プレビューを白画面にせず、最後に成功したSVGを維持するようにした
- compile errorはMonaco markerと下部diagnosticsに表示する
- MonacoのCSSと専用テーマを追加し、エディタが空白表示にならないようにした
- D2 SVGのroot `viewBox` から `width` / `height` を補完し、プレビューサイズを安定化した
- overlayの座標系はD2内部SVGの `viewBox` を優先して使い、選択表示のずれを抑えた
- ウィンドウリサイズ時にエディタ背景がプレビュー側へ漏れないよう、各ペインのoverflow / z-index / 背景を整理した

## ビルドと確認

確認済みのコマンド:

```sh
npm run build:app
cargo check
go test ./...
npm run tauri build -- --bundles app
```

通常のアプリバンドルは以下に生成される。

```text
src-tauri/target/release/bundle/macos/D2 Desk.app
```

## まだ残っていること

- PNG / PDF出力はフロントエンド側の簡易実装で、Go sidecar側のraster / PDF rendererは未接続
- object mapのsource range推定は簡易スキャンであり、container、import、複雑なlabel、複数参照には改善余地がある
- layout engineは現時点ではdagreのみ
- 補完APIはsidecarに用意しているが、Monaco側の補完UIにはまだ接続していない
- 最近使ったファイル、自動保存、テンプレート、学習ヒント、プロパティ編集は未実装
