# worker

npm test

node --test worker.test.mjs

# 站台

- 啟動站台
npm start

看到 Local: http://127.0.0.1:3000 後，用瀏覽器開啟 http://127.0.0.1:3000。要停止站台時，在 PowerShell 按 Ctrl+C。

這個啟動方式已設定在 package.json；也可以直接執行 node serve.mjs。站台只會在這台電腦本機提供服務。

教學用三個功能頁：
- 功能 A：http://127.0.0.1:3000/index.html（/api/calendar-events → calendar_events）
- 功能 B：http://127.0.0.1:3000/index-2.html（/api/calendar-events-2 → calendar_events_2）
- 功能 C：http://127.0.0.1:3000/index-3.html（/api/calendar-events-3 → calendar_events_3）

Worker 已拆成三支檔案，方便多人分工避免同改一檔衝突：
- worker-calendar-a.js：功能 A API
- worker-calendar-b.js：功能 B API
- worker-calendar-c.js：功能 C API
- worker.js：僅負責路由分派與 Notion 同步 API

新增 B/C 專用資料表（Supabase SQL Editor 執行）：
- 開啟 [create-teaching-calendar-tables.sql](./create-teaching-calendar-tables.sql)
- 將內容整段貼到 Supabase SQL Editor 後執行

#

https://dash.cloudflare.com/7a42c652c3a4f3e482fcd6de0aa3f344/workers/services/view/restless-cherry-3164/production

https://supabase.com/dashboard/organizations
