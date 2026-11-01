# Supabase → Notion 行程同步

## 部署 Worker

使用現有 Cloudflare 專案部署（保留既有環境變數）：

```powershell
npx wrangler deploy
```

入口為 worker.js，會一起打包 notion-sync.js；不可只將 worker.js 貼上網頁編輯器。

在 Cloudflare 設定這些變數：

- Secret `NOTION_TOKEN`：Notion 內部連接權杖。
- Text `NOTION_DATA_SOURCE_ID`：`40ab7eb5-80a0-805d-8bf2-000b35e766b8`。
- Secret `NOTION_SYNC_SECRET`：自行使用密碼管理器產生至少 32 字元隨機字串，與 Notion Token 不同。
- 沿用既有 `SUPABASE_URL` 與 Supabase API Key。
- 選用 `NOTION_TIME_ZONE`：預設 `Asia/Taipei`，用於全天行程日期。

Notion 連接須有行程資料庫的讀取、新增、更新權限。
Supabase API Key 必須可讀取所有要同步的行程；RLS 只允許讀到部分資料時也只會同步該部分。

## 設定 Supabase Database Webhook

在 Supabase 專案的 **Integrations → Webhooks** 建立 Database Webhook。你截圖中的 Database 選單沒有 Webhooks，請不要在 Schema Visualizer 或 Triggers 裡找。也可直接開啟 [Supabase Webhooks](https://supabase.com/dashboard/project/_/integrations/webhooks/overview)；確認頁面左上選到部署此 Worker 所使用的同一個 Supabase 專案。

Webhook 只會同步建立後收到的資料異動；建立前已存在的行程不會自動補上，請接著執行「補同步現有行程」。

| 設定 | 值 |
|---|---|
| 名稱 | calendar_events_to_notion |
| Schema / Table | public / calendar_events |
| Events | INSERT、UPDATE |
| Type / Method | HTTP Request / POST |
| URL | https://restless-cherry-3164.dennis866.workers.dev/api/notion/webhook |
| Header: Content-Type | application/json |
| Header: Authorization | Bearer 加一個空格，再接 NOTION_SYNC_SECRET 的值 |
| Timeout | 盡可能設為 30000 ms |

不勾 DELETE：此版本不會將刪除傳到 Notion。也不用設定 Notion 開發者頁面的 Webhook。

## 補同步現有行程

在本專案 PowerShell 執行：

```powershell
.\sync-notion.ps1
```

依提示輸入 NOTION_SYNC_SECRET。每批最多 5 筆，以 ID 游標分頁。
若電腦的執行原則禁止本地腳本，可檢視腳本後以 `powershell -ExecutionPolicy Bypass -File .\sync-notion.ps1` 執行單次程序。
失敗批次最多重試三次；已成功建立的項目依 Supabase ID 查找後更新。

## 驗證與限制

新增一筆測試行程，確認 Notion 出現相同 Supabase ID；再直接於 Supabase 修改名稱，確認 Notion 原項目被更新。
此版本不寫回 Supabase，不變更原本新增行程 API，也不在前端存放同步密鑰。
Webhook 會重新讀取 Supabase 當前資料，避免通知延遲直接覆蓋成過期的 payload。
Notion 的 Supabase ID 查詢不是原子唯一約束：同一筆行程的並行首次通知可能產生重複，請避免同時補同步與大量寫入。高並行正式環境應另加按行程序列化的佇列或 Durable Object。
Webhook 失敗會回傳非 2xx；沒有持久自動重試佇列，請在 Supabase Webhook / pg_net 紀錄檢查失敗，修正後重新執行補同步。
Notion 頁面 ID 未寫回 Supabase，以 Notion 的 Supabase ID 欄位維持對應。

參考：
- https://supabase.com/docs/guides/database/webhooks
- https://developers.notion.com/reference/query-a-data-source
