import Link from "next/link";
import { notFound } from "next/navigation";
import ArticleForm from "@/components/admin/ArticleForm";
import { requireAdmin } from "@/lib/supabase/require-admin";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const [{ data }, { data: categories }, { data: images }] = await Promise.all([
    supabase.from("articles").select("*").eq("id", id).maybeSingle(),
    supabase.from("article_categories").select("id,name").eq("published", true).order("sort_order"),
    supabase.from("article_images").select("id,storage_path,alt_text,sort_order").eq("article_id", id).order("sort_order"),
  ]);
  if (!data) notFound();
  return <main className="admin-page admin-form-page"><Link href="/admin/articles">← 返回文章列表</Link><h1>編輯文章</h1><ArticleForm initial={data} categories={categories ?? []} existingImages={images ?? []} /></main>;
}
