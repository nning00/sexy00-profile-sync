import Link from "next/link";
import OptimizedMediaImage from "@/components/OptimizedMediaImage";
import { mediaUrl } from "@/lib/cms";
import { parseProfileDetails } from "@/lib/profile-details";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { verifyAdultProfile } from "./actions";
import VerifyAllAdultProfiles from "./VerifyAllAdultProfiles";

export default async function AdultReviewPage({ searchParams }: { searchParams: Promise<{ verified?: string; verified_all?: string; error?: string }> }) {
  const { verified = "", verified_all = "", error = "" } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,slug,display_name,introduction,card_image_path,source_url,source_last_seen_at,profile_cities(cities(name))")
    .eq("source_provider", "edc-public-catalog")
    .eq("adult_review_status", "pending")
    .order("source_last_seen_at", { ascending: false });

  return <main className="admin-page admin-adult-review-page">
    <div className="admin-subheader">
      <div><Link href="/admin/profiles">← 返回形象列表</Link><h1>待確認成年資料</h1><p>來源未公開年齡的資料只保存在後台，不會出現在前台。請確認本人已滿 18 歲後再發布。</p></div>
      <div className="admin-review-count"><span>待確認</span><strong>{profiles?.length ?? 0}</strong></div>
    </div>
    {verified && <div className="admin-success">已確認成年並發布 1 筆資料。</div>}
    {verified_all && <div className="admin-success">已一鍵確認成年並發布 {verified_all} 筆資料。</div>}
    {(error || profileError) && <div className="admin-error">{error || profileError?.message}</div>}
    <div className="admin-review-notice"><strong>確認原則</strong><p>缺少身高、體重等資料不影響發布；只有成年身分需要先確認。請勿依外貌推測，也不要填入虛構年齡。</p></div>
    {!!profiles?.length && <VerifyAllAdultProfiles profileIds={profiles.map((profile) => profile.id)} />}
    <section className="admin-review-grid">
      {(profiles ?? []).map((profile) => {
        const details = parseProfileDetails(profile.introduction);
        const cityNames = (profile.profile_cities ?? []).flatMap((assignment) => {
          const city = assignment.cities as unknown as { name?: string } | null;
          return city?.name ? [city.name] : [];
        });
        return <article className="admin-review-card" key={profile.id}>
          <div className="admin-review-image">
            {profile.card_image_path
              ? <OptimizedMediaImage src={mediaUrl(profile.card_image_path)} alt={`${profile.display_name}待確認形象照片`} fill sizes="(max-width: 720px) 100vw, 280px" />
              : <span>尚無圖片</span>}
          </div>
          <div className="admin-review-content">
            <div><p className="eyebrow">{cityNames.join("、") || "尚未分類"}</p><h2>{profile.display_name}</h2></div>
            <dl>
              <div><dt>來源年齡</dt><dd>{details.age || "未公開"}</dd></div>
              <div><dt>身高</dt><dd>{details.height || "未提供"}</dd></div>
              <div><dt>體重</dt><dd>{details.weight || "未提供"}</dd></div>
              <div><dt>罩杯</dt><dd>{details.cup || "未提供"}</dd></div>
            </dl>
            <div className="admin-review-actions">
              {profile.source_url && <a href={profile.source_url} target="_blank" rel="noopener noreferrer">查看來源資料</a>}
              <Link href={`/admin/profiles/${profile.id}/edit`}>查看完整內容</Link>
              <form action={verifyAdultProfile}>
                <input name="profile_id" type="hidden" value={profile.id} />
                <button type="submit">確認已滿 18 歲並發布</button>
              </form>
            </div>
          </div>
        </article>;
      })}
      {!profiles?.length && !profileError && <div className="admin-review-empty"><h2>目前沒有待確認資料</h2><p>下一次來源同步後，年齡未公開的資料會自動出現在這裡。</p></div>}
    </section>
  </main>;
}
