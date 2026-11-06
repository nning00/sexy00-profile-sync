import { requireAdmin } from "@/lib/supabase/require-admin";
import MediaIsolation from "@/components/admin/MediaIsolation";

export const metadata = { title: "圖片獨立化｜sexy00.cc 後台", robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdmin();
  return <main id="main-content" style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}><h1>sexy00.cc 圖片獨立化</h1><p>只讀取原站圖片；複製到 sexy00 專案、校驗內容並備份引用後才更新。本操作不修改或刪除原站資料。</p><MediaIsolation /></main>;
}
