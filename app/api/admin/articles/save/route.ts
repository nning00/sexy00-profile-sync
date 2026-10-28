import { NextResponse } from "next/server";
import { LONG_IMAGE_CACHE_SECONDS } from "@/lib/image-upload";
import { isOwnedMediaPath, scopedMediaPath } from "@/lib/site-instance";
import { createClient } from "@/lib/supabase/server";

type ExistingImage = { id: string; storage_path: string };

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function file(form: FormData, name: string) {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

function extensionFor(upload: File) {
  if (upload.type === "image/webp") return "webp";
  if (upload.type === "image/png") return "png";
  return upload.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "登入已失效，請重新登入後再儲存。" }, { status: 401 });
    const { data: admin } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!admin) return NextResponse.json({ error: "此帳號沒有後台編輯權限。" }, { status: 403 });

    const form = await request.formData();
    const articleId = text(form, "article_id") || null;
    const initialSlug = text(form, "initial_slug");
    const initialStatus = text(form, "initial_status");
    const initialCoverPath = text(form, "initial_cover_image_path") || null;
    const title = text(form, "title");
    const slug = text(form, "slug");
    const nextStatus = text(form, "status") || "draft";
    const categoryId = text(form, "category_id") || null;
    const categoryName = text(form, "category_name") || null;
    const contentText = text(form, "content");
    const coverFile = file(form, "cover_image");
    const removeCover = form.get("remove_cover") === "on";
    let coverImagePath = removeCover ? null : initialCoverPath;
    let uploadedCoverPath: string | null = null;

    if (!title || !slug || !categoryId) {
      return NextResponse.json({ error: "文章標題、網址代稱與分類為必填。" }, { status: 400 });
    }

    if (coverFile) {
      uploadedCoverPath = scopedMediaPath(`articles/covers/${crypto.randomUUID()}.${extensionFor(coverFile)}`);
      const { error } = await supabase.storage.from("site-media").upload(uploadedCoverPath, coverFile, {
        upsert: false,
        contentType: coverFile.type || "image/jpeg",
        cacheControl: LONG_IMAGE_CACHE_SECONDS,
      });
      if (error) return NextResponse.json({ error: `封面圖片上傳失敗：${error.message}` }, { status: 400 });
      coverImagePath = uploadedCoverPath;
    }

    const payload = {
      slug,
      title,
      excerpt: text(form, "excerpt"),
      category_id: categoryId,
      category: categoryName,
      content: contentText.split(/\n\s*\n/).filter(Boolean).map((paragraph) => ({ type: "paragraph", text: paragraph })),
      cover_image_path: coverImagePath,
      cover_image_alt: coverImagePath ? text(form, "cover_image_alt") || title : null,
      status: nextStatus,
      published_at: nextStatus === "published" ? text(form, "initial_published_at") || new Date().toISOString() : null,
      sort_order: Number(form.get("sort_order") ?? 0),
      seo_title: text(form, "seo_title"),
      seo_description: text(form, "seo_description"),
      is_featured: form.get("is_featured") === "on",
      featured_order: Number(form.get("featured_order") ?? 0),
    };

    const result = articleId
      ? await supabase.from("articles").update(payload).eq("id", articleId).select("id").single()
      : await supabase.from("articles").insert(payload).select("id").single();
    if (result.error) {
      if (uploadedCoverPath) await supabase.storage.from("site-media").remove([uploadedCoverPath]);
      return NextResponse.json({ error: `儲存失敗：${result.error.message}` }, { status: 400 });
    }
    const savedArticleId = articleId || result.data.id;

    if ((removeCover || uploadedCoverPath) && isOwnedMediaPath(initialCoverPath) && initialCoverPath !== uploadedCoverPath) {
      await supabase.storage.from("site-media").remove([initialCoverPath!]);
    }

    let existingImages: ExistingImage[] = [];
    try { existingImages = JSON.parse(text(form, "existing_images") || "[]") as ExistingImage[]; } catch { existingImages = []; }
    let remainingImageCount = 0;
    for (const image of existingImages) {
      if (form.get(`remove_image_${image.id}`) === "on") {
        const { error } = await supabase.from("article_images").delete().eq("id", image.id);
        if (error) return NextResponse.json({ error: `文章圖片更新失敗：${error.message}` }, { status: 400 });
        if (isOwnedMediaPath(image.storage_path)) await supabase.storage.from("site-media").remove([image.storage_path]);
      } else {
        const { error } = await supabase.from("article_images").update({
          alt_text: text(form, `alt_${image.id}`) || title,
          sort_order: remainingImageCount + 1,
        }).eq("id", image.id);
        if (error) return NextResponse.json({ error: `圖片 ALT 更新失敗：${error.message}` }, { status: 400 });
        remainingImageCount += 1;
      }
    }

    const uploadRows = text(form, "upload_rows").split(",").filter(Boolean);
    for (const [index, row] of uploadRows.entries()) {
      const upload = file(form, `article_image_${row}`);
      if (!upload) continue;
      const storagePath = scopedMediaPath(`articles/${savedArticleId}/${crypto.randomUUID()}.${extensionFor(upload)}`);
      const { error: uploadError } = await supabase.storage.from("site-media").upload(storagePath, upload, {
        upsert: false,
        contentType: upload.type || "image/jpeg",
        cacheControl: LONG_IMAGE_CACHE_SECONDS,
      });
      if (uploadError) return NextResponse.json({ error: `文章已儲存，但第 ${index + 1} 張圖片上傳失敗：${uploadError.message}` }, { status: 400 });
      const { error: imageError } = await supabase.from("article_images").insert({
        article_id: savedArticleId,
        storage_path: storagePath,
        alt_text: text(form, `article_image_alt_${row}`) || title,
        sort_order: remainingImageCount + index + 1,
      });
      if (imageError) {
        await supabase.storage.from("site-media").remove([storagePath]);
        return NextResponse.json({ error: `文章已儲存，但第 ${index + 1} 張圖片資料建立失敗：${imageError.message}` }, { status: 400 });
      }
    }

    const indexNowPaths = new Set<string>();
    if (nextStatus === "published") indexNowPaths.add(`/articles/${slug}`);
    if (initialStatus === "published" && initialSlug !== slug) indexNowPaths.add(`/articles/${initialSlug}`);
    if (initialStatus === "published" && nextStatus !== "published") indexNowPaths.add(`/articles/${initialSlug}`);
    return NextResponse.json({ ok: true, indexNowPaths: [...indexNowPaths] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "伺服器暫時無法儲存，請稍後再試。" }, { status: 500 });
  }
}
