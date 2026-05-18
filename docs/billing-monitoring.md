# Billing Monitoring

本番公開前に、CloudflareとGoogle Cloudの両方で課金監視を設定する。

このアプリの初期構成は低コスト運用を前提にしている。Cloudflare側はWorkersと静的Assetsだけを使い、D1、KV、R2、Queues、AI、Vectorize、Containersは使わない。Google Cloud側はSheets API、Calendar API、OAuthだけを使い、GCP上に常時稼働リソースを置かない。

## Cloudflare

公式: https://developers.cloudflare.com/billing/manage/budget-alerts/

### 監視対象

- Workers requests
- Workers CPU time
- Workers Logs
- Cloudflare account-wide usage-based spend

### 推奨設定

1. Cloudflare Dashboardを開く
2. 対象アカウントを選ぶ
3. `Manage Account > Billing > Billable Usage` を開く
4. `Create budget alert` を作る
5. まずは低い閾値で通知する
   - 可能なら `$1`
   - 追加で `$5`
   - 本格運用後に実利用を見て調整

Budget alertはメール通知で、使用量ベースの請求が閾値を超えたときに検知する。ハードキャップではないため、想定外のアクセスが増えた場合はWorkerを一時停止するか、認証・ルート・アクセス制御を見直す。

### 本アプリで避けること

- Cloudflare Paid planへ切り替える前に相談なしで有料機能を追加しない
- D1、KV、R2、Queues、AI、Vectorize、Containersを追加しない
- Workers Logpushや外部ログ転送を有効にしない
- Cron Triggerを高頻度で追加しない

## Google Cloud

公式: https://cloud.google.com/billing/docs/how-to/budgets

### 監視対象

- アプリ用Google Cloud Project
- Cloud Billing account
- Sheets API
- Calendar API
- OAuth consent / OAuth client周辺

### 推奨設定

1. Google Cloud Consoleで対象Projectを選ぶ
2. `Billing > Budgets & alerts` を開く
3. 月次Budgetを作る
4. Scopeは、可能ならアプリ用Projectだけに絞る
5. 閾値を低めに設定する
   - 50%
   - 90%
   - 100%
6. 通知先メールが普段見るアドレスになっていることを確認する

Google CloudのBudget alertもハードキャップではない。想定外の課金を避けるには、不要なAPIを有効化しない、APIキーを作らない、サービスアカウント鍵を漏らさない、プロジェクトをこのアプリ専用に分ける。

## 公開前チェック

- Cloudflare Budget alertが1つ以上ある
- Google Cloud Budget alertが1つ以上ある
- CloudflareのWorkerに不要な有料バインディングがない
- Google Cloud Projectで不要なAPIが有効化されていない
- Cloudflare billing emailが受信できる
- Google Cloud billing alert emailが受信できる
- `DEMO_MODE` は本番Secretに設定しない
