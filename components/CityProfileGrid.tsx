"use client";

import { useState } from "react";
import Link from "next/link";
import OptimizedMediaImage from "@/components/OptimizedMediaImage";

const PAGE_SIZE = 24;

export type CityProfileCard = {
  id: string;
  slug: string;
  name: string;
  image: string;
  imageAlt: string;
};

export default function CityProfileGrid({ profiles: initialProfiles, total, regionSlug, citySlug }: { profiles: CityProfileCard[]; total: number; regionSlug: string; citySlug: string }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const remainingCount = Math.max(total - profiles.length, 0);

  async function loadMore() {
    if (loading || remainingCount === 0) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ region: regionSlug, city: citySlug, offset: String(profiles.length), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/city-profiles?${query.toString()}`);
      if (!response.ok) throw new Error("request-failed");
      const result = await response.json() as { profiles?: CityProfileCard[] };
      const existingIds = new Set(profiles.map((profile) => profile.id));
      setProfiles([...profiles, ...(result.profiles ?? []).filter((profile) => !existingIds.has(profile.id))]);
    } catch {
      setError("暫時無法載入更多資料，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <div className="profile-grid">
      {profiles.map((profile, index) => <Link className="profile-card" href={`/profiles/${profile.slug}`} key={profile.id}>
        <div className="profile-photo">
          <OptimizedMediaImage
            src={profile.image}
            alt={profile.imageAlt}
            fill
            preload={index === 0}
            sizes="(max-width: 680px) 50vw, 33vw"
          />
        </div>
        <div className="profile-info">
          <h3>{profile.name}</h3>
          <span>點我查看資訊</span>
        </div>
      </Link>)}
    </div>
    {remainingCount > 0 && <div className="profile-load-more">
      <button
        className="button secondary"
        type="button"
        disabled={loading}
        onClick={loadMore}
      >
        {loading ? "載入中…" : `載入更多（尚有 ${remainingCount} 位）`}
      </button>
    </div>}
    {error && <p className="profile-load-error" role="alert">{error}</p>}
  </>;
}
