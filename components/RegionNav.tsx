import RegionNavClient from "@/components/RegionNavClient";
import { regions as fallbackRegions } from "@/data/regions";
import { articles as fallbackArticles } from "@/data/articles";
import { getPublicNavigation, getSiteSettings } from "@/lib/cms";
import { regionDisplayName } from "@/lib/region-display";

type RegionNavProps = {
  navigation?: Awaited<ReturnType<typeof getPublicNavigation>>;
  settings?: Awaited<ReturnType<typeof getSiteSettings>>;
};

export default async function RegionNav(props: RegionNavProps = {}) {
  const [navigation, settings] = props.navigation && props.settings
    ? [props.navigation, props.settings]
    : await Promise.all([getPublicNavigation(), getSiteSettings()]);
  const { regions: regionData, articles: navigationArticles } = navigation;
  const articleData = navigationArticles.slice(0, 8);
  const regions = regionData?.length ? regionData.map((region) => ({ slug: region.slug, name: regionDisplayName(region.slug, region.name), cities: [...(region.cities ?? [])].filter((city) => city.published).sort((a, b) => a.sort_order - b.sort_order).map(({ slug, name }) => ({ slug, name })) })) : fallbackRegions.map((region) => ({ slug: region.slug, name: regionDisplayName(region.slug, region.name), cities: region.cities.map((city) => ({ ...city })) }));
  const articles = articleData?.length ? articleData : fallbackArticles.map(({ slug, title }) => ({ slug, title }));
  return <RegionNavClient regions={regions} articles={articles} hotArticlesLabel={settings.navigation.hot_articles} />;
}

