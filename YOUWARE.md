# MultiMap Search UI リリースガイド

React + Vite + Tailwind で構成された Google Maps / Places API 連携アプリ。最大5件までのテキスト検索を保存し、結果をマップ上に色分け表示できる検索ダッシュボードです。

## 実装サマリ
- 主要画面: `src/App.tsx`
  - 検索フォーム: テキスト検索（1回10件取得）、"現在営業中のみ" フィルタ、同時保存5件まで
  - 検索結果パネル: 取得件数、所要時間、再検索・マップフォーカス・削除操作、ログ・警告表示
  - マップビュー: Places API結果をマーカー化、凡例、全体表示、APIキー入力フォーム（マスク対応）
- グローバルスタイル: `src/index.css`
- ビルド成果物: `dist/`（`npm run build`で生成）

## Google Maps / Places API
- `.env` に `VITE_GOOGLE_MAPS_API_KEY` を設定すると初期読み込みに利用
  ```env
  VITE_GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY
  ```
- UI上でも APIキー入力欄からセッション内でキー適用可（ストレージ保存なし、マスク表示）
- Places API Text Search を使用し、検索毎に最大10件を取得
- 必要なGoogle Cloud設定
  - Maps JavaScript API / Places API を有効化
  - 課金アカウント紐付け
  - ドメイン制限を設定する場合はYouwareプレビューURL等を許可

## 検索データフロー
1. フォーム送信で `performSearch` が PlacesService.textSearch を実行
2. 応答を `SearchSet` として保存（色割当、統計情報）
3. `searchSets` 状態の変更を `useEffect` が検知し、Google Maps マーカーを再描画
4. `target` 操作（フォーカス/再検索/削除）でマップズーム・リロード・スタック更新

## 主要依存
- React 18 / TypeScript / Vite 7 / Tailwind CSS 3
- Google Maps JavaScript API (runtime script load)
- Places JavaScript API (Text Search)

## 開発コマンド
- 依存インストール: `npm install`
- 本番ビルド: `npm run build`
- プレビュー: `npm run preview`

## 注意事項
- APIキー未設定時は擬似ピンと警告を表示し、検索ボタン/マップ初期化を制限
- Places APIは無料枠に制限あり。大量検索時はクォータを考慮
- UIはChrome最新版向けに最適化。別ブラウザでの動作は保証外
- 将来的にバックエンドや認証を導入する場合はYouware Backend MCPの利用を検討
