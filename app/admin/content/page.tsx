import Link from "next/link";
import ContentSettingsForm from "@/components/admin/ContentSettingsForm";
import { getContentSettingsUncached } from "@/lib/cms";
import { requireAdmin } from "@/lib/supabase/require-admin";
export default async function ContentPage() { await requireAdmin(); const content = await getContentSettingsUncached(); return <main className="admin-page admin-form-page"><Link href="/admin">← 後台首頁</Link><h1>共用文字與政策模組</h1><p>管理服務卡、FAQ、城市共用提醒、形象頁欄位名稱及政策頁 SEO；城市獨立內容請至「專區、城市內容與 SEO」。</p><ContentSettingsForm initial={content} /></main>; }
