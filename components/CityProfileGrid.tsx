"use client";
import Link from "next/link";
import OptimizedMediaImage from "@/components/OptimizedMediaImage";
import { PROFILE_RETURN_KEY, profileReturnPath } from "@/lib/navigation";
import { cityPageHref } from "@/lib/city-pagination";
export type CityProfileCard = { id: string; slug: string; name: string; image: string; imageAlt: string };
export default function CityProfileGrid({ profiles, regionSlug, citySlug, page = 1 }: { profiles: CityProfileCard[]; regionSlug: string; citySlug: string; page?: number }) {
  const returnPath = profileReturnPath(cityPageHref(`/regions/${regionSlug}/${citySlug}`, page));
  return <div className="profile-grid">
    {profiles.map((profile, index) => <Link className="profile-card" href={`/profiles/${profile.slug}`} key={profile.id} prefetch={false}
      onClick={() => {
        // Optional browser-only context. Storage denial cannot stop navigation.
        try { sessionStorage.setItem(PROFILE_RETURN_KEY, JSON.stringify({ profilePath: `/profiles/${profile.slug}`, returnPath, at: Date.now() })); } catch { /* no storage */ }
      }}>
      <div className="profile-photo"><OptimizedMediaImage src={profile.image} alt={profile.imageAlt} fill fallbackWidth={480} preload={index === 0} sizes="(max-width: 680px) 50vw, 33vw" /></div>
      <div className="profile-info"><h3>{profile.name}</h3><span>點我查看資訊</span></div>
    </Link>)}
  </div>;
}
