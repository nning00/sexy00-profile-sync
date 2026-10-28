"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { LONG_IMAGE_CACHE_SECONDS, prepareImageForUpload } from "@/lib/image-upload";
import { refreshPublicContent } from "@/lib/refresh-public-content";
import { isOwnedMediaPath, scopedMediaPath } from "@/lib/site-instance";
import { imagePositionOptions } from "@/lib/image-position";

type Content = Awaited<ReturnType<typeof import("@/lib/cms").getContentSettings>>;
type Legal = Content["privacy"];

export default function ContentSettingsForm({ initial }: { initial: Content }) {
  const [faqs, setFaqs] = useState(initial.faqs);
  const [services, setServices] = useState(initial.services);
  const [serviceImageFiles, setServiceImageFiles] = useState<Array<File | null>>(() => initial.services.map(() => null));
  const [privacy, setPrivacy] = useState(initial.privacy);
  const [terms, setTerms] = useState(initial.terms);
  const [labels, setLabels] = useState(initial.labels);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  const labelNames: Record<string, string> = { faq_heading: "頁尾常見問題連結文字", line_cta: "首頁最下方 LINE 按鈕文字", profile_contact_button: "形象詳細頁 LINE 按鈕文字", profile_legal_notice: "形象詳細頁合法使用提醒", profile_nationality_label: "欄位 1 名稱（預設：國籍）", profile_age_detail_label: "欄位 2 名稱（預設：年齡）", profile_height_label: "欄位 3 名稱（預設：身高）", profile_weight_label: "欄位 4 名稱（預設：體重）", profile_cup_label: "欄位 5 名稱（預設：罩杯）", profile_environment_label: "欄位 6 名稱（預設：環境）", profile_service_method_label: "欄位 7 名稱（預設：方式）", profile_price_label: "欄位 8 名稱（預設：價格）", profile_service_area_label: "欄位 9 名稱（預設：服務地區）", profile_compatible_label: "欄位 10 名稱（預設：可配合）", profile_not_accepted_label: "欄位 11 名稱（預設：不接受）", profile_surcharge_label: "欄位 12 名稱（預設：加價專案）", profile_promotion_label: "欄位 13 名稱（預設：優惠專案）", city_info_heading_suffix: "城市資訊區標題後綴（前方自動帶入城市）", city_info_notice: "所有城市共用提醒" };
  const multilineLabels = ["profile_legal_notice", "city_info_notice"];
  const labelGroups = [
    { title: "③ 城市頁共用文字", help: "這裡只保留每個城市都共同使用的標題後綴與提醒；台北、台中等各城市的標題、介紹及 SEO，請到「專區與城市 → 城市獨立內容與 SEO」修改。", keys: ["city_info_heading_suffix", "city_info_notice"] },
    { title: "④ 形象內頁資訊卡：13 個欄位名稱", help: "這裡只設定全站共用的欄位名稱；每位形象的答案請到「形象管理 → 編輯形象」填寫。", keys: ["profile_nationality_label", "profile_age_detail_label", "profile_height_label", "profile_weight_label", "profile_cup_label", "profile_environment_label", "profile_service_method_label", "profile_price_label", "profile_service_area_label", "profile_compatible_label", "profile_not_accepted_label", "profile_surcharge_label", "profile_promotion_label"] },
    { title: "⑤ 前台 LINE 按鈕與形象頁提醒", help: "這些項目分別對應首頁最下方、頁尾、形象詳細頁按鈕及形象詳細頁提醒。", keys: ["line_cta", "faq_heading", "profile_contact_button", "profile_legal_notice"] },
  ];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
    const formElement = event.currentTarget;
    const normalizedSlugs = services.map((service) => service.slug.trim().toLowerCase());
    const duplicateSlugs = normalizedSlugs.filter((slug, index) => slug && normalizedSlugs.indexOf(slug) !== index);
    if (normalizedSlugs.some((slug) => !slug) || duplicateSlugs.length) {
      setMessage(duplicateSlugs.length
        ? `儲存失敗：服務網址代稱不可重複（${[...new Set(duplicateSlugs)].join("、")}）。請先修改後再儲存。`
        : "儲存失敗：每個服務都必須填寫網址代稱。");
      return;
    }
    setSaving(true); setMessage(""); const supabase = createClient();
    const nextServices = services.map((service) => ({ ...service }));
    const uploadedPaths: string[] = [];
    const replacedPaths: string[] = [];
    try {
      for (const [index, file] of serviceImageFiles.entries()) {
        if (!file || !nextServices[index]) continue;
        const prepared = await prepareImageForUpload(file, { maxEdge: 1400, quality: 0.78 });
        const path = scopedMediaPath(`services/${crypto.randomUUID()}.${prepared.extension}`);
        const { error: uploadError } = await supabase.storage.from("site-media").upload(path, prepared.file, {
          upsert: false,
          contentType: prepared.file.type,
          cacheControl: LONG_IMAGE_CACHE_SECONDS,
        });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        if (storedMediaPath(nextServices[index].image)) replacedPaths.push(nextServices[index].image);
        nextServices[index].image = path;
      }
    } catch (uploadError) {
      if (uploadedPaths.length) await supabase.storage.from("site-media").remove(uploadedPaths);
      setSaving(false);
      setMessage(`服務圖片上傳失敗：${uploadError instanceof Error ? uploadError.message : "請稍後再試"}`);
      return;
    }
    const { error } = await supabase.from("site_settings").upsert([{ key: "faqs", value: faqs }, { key: "services", value: nextServices }, { key: "privacy", value: privacy }, { key: "terms", value: terms }, { key: "labels", value: labels }], { onConflict: "key" });
    if (error) {
      if (uploadedPaths.length) await supabase.storage.from("site-media").remove(uploadedPaths);
      setSaving(false); setMessage(`儲存失敗：${error.message}`); return;
    }
    const unusedReplacedPaths = [...new Set(replacedPaths)].filter((path) => !nextServices.some((service) => service.image === path));
    if (unusedReplacedPaths.length) await supabase.storage.from("site-media").remove(unusedReplacedPaths);
    setServices(nextServices);
    setServiceImageFiles(nextServices.map(() => null));
    formElement.reset();
    try {
      await refreshPublicContent(["site-settings"]);
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
  function storedMediaPath(path: string | null | undefined): path is string {
    return isOwnedMediaPath(path);
  }
  function updateServiceImage(index: number, file: File | null) {
    setServiceImageFiles((files) => files.map((current, fileIndex) => fileIndex === index ? file : current));
  }
  function addService() {
    const usedSlugs = new Set(services.map((service) => service.slug));
    let sequence = services.length + 1;
    while (usedSlugs.has(`service-${sequence}`)) sequence += 1;
    const highestNumber = services.reduce((highest, service) => Math.max(highest, Number.parseInt(service.number, 10) || 0), 0);
    setServices([...services, { slug: `service-${sequence}`, number: String(highestNumber + 1).padStart(2, "0"), title: "新服務", subtitle: "", text: "", image: "/placeholders/card-01.svg", image_position: "center top", points: [], seo_title: "", seo_description: "" }]);
    setServiceImageFiles([...serviceImageFiles, null]);
  }
  function legalEditor(title: string, value: Legal, setter: (value: Legal) => void) {
    return <details className="admin-content-block"><summary>{title}</summary><div className="admin-content-inner">
      <div className="admin-form-grid"><label>頁面標題<input value={value.title} onChange={(e) => setter({ ...value, title: e.target.value })} /></label><label>最後更新<input value={value.updated} onChange={(e) => setter({ ...value, updated: e.target.value })} /></label></div>
      <div className="admin-form-grid"><label>SEO 標題<input value={value.seo_title} onChange={(e) => setter({ ...value, seo_title: e.target.value })} /></label><label>SEO 描述<textarea rows={3} value={value.seo_description} onChange={(e) => setter({ ...value, seo_description: e.target.value })} /></label></div>
      {value.sections.map((section, index) => <div className="admin-repeat-row" key={index}><label>段落標題<input value={section.heading} onChange={(e) => setter({ ...value, sections: value.sections.map((item, i) => i === index ? { ...item, heading: e.target.value } : item) })} /></label><label>段落內容<textarea rows={4} value={section.content} onChange={(e) => setter({ ...value, sections: value.sections.map((item, i) => i === index ? { ...item, content: e.target.value } : item) })} /></label><button type="button" onClick={() => setter({ ...value, sections: value.sections.filter((_, i) => i !== index) })}>移除此段</button></div>)}
      <button type="button" className="admin-add-button" onClick={() => setter({ ...value, sections: [...value.sections, { heading: "新段落", content: "" }] })}>＋ 新增段落</button><label>頁尾提醒<textarea rows={3} value={value.note} onChange={(e) => setter({ ...value, note: e.target.value })} /></label>
    </div></details>;
  }
  function labelEditor(key: string) {
    const value = (labels as Record<string, string>)[key] ?? "";
    const control = multilineLabels.includes(key)
      ? <textarea rows={key.startsWith("city_") ? 4 : 3} value={value} onChange={(e) => setLabels({ ...labels, [key]: e.target.value })} />
      : <input value={value} onChange={(e) => setLabels({ ...labels, [key]: e.target.value })} />;
    return <label key={key}>{labelNames[key] ?? key}{control}</label>;
  }
  return <form className="admin-editor admin-content-editor" onSubmit={save}>{message && <div className={message.startsWith("已") ? "admin-success" : "admin-error"}>{message}</div>}
    <div className="admin-content-guide"><strong>按照頁面類型排列</strong><p>首頁區塊標題與圖片在「首頁文字、圖片與全站設定」；城市獨立內容在「專區與城市」。這裡管理服務卡、FAQ、共用文字及政策頁。</p></div>
    <details className="admin-content-block"><summary>① 首頁服務項目與服務分頁 SEO</summary><div className="admin-content-inner"><p className="admin-content-help">這裡修改首頁所有服務卡，以及點進服務卡後的介紹內容。新增服務也會顯示在首頁；圖片請使用下方的檔案選擇器更換，儲存時會自動壓縮並上傳。</p>{services.map((service, index) => <div className="admin-repeat-row service-editor" key={`${service.slug}-${index}`}><div className="admin-form-grid"><label>服務名稱<input value={service.title} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} /></label><label>網址代稱<input pattern="[a-z0-9-]+" value={service.slug} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, slug: e.target.value } : item))} /></label><label>編號<input value={service.number} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, number: e.target.value } : item))} /></label><label>副標題<input value={service.subtitle} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, subtitle: e.target.value } : item))} /></label></div><label>介紹<textarea rows={3} value={service.text} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, text: e.target.value } : item))} /></label><label>重點（每行一項）<textarea rows={4} value={service.points.join("\n")} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, points: e.target.value.split("\n") } : item))} /></label><div className="admin-service-image-editor"><label>更換服務圖片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => updateServiceImage(index, e.target.files?.[0] ?? null)} /></label><p className="admin-current-file">目前圖片：{service.image}</p>{serviceImageFiles[index] && <p className="admin-selected-file">已選擇：{serviceImageFiles[index]?.name}（按「儲存全部內容」後上傳）</p>}<label>卡片圖片焦點<select value={service.image_position} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, image_position: e.target.value as typeof item.image_position } : item))}>{imagePositionOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><div className="admin-form-grid"><label>SEO 標題<input value={service.seo_title} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, seo_title: e.target.value } : item))} /></label><label>SEO 描述<textarea rows={3} value={service.seo_description} onChange={(e) => setServices(services.map((item, i) => i === index ? { ...item, seo_description: e.target.value } : item))} /></label></div><button type="button" onClick={() => { setServices(services.filter((_, i) => i !== index)); setServiceImageFiles(serviceImageFiles.filter((_, i) => i !== index)); }}>移除此服務</button></div>)}<button type="button" className="admin-add-button" onClick={addService}>＋ 新增服務</button></div></details>
    <details className="admin-content-block" open><summary>② 首頁常見問題（問題與回答）</summary><div className="admin-content-inner"><p className="admin-content-help">可修改、刪除或新增問題；首頁會依照這裡的順序顯示。</p>{faqs.map((faq, index) => <div className="admin-repeat-row" key={index}><label>問題<input value={faq.question} onChange={(e) => setFaqs(faqs.map((item, i) => i === index ? { ...item, question: e.target.value } : item))} /></label><label>回答<textarea rows={3} value={faq.answer} onChange={(e) => setFaqs(faqs.map((item, i) => i === index ? { ...item, answer: e.target.value } : item))} /></label><button type="button" onClick={() => setFaqs(faqs.filter((_, i) => i !== index))}>移除此題</button></div>)}<button type="button" className="admin-add-button" onClick={() => setFaqs([...faqs, { question: "新問題", answer: "" }])}>＋ 新增問題</button></div></details>
    {labelGroups.map((group) => <details className="admin-content-block" key={group.title}><summary>{group.title}</summary><div className="admin-content-inner"><p className="admin-content-help">{group.help}</p><div className="admin-form-grid">{group.keys.map(labelEditor)}</div></div></details>)}
    {legalEditor("⑥ 隱私權政策頁與 SEO", privacy, setPrivacy)}{legalEditor("⑦ 使用條款頁與 SEO", terms, setTerms)}
    <button className="button primary" disabled={saving}>{saving ? "儲存中…" : "儲存全部內容"}</button>
  </form>;
}

