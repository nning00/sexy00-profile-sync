"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseProfileDetails, profileDetailKeys, serializeProfileDetails, type ProfileDetailKey, type ProfileDetails } from "@/lib/profile-details";
import { LONG_IMAGE_CACHE_SECONDS, prepareImageForUpload } from "@/lib/image-upload";
import { refreshPublicContent } from "@/lib/refresh-public-content";
import { isOwnedMediaPath, scopedMediaPath } from "@/lib/site-instance";

type ProfileData = { id?: string; slug: string; display_name: string; style: string | null; interest: string | null; introduction: string | null; card_image_path: string | null; status: string; sort_order: number; seo_title: string | null; seo_description: string | null; adult_review_status?: "pending" | "verified" | "rejected" | null };
type CityOption = { id: string; name: string; regionName: string };
type ExistingImage = { id: string; storage_path: string; alt_text: string | null; sort_order: number };
const isVideoPath = (path: string) => /\.(mp4|webm)$/i.test(path);

export default function ProfileForm({ initial, cities = [], initialCityIds = [], defaultSortOrder = 0, existingImages = [], detailLabels, suggestedSlug = "", returnCityId = "" }: { initial?: ProfileData; cities?: CityOption[]; initialCityIds?: string[]; defaultSortOrder?: number; existingImages?: ExistingImage[]; detailLabels: Record<ProfileDetailKey, string>; suggestedSlug?: string; returnCityId?: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadRows, setUploadRows] = useState<number[]>([0]);

  async function deleteProfile() {
    if (!initial?.id) return;
    const confirmed = window.confirm(`確定要永久刪除「${initial.display_name}」嗎？\n\n主圖片、相簿照片、影片及城市關聯都會一併刪除，且無法復原。`);
    if (!confirmed) return;
    setSaving(true); setMessage("");
    const supabase = createClient();
    const storagePaths = [initial.card_image_path, ...existingImages.map((item) => item.storage_path)]
      .filter(isOwnedMediaPath);
    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage.from("site-media").remove(storagePaths);
      if (storageError) { setMessage(`刪除媒體失敗：${storageError.message}`); setSaving(false); return; }
    }
    const { error } = await supabase.from("profiles").delete().eq("id", initial.id);
    if (error) { setMessage(`刪除形象失敗：${error.message}`); setSaving(false); return; }
    await refreshPublicContent(["profiles", "regions"]).catch(() => undefined);
    router.push(`/admin/profiles${returnCityId ? `?city=${returnCityId}` : ""}`); router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const details = Object.fromEntries(profileDetailKeys.map((key) => [key, String(form.get(`detail_${key}`) ?? "").trim()])) as ProfileDetails;
    const slug = String(form.get("slug") ?? "").trim();
    let duplicateQuery = supabase.from("profiles").select("id,display_name").eq("slug", slug);
    if (initial?.id) duplicateQuery = duplicateQuery.neq("id", initial.id);
    const { data: duplicate } = await duplicateQuery.maybeSingle();
    if (duplicate) {
      setMessage(`網址代稱「${slug}」已被「${duplicate.display_name}」使用，請改成其他代稱，例如下一個編號。`);
      setSaving(false); return;
    }
    let imagePath = initial?.card_image_path ?? null;
    const file = form.get("image") as File;
    if (file?.size) {
      const prepared = await prepareImageForUpload(file);
      const path = scopedMediaPath(`profiles/${crypto.randomUUID()}.${prepared.extension}`);
      const { error: uploadError } = await supabase.storage.from("site-media").upload(path, prepared.file, {
        upsert: false,
        contentType: prepared.file.type,
        cacheControl: LONG_IMAGE_CACHE_SECONDS,
      });
      if (uploadError) { setMessage(`圖片上傳失敗：${uploadError.message}`); setSaving(false); return; }
      imagePath = path;
    }
    const payload = {
      slug, display_name: String(form.get("display_name") ?? "").trim(),
      style: initial?.style ?? "", interest: initial?.interest ?? "",
      introduction: serializeProfileDetails(details), card_image_path: imagePath,
      status: initial?.adult_review_status === "pending" ? "draft" : "published",
      adult_review_status: initial?.adult_review_status ?? "verified",
      sort_order: Number(form.get("sort_order") ?? 0),
      seo_title: String(form.get("seo_title") ?? "").trim(), seo_description: String(form.get("seo_description") ?? "").trim(),
    };
    const result = initial?.id
      ? await supabase.from("profiles").update(payload).eq("id", initial.id).select("id").single()
      : await supabase.from("profiles").insert(payload).select("id").single();
    if (result.error) {
      const errorMessage = result.error.code === "23505" ? `網址代稱「${slug}」已被使用，請更換一個不重複的代稱。` : `儲存失敗：${result.error.message}`;
      setMessage(errorMessage); setSaving(false); return;
    }
    const profileId = initial?.id ?? result.data.id;
    const cityIds = form.getAll("city_ids").map(String);
    const { error: removeError } = await supabase.from("profile_cities").delete().eq("profile_id", profileId);
    if (removeError) { setMessage(`地區更新失敗：${removeError.message}`); setSaving(false); return; }
    if (cityIds.length) {
      const { error: cityError } = await supabase.from("profile_cities").insert(cityIds.map((city_id) => ({ profile_id: profileId, city_id })));
      if (cityError) { setMessage(`地區更新失敗：${cityError.message}`); setSaving(false); return; }
    }
    const videoValue = form.get("profile_video");
    const newVideo = videoValue instanceof File && videoValue.size > 0 ? videoValue : null;
    if (newVideo && newVideo.size > 50 * 1024 * 1024) {
      setMessage("影片超過 50 MB，請先壓縮後再上傳。"); setSaving(false); return;
    }
    for (const image of existingImages) {
      if (form.get(`remove_image_${image.id}`) || (newVideo && isVideoPath(image.storage_path))) {
        const { error: deleteRowError } = await supabase.from("profile_images").delete().eq("id", image.id);
        if (deleteRowError) { setMessage(`相簿更新失敗：${deleteRowError.message}`); setSaving(false); return; }
        if (isOwnedMediaPath(image.storage_path)) await supabase.storage.from("site-media").remove([image.storage_path]);
      } else {
        await supabase.from("profile_images").update({ alt_text: String(form.get(`alt_${image.id}`) ?? "").trim() }).eq("id", image.id);
      }
    }
    const pendingImages = uploadRows.flatMap((row) => {
      const galleryFile = form.get(`gallery_image_${row}`);
      if (!(galleryFile instanceof File) || galleryFile.size === 0) return [];
      return [{ file: galleryFile, alt: String(form.get(`gallery_alt_${row}`) ?? "").trim() }];
    });
    for (const [index, pendingImage] of pendingImages.entries()) {
      const galleryFile = pendingImage.file;
      const prepared = await prepareImageForUpload(galleryFile);
      const storagePath = scopedMediaPath(`profiles/${profileId}/${crypto.randomUUID()}.${prepared.extension}`);
      const { error: galleryUploadError } = await supabase.storage.from("site-media").upload(storagePath, prepared.file, {
        upsert: false,
        contentType: prepared.file.type,
        cacheControl: LONG_IMAGE_CACHE_SECONDS,
      });
      if (galleryUploadError) { setMessage(`相簿上傳失敗：${galleryUploadError.message}`); setSaving(false); return; }
      const { error: imageRowError } = await supabase.from("profile_images").insert({ profile_id: profileId, storage_path: storagePath, alt_text: pendingImage.alt || payload.display_name, sort_order: existingImages.length + index + 1 });
      if (imageRowError) { setMessage(`相簿儲存失敗：${imageRowError.message}`); setSaving(false); return; }
      if (!imagePath && index === 0) {
        const { error: coverError } = await supabase.from("profiles").update({ card_image_path: storagePath }).eq("id", profileId);
        if (coverError) { setMessage(`封面設定失敗：${coverError.message}`); setSaving(false); return; }
        imagePath = storagePath;
      }
    }
    if (newVideo) {
      const extension = newVideo.name.split(".").pop()?.toLowerCase() || "mp4";
      const storagePath = scopedMediaPath(`profiles/${profileId}/${crypto.randomUUID()}.${extension}`);
      const { error: videoUploadError } = await supabase.storage.from("site-media").upload(storagePath, newVideo, { contentType: newVideo.type, cacheControl: "86400" });
      if (videoUploadError) {
        const hint = videoUploadError.message.includes("mime type") ? "Supabase 儲存桶尚未允許影片格式，請先執行影片支援設定。" : videoUploadError.message;
        setMessage(`影片上傳失敗：${hint}`); setSaving(false); return;
      }
      const videoDescription = String(form.get("profile_video_description") ?? "").trim();
      const { error: videoRowError } = await supabase.from("profile_images").insert({ profile_id: profileId, storage_path: storagePath, alt_text: videoDescription || `${payload.display_name}形象影片`, sort_order: existingImages.length + pendingImages.length + 1 });
      if (videoRowError) { setMessage(`影片儲存失敗：${videoRowError.message}`); setSaving(false); return; }
    }
    const destinationCityId = returnCityId || cityIds[0] || "";
    await refreshPublicContent(["profiles", "regions"]).catch(() => undefined);
    router.push(initial?.adult_review_status === "pending" ? "/admin/profiles/adult-review" : `/admin/profiles${destinationCityId ? `?city=${destinationCityId}` : ""}`); router.refresh();
    } catch (error) {
      setMessage(`儲存失敗：${error instanceof Error ? error.message : "請稍後再試"}`);
    } finally {
      setSaving(false);
    }
  }

  return <form className="admin-editor" onSubmit={submit}>
    {message && <div className="admin-error">{message}</div>}
    {initial?.adult_review_status === "pending" && <div className="admin-review-notice"><strong>這筆資料仍在等待成年確認</strong><p>你可以先修正內容，但儲存後仍不會出現在前台。請回到「待確認成年資料」完成確認與發布。</p></div>}
    <div className="admin-form-grid">
      <label>顯示名稱<input name="display_name" required defaultValue={initial?.display_name ?? ""} placeholder="例如：形象 A" /></label>
      <label>網址代稱<input name="slug" required pattern="[a-z0-9-]+" defaultValue={initial?.slug ?? suggestedSlug} placeholder="例如：taipei-1" /><small>僅使用英文小寫、數字與減號</small></label>
      <label>顯示排序<input name="sort_order" type="number" min="1" defaultValue={initial?.sort_order || defaultSortOrder || 1} /></label>
    </div>
    <label>主圖片<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label>
    {initial?.card_image_path && <p className="admin-current-file">目前圖片：{initial.card_image_path}</p>}
    <fieldset className="admin-profile-details">
      <legend>形象內頁資訊（每位形象分別填寫）</legend>
      <p>欄位名稱可到「共用文字與政策模組 → ④ 形象內頁資訊卡」修改；這裡只填這一位的答案。</p>
      <div className="admin-profile-details-grid">
        {profileDetailKeys.map((key, index) => {
          const values = parseProfileDetails(initial?.introduction, initial?.style ?? "", initial?.interest ?? "");
          const multiline = index >= 6;
          return <label className={multiline ? "wide" : ""} key={key}>{detailLabels[key]}
            {multiline
              ? <textarea name={`detail_${key}`} rows={3} defaultValue={values[key]} placeholder={`請填寫${detailLabels[key]}`} />
              : <input name={`detail_${key}`} defaultValue={values[key]} placeholder={`請填寫${detailLabels[key]}`} />}
          </label>;
        })}
      </div>
    </fieldset>
    <fieldset className="admin-gallery-editor">
      <legend>詳細頁相簿與 ALT 描述</legend>
      {existingImages.map((image) => <div className="admin-existing-image" key={image.id}>
        <span>{isVideoPath(image.storage_path) ? "影片 · " : "照片 · "}{image.storage_path.split("/").pop()}</span>
        <input name={`alt_${image.id}`} defaultValue={image.alt_text ?? ""} placeholder={isVideoPath(image.storage_path) ? "影片內容說明" : "這張圖片的自然文字描述"} />
        <label><input type="checkbox" name={`remove_image_${image.id}`} /> 儲存時移除此{isVideoPath(image.storage_path) ? "影片" : "圖片"}</label>
      </div>)}
      <div className="admin-new-images">
        <div className="admin-new-images-heading">
          <div><strong>新增相簿照片</strong><p>可逐張選擇照片並填寫描述，完成後只需儲存一次。</p></div>
          <button type="button" onClick={() => setUploadRows((rows) => [...rows, Math.max(...rows, -1) + 1])}>＋ 再新增一張</button>
        </div>
        {uploadRows.map((row, index) => <div className="admin-new-image-row" key={row}>
          <span>新照片 {index + 1}</span>
          <label>選擇圖片<input name={`gallery_image_${row}`} type="file" accept="image/jpeg,image/png,image/webp" /></label>
          <label>圖片 ALT 描述<input name={`gallery_alt_${row}`} placeholder="例如：咪娜在室內的形象照片" /></label>
          {uploadRows.length > 1 && <button type="button" onClick={() => setUploadRows((rows) => rows.filter((item) => item !== row))}>移除此欄</button>}
        </div>)}
      </div>
      <div className="admin-video-upload">
        <div><strong>形象影片（最多一部）</strong><p>支援 MP4、WebM；若已有影片，再上傳新影片會自動取代舊影片。</p></div>
        <label>選擇影片<input name="profile_video" type="file" accept="video/mp4,video/webm" /></label>
        <label>影片說明<input name="profile_video_description" placeholder="例如：室內形象短片" /></label>
      </div>
    </fieldset>
    <fieldset className="admin-city-picker">
      <legend>發布城市（可複選）</legend>
      {cities.length ? cities.map((city) => <label key={city.id}>
        <input type="checkbox" name="city_ids" value={city.id} defaultChecked={initialCityIds.includes(city.id)} />
        <span>{city.regionName} · {city.name}</span>
      </label>) : <p>尚未建立地區資料，請先到「地區版面管理」初始化。</p>}
    </fieldset>
    <div className="admin-form-grid">
      <label>SEO 標題<input name="seo_title" defaultValue={initial?.seo_title ?? ""} /></label>
      <label>SEO 描述<textarea name="seo_description" rows={3} defaultValue={initial?.seo_description ?? ""} /></label>
    </div>
    <div className="admin-profile-actions">
      <button className="button primary" disabled={saving}>{saving ? "處理中…" : "儲存並發布"}</button>
      {initial?.id && <button className="admin-delete-profile" type="button" disabled={saving} onClick={deleteProfile}>永久刪除此形象</button>}
    </div>
  </form>;
}
