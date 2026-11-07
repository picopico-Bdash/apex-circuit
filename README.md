# Apex Circuit

ブラウザで遊べる 3D サーキットレースゲームです（three.js r128）。
CPU 4台との周回レース。コース3種（グランプリ / テクニカル / 峠）、天候3種（晴れ / 雨 / 夕暮れ）、難易度と周回数を選べます。

**▶ プレイ: https://picopico-Bdash.github.io/apex-circuit/**

## 操作

| キー | 操作 |
|---|---|
| ↑ / W | アクセル |
| ↓ / S | ブレーキ・バック |
| ← → / A D | ハンドル |
| Space | サイドブレーキ（ドリフト） |
| C / R / Esc | 視点切替 / コースに戻る / ポーズ |

スマートフォンでは画面左下のハンドルと右下のアクセル・ブレーキで操作します。

## 構成

```
docs/                GitHub Pages で公開されるサイト（ビルド結果）
  index.html         ページ本体（HUD・メニュー・CSS）
  js/game.js         ゲーム本体
  models/*.glb       車体・コース小物の glTF モデル
game.html            ゲームコードのソース
src/shell.html       ページの HTML/CSS テンプレート
build_docs.py        game.html + src/shell.html から docs/ を生成
```

ゲームを修正したら `game.html` を編集して `python build_docs.py` を実行し、`docs/` をコミットしてください。

ローカルで試す場合は、`fetch()` でモデルを読み込むため HTTP サーバー経由で開いてください:

```bash
python -m http.server 8000 --directory docs
```
