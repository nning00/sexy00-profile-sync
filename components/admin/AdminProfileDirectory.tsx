"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ProfileItem = { id: string; slug: string; displayName: string; sortOrder: number; cityIds: string[] };
type CityItem = { id: string; name: string; regionId: string; sortOrder: number };
type RegionItem = { id: string; name: string; sortOrder: number };

export default function AdminProfileDirectory({ profiles, cities, regions, initialCityId = "" }: { profiles: ProfileItem[]; cities: CityItem[]; regions: RegionItem[]; initialCityId?: string }) {
  const [view, setView] = useState<"regions" | "all" | "unassigned">("regions");
  const [search, setSearch] = useState("");
  const [activeCityId, setActiveCityId] = useState(initialCityId);
  useEffect(() => {
    if (initialCityId) {
      sessionStorage.setItem("adminProfilesActiveCity", initialCityId);
      return;
    }
    const rememberedCity = sessionStorage.getItem("adminProfilesActiveCity");
    if (rememberedCity && cities.some((city) => city.id === rememberedCity)) {
      const timer = window.setTimeout(() => setActiveCityId(rememberedCity), 0);
      return () => window.clearTimeout(timer);
    }
  }, [cities, initialCityId]);
  const keyword = search.trim().toLocaleLowerCase("zh-Hant");
  const filteredProfiles = profiles.filter((profile) => !keyword || `${profile.displayName} ${profile.slug}`.toLocaleLowerCase("zh-Hant").includes(keyword));
  const unassigned = filteredProfiles.filter((profile) => profile.cityIds.length === 0);

  function profileList(items: ProfileItem[], cityId = "") {
    return <div className="admin-table admin-directory-table">{items.length ? items.map((item) => <Link href={`/admin/profiles/${item.id}/edit${cityId ? `?returnCity=${cityId}` : ""}`} key={item.id}>
      <strong>{item.displayName}</strong><span>{item.slug}</span><i>框架 {item.sortOrder}</i><b>編輯 →</b>
    </Link>) : <p>目前沒有符合的形象。</p>}</div>;
  }

  return <>
    <div className="admin-directory-tools">
      <div className="admin-directory-tabs">
        <button className={view === "regions" ? "active" : ""} type="button" onClick={() => setView("regions")}>依專區管理</button>
        <button className={view === "all" ? "active" : ""} type="button" onClick={() => setView("all")}>全部形象 <span>{profiles.length}</span></button>
        <button className={view === "unassigned" ? "active" : ""} type="button" onClick={() => setView("unassigned")}>尚未分類 <span>{profiles.filter((item) => item.cityIds.length === 0).length}</span></button>
      </div>
      <label className="admin-profile-search"><span>搜尋</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="輸入名稱或網址代稱" /></label>
    </div>
    {view === "all" && profileList(filteredProfiles)}
    {view === "unassigned" && <section className="admin-unassigned"><div><h2>尚未分類</h2><p>這些形象尚未勾選發布城市，可進入編輯後指定城市。</p></div>{profileList(unassigned)}</section>}
    {view === "regions" && <div className="admin-profile-regions">
      {regions.map((region, regionIndex) => {
        const regionCities = cities.filter((city) => city.regionId === region.id);
        const regionProfileIds = new Set(regionCities.flatMap((city) => profiles.filter((profile) => profile.cityIds.includes(city.id)).map((profile) => profile.id)));
        const activeRegionId = cities.find((city) => city.id === activeCityId)?.regionId;
        return <details className="admin-profile-region" open={activeRegionId ? activeRegionId === region.id : regionIndex === 0} key={region.id}>
          <summary><strong>{region.name}</strong><span>{regionProfileIds.size} 位形象</span></summary>
          <div className="admin-profile-city-list">
            {regionCities.map((city) => {
              const cityProfiles = filteredProfiles.filter((profile) => profile.cityIds.includes(city.id));
              const citySortOrders = profiles.filter((profile) => profile.cityIds.includes(city.id)).map((profile) => profile.sortOrder || 0);
              const nextSlot = Math.max(0, ...citySortOrders) + 1;
              return <details className="admin-profile-city" open={activeCityId === city.id} onToggle={(event) => {
                if (event.currentTarget.open) {
                  setActiveCityId(city.id);
                  sessionStorage.setItem("adminProfilesActiveCity", city.id);
                }
              }} key={city.id}>
                <summary><strong>{city.name}</strong><span>{cityProfiles.length} 位</span><i>展開管理</i></summary>
                <div className="admin-profile-city-actions"><Link href={`/admin/profiles/new?city=${city.id}&slot=${nextSlot}`}>＋ 新增{city.name}形象</Link></div>
                {profileList(cityProfiles, city.id)}
              </details>;
            })}
          </div>
        </details>;
      })}
    </div>}
  </>;
}
