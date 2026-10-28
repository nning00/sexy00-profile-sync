import Link from "next/link";
import ProfileForm from "@/components/admin/ProfileForm";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { getContentSettings } from "@/lib/cms";
import { profileSlugBaseFromCityName } from "@/lib/profile-slugs";

export default async function NewProfilePage({ searchParams }: { searchParams: Promise<{ city?: string; slot?: string }> }) {
  const { supabase } = await requireAdmin();
  const { city, slot } = await searchParams;
  const [{ data }, { data: existingProfiles }, content] = await Promise.all([supabase.from("cities").select("id,name,sort_order,regions(name,sort_order)").order("sort_order"), supabase.from("profiles").select("slug"), getContentSettings()]);
  const cities = [...(data ?? [])]
    .sort((a, b) => {
      const aRegion = a.regions as unknown as { name: string; sort_order: number } | null;
      const bRegion = b.regions as unknown as { name: string; sort_order: number } | null;
      return (aRegion?.sort_order ?? 999) - (bRegion?.sort_order ?? 999) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant");
    })
    .map((item) => ({ id: item.id, name: item.name, regionName: (item.regions as unknown as { name: string } | null)?.name ?? "其他" }));
  const detailLabels = { nationality: content.labels.profile_nationality_label, age: content.labels.profile_age_detail_label, height: content.labels.profile_height_label, weight: content.labels.profile_weight_label, cup: content.labels.profile_cup_label, environment: content.labels.profile_environment_label, serviceMethod: content.labels.profile_service_method_label, price: content.labels.profile_price_label, serviceArea: content.labels.profile_service_area_label, compatible: content.labels.profile_compatible_label, notAccepted: content.labels.profile_not_accepted_label, surcharge: content.labels.profile_surcharge_label, promotion: content.labels.profile_promotion_label };
  const selectedCity = (data ?? []).find((item) => item.id === city);
  const cityName = selectedCity?.name ?? "";
  const slugBase = profileSlugBaseFromCityName(cityName);
  const pattern = cityName ? new RegExp(`^${slugBase}-(\\d+)$`) : null;
  const nextNumber = pattern ? Math.max(0, ...(existingProfiles ?? []).map((item) => Number(item.slug.match(pattern)?.[1] ?? 0))) + 1 : 0;
  const suggestedSlug = cityName ? `${slugBase}-${nextNumber}` : "";
  const returnUrl = `/admin/profiles${city ? `?city=${city}` : ""}`;
  return <main className="admin-page admin-form-page"><Link href={returnUrl}>← 返回形象列表</Link><h1>{cityName ? `新增${cityName}形象` : "新增形象"}</h1><ProfileForm cities={cities} initialCityIds={city ? [city] : []} defaultSortOrder={Math.max(1, Number(slot) || 1)} detailLabels={detailLabels} suggestedSlug={suggestedSlug} returnCityId={city} /></main>;
}
