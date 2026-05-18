# RED BISONS Activity

RED BISONS の活動予定、出欠、鍵開け、鍵閉め、見守り時間帯、保護者連絡を管理するブラウザアプリです。

Googleログインを必須にし、Google Sheetsを低コストなデータストア、共有Googleカレンダーを活動予定の配信先として使います。公開GitHubリポジトリで運用できるよう、秘密情報はすべてホスティング環境のSecretに置きます。

## 構成

- Frontend: 静的SPA
- Backend: Cloudflare Workersを本命、Node.jsをローカル検証/退避用
- Auth: Google Identity Services + Worker側IDトークン検証
- Data: Google Sheets
- Calendar: RED BISONS共有Googleカレンダー
- Secrets: Cloudflare Worker secrets、本番外検証では `.dev.vars` / `.env`

## セキュリティ方針

- Googleログイン必須
- 未ログイン時は活動情報を返さない
- 管理者判定はWorker側で実施
- Google Sheets/Calendarへの書き込みはWorker側だけで実施
- Googleサービスアカウント秘密鍵はリポジトリに置かない
- クライアントへ渡すのは公開可能なGoogle OAuth Client IDのみ
- CORSは `ALLOWED_ORIGINS` で許可したOriginだけに限定

## セットアップ

### 1. Google Cloud

1. Google Cloud Projectを作成する
2. Google Sheets APIとGoogle Calendar APIを有効化する
3. OAuth 2.0 Client IDを作成する
   - Application type: Web application
   - Authorized JavaScript origins:
     - `http://localhost:8787`
     - 本番のWorker URL
4. Service Accountを作成する
5. Service AccountのJSONキーを作成する
6. 対象Google Sheetsと共有Googleカレンダーに、Service Accountのメールアドレスを編集者として追加する

### 2. Google Sheets

既存の活動シートは残したまま、アプリ用に以下のタブを追加します。

- `Members`
- `Activities`
- `Responses`
- `ActivityComments`

ヘッダーは [docs/sheets-schema.md](docs/sheets-schema.md) の通りです。

### 3. ローカル検証

```bash
npm install
npm run check
npm run smoke:local
npm run dev:cloudflare
```

本番Secretsは `wrangler secret put` で登録します。

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY
wrangler secret put SHEET_ID
wrangler secret put CALENDAR_ID
wrangler secret put ADMIN_EMAILS
wrangler secret put ALLOWED_ORIGINS
```

ローカル開発では `.env.example` を参考に `.dev.vars` を作成します。`.dev.vars` はGit管理しません。詳しい検証手順は [docs/operations.md](docs/operations.md) を参照してください。

### 4. デプロイ

```bash
npm run deploy
```

## Raspberry Piでの暫定運用

自宅のRaspberry Piは、本番サーバーの第一候補ではなく、検証・暫定デモ・退避先として使えます。Node.jsサーバーとDocker構成を用意しています。

```bash
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
```

外部公開は、ルーターのポート開放ではなくCloudflare TunnelなどのHTTPSトンネルを推奨します。詳細は [docs/raspberry-pi.md](docs/raspberry-pi.md) を参照してください。

Docker運用では `GOOGLE_PRIVATE_KEY` は改行を `\n` にした1行文字列で `.env` に入れてください。

## 管理者

`ADMIN_EMAILS` に含まれるGoogleアカウントだけが、活動登録・編集、メンバー登録・編集を実行できます。

## MVP機能

- Googleログイン
- 活動一覧
- 活動詳細
- 参加者一覧
- 未回答一覧
- 鍵開け、鍵閉め、見守り可否の入力
- 見守り可能時間帯の入力
- 見守り不足の注意表示
- 活動単位のコメント
- 共有Googleカレンダーへの予定同期
- Googleカレンダー追加リンク

## 低コスト運用方針

更新頻度が高くない前提で、常時稼働サーバーを持たない構成にしています。Googleカレンダー連携は共有カレンダー購読を基本とし、個人カレンダーへの直接書き込みは将来拡張とします。

初期運用はCloudflare Workers Freeを本命にし、MacBook ProまたはAIエージェント環境でローカル検証します。Raspberry Piは必要な場合だけ退避先として使います。
