import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { normalizeImagePosition } from "@/lib/image-position";

export type CmsProfile = {
  id: string; slug: string; display_name: string; style: string | null; interest: string | null;
  introduction: string | null; card_image_path: string | null; seo_title: string | null;
  seo_description: string | null; updated_at: string;
  profile_images?: Array<{ storage_path: string; alt_text: string | null; sort_order: number }>;
};

export type CmsProfileIndex = Pick<CmsProfile, "id" | "slug" | "updated_at">;

export type CmsArticle = {
  id: string; slug: string; title: string; excerpt: string | null; category: string | null;
  content: unknown; cover_image_path: string | null; cover_image_alt?: string | null; seo_title: string | null;
  seo_description: string | null; published_at: string | null; updated_at: string;
  category_id?: string | null; is_featured?: boolean; featured_order?: number;
  article_categories?: ArticleCategory | null;
  article_images?: Array<{ id?: string; storage_path: string; alt_text: string | null; sort_order: number }>;
};

export type ArticleCategory = { id: string; name: string; slug: string; sort_order: number; published: boolean; seo_title: string | null; seo_description: string | null };

export function mediaUrl(path: string | null | undefined) {
  if (!path) return "/placeholders/hero.svg";
  if (/^https?:\/\//.test(path) || path.startsWith("/")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/site-media/${path}` : "/placeholders/hero.svg";
}

export function serviceMediaUrl(path: string | null | undefined, fallback: string | null | undefined) {
  // The original template used local demo files that are intentionally not
  // shipped with the clean site. Keep old records working until an editor
  // uploads a dedicated service image.
  if (!path || path.startsWith("/gallery/") || path.startsWith("/placeholders/")) {
    return mediaUrl(fallback);
  }
  return mediaUrl(path);
}

const isVideoMedia = (path: string) => /\.(mp4|webm)(?:\?.*)?$/i.test(path);

export function profileCardPath(profile: Pick<CmsProfile, "card_image_path" | "profile_images">) {
  if (profile.card_image_path) return profile.card_image_path;
  return [...(profile.profile_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .find((item) => !isVideoMedia(item.storage_path))?.storage_path;
}

async function getPublishedProfilesUncached() {
  const supabase = createPublicClient();
  const profiles: CmsProfileIndex[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from("profiles")
      .select("id,slug,updated_at")
      .eq("status", "published")
      .order("sort_order")
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);
    if (error) return [];
    profiles.push(...((data ?? []) as CmsProfileIndex[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return profiles;
}

async function getPublishedProfilesForCityUncached(regionSlug: string, citySlug: string) {
  const supabase = createPublicClient();
  const { data: region } = await supabase.from("regions").select("id").eq("slug", regionSlug).eq("published", true).maybeSingle();
  if (!region) return [] as CmsProfile[];
  const { data: city } = await supabase.from("cities").select("id").eq("region_id", region.id).eq("slug", citySlug).eq("published", true).maybeSingle();
  if (!city) return [] as CmsProfile[];
  const { data, error } = await supabase.from("profile_cities")
    .select("profiles!inner(id,slug,display_name,style,interest,introduction,card_image_path,seo_title,seo_description,updated_at,sort_order,status)")
    .eq("city_id", city.id).eq("profiles.status", "published");
  if (error) return [] as CmsProfile[];
  return (data ?? []).map((row) => row.profiles as unknown as CmsProfile)
    .sort((a, b) => ((a as CmsProfile & { sort_order?: number }).sort_order ?? 0) - ((b as CmsProfile & { sort_order?: number }).sort_order ?? 0));
}

async function getPublishedProfilePageForCityUncached(regionSlug: string, citySlug: string, offset = 0, limit = 24) {
  const supabase = createPublicClient();
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(48, Math.max(1, Math.floor(limit)));
  const { data: region } = await supabase.from("regions").select("id").eq("slug", regionSlug).eq("published", true).maybeSingle();
  if (!region) return { profiles: [] as CmsProfile[], total: 0 };
  const { data: city } = await supabase.from("cities").select("id").eq("region_id", region.id).eq("slug", citySlug).eq("published", true).maybeSingle();
  if (!city) return { profiles: [] as CmsProfile[], total: 0 };
  const { data, error, count } = await supabase.from("profile_cities")
    .select("profiles!inner(id,slug,display_name,style,interest,introduction,card_image_path,seo_title,seo_description,updated_at,sort_order,status)", { count: "exact" })
    .eq("city_id", city.id)
    .eq("profiles.status", "published")
    .order("sort_order", { referencedTable: "profiles" })
    .range(safeOffset, safeOffset + safeLimit - 1);
  if (error) return { profiles: [] as CmsProfile[], total: 0 };
  const profiles = (data ?? []).map((row) => row.profiles as unknown as CmsProfile);
  return { profiles, total: count ?? profiles.length };
}

async function getPublishedProfileUncached(slug: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from("profiles")
    .select("id,slug,display_name,style,interest,introduction,card_image_path,seo_title,seo_description,updated_at,profile_images(storage_path,alt_text,sort_order)")
    .eq("slug", slug).eq("status", "published").maybeSingle();
  if (error || !data) return null;
  const profile = data as CmsProfile;
  profile.profile_images = [...(profile.profile_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return profile;
}

async function getRelatedProfilesUncached(profileId: string, limit = 8) {
  const supabase = createPublicClient();
  const { data: assignments, error: assignmentError } = await supabase.from("profile_cities")
    .select("city_id").eq("profile_id", profileId);
  const cityIds = [...new Set((assignments ?? []).map((item) => item.city_id))];
  if (assignmentError || !cityIds.length) return [] as CmsProfile[];
  const { data, error } = await supabase.from("profile_cities")
    .select("profiles!inner(id,slug,display_name,style,interest,introduction,card_image_path,seo_title,seo_description,updated_at,sort_order,status)")
    .in("city_id", cityIds).neq("profile_id", profileId).eq("profiles.status", "published")
    .limit(Math.max(limit * 2, limit));
  if (error) return [] as CmsProfile[];
  const unique = new Map<string, CmsProfile>();
  for (const row of data ?? []) {
    const related = row.profiles as unknown as CmsProfile;
    if (!unique.has(related.id)) unique.set(related.id, related);
  }
  return [...unique.values()].slice(0, limit);
}

async function getPublishedArticlesUncached(limit?: number) {
  const supabase = createPublicClient();
  let query = supabase.from("articles")
    .select("id,slug,title,excerpt,category,category_id,is_featured,featured_order,content,cover_image_path,cover_image_alt,seo_title,seo_description,published_at,updated_at,article_categories(id,name,slug,sort_order,published,seo_title,seo_description)")
    .eq("status", "published").order("sort_order").order("published_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (!error) return (data ?? []) as unknown as CmsArticle[];
  let legacy = supabase.from("articles").select("id,slug,title,excerpt,category,content,cover_image_path,seo_title,seo_description,published_at,updated_at").eq("status", "published").order("sort_order").order("published_at", { ascending: false });
  if (limit) legacy = legacy.limit(limit);
  const { data: legacyData, error: legacyError } = await legacy;
  return legacyError ? [] as CmsArticle[] : (legacyData ?? []) as CmsArticle[];
}

async function getPublicNavigationUncached() {
  const supabase = createPublicClient();
  const [{ data: regions }, { data: articles }] = await Promise.all([
    supabase
      .from("regions")
      .select("slug,name,sort_order,cities(slug,name,sort_order,published)")
      .eq("published", true)
      .order("sort_order"),
    supabase
      .from("articles")
      .select("slug,title")
      .eq("status", "published")
      .order("sort_order")
      .limit(12),
  ]);
  return { regions: regions ?? [], articles: articles ?? [] };
}

async function getPublishedArticleUncached(slug: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from("articles")
    .select("id,slug,title,excerpt,category,category_id,is_featured,featured_order,content,cover_image_path,cover_image_alt,seo_title,seo_description,published_at,updated_at,article_categories(id,name,slug,sort_order,published,seo_title,seo_description),article_images(id,storage_path,alt_text,sort_order)")
    .eq("slug", slug).eq("status", "published").maybeSingle();
  if (!error && data) {
    const article = data as unknown as CmsArticle;
    article.article_images = [...(article.article_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    return article;
  }
  const { data: legacyData, error: legacyError } = await supabase.from("articles").select("id,slug,title,excerpt,category,content,cover_image_path,seo_title,seo_description,published_at,updated_at").eq("slug", slug).eq("status", "published").maybeSingle();
  return legacyError || !legacyData ? null : legacyData as CmsArticle;
}

async function getArticleCategoriesUncached() {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from("article_categories").select("id,name,slug,sort_order,published,seo_title,seo_description").eq("published", true).order("sort_order").order("name");
  return error ? [] as ArticleCategory[] : (data ?? []) as ArticleCategory[];
}

export function articleParagraphs(content: unknown) {
  if (!Array.isArray(content)) return [] as string[];
  return content.map((block) => typeof block === "object" && block && "text" in block ? String(block.text) : "").filter(Boolean);
}

type SiteSettingRow = { key: string; value: unknown };

export async function getSiteSettingsUncached(existingRows?: SiteSettingRow[]) {
  const data = existingRows ?? (await createPublicClient().from("site_settings").select("key,value")).data ?? [];
  const values = Object.fromEntries((data ?? []).map((item) => [item.key, item.value])) as Record<string, Record<string, string>>;
  const defaultGalleryImages = [{ src: "/placeholders/hero.svg", alt: "首頁示意圖" }, { src: "/placeholders/card-01.svg", alt: "服務示意圖一" }, { src: "/placeholders/card-02.svg", alt: "服務示意圖二" }, { src: "/placeholders/card-03.svg", alt: "服務示意圖三" }, { src: "/placeholders/promise.svg", alt: "區塊示意圖" }, { src: "/placeholders/hero.svg", alt: "首頁示意圖備用" }];
  const savedGalleryImages = Array.isArray(values.gallery?.images) ? values.gallery.images as unknown as Array<{ src: string; alt: string }> : [];
  const galleryImages = Array.from({ length: 6 }, (_, index) => savedGalleryImages[index] ?? defaultGalleryImages[index]);
  return {
    brand: { name: values.brand?.name || "範例品牌", line_url: values.brand?.line_url || "https://example.com/contact", logo_image: values.brand?.logo_image || "/placeholders/logo.svg", favicon_image: values.brand?.favicon_image || "/placeholders/favicon.svg", footer_text: values.brand?.footer_text || "請在後台填寫品牌介紹、服務特色與聯絡資訊。", copyright_text: values.brand?.copyright_text || "© 範例品牌. All rights reserved. 著作權所有，並保留一切權利" },
    navigation: { about: values.navigation?.about || "關於我們", services: values.navigation?.services || "服務內容", gallery: values.navigation?.gallery || "作品展示", faq: values.navigation?.faq || "常見問題", hot_articles: values.navigation?.hot_articles || "熱門文章", line_cta: values.navigation?.line_cta || "聯絡我們", mobile_menu: values.navigation?.mobile_menu || "選單", region_tab: values.navigation?.region_tab || "選擇地區", search_placeholder: values.navigation?.search_placeholder || "搜尋地區或文章" },
    seo: { default_title: values.seo?.default_title || "範例品牌", default_description: values.seo?.default_description || "請在後台填寫網站的服務與內容介紹。" },
    homepage: {
      hero_title: values.homepage?.hero_title || "在這裡放上你的品牌主標題", hero_text: values.homepage?.hero_text || "使用後台自由管理首頁文字、圖片、服務與文章。", hero_primary_cta: values.homepage?.hero_primary_cta || "立即聯絡", hero_secondary_cta: values.homepage?.hero_secondary_cta || "瀏覽內容", adult_note: values.homepage?.adult_note || "請依網站內容設定適合的瀏覽提醒", photo_badge: values.homepage?.photo_badge || "安心 · 尊重 · 質感", hero_image: values.homepage?.hero_image || "/placeholders/hero.svg", hero_image_mobile: values.homepage?.hero_image_mobile || (!values.homepage?.hero_image || values.homepage.hero_image === "/placeholders/hero.svg" ? "/placeholders/hero-mobile.svg" : values.homepage.hero_image), hero_image_alt: values.homepage?.hero_image_alt || "範例品牌首頁主視覺", hero_image_position_desktop: normalizeImagePosition(values.homepage?.hero_image_position_desktop, "center center"), hero_image_position_mobile: normalizeImagePosition(values.homepage?.hero_image_position_mobile, "center top"),
      intro_title: values.homepage?.intro_title || "在這裡介紹你的品牌故事", intro_text: values.homepage?.intro_text || "這段文字可在後台自由修改。", intro_legal_text: values.homepage?.intro_legal_text || "請依實際業務與所在地法規填寫網站說明。",
      services_title: values.homepage?.services_title || "服務內容", services_description: values.homepage?.services_description || "簡單清楚的流程，讓你安心了解、自在選擇。",
      promise_title: values.homepage?.promise_title || "值得信賴的服務特色", promise_image: values.homepage?.promise_image || "/placeholders/promise.svg", promise_image_alt: values.homepage?.promise_image_alt || "範例品牌服務特色示意圖", promise_image_position_desktop: normalizeImagePosition(values.homepage?.promise_image_position_desktop, "center center"), promise_image_position_mobile: normalizeImagePosition(values.homepage?.promise_image_position_mobile, "center top"), promise_one_title: values.homepage?.promise_one_title || "隱私優先", promise_one_text: values.homepage?.promise_one_text || "不公開個人聯絡內容，尊重彼此隱私。", promise_two_title: values.homepage?.promise_two_title || "清楚溝通", promise_two_text: values.homepage?.promise_two_text || "行程、時間與規範皆在預約前確認。", promise_three_title: values.homepage?.promise_three_title || "使用條件", promise_three_text: values.homepage?.promise_three_text || "請依實際服務填寫適用條件。",
      faq_title: values.homepage?.faq_title || "常見問題", faq_description: values.homepage?.faq_description || "事前了解基本流程，讓溝通更簡單安心。", contact_title: values.homepage?.contact_title || "準備好開始聯絡了嗎？", contact_text: values.homepage?.contact_text || "請透過正式聯絡方式說明需求與方便聯絡的時間。"
    },
    gallery: { title: values.gallery?.title || "作品展示", description: values.gallery?.description || "請從後台上傳圖片並填寫替代文字。", images: galleryImages },
  };
}

const defaultFaqs = [
  { question: "如何進行預約諮詢？", answer: "請透過網站上的聯絡按鈕，說明希望了解的內容與方便聯絡的時間。" },
  { question: "網站提供哪些服務？", answer: "請在後台依照實際業務填寫服務範圍與限制。" },
  { question: "我的聯絡資料會被公開嗎？", answer: "不會。聯絡內容僅用於回覆詢問及必要溝通。" },
];
const defaultServices = [
  { slug: "service-one", number: "01", title: "服務項目一", subtitle: "請在後台修改副標題", text: "這是可自由替換的服務項目示範內容。", image: "/placeholders/card-01.svg", image_position: "center top", points: ["事前確認需求與時間", "尊重雙方界線與選擇", "透過正式聯絡方式完成必要溝通"], seo_title: "服務項目一", seo_description: "請在後台填寫服務項目一的 SEO 描述。" },
  { slug: "service-two", number: "02", title: "服務項目二", subtitle: "請在後台修改副標題", text: "這是可自由替換的服務項目示範內容。", image: "/placeholders/card-02.svg", image_position: "center top", points: ["事前說明需求與時間", "確認服務內容與使用條件", "臨時變更請提前聯絡"], seo_title: "服務項目二", seo_description: "請在後台填寫服務項目二的 SEO 描述。" },
  { slug: "service-three", number: "03", title: "服務項目三", subtitle: "請在後台修改副標題", text: "這是可自由替換的服務項目示範內容。", image: "/placeholders/card-03.svg", image_position: "center top", points: ["圖片與文字須具備使用權", "依照實際業務填寫限制", "不提供或安排違法服務"], seo_title: "服務項目三", seo_description: "請在後台填寫服務項目三的 SEO 描述。" },
];
const defaultPrivacy = { title: "隱私權政策", updated: "2026 年 7 月 24 日", seo_title: "隱私權政策", seo_description: "了解本網站如何處理瀏覽、年齡確認與外部聯絡相關資訊。", sections: [{ heading: "一、適用範圍", content: "本政策說明網站在你瀏覽、完成年齡確認或點擊外部聯絡連結時，如何處理相關資訊。" }, { heading: "二、網站處理的資訊", content: "年齡確認結果只會保存在你的裝置上，用於避免重複顯示確認視窗。" }, { heading: "三、外部服務", content: "點擊外部聯絡按鈕後，你會離開本站，資料將依第三方服務政策處理。" }], note: "本頁為依網站現行功能製作的一般性說明，不取代個別法律意見。" };
const defaultTerms = { title: "使用條款", updated: "2026 年 7 月 24 日", seo_title: "使用條款", seo_description: "本網站的成年限制、合法使用、預約溝通與內容權利說明。", sections: [{ heading: "一、成年限制", content: "本網站僅供年滿 18 歲且已達所在地法定成年年齡者瀏覽與聯絡。" }, { heading: "二、合法與尊重原則", content: "本站僅提供成人形象展示、合法陪伴及一般預約諮詢資訊。" }, { heading: "三、內容與圖片權利", content: "本站品牌、文字、版面及獲授權圖片不得擅自冒用或用於建立虛假帳號。" }], note: "本頁為網站使用規範的一般性說明，不取代個別法律意見。" };

export async function getContentSettingsUncached(existingRows?: SiteSettingRow[]) {
  const data = existingRows ?? (await createPublicClient().from("site_settings").select("key,value").in("key", ["faqs", "services", "privacy", "terms", "labels"])).data ?? [];
  const values = Object.fromEntries((data ?? []).map((item) => [item.key, item.value])) as Record<string, unknown>;
  const savedLabels = values.labels && typeof values.labels === "object" ? { ...(values.labels as Record<string, string>) } : {};
  delete savedLabels.city_heading_description;
  return {
    faqs: (Array.isArray(values.faqs) ? values.faqs : defaultFaqs) as Array<{ question: string; answer: string }>,
    services: (Array.isArray(values.services) ? values.services : defaultServices).map((service) => {
      const saved = service as (typeof defaultServices)[number] & { image_position?: unknown };
      return { ...saved, image_position: normalizeImagePosition(saved.image_position, "center top") };
    }) as typeof defaultServices,
    privacy: (values.privacy && typeof values.privacy === "object" ? values.privacy : defaultPrivacy) as typeof defaultPrivacy,
    terms: (values.terms && typeof values.terms === "object" ? values.terms : defaultTerms) as typeof defaultTerms,
    labels: { services_heading: "服務內容", gallery_heading: "形象寫真", faq_heading: "常見問題", profile_cta: "點我查看資訊", line_cta: "加入 LINE 諮詢", profile_style_label: "形象風格", profile_interest_label: "活動偏好", profile_contact_label: "聯絡方式", profile_contact_summary: "請先透過 LINE 確認", profile_contact_value: "請先透過 LINE 聯絡諮詢", profile_contact_button: "透過 LINE 聯絡諮詢", profile_description_heading: "形象介紹", profile_legal_notice: "所有公開資訊僅供合法形象展示與一般諮詢使用，實際活動須遵守所在地法規、成年人自願及雙方同意。", profile_public_heading: "公開資料", profile_public_name_label: "公開名稱", profile_age_label: "年齡限制", profile_age_value: "僅限年滿 18 歲成年人", profile_nationality_label: "國籍", profile_age_detail_label: "年齡", profile_height_label: "身高", profile_weight_label: "體重", profile_cup_label: "罩杯", profile_environment_label: "環境", profile_service_method_label: "方式", profile_price_label: "價格", profile_service_area_label: "服務地區", profile_compatible_label: "可配合", profile_not_accepted_label: "不接受", profile_surcharge_label: "加價專案", profile_promotion_label: "優惠專案", city_gallery_heading_suffix: "形象介紹", city_gallery_description: "以下為合法形象展示的範例框架，不表示本人所在地或即時可安排狀態。", city_info_heading_suffix: "地區資訊", city_info_description: "本頁用於整理{city}地區的成人形象與合法陪伴諮詢資訊。所有聯絡皆以成年人、自願、清楚溝通及遵守所在地規範為前提。", city_info_notice: "請勿提出性交易、強迫、騷擾、偷拍、散布照片或其他違法要求。網站展示的照片與文字不代表即時所在地、價格或預約承諾。", ...savedLabels },
  };
}

async function getPublicSettingsBundleUncached() {
  const { data } = await createPublicClient().from("site_settings").select("key,value");
  const rows = (data ?? []) as SiteSettingRow[];
  const [settings, content] = await Promise.all([
    getSiteSettingsUncached(rows),
    getContentSettingsUncached(rows),
  ]);
  return { settings, content };
}

const cacheOptions = { revalidate: 300 } as const;
const getPublicSettingsBundle = unstable_cache(getPublicSettingsBundleUncached, ["public-settings-bundle"], { ...cacheOptions, tags: ["site-settings"] });

export const getPublishedProfiles = unstable_cache(getPublishedProfilesUncached, ["published-profiles"], { ...cacheOptions, tags: ["profiles"] });
export const getPublishedProfilesForCity = unstable_cache(getPublishedProfilesForCityUncached, ["published-profiles-city"], { ...cacheOptions, tags: ["profiles", "regions"] });
export const getPublishedProfilePageForCity = unstable_cache(getPublishedProfilePageForCityUncached, ["published-profile-page-city"], { ...cacheOptions, tags: ["profiles", "regions"] });
export const getPublishedProfile = unstable_cache(getPublishedProfileUncached, ["published-profile"], { ...cacheOptions, tags: ["profiles"] });
export const getRelatedProfiles = unstable_cache(getRelatedProfilesUncached, ["related-profiles"], { ...cacheOptions, tags: ["profiles", "regions"] });
export const getPublishedArticles = unstable_cache(getPublishedArticlesUncached, ["published-articles"], { ...cacheOptions, tags: ["articles"] });
export const getPublicNavigation = unstable_cache(getPublicNavigationUncached, ["public-navigation"], { ...cacheOptions, tags: ["regions", "articles"] });
export const getPublishedArticle = unstable_cache(getPublishedArticleUncached, ["published-article"], { ...cacheOptions, tags: ["articles"] });
export const getArticleCategories = unstable_cache(getArticleCategoriesUncached, ["article-categories"], { ...cacheOptions, tags: ["articles", "article-categories"] });
export async function getSiteSettings() {
  return (await getPublicSettingsBundle()).settings;
}

export async function getContentSettings() {
  return (await getPublicSettingsBundle()).content;
}
