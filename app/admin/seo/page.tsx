import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/supabase/require-admin";

type Profile = { id: string; slug: string; display_name: string; seo_title: string | null; seo_description: string | null };
type Article = { id: string; slug: string; title: string; status: string; seo_title: string | null; seo_description: string | null };
type Category = { id: string; slug: string; name: string; published: boolean; seo_title: string | null; seo_description: string | null };
type City = { id: string; slug: string; name: string; summary: string | null; seo_title: string | null; seo_description: string | null; region_id: string; published: boolean };
type Region = { id: string; name: string };
type Setting = { key: string; value: unknown };
type Issue<T> = { item: T; reason: string; value?: string };

function clean(value: string | null | undefined) { return (value ?? "").trim(); }
function fingerprint(value: string | null | undefined) { return clean(value).normalize("NFKC").toLocaleLowerCase("zh-Hant").replace(/[\s｜|・·,，。!！?？:：;；/／\-–—_()（）【】「」『』]/g, ""); }
function duplicateGroups<T>(items: T[], valueOf: (item: T) => string | null) { const groups = new Map<string, T[]>(); for (const item of items) { const value = fingerprint(valueOf(item)); if (!value) continue; groups.set(value, [...(groups.get(value) ?? []), item]); } return [...groups.values()].filter((group) => group.length > 1).sort((a, b) => b.length - a.length); }
function textReason(value: string | null | undefined) { const text = clean(value); if (!text) return ""; if (/\b(secret|undefined|null)\b/i.test(text)) return "含有不應出現的英文或程式文字"; if (/度假度假/.test(text)) return "含有重複詞「度假度假」"; if (/^整收錄/.test(text)) return "疑似錯字「整收錄」"; if (/�/.test(text)) return "含有亂碼字元"; return ""; }
function looksLikeKeywordList(value: string | null | undefined) { const text = clean(value); return text.split(/\s+/).length >= 7 && !/[，。！？；、,.!?;]/.test(text); }
function flattenDuplicateIssues<T>(groups: T[][], valueOf: (item: T) => string | null) { return groups.flatMap((group, index) => group.map((item) => ({ item, reason: `重複群組 ${index + 1}`, value: clean(valueOf(item)) }))); }
function settingObject(settings: Setting[], key: string) { const value = settings.find((item) => item.key === key)?.value; return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

export const metadata: Metadata = { title: { absolute: "SEO 健康檢查｜網站後台" }, robots: { index: false, follow: false } };

export default async function AdminSeoPage() {
  const { supabase } = await requireAdmin();
  const [{ data: articleRows }, { data: categoryRows }, { data: cityRows }, { data: regionRows }, { data: settingRows }] = await Promise.all([
    supabase.from("articles").select("id,slug,title,status,seo_title,seo_description"),
    supabase.from("article_categories").select("id,slug,name,published,seo_title,seo_description"),
    supabase.from("cities").select("id,slug,name,summary,seo_title,seo_description,region_id,published"),
    supabase.from("regions").select("id,name"),
    supabase.from("site_settings").select("key,value").in("key", ["brand", "seo"]),
  ]);
  const profileRows: Profile[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,slug,display_name,seo_title,seo_description")
      .eq("status", "published")
      .range(start, start + pageSize - 1);
    if (error) throw error;
    profileRows.push(...((data ?? []) as Profile[]));
    if ((data?.length ?? 0) < pageSize) break;
  }

  const profiles = profileRows;
  const articles = (articleRows ?? []) as Article[];
  const categories = (categoryRows ?? []) as Category[];
  const cities = (cityRows ?? []) as City[];
  const regions = (regionRows ?? []) as Region[];
  const settings = (settingRows ?? []) as Setting[];
  const regionIds = new Set(regions.map((region) => region.id));
  const brandName = String(settingObject(settings, "brand").name || "範例品牌");
  const defaultSeo = settingObject(settings, "seo");

  const profileTitleDuplicates = flattenDuplicateIssues(duplicateGroups(profiles, (item) => item.seo_title), (item) => item.seo_title);
  const profileDescriptionDuplicates = flattenDuplicateIssues(duplicateGroups(profiles, (item) => item.seo_description), (item) => item.seo_description);
  const articleTitleDuplicates = flattenDuplicateIssues(duplicateGroups(articles.filter((item) => item.status === "published"), (item) => item.seo_title), (item) => item.seo_title);
  const articleDescriptionDuplicates = flattenDuplicateIssues(duplicateGroups(articles.filter((item) => item.status === "published"), (item) => item.seo_description), (item) => item.seo_description);
  const categoryTitleDuplicates = flattenDuplicateIssues(duplicateGroups(categories.filter((item) => item.published), (item) => item.seo_title), (item) => item.seo_title);
  const cityTitleDuplicates = flattenDuplicateIssues(duplicateGroups(cities.filter((item) => item.published && regionIds.has(item.region_id)), (item) => item.seo_title), (item) => item.seo_title);

  const incompleteProfiles: Issue<Profile>[] = profiles.filter((item) => !clean(item.seo_title) || !clean(item.seo_description)).map((item) => ({ item, reason: !clean(item.seo_title) ? "缺少 SEO 標題" : "缺少 SEO 描述" }));
  const incompleteArticles: Issue<Article>[] = articles.filter((item) => item.status === "published" && (!clean(item.seo_title) || !clean(item.seo_description))).map((item) => ({ item, reason: !clean(item.seo_title) ? "缺少 SEO 標題" : "缺少 SEO 描述" }));
  const incompleteCategories: Issue<Category>[] = categories.filter((item) => item.published && (!clean(item.seo_title) || !clean(item.seo_description))).map((item) => ({ item, reason: !clean(item.seo_title) ? "缺少 SEO 標題" : "缺少 SEO 描述" }));
  const incompleteCities: Issue<City>[] = cities.filter((item) => item.published && regionIds.has(item.region_id) && (!clean(item.summary) || !clean(item.seo_title) || !clean(item.seo_description))).map((item) => ({ item, reason: !clean(item.summary) ? "缺少城市介紹" : !clean(item.seo_title) ? "缺少 SEO 標題" : "缺少 SEO 描述" }));
  const orphanCities: Issue<City>[] = cities.filter((item) => !regionIds.has(item.region_id)).map((item) => ({ item, reason: `所屬專區不存在（${item.region_id}）` }));

  const textIssues: Array<Issue<Profile | Article | Category | City> & { href: string; label: string }> = [];
  for (const item of profiles) for (const value of [item.seo_title, item.seo_description]) { const reason = textReason(value); if (reason) textIssues.push({ item, reason, value: clean(value), href: `/admin/profiles/${item.id}/edit`, label: item.display_name }); }
  for (const item of articles) for (const value of [item.seo_title, item.seo_description]) { const reason = textReason(value); if (reason) textIssues.push({ item, reason, value: clean(value), href: `/admin/articles/${item.id}/edit`, label: item.title }); }
  for (const item of categories) for (const value of [item.seo_title, item.seo_description]) { const reason = textReason(value); if (reason) textIssues.push({ item, reason, value: clean(value), href: "/admin/settings#article-categories", label: item.name }); }
  for (const item of cities) for (const value of [item.summary, item.seo_title, item.seo_description]) { const reason = textReason(value); if (reason) textIssues.push({ item, reason, value: clean(value), href: regionIds.has(item.region_id) ? `/admin/regions/${item.region_id}/edit` : "/admin/regions", label: item.name }); }

  const weakProfiles: Issue<Profile>[] = profiles.flatMap((item) => {
    const issues: Issue<Profile>[] = [];
    const seoTitle = clean(item.seo_title);
    if (seoTitle && seoTitle.length < 8) issues.push({ item, reason: "SEO 標題過度簡略，建議加入城市、公開名稱或特徵", value: seoTitle });
    if (looksLikeKeywordList(item.seo_description)) issues.push({ item, reason: "SEO 描述像關鍵字清單，建議改成自然完整句", value: clean(item.seo_description) });
    return issues;
  });
  const escapedBrand = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const categoryBrandPattern = new RegExp(`(?:[-–—｜|]\\s*)?${escapedBrand}\\s*$`, "i");
  const categoryBrandIssues: Issue<Category>[] = categories.filter((item) => categoryBrandPattern.test(clean(item.seo_title))).map((item) => ({ item, reason: `標題已包含「${brandName}」，前台還會自動附加一次`, value: clean(item.seo_title) }));
  const defaultSeoIssues = [!clean(String(defaultSeo.default_title ?? "")) ? "缺少全站預設 SEO 標題" : "", !clean(String(defaultSeo.default_description ?? "")) ? "缺少全站預設 SEO 描述" : ""].filter(Boolean);

  const duplicateCount = profileTitleDuplicates.length + profileDescriptionDuplicates.length + articleTitleDuplicates.length + articleDescriptionDuplicates.length + categoryTitleDuplicates.length + cityTitleDuplicates.length;
  const incompleteCount = incompleteProfiles.length + incompleteArticles.length + incompleteCategories.length + incompleteCities.length + defaultSeoIssues.length;
  const qualityCount = textIssues.length + weakProfiles.length + categoryBrandIssues.length;
  const issueCount = duplicateCount + incompleteCount + qualityCount + orphanCities.length;

  return <main className="admin-page admin-seo-page">
    <div className="admin-subheader"><div><Link href="/admin">← 後台首頁</Link><h1>SEO 健康檢查</h1><p>同時檢查缺漏、重複、錯字、關鍵字堆疊、品牌重複與孤立舊資料；不會自動更改前台內容。</p></div></div>
    <section className="seo-health-summary" aria-label="SEO 檢查摘要">
      <article><span>已發布形象</span><strong>{profiles.length}</strong></article>
      <article><span>重複欄位筆數</span><strong>{duplicateCount}</strong></article>
      <article><span>文字品質警示</span><strong>{qualityCount}</strong></article>
      <article><span>孤立舊城市</span><strong>{orphanCities.length}</strong></article>
      <article className={issueCount ? "has-warning" : "is-healthy"}><span>待改善項目</span><strong>{issueCount}</strong></article>
    </section>
    <SeoSection title="疑似錯字或異常文字" description="檢查中英文字誤植、重複詞、程式文字與亂碼。" count={textIssues.length}>{textIssues.map((issue, index) => <IssueLink key={`${issue.href}-${index}`} href={issue.href} label={issue.label} reason={issue.reason} value={issue.value} />)}</SeoSection>
    <SeoSection title="形象描述品質" description="標題不應只有過度簡略的通用詞，描述也不應只是大量堆疊地名或關鍵字。" count={weakProfiles.length}>{weakProfiles.map((issue, index) => <IssueLink key={`${issue.item.id}-${index}`} href={`/admin/profiles/${issue.item.id}/edit`} label={issue.item.display_name} reason={issue.reason} value={issue.value} />)}</SeoSection>
    <SeoSection title="形象 SEO 重複" description="直接比較後台原始標題與描述，避免每位形象使用同一組關鍵字。" count={profileTitleDuplicates.length + profileDescriptionDuplicates.length}>{[...profileTitleDuplicates, ...profileDescriptionDuplicates].map((issue, index) => <IssueLink key={`${issue.item.id}-${index}`} href={`/admin/profiles/${issue.item.id}/edit`} label={issue.item.display_name} reason={issue.reason} value={issue.value} />)}</SeoSection>
    <SeoSection title="文章 SEO 重複" description="僅檢查已發布文章；每篇文章應有不同的搜尋主題與摘要。" count={articleTitleDuplicates.length + articleDescriptionDuplicates.length}>{[...articleTitleDuplicates, ...articleDescriptionDuplicates].map((issue, index) => <IssueLink key={`${issue.item.id}-${index}`} href={`/admin/articles/${issue.item.id}/edit`} label={issue.item.title} reason={issue.reason} value={issue.value} />)}</SeoSection>
    <SeoSection title="文章分類 SEO 問題" description="分類頁不得重複品牌名稱，也應避免彼此使用相同標題。" count={categoryBrandIssues.length + categoryTitleDuplicates.length + incompleteCategories.length}>{[...categoryBrandIssues, ...categoryTitleDuplicates, ...incompleteCategories].map((issue, index) => <IssueLink key={`${issue.item.id}-${index}`} href="/admin/settings#article-categories" label={issue.item.name} reason={issue.reason} value={issue.value} />)}</SeoSection>
    <SeoSection title="城市資料問題" description="檢查城市內容缺漏、標題重複及所屬專區已不存在的舊資料。" count={incompleteCities.length + cityTitleDuplicates.length + orphanCities.length}>{[...incompleteCities, ...cityTitleDuplicates].map((issue, index) => <IssueLink key={`${issue.item.id}-${index}`} href={`/admin/regions/${issue.item.region_id}/edit`} label={issue.item.name} reason={issue.reason} value={issue.value} />)}{orphanCities.map((issue) => <IssueLink key={issue.item.id} href="/admin/regions" label={issue.item.name} reason={issue.reason} value={`網址代稱：${issue.item.slug}`} />)}</SeoSection>
    <SeoSection title="SEO 欄位缺漏" description="已發布形象、文章與全站預設設定都應具有 SEO 標題及描述。" count={incompleteProfiles.length + incompleteArticles.length + defaultSeoIssues.length}>{incompleteProfiles.map((issue) => <IssueLink key={issue.item.id} href={`/admin/profiles/${issue.item.id}/edit`} label={issue.item.display_name} reason={issue.reason} />)}{incompleteArticles.map((issue) => <IssueLink key={issue.item.id} href={`/admin/articles/${issue.item.id}/edit`} label={issue.item.title} reason={issue.reason} />)}{defaultSeoIssues.map((reason) => <IssueLink key={reason} href="/admin/settings" label="全站預設 SEO" reason={reason} />)}</SeoSection>
  </main>;
}

function IssueLink({ href, label, reason, value }: { href: string; label: string; reason: string; value?: string }) { return <Link href={href}><span><strong>{label}</strong><small>{reason}{value ? ` · ${value}` : ""}</small></span><b>前往處理 →</b></Link>; }
function SeoSection({ title, description, count, children }: { title: string; description: string; count: number; children: React.ReactNode }) { return <details className="seo-health-section" open={count > 0}><summary><span><strong>{title}</strong><small>{description}</small></span><i>{count}</i></summary><div className="seo-health-list">{count ? children : <p>目前沒有發現這類問題。</p>}</div></details>; }
