# Hosting Decision

## 結論

できる限り低コストで、かつ保護者向けに安定して運用する前提では、MVPの第一候補はCloudflare Workers Free構成にする。

Raspberry Piは、開発・検証・一時的な退避先として残す。日常の動作確認はMacBook ProまたはAIエージェントのサンドボックスで行い、運用が固まった後にクラウドへ委譲しやすいよう、Node.js/Dockerでも同じアプリを動かせる構成にしておく。

## Cloudflareを第一候補にする理由

- 月額0円から始められる
- 静的アセット配信が無料扱いで、アプリの画面表示コストを抑えやすい
- Worker Freeの上限内で、チーム活動管理程度のAPIアクセスなら十分余裕がある
- HTTPS、公開URL、デプロイ、Secrets管理をCloudflare側に任せられる
- 自宅回線、停電、SDカード故障、PiのOS更新に左右されない
- 将来クラウド運用へ委譲するときに、そのまま引き継ぎやすい

## Raspberry Piを第一候補にしない理由

- 電気代は小さいがゼロではない
- 停電、再起動、ネット断、ルーター不調の影響を受ける
- OS、Docker、セキュリティアップデート、ログ監視が必要
- 自宅公開にはCloudflare Tunnel等がほぼ必要で、結局Cloudflareの運用要素が残る
- 保護者向けアプリでは、低頻度でも「必要なときに開けない」影響が大きい

## Raspberry Piを使う場面

- MacBook Proだけでは足りない長時間検証
- Google OAuth、Sheets、Calendar連携の動作確認
- Cloudflare Workersに移す前の暫定デモ
- Cloudflare側で一時障害や設定待ちがある場合の退避先

## 推奨ステップ

1. Cloudflare Workers FreeでMVPを公開する
2. MacBook ProまたはAIエージェントのサンドボックスでローカル検証する
3. 利用状況を見て、無料枠を超えそうならWorkers StandardやVPSを検討する
4. 運用委譲時は、GitHub repo、Cloudflare project、Google Cloud project、Sheets/Calendar権限を整理して渡す
