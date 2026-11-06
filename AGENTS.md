# sexy00.cc 專案隔離規則

- 本目錄只供 `sexy00.cc` 使用。
- Git remote 必須為 `https://github.com/nning00/sexy00-profile-sync.git`。
- 部署 Worker 僅限 `sexy00-site`；Supabase 寫入目標僅限 `kkxsclcqdxoiqucunpur`。
- 每次寫入或部署前，重新核對 remote、分支、Worker 名稱與 Supabase 專案 ID。
- 不得因修復本網站而修改、刪除或部署 sexyning、sexytw、18ning 的資源。
- 跨站圖片獨立化只能讀取來源，先複製到本專案再驗證及更新本專案引用；不得刪除來源圖片。
- 舊 sexy00 worktree 保留作歷史，未經檢查不得移除其母 Git 目錄。
- 不將私密金鑰、登入資訊、環境檔、正式內容備份加入 Git。
- 本機使用環境範例，不從其他網站複製真實環境密鑰。
