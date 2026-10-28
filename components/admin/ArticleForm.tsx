"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { prepareImageForUpload } from "@/lib/image-upload";
import { refreshPublicContent } from "@/lib/refresh-public-content";

type Category = { id: string; name: string };
type ExistingImage = { id: string; storage_path: string; alt_text: string | null; sort_order: number };
type ArticleData = {
  id?: string; slug: string; title: string; excerpt: string | null; category: string | null;
  category_id?: string | null; is_featured?: boolean; featured_order?: number; content: unknown;
  cover_image_path: string | null; cover_image_alt?: string | null; status: string; sort_order: number;
  seo_title: string | null; seo_description: string | null; published_at?: string | null;
};

export default function ArticleForm({ initial, categories, existingImages = [] }: { initial?: ArticleData; categories: Category[]; existingImages?: ExistingImage[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadRows, setUploadRows] = useState<number[]>([0]);
  const initialContent = Array.isArray(initial?.content) ? (initial.content as Array<{ text?: string }>).map((item) => item.text ?? "").join("\n\n") : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
    const form = new FormData(event.currentTarget);
    const nextStatus = String(form.get("status") ?? "draft");
    const categoryId = String(form.get("category_id") ?? "");
    const selectedCategory = categories.find((item) => item.id === categoryId);
    const coverValue = form.get("cover_image");
    const coverFile = coverValue instanceof File && coverValue.size > 0 ? coverValue : null;

    if (coverFile) {
      const prepared = await prepareImageForUpload(coverFile, { maxEdge: 1600, quality: 0.8 });
      form.set("cover_image", prepared.file);
    }

    for (const row of uploadRows) {
      const value = form.get(`article_image_${row}`);
      if (value instanceof File && value.size > 0) {
        const prepared = await prepareImageForUpload(value, { maxEdge: 1600, quality: 0.8 });
        form.set(`article_image_${row}`, prepared.file);
      }
    }

    form.set("article_id", initial?.id ?? "");
    form.set("initial_slug", initial?.slug ?? "");
    form.set("initial_status", initial?.status ?? "");
    form.set("initial_published_at", initial?.published_at ?? "");
    form.set("initial_cover_image_path", initial?.cover_image_path ?? "");
    form.set("category_name", selectedCategory?.name ?? "");
    form.set("existing_images", JSON.stringify(existingImages.map(({ id, storage_path }) => ({ id, storage_path }))));
    form.set("upload_rows", uploadRows.join(","));

    const response = await fetch("/api/admin/articles/save", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "儲存請求失敗，請稍後再試。");

    await refreshPublicContent(["articles"], result.indexNowPaths ?? []).catch(() => undefined);
    router.push("/admin/articles"); router.refresh();
    } catch (error) {
      setMessage(`儲存失敗：${error instanceof Error ? error.message : "請稍後再試"}`);
    } finally {
      setSaving(false);
    }
  }

  return <form className="admin-editor" onSubmit={submit}>
    {message && <div className="admin-error" role="alert">{message}</div>}
    <label>文章標題<input name="title" required defaultValue={initial?.title ?? ""} /></label>
    <div className="admin-form-grid"><label>網址代稱<input name="slug" required pattern="[a-z0-9-]+" defaultValue={initial?.slug ?? ""} placeholder="safe-meeting-guide" /></label><label>文章分類<select name="category_id" required defaultValue={initial?.category_id ?? ""}><option value="" disabled>請選擇分類</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><small>分類請至「全站設定 → 文章分類管理」新增或修改。</small></label></div>
    <label>文章摘要<textarea name="excerpt" rows={3} defaultValue={initial?.excerpt ?? ""} /></label>
    <fieldset className="admin-gallery-editor admin-article-media-editor">
      <legend>文章封面圖片</legend><p className="admin-media-help">顯示順序為「文章標題 → 摘要 → 封面圖片 → 文章內文」，圖片會自動壓縮成適合網站的尺寸。</p>
      <div className="admin-form-grid"><label>更換封面圖片<input name="cover_image" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>封面圖片 ALT 描述<input name="cover_image_alt" defaultValue={initial?.cover_image_alt ?? ""} placeholder="自然描述圖片內容，勿堆疊關鍵字" /></label></div>
      {initial?.cover_image_path && <div className="admin-current-media"><p className="admin-current-file">目前封面：{initial.cover_image_path}</p><label><input type="checkbox" name="remove_cover" /> 儲存時移除目前封面</label></div>}
    </fieldset>
    <label>文章內文<textarea name="content" rows={14} defaultValue={initialContent} placeholder="每兩段之間留一個空白行" /></label>
    <fieldset className="admin-gallery-editor admin-article-media-editor">
      <legend>文章內文後圖片</legend>
      {existingImages.length > 0 && <div className="admin-article-existing-images">{existingImages.map((image, index) => <div className="admin-existing-image" key={image.id}><span>圖片 {index + 1} · {image.storage_path.split("/").pop()}</span><input name={`alt_${image.id}`} defaultValue={image.alt_text ?? ""} placeholder="這張圖片的自然內容描述" /><label><input type="checkbox" name={`remove_image_${image.id}`} /> 儲存時移除</label></div>)}</div>}
      <div className="admin-new-images"><div className="admin-new-images-heading"><div><strong>新增文章圖片</strong><p>圖片會依序顯示在文章內文下方，每張都能設定獨立 ALT 描述。</p></div><button type="button" onClick={() => setUploadRows((rows) => [...rows, Math.max(...rows, -1) + 1])}>＋ 再新增一張</button></div>
        {uploadRows.map((row, index) => <div className="admin-new-image-row" key={row}><span>新圖片 {index + 1}</span><label>選擇圖片<input name={`article_image_${row}`} type="file" accept="image/jpeg,image/png,image/webp" /></label><label>圖片 ALT 描述<input name={`article_image_alt_${row}`} placeholder="例如：舒壓前後的放鬆環境示意圖" /></label>{uploadRows.length > 1 && <button type="button" onClick={() => setUploadRows((rows) => rows.filter((item) => item !== row))}>移除此欄</button>}</div>)}
      </div>
    </fieldset>
    <div className="admin-form-grid"><label>狀態<select name="status" defaultValue={initial?.status ?? "draft"}><option value="draft">草稿</option><option value="published">發布</option><option value="archived">封存</option></select></label><label>排序<input name="sort_order" type="number" defaultValue={initial?.sort_order ?? 0} /></label></div>
    <div className="admin-form-grid"><label className="admin-check-row"><input name="is_featured" type="checkbox" defaultChecked={initial?.is_featured ?? false} />設為熱門文章</label><label>熱門排序<input name="featured_order" type="number" defaultValue={initial?.featured_order ?? 0} /></label></div>
    <div className="admin-form-grid"><label>SEO 標題<input name="seo_title" defaultValue={initial?.seo_title ?? ""} /></label><label>SEO 描述<textarea name="seo_description" rows={3} defaultValue={initial?.seo_description ?? ""} /></label></div>
    <button className="button primary" disabled={saving}>{saving ? "圖片處理與儲存中…" : "儲存文章"}</button>
  </form>;
}
