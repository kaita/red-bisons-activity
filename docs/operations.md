# Operations

## 方針

MVPの本命運用はCloudflare Workers Free構成にする。Raspberry Piは本番サーバー候補ではなく、検証・暫定デモ・退避先として扱う。

ローカル検証はMacBook ProまたはAIエージェントのサンドボックスで行う。秘密情報なしでも最低限の起動確認ができ、Google連携込みの確認は `.dev.vars` またはCloudflare Secretsを設定して行う。

## 検証レベル

### Level 1: 構文・依存関係チェック

```bash
npm install
npm run check
npm audit --audit-level=moderate
```

### Level 2: 秘密情報なしのローカル起動確認

```bash
npm run smoke:local
```

確認すること:

- Nodeサーバーが起動する
- `/api/config` が応答する
- `/` がSPAを返す

Google OAuthやSheets/Calendarの実接続は確認しない。

### Level 3: MacBook ProでのGoogle連携込みローカル確認

```bash
cp .env.example .dev.vars
```

`.dev.vars` に実値を入れる。Google OAuth ClientのAuthorized JavaScript originsに以下を追加する。

```text
http://localhost:8787
```

起動:

```bash
npm run dev:cloudflare
```

またはNodeランタイムで確認:

```bash
npm run dev:node
```

ブラウザで `http://localhost:8787` を開き、Googleログイン、活動一覧、回答保存、管理者機能を確認する。

### Level 4: Cloudflare上での限定確認

本番相当のCloudflare Workersへデプロイして確認する。URL自体はインターネットから到達可能になるが、アプリデータはGoogleログインとサーバー側権限判定で保護される。

```bash
npm run deploy
```

Cloudflare Secretsを設定する:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY
wrangler secret put SHEET_ID
wrangler secret put CALENDAR_ID
wrangler secret put ADMIN_EMAILS
wrangler secret put ALLOWED_ORIGINS
```

Google OAuth ClientのAuthorized JavaScript originsにCloudflareのURLを追加する。

## 公開前チェック

- `ADMIN_EMAILS` が管理者本人だけになっている
- `Members` シートにテスト保護者だけが登録されている
- `.env` と `.dev.vars` がGit管理されていない
- GitHub Actionsが成功している
- Google Sheetsと共有CalendarのService Account共有が編集者になっている
- 保護者に案内するURLをまだ配布していない

## Cloudflareに寄せる理由

- 自宅回線やRaspberry Piの稼働状態に依存しない
- HTTPS、Secrets、デプロイをCloudflareに任せられる
- Free枠から始められる
- 運用委譲時にGitHub、Cloudflare、Google Cloudの権限を渡しやすい

