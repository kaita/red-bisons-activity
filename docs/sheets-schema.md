# Google Sheets Schema

既存の `活動スケジュール` と `情報` タブは残し、アプリ用に以下の構造化タブを追加します。

## Members

| Column | Description |
| --- | --- |
| id | `member_...` 形式のID |
| playerName | 選手名 |
| grade | 学年 |
| familyName | 家庭名 |
| displayName | アプリ表示名 |
| parentEmails | 保護者Googleメール。複数の場合はカンマ区切り |
| calendarEmail | 子ども/家庭カレンダー用メール。MVPでは任意 |
| active | `true` / `false` |

## Activities

| Column | Description |
| --- | --- |
| id | `activity_...` 形式のID |
| date | `YYYY-MM-DD` |
| startTime | `HH:MM` |
| endTime | `HH:MM` |
| place | 場所 |
| handoverNote | 引き継ぎ |
| status | `公開` / `下書き` / `中止` |
| requiredAdults | 見守り必要人数 |
| watchTimeUnitMinutes | 見守り可視化の時間単位 |
| calendarEventId | 共有Googleカレンダー予定ID |
| calendarSyncStatus | 同期状態 |
| updatedAt | ISO日時 |
| handoverUpdatedByEmail | 引き継ぎを最後に更新した管理者メール。画面/APIには表示しない |
| handoverUpdatedByName | 引き継ぎを最後に更新した管理者表示名 |
| handoverUpdatedAt | 引き継ぎを最後に更新したISO日時 |

## Responses

| Column | Description |
| --- | --- |
| activityId | 活動ID |
| memberId | 選手ID |
| parentEmail | 最終更新した保護者メール |
| attendanceStatus | `参加` / `欠席` / `未回答` / `未定` |
| canOpen | 鍵開け可否 |
| canClose | 鍵閉め可否 |
| canWatch | 見守り可否 |
| watchStartTime | 見守り開始 `HH:MM` |
| watchEndTime | 見守り終了 `HH:MM` |
| comment | 遅刻早退・引率・共有コメント |
| updatedAt | ISO日時 |

## ActivityComments

| Column | Description |
| --- | --- |
| id | コメントID |
| activityId | 活動ID |
| userEmail | 投稿者メール |
| displayName | 投稿者表示名 |
| body | コメント本文 |
| createdAt | ISO日時 |
| updatedAt | ISO日時 |
