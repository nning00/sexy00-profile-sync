# sexy00.cc 本機入口與資源邊界

本機開發目錄：`C:\Users\User\Documents\Codex\sites\sexy00.cc`

## 唯一可寫目標

- GitHub：`nning00/sexy00-profile-sync`，正式分支 `main`
- Cloudflare Worker：`sexy00-site`
- 正式網域：`sexy00.cc`、`www.sexy00.cc`
- Supabase：`kkxsclcqdxoiqucunpur`，專案名稱 `sexy00.cc`
- 圖片桶：`site-media`（私人）
- 維護備份桶：`sexy00-maintenance`（私人，JSON 備份）

本目錄擁有獨立 `.git`，不依賴舊 sexy00 worktree。舊目錄保留作歷史，不要從舊副本部署；不要刪除舊 worktree 的母 Git 目錄。

## 圖片獨立化

管理員入口：`/admin/media-isolation`。寫入受登入、管理員、同來源及目標專案 ID 四層檢查限制。

- 來源僅讀取舊站公開圖片，不持有或使用舊站管理金鑰。
- 每張圖片先複製到 sexy00 私人桶，以 SHA-256 比對下載回來的內容，再備份舊引用，最後條件式更新引用。
- 不刪除或覆蓋來源檔案，失敗時保留有效舊引用。
- 目的物件採來源 URL 雜湊命名，不覆蓋既有目的物件；重跑只處理剩餘外站引用。
- 備份存於 `sexy00-maintenance/maintenance/media-isolation-20261107/`。
- 三筆過時缺圖引用先備份再處理，工具保留恢復入口；目前三張有效來源照片保留。
- 正式圖片檔案不放 Git，備份、金鑰與環境設定值不放 Git。

## 外部排程檢查

同步排程在 `.github/workflows/profile-sync.yml`，設定為每六小時一次；不是 Cloudflare Cron。
2026-11-07 檢查時，最近的同步 run `42217295048` 的資料批次曾成功處理，但最後步驟回應 `Bad Request` 而失敗。
本次圖片隔離不以重跑全量封存來測試，避免擴大資料變動。排程成功狀態須另行修復及驗證，不能把排程存在當成每輪成功。

Cloudflare 的 runtime Secrets 維持原值，不輪替、不拷貝到其他 Worker。已確認兩個正式網域都在 sexy00-site；GA4 公開識別碼與其他三站不同。
