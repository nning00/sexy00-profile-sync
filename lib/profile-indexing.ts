type ProfileImage = { storage_path: string; alt_text?: string | null };

export type ProfileIndexCandidate = {
  slug?: string | null;
  display_name?: string | null;
  introduction?: string | null;
  card_image_path?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  profile_images?: ProfileImage[] | null;
};

const placeholderName = /^(?:未命名|待確認|待補|測試|test|unknown|範例)/i;
const placeholderPath = /(?:^|\/)(?:placeholders?|example|sample)(?:\/|\.|$)/i;
const videoPath = /\.(?:mp4|webm)(?:\?.*)?$/i;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function hasSubstantiveIntroduction(value: string | null | undefined) {
  const text = clean(value);
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).filter((item) => clean(String(item ?? "")).length >= 2).length >= 2;
    }
  } catch {
    // Older records may contain a normal paragraph rather than JSON.
  }
  return text.length >= 30;
}

function hasRealImage(profile: ProfileIndexCandidate) {
  const paths = [profile.card_image_path, ...(profile.profile_images ?? []).map((item) => item.storage_path)]
    .map(clean)
    .filter(Boolean);
  return paths.some((path) => !placeholderPath.test(path) && !videoPath.test(path));
}

/**
 * A public profile can still be viewed when it is incomplete, but it should
 * not be submitted as a high-quality search result until the essentials are
 * present. Keeping this rule shared prevents the page metadata and sitemap
 * from making contradictory indexing decisions.
 */
export function isIndexableProfile(profile: ProfileIndexCandidate) {
  const slug = clean(profile.slug);
  const name = clean(profile.display_name);
  const title = clean(profile.seo_title);
  const description = clean(profile.seo_description);
  return Boolean(
    /^[a-z0-9][a-z0-9-]{2,}$/i.test(slug)
    && name.length >= 2
    && !placeholderName.test(name)
    && title.length >= 8
    && description.length >= 35
    && hasRealImage(profile)
    && hasSubstantiveIntroduction(profile.introduction)
  );
}

export function profileSeoFingerprint(profile: ProfileIndexCandidate) {
  return `${clean(profile.seo_title).normalize("NFKC").toLocaleLowerCase("zh-Hant")}\u0000${clean(profile.seo_description).normalize("NFKC").toLocaleLowerCase("zh-Hant")}`;
}

export function profileIndexingIssues(profile: ProfileIndexCandidate) {
  const issues: string[] = [];
  const name = clean(profile.display_name);
  if (!/^[a-z0-9][a-z0-9-]{2,}$/i.test(clean(profile.slug))) issues.push("網址代稱不完整");
  if (name.length < 2 || placeholderName.test(name)) issues.push("公開名稱不完整");
  if (clean(profile.seo_title).length < 8) issues.push("SEO 標題過短");
  if (clean(profile.seo_description).length < 35) issues.push("SEO 描述過短");
  if (!hasRealImage(profile)) issues.push("缺少可用形象圖片");
  if (!hasSubstantiveIntroduction(profile.introduction)) issues.push("公開資料過少");
  return issues;
}
