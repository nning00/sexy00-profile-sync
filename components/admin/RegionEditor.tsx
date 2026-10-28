"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { refreshPublicContent } from "@/lib/refresh-public-content";

type City = {
  id?: string;
  name: string;
  slug: string;
  page_title: string | null;
  summary: string | null;
  gallery_title: string | null;
  gallery_description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  sort_order: number;
  published: boolean;
};
type Region = { id: string; name: string; slug: string; english_name: string | null; summary: string | null; sort_order: number; published: boolean };

export default function RegionEditor({ region, initialCities }: { region: Region; initialCities: City[] }) {
  const router = useRouter();
  const [cities, setCities] = useState(initialCities);
  const [removedCityIds, setRemovedCityIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
    const form = new FormData(event.currentTarget); const supabase = createClient();
    const { error } = await supabase.from("regions").update({
      name: String(form.get("name") ?? "").trim(), slug: String(form.get("slug") ?? "").trim(),
      english_name: String(form.get("english_name") ?? "").trim(), summary: String(form.get("summary") ?? "").trim(),
      sort_order: Number(form.get("sort_order") ?? 0), published: form.get("published") === "on",
    }).eq("id", region.id);
    if (error) { setMessage(`儲存失敗：${error.message}`); setSaving(false); return; }
    if (removedCityIds.length) {
      const { error: deleteError } = await supabase.from("cities").delete().in("id", removedCityIds);
      if (deleteError) { setMessage(`刪除城市失敗：${deleteError.message}`); setSaving(false); return; }
    }
    for (const [index, city] of cities.entries()) {
      const payload = {
        region_id: region.id,
        name: city.name.trim(),
        slug: city.slug.trim(),
        page_title: city.page_title?.trim() || `${city.name.trim()}地區精選資訊`,
        summary: city.summary?.trim() || `${city.name.trim()}地區提供成年人形象展示與合法預約諮詢資訊，所有互動皆以成年人、自願、尊重隱私及遵守所在地法規為前提。`,
        gallery_title: city.gallery_title?.trim() || `${city.name.trim()}形象介紹`,
        gallery_description: city.gallery_description?.trim() || `瀏覽${city.name.trim()}地區的成人形象介紹與公開資訊；實際內容與可安排情況，請透過正式聯絡方式確認。`,
        seo_title: city.seo_title?.trim() || `${city.name.trim()}成人形象介紹與預約諮詢`,
        seo_description: city.seo_description?.trim() || `查看${city.name.trim()}地區成人形象介紹、公開資訊與合法預約諮詢方式。重視成年人自願、隱私保護、清楚溝通與所在地法規。`,
        sort_order: city.sort_order || index,
        published: city.published,
      };
      const result = city.id ? await supabase.from("cities").update(payload).eq("id", city.id) : await supabase.from("cities").insert(payload);
      if (result.error) { setMessage(`城市儲存失敗：${result.error.message}`); setSaving(false); return; }
    }
    await refreshPublicContent(["regions", "profiles"]).catch(() => undefined);
    setMessage("已儲存。隱藏的項目不會顯示在前台選單。"); router.refresh();
    } catch (error) {
      setMessage(`儲存失敗：${error instanceof Error ? error.message : "請稍後再試"}`);
    } finally {
      setSaving(false);
    }
  }

  return <form className="admin-editor" onSubmit={submit}>
    {message && <div className={message.startsWith("已") ? "admin-success" : "admin-error"}>{message}</div>}
    <div className="admin-form-grid"><label>專區顯示名稱<input name="name" required defaultValue={region.name} /></label><label>網址代稱<input name="slug" required pattern="[a-z0-9-]+" defaultValue={region.slug} /></label></div>
    <div className="admin-form-grid"><label>英文名稱<input name="english_name" defaultValue={region.english_name ?? ""} /></label><label>排序<input name="sort_order" type="number" defaultValue={region.sort_order} /></label></div>
    <label>專區介紹<textarea name="summary" rows={4} defaultValue={region.summary ?? ""} /></label>
    <label className="admin-inline-check"><input type="checkbox" name="published" defaultChecked={region.published} /> 顯示此專區</label>
    <section className="admin-city-editor"><div><div><h2>城市獨立內容與 SEO</h2><p>展開城市後，可分別修改前台文字與搜尋結果標題。網址代稱上線後請勿任意更改。</p></div><button type="button" onClick={() => setCities([...cities, { name: "", slug: "", page_title: "", summary: "", gallery_title: "", gallery_description: "", seo_title: "", seo_description: "", sort_order: cities.length, published: true }])}>＋ 新增城市</button></div>
      {cities.map((city, index) => <details className="admin-city-content-card" key={city.id ?? `new-${index}`} open={index === 0}>
        <summary><span><strong>{city.name || "新城市"}</strong><small>/{city.slug || "url"}</small></span><i>{city.published ? "前台顯示中" : "目前隱藏"}</i></summary>
        <div className="admin-city-content-inner">
          <div className="admin-city-content-heading"><strong>① 基本設定</strong><span>名稱、網址、排序與公開狀態</span></div>
          <div className="admin-city-basic-grid">
            <label>城市名稱<input value={city.name} placeholder="例如：台北" onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label>
            <label>英文網址代稱<input value={city.slug} placeholder="例如：taipei" pattern="[a-z0-9-]+" onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, slug: event.target.value } : item))} /></label>
            <label>排序<input value={city.sort_order} type="number" onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, sort_order: Number(event.target.value) } : item))} /></label>
            <label className="admin-inline-check"><input type="checkbox" checked={city.published} onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, published: event.target.checked } : item))} /> 顯示在前台</label>
          </div>
          <div className="admin-city-content-heading"><strong>② 前台城市頁內容</strong><span>每個城市應使用不同且自然的介紹文字</span></div>
          <label>城市頁主標題（H1）<input value={city.page_title ?? ""} placeholder={`${city.name || "城市"}地區精選資訊`} onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, page_title: event.target.value } : item))} /></label>
          <label>城市原創介紹<textarea rows={5} value={city.summary ?? ""} placeholder="介紹此城市頁的資訊特色、適用對象與合法使用原則。" onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, summary: event.target.value } : item))} /></label>
          <div className="admin-form-grid">
            <label>形象區標題<input value={city.gallery_title ?? ""} placeholder={`${city.name || "城市"}形象介紹`} onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, gallery_title: event.target.value } : item))} /></label>
            <label>形象區說明<textarea rows={3} value={city.gallery_description ?? ""} onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, gallery_description: event.target.value } : item))} /></label>
          </div>
          <div className="admin-city-content-heading"><strong>③ Google 搜尋結果</strong><span>品牌名稱會由網站自動附加，SEO 標題中不必重複輸入品牌名稱</span></div>
          <div className="admin-form-grid">
            <label>SEO 標題<input value={city.seo_title ?? ""} placeholder={`${city.name || "城市"}成人形象介紹與預約諮詢`} onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, seo_title: event.target.value } : item))} /></label>
            <label>SEO 描述<textarea rows={4} value={city.seo_description ?? ""} onChange={(event) => setCities(cities.map((item, itemIndex) => itemIndex === index ? { ...item, seo_description: event.target.value } : item))} /></label>
          </div>
          <button className="admin-city-delete" type="button" onClick={() => { if (city.id) setRemovedCityIds([...removedCityIds, city.id]); setCities(cities.filter((_, itemIndex) => itemIndex !== index)); }}>刪除此城市</button>
        </div>
      </details>)}
    </section>
    <button className="button primary" disabled={saving}>{saving ? "儲存中…" : "儲存專區與選單"}</button>
  </form>;
}
