"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LONG_IMAGE_CACHE_SECONDS, prepareImageForUpload } from "@/lib/image-upload";
import { refreshPublicContent } from "@/lib/refresh-public-content";
import { scopedMediaPath } from "@/lib/site-instance";
import { imagePositionOptions } from "@/lib/image-position";

type Settings = Awaited<ReturnType<typeof import("@/lib/cms").getSiteSettings>>;
export default function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
    const form = new FormData(event.currentTarget); const supabase = createClient();
    async function uploadPrepared(prepared: Pick<Awaited<ReturnType<typeof prepareImageForUpload>>, "file" | "extension">) {
      const path = scopedMediaPath(`settings/${crypto.randomUUID()}.${prepared.extension}`);
      const { error } = await supabase.storage.from("site-media").upload(path, prepared.file, {
        upsert: false,
        contentType: prepared.file.type,
        cacheControl: LONG_IMAGE_CACHE_SECONDS,
      });
      if (error) throw error;
      return path;
    }
    async function upload(name: string, current: string, optimize = true) {
      const file = form.get(name) as File;
      if (!file?.size) return current;
      const prepared = optimize
        ? await prepareImageForUpload(file)
        : { file, extension: file.name.split(".").pop()?.toLowerCase() || "png" };
      return uploadPrepared(prepared);
    }
    let heroImage = settings.homepage.hero_image; let heroMobileImage = settings.homepage.hero_image_mobile; let promiseImage: string; let logoImage: string; let faviconImage: string; const galleryImages = [...settings.gallery.images];
    try {
      const heroFile = form.get("hero_image") as File;
      if (heroFile?.size) {
        const [desktopPrepared, mobilePrepared] = await Promise.all([
          prepareImageForUpload(heroFile, { maxEdge: 1600, quality: 0.8 }),
          prepareImageForUpload(heroFile, { maxEdge: 900, quality: 0.72 }),
        ]);
        [heroImage, heroMobileImage] = await Promise.all([
          uploadPrepared(desktopPrepared),
          uploadPrepared(mobilePrepared),
        ]);
      }
      const heroMobileFile = form.get("hero_image_mobile") as File;
      if (heroMobileFile?.size) {
        heroMobileImage = await uploadPrepared(await prepareImageForUpload(heroMobileFile, { maxEdge: 1000, quality: 0.76 }));
      }
      promiseImage = await upload("promise_image", settings.homepage.promise_image);
      logoImage = await upload("logo_image", settings.brand.logo_image);
      faviconImage = await upload("favicon_image", settings.brand.favicon_image, false);
      for (let index = 0; index < galleryImages.length; index++) {
        const file = form.get(`gallery_image_${index}`) as File;
        const src = file?.size
          ? await uploadPrepared(await prepareImageForUpload(file, { maxEdge: 1200, quality: 0.72 }))
          : galleryImages[index].src;
        galleryImages[index] = { src, alt: String(form.get(`gallery_alt_${index}`) ?? "").trim() };
      }
    } catch (error) { setSaving(false); setMessage(`圖片上傳失敗：${error instanceof Error ? error.message : "請稍後再試"}`); return; }
    const rows = [
      { key: "brand", value: { name: String(form.get("brand_name")), line_url: String(form.get("line_url")), logo_image: logoImage, favicon_image: faviconImage, footer_text: String(form.get("footer_text")), copyright_text: String(form.get("copyright_text")) } },
      { key: "navigation", value: { about: String(form.get("nav_about")), services: String(form.get("nav_services")), gallery: String(form.get("nav_gallery")), faq: String(form.get("nav_faq")), hot_articles: String(form.get("nav_hot_articles")), line_cta: String(form.get("nav_line_cta")), mobile_menu: String(form.get("nav_mobile_menu")), region_tab: String(form.get("nav_region_tab")), search_placeholder: String(form.get("nav_search_placeholder")) } },
      { key: "seo", value: { default_title: String(form.get("default_title")), default_description: String(form.get("default_description")) } },
      { key: "homepage", value: { hero_title: String(form.get("hero_title")), hero_text: String(form.get("hero_text")), hero_primary_cta: String(form.get("hero_primary_cta")), hero_secondary_cta: settings.homepage.hero_secondary_cta, adult_note: String(form.get("adult_note")), photo_badge: settings.homepage.photo_badge, hero_image: heroImage, hero_image_mobile: heroMobileImage, hero_image_alt: String(form.get("hero_image_alt")), hero_image_position_desktop: String(form.get("hero_image_position_desktop")), hero_image_position_mobile: String(form.get("hero_image_position_mobile")), intro_title: String(form.get("intro_title")), intro_text: String(form.get("intro_text")), intro_legal_text: String(form.get("intro_legal_text")), services_title: String(form.get("services_title")), services_description: String(form.get("services_description")), promise_title: String(form.get("promise_title")), promise_image: promiseImage, promise_image_alt: String(form.get("promise_image_alt")), promise_image_position_desktop: String(form.get("promise_image_position_desktop")), promise_image_position_mobile: String(form.get("promise_image_position_mobile")), promise_one_title: String(form.get("promise_one_title")), promise_one_text: String(form.get("promise_one_text")), promise_two_title: String(form.get("promise_two_title")), promise_two_text: String(form.get("promise_two_text")), promise_three_title: String(form.get("promise_three_title")), promise_three_text: String(form.get("promise_three_text")), faq_title: String(form.get("faq_title")), faq_description: String(form.get("faq_description")), contact_title: String(form.get("contact_title")), contact_text: String(form.get("contact_text")) } },
      { key: "gallery", value: { title: String(form.get("gallery_title")), description: String(form.get("gallery_description")), images: galleryImages } },
    ];
    const { error } = await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
    if (error) { setSaving(false); setMessage(`儲存失敗：${error.message}`); return; }
    try {
      await refreshPublicContent(["site-settings"]);
      router.refresh();
      setMessage("已儲存，前台重新整理後會立即顯示變更。");
    } catch (refreshError) {
      setMessage(refreshError instanceof Error ? refreshError.message : "已儲存，但網站快取更新失敗。");
    }
    } catch (error) {
      setMessage(`儲存失敗：${error instanceof Error ? error.message : "請稍後再試"}`);
    } finally {
      setSaving(false);
    }
  }
  return <form className="admin-editor admin-content-editor" onSubmit={submit}>{message && <div className={message.startsWith("已") ? "admin-success" : "admin-error"}>{message}</div>}
    <div className="admin-content-guide"><strong>依照首頁由上到下修改</strong><p>每個框代表首頁的一個區塊；只需展開想修改的部分。</p></div>
    <details className="admin-content-block" open><summary>① 首頁最上方主視覺</summary><div className="admin-content-inner"><label>主標題<input name="hero_title" defaultValue={settings.homepage.hero_title} /></label><label>主介紹<textarea name="hero_text" rows={3} defaultValue={settings.homepage.hero_text} /></label><label>粉紅色按鈕文字<input name="hero_primary_cta" defaultValue={settings.homepage.hero_primary_cta} /></label><label>成年提醒文字<input name="adult_note" defaultValue={settings.homepage.adult_note} /></label><div className="admin-form-grid"><div><label>更換桌面版主圖<input name="hero_image" type="file" accept="image/jpeg,image/png,image/webp" /></label><p className="admin-current-file">目前圖片：{settings.homepage.hero_image}</p></div><div><label>更換手機版主圖（選填）<input name="hero_image_mobile" type="file" accept="image/jpeg,image/png,image/webp" /></label><p className="admin-current-file">目前圖片：{settings.homepage.hero_image_mobile}</p></div></div><p className="admin-content-help">手機版圖片留空時，重新上傳桌面版主圖會自動建立手機尺寸；若手機構圖不同，可另外上傳直式圖片。</p><div className="admin-form-grid"><label>桌面版圖片焦點<select name="hero_image_position_desktop" defaultValue={settings.homepage.hero_image_position_desktop}>{imagePositionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>手機版圖片焦點<select name="hero_image_position_mobile" defaultValue={settings.homepage.hero_image_position_mobile}>{imagePositionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><label>首頁主圖 ALT 描述<input name="hero_image_alt" defaultValue={settings.homepage.hero_image_alt} /></label></div></details>
    <details className="admin-content-block"><summary>② 關於我們</summary><div className="admin-content-inner"><label>標題<input name="intro_title" defaultValue={settings.homepage.intro_title} /></label><label>第一段文字<textarea name="intro_text" rows={3} defaultValue={settings.homepage.intro_text} /></label><label>第二段合法使用說明<textarea name="intro_legal_text" rows={3} defaultValue={settings.homepage.intro_legal_text} /></label></div></details>
    <details className="admin-content-block"><summary>③ 服務內容區</summary><div className="admin-content-inner"><label>區塊標題<input name="services_title" defaultValue={settings.homepage.services_title} /></label><label>區塊說明<textarea name="services_description" rows={3} defaultValue={settings.homepage.services_description} /></label><p className="admin-content-help">三張服務卡片的名稱、內容及 SEO，請到「全站內容模組 → 首頁服務項目」修改。</p></div></details>
    <details className="admin-content-block"><summary>④ 首頁形象寫真</summary><div className="admin-content-inner"><label>區塊標題<input name="gallery_title" defaultValue={settings.gallery.title} /></label><label>區塊介紹<textarea name="gallery_description" rows={3} defaultValue={settings.gallery.description} /></label><div className="admin-gallery-settings">{settings.gallery.images.map((image, index) => <div key={`${image.src}-${index}`}><strong>照片 {index + 1}</strong><label>更換圖片<input name={`gallery_image_${index}`} type="file" accept="image/jpeg,image/png,image/webp" /></label><p className="admin-current-file">目前圖片：{image.src}</p><label>圖片 ALT 描述<input name={`gallery_alt_${index}`} defaultValue={image.alt} /></label></div>)}</div></div></details>
    <details className="admin-content-block"><summary>⑤ 安心承諾區</summary><div className="admin-content-inner"><label>區塊標題<input name="promise_title" defaultValue={settings.homepage.promise_title} /></label><label>更換安心承諾背景圖<input name="promise_image" type="file" accept="image/jpeg,image/png,image/webp" /></label><p className="admin-current-file">目前圖片：{settings.homepage.promise_image}</p><div className="admin-form-grid"><label>桌面版圖片焦點<select name="promise_image_position_desktop" defaultValue={settings.homepage.promise_image_position_desktop}>{imagePositionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>手機版圖片焦點<select name="promise_image_position_mobile" defaultValue={settings.homepage.promise_image_position_mobile}>{imagePositionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><label>安心承諾圖片 ALT 描述<input name="promise_image_alt" defaultValue={settings.homepage.promise_image_alt} /></label>{[1,2,3].map((number) => { const word = number === 1 ? "one" : number === 2 ? "two" : "three"; return <div className="admin-repeat-row" key={word}><strong>第 {number} 項</strong><label>小標題<input name={`promise_${word}_title`} defaultValue={settings.homepage[`promise_${word}_title` as keyof typeof settings.homepage]} /></label><label>說明<textarea name={`promise_${word}_text`} rows={2} defaultValue={settings.homepage[`promise_${word}_text` as keyof typeof settings.homepage]} /></label></div>; })}</div></details>
    <details className="admin-content-block"><summary>⑥ 常見問題區標題</summary><div className="admin-content-inner"><label>區塊標題<input name="faq_title" defaultValue={settings.homepage.faq_title} /></label><label>區塊說明<textarea name="faq_description" rows={3} defaultValue={settings.homepage.faq_description} /></label><p className="admin-content-help">每一題問題與答案，請到「全站內容模組 → 首頁常見問題」修改。</p></div></details>
    <details className="admin-content-block"><summary>⑦ 首頁最下方聯絡區</summary><div className="admin-content-inner"><label>聯絡區標題<input name="contact_title" defaultValue={settings.homepage.contact_title} /></label><label>聯絡區文字<textarea name="contact_text" rows={3} defaultValue={settings.homepage.contact_text} /></label></div></details>
    <details className="admin-content-block"><summary>全站導覽選單文字</summary><div className="admin-content-inner"><p className="admin-content-help">修改首頁上方選單、手機選單及熱門文章名稱；五大專區名稱請至「專區與城市選單」修改。</p><div className="admin-form-grid"><label>關於我們<input name="nav_about" defaultValue={settings.navigation.about} /></label><label>服務內容<input name="nav_services" defaultValue={settings.navigation.services} /></label><label>形象寫真<input name="nav_gallery" defaultValue={settings.navigation.gallery} /></label><label>常見問題<input name="nav_faq" defaultValue={settings.navigation.faq} /></label><label>熱門文章<input name="nav_hot_articles" defaultValue={settings.navigation.hot_articles} /></label><label>LINE 預約按鈕<input name="nav_line_cta" defaultValue={settings.navigation.line_cta} /></label><label>手機「選單」文字<input name="nav_mobile_menu" defaultValue={settings.navigation.mobile_menu} /></label><label>手機「選擇地區」文字<input name="nav_region_tab" defaultValue={settings.navigation.region_tab} /></label><label>手機搜尋提示<input name="nav_search_placeholder" defaultValue={settings.navigation.search_placeholder} /></label></div></div></details>
    <details className="admin-content-block"><summary>全站品牌、Logo、LINE 與頁尾</summary><div className="admin-content-inner"><div className="admin-form-grid"><label>品牌名稱<input name="brand_name" defaultValue={settings.brand.name} /></label><label>LINE 連結<input name="line_url" type="url" defaultValue={settings.brand.line_url} /></label></div><div className="admin-form-grid"><div><label>前台品牌 Logo<input name="logo_image" type="file" accept="image/png,image/webp,image/jpeg" /></label><p className="admin-current-file">目前檔案：{settings.brand.logo_image}</p></div><div><label>瀏覽器分頁圖示<input name="favicon_image" type="file" accept="image/png,image/webp,image/x-icon" /></label><p className="admin-current-file">目前檔案：{settings.brand.favicon_image}</p></div></div><p className="admin-content-help">Logo 建議使用透明背景 PNG；分頁圖示建議使用正方形 PNG。重新上傳後，前台全站會同步更新。</p><label>頁尾品牌介紹文字<textarea name="footer_text" rows={3} defaultValue={settings.brand.footer_text} /></label><label>頁尾著作權文字<textarea name="copyright_text" rows={2} defaultValue={settings.brand.copyright_text} /></label></div></details>
    <details className="admin-content-block"><summary>全站預設 SEO</summary><div className="admin-content-inner"><label>預設 SEO 標題<input name="default_title" defaultValue={settings.seo.default_title} /></label><label>預設 SEO 描述<textarea name="default_description" rows={3} defaultValue={settings.seo.default_description} /></label></div></details>
    <button className="button primary" disabled={saving}>{saving ? "儲存中…" : "儲存全站設定"}</button>
  </form>;
}
