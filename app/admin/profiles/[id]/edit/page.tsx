import Link from "next/link";
import { notFound } from "next/navigation";
import ProfileForm from "@/components/admin/ProfileForm";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { getContentSettings } from "@/lib/cms";

export default async function EditProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnCity?: string }> }) {
  const { id } = await params;
  const { returnCity = "" } = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: profile }, { data: cityData }, { data: assignments }, { data: images }, content] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("cities").select("id,name,sort_order,regions(name,sort_order)").order("sort_order"),
    supabase.from("profile_cities").select("city_id").eq("profile_id", id),
    supabase.from("profile_images").select("id,storage_path,alt_text,sort_order").eq("profile_id", id).order("sort_order"),
    getContentSettings(),
  ]);
  if (!profile) notFound();
  const cities = [...(cityData ?? [])]
    .sort((a, b) => {
      const aRegion = a.regions as unknown as { name: string; sort_order: number } | null;
      const bRegion = b.regions as unknown as { name: string; sort_order: number } | null;
      return (aRegion?.sort_order ?? 999) - (bRegion?.sort_order ?? 999) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant");
    })
    .map((item) => ({ id: item.id, name: item.name, regionName: (item.regions as unknown as { name: string } | null)?.name ?? "其他" }));
  const detailLabels = { nationality: content.labels.profile_nationality_label, age: content.labels.profile_age_detail_label, height: content.labels.profile_height_label, weight: content.labels.profile_weight_label, cup: content.labels.profile_cup_label, environment: content.labels.profile_environment_label, serviceMethod: content.labels.profile_service_method_label, price: content.labels.profile_price_label, serviceArea: content.labels.profile_service_area_label, compatible: content.labels.profile_compatible_label, notAccepted: content.labels.profile_not_accepted_label, surcharge: content.labels.profile_surcharge_label, promotion: content.labels.profile_promotion_label };
  const returnUrl = `/admin/profiles${returnCity ? `?city=${returnCity}` : ""}`;
  return <main className="admin-page admin-form-page"><Link href={returnUrl}>← 返回形象列表</Link><h1>編輯形象</h1><ProfileForm initial={profile} cities={cities} initialCityIds={(assignments ?? []).map((item) => item.city_id)} existingImages={images ?? []} detailLabels={detailLabels} returnCityId={returnCity} /></main>;
}
