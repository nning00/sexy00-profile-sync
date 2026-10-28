import Link from "next/link";
import { login } from "./actions";

const messages: Record<string, string> = {
  missing: "請輸入電子信箱與密碼。",
  invalid: "登入資料不正確，請重新確認。",
  unauthorized: "這個帳號沒有後台管理權限。",
};

export const metadata = { title: "後台登入", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <Link className="brand" href="/"><span className="brand-mark">N</span><span>新站內容管理</span></Link>
        <p className="eyebrow">CONTENT MANAGEMENT</p>
        <h1>後台登入</h1>
        <p>登入後即可管理形象卡、相簿、城市分類、熱門文章與 SEO。</p>
        {error && <div className="admin-error">{messages[error] ?? "登入時發生錯誤。"}</div>}
        <form action={login}>
          <label>電子信箱<input type="email" name="email" autoComplete="email" required /></label>
          <label>密碼<input type="password" name="password" autoComplete="current-password" required /></label>
          <button className="button primary" type="submit">登入管理後台</button>
        </form>
        <Link className="admin-back" href="/">← 返回網站首頁</Link>
      </section>
    </main>
  );
}
