import Link from "next/link";
import OptimizedMediaImage from "@/components/OptimizedMediaImage";
import { mediaUrl } from "@/lib/cms";
import { parseProfileDetails } from "@/lib/profile-details";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { stageAdultProfile } from "./actions";
import PublishAdultProfiles from "./PublishAdultProfiles";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE=30;
export default async function AdultReviewPage({ searchParams }: { searchParams: Promise<{ staged?: string; page?: string; error?: string }> }) {
  const { staged = "", page = "1", error = "" } = await searchParams;
  const pageNumber=/^\d{1,4}$/.test(page) ? Math.max(1,Number(page)) : 1;
  const { supabase } = await requireAdmin();
  const receiptDb=createAdminClient();
  const [receipts,boundReceipts]=await Promise.all([
    receiptDb.from("adult_verification_receipts").select("source_key",{count:"exact",head:true}),
    receiptDb.from("adult_verification_receipts").select("source_key",{count:"exact",head:true}).eq("evidence_state","bound").eq("evidence_version",2).is("revoked_at",null),
  ]);
  const { data: profiles, error: profileError, count } = await supabase
    .from("profiles")
    .select("id,display_name,introduction,card_image_path,source_url,updated_at,profile_cities(cities(name))",{count:"exact"})
    .eq("source_provider", "edc-public-catalog")
    .eq("adult_review_status", "pending")
    .eq("status","draft")
    .order("source_last_seen_at", { ascending: false }).order("id")
    .range((pageNumber-1)*PAGE_SIZE,pageNumber*PAGE_SIZE-1);
  const ready:{id:string;version:string;name:string;slug:string}[]=[];
  let readyError=false;
  for(let offset=0;offset<10000;offset+=200){
    const result=await receiptDb.from("profiles")
      .select("id,slug,display_name,updated_at,source_content_hash,adult_verified_by,adult_verified_at,adult_verification_receipts(content_hash,verified_by,verified_at,revoked_at,evidence_state,evidence_version)")
      .eq("source_provider","edc-public-catalog").eq("status","draft").eq("adult_review_status","verified").eq("adult_publish_hold",true)
      .order("id").range(offset,offset+199);
    if(result.error || !result.data){readyError=true;break;}
    for(const row of result.data){
      const bound=row.adult_verification_receipts.some(receipt=>!receipt.revoked_at && receipt.evidence_state==="bound" &&
        receipt.evidence_version===2 && receipt.content_hash===row.source_content_hash && receipt.verified_by===row.adult_verified_by && receipt.verified_at===row.adult_verified_at);
      if(bound)ready.push({id:row.id,version:row.updated_at,name:row.display_name,slug:row.slug});
    }
    if(result.data.length<200)break;
    if(offset===9800)readyError=true;
  }

  return <main className="admin-page admin-adult-review-page">
    <div className="admin-subheader">
      <div><Link href="/admin/profiles">← 返回形象列表</Link><h1>待確認成年資料</h1><p>來源未公開年齡的資料只保存在後台，不會出現在前台。請確認本人已滿 18 歲後再發布。</p></div>
      <div className="admin-review-count"><span>待確認</span><strong>{count ?? 0}</strong></div>
    </div>
    {staged === "1" && <div className="admin-success">已保存成年確認，仍未上架。請在「已確認成年，待上架」勾選發布。</div>}
    {(error || profileError) && <div className="admin-error">{error || profileError?.message}</div>}
    <div className="admin-review-notice"><strong>成年確認與資料清理</strong><p>缺少身高、體重等資料不影響發布；只有成年身分需要先確認。請勿依外貌推測，也不要填入虛構年齡。</p><p>成年確認紀錄與形象資料連動：暫時下架或封存期間保留，永久刪除形象時一併清除，不另行永久留存。人物永久刪除後若重新匯入，會重新依來源年齡或人工確認判斷，不沿用已清除的確認紀錄。</p><p>封存期間重新出現的同一筆形象，只有來源、完整資料與照片指紋吻合才可沿用確認；同名、資料或照片變更，以及證據不足時仍需重新確認。這不是證件驗證，也不會使用人臉辨識。</p><p>{receipts.error || boundReceipts.error ? "確認紀錄統計暫時無法讀取，請稍後重新整理。" : `目前記錄 ${receipts.count ?? 0} 筆人工確認，其中 ${boundReceipts.count ?? 0} 筆具備完整照片比對依據；永久刪除對應形象時會一起清除。`}</p></div>
    {readyError ? <p className="admin-error">無法完整讀取待上架資料，請重新整理後再試。</p> : <PublishAdultProfiles rows={ready} />}
    <h2>尚待成年確認</h2>
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
              <div><dt>身高</dt><dd>{details.height || "未提供"}</dd></div>
              <div><dt>體重</dt><dd>{details.weight || "未提供"}</dd></div>
              <div><dt>罩杯</dt><dd>{details.cup || "未提供"}</dd></div>
            </dl>
            <div className="admin-review-actions">
              {profile.source_url && <a href={profile.source_url} target="_blank" rel="noopener noreferrer">查看來源資料</a>}
              <Link href={`/admin/profiles/${profile.id}/edit`}>查看完整內容</Link>
              <form action={stageAdultProfile}>
                <input name="profile_id" type="hidden" value={profile.id} />
                <input name="version" type="hidden" value={profile.updated_at} />
                <label className="admin-check-row"><input name="adult_confirmed" type="checkbox" required />我已查核這筆資料的成年證明</label>
                <button type="submit">保存已滿 18 歲確認（不發布）</button>
              </form>
            </div>
          </div>
        </article>;
      })}
      {!profiles?.length && !profileError && <div className="admin-review-empty"><h2>這一頁沒有待確認資料</h2></div>}
    </section>
    <nav className="admin-review-pagination" aria-label="待確認資料分頁">
      {pageNumber>1 && <Link href={`?page=${pageNumber-1}`}>上一頁</Link>}
      <span>第 {pageNumber} 頁</span>
      {pageNumber*PAGE_SIZE<(count??0) && <Link href={`?page=${pageNumber+1}`}>下一頁</Link>}
    </nav>
  </main>;
}
