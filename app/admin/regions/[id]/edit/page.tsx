import Link from "next/link";
import { notFound } from "next/navigation";
import RegionEditor from "@/components/admin/RegionEditor";
import { requireAdmin } from "@/lib/supabase/require-admin";

export default async function EditRegionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase } = await requireAdmin();
  const [{ data: region }, { data: cities }] = await Promise.all([
    supabase.from("regions").select("id,name,slug,english_name,summary,sort_order,published").eq("id", id).maybeSingle(),
    supabase.from("cities").select("id,name,slug,page_title,summary,gallery_title,gallery_description,seo_title,seo_description,sort_order,published").eq("region_id", id).order("sort_order"),
  ]);
  if (!region) notFound();
  return <main className="admin-page admin-form-page"><Link href="/admin/regions">← 返回地區版面</Link><h1>編輯{region.name}</h1><RegionEditor region={region} initialCities={cities ?? []} /></main>;
}
