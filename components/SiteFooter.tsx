import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { articles as fallbackArticles } from "@/data/articles";
import { regions as fallbackRegions } from "@/data/regions";
import { getContentSettings, getPublicNavigation, getSiteSettings } from "@/lib/cms";
import { regionDisplayName } from "@/lib/region-display";

export default async function SiteFooter() {
  const [{ regions: regionData, articles: navigationArticles }, settings, content] = await Promise.all([
    getPublicNavigation(), getSiteSettings(), getContentSettings(),
  ]);
  const regions = regionData?.length ? regionData.map((region) => {
    const cities = [...(region.cities ?? [])].filter((city) => city.published).sort((a, b) => a.sort_order - b.sort_order);
    return { ...region, name: regionDisplayName(region.slug, region.name), cities, firstCity: cities[0]?.slug };
  }) : fallbackRegions.map((region) => ({ slug: region.slug, name: regionDisplayName(region.slug, region.name), cities: region.cities, firstCity: region.cities[0].slug }));
  const articleData = navigationArticles.slice(0, 5);
  const articles = articleData.length ? articleData : fallbackArticles.slice(0, 5);
  return <footer className="site-footer"><div className="footer-main">
    <div className="footer-about"><Link className="brand footer-brand" href="/"><BrandMark /><span>{settings.brand.name}</span></Link><p>{settings.brand.footer_text}</p><a className="footer-line" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">LINE 聯絡我們 →</a></div>
    <div className="footer-column"><h2>地區專區</h2>{regions.filter((region) => region.firstCity).map((region) => <Link href={`/regions/${region.slug}/${region.firstCity}`} key={region.slug}>{region.name}</Link>)}</div>
    <div className="footer-column"><h2>服務方式</h2>{content.services.map((service) => <Link href={`/services/${service.slug}`} key={service.slug}>{service.title}</Link>)}<Link href="/#faq">{content.labels.faq_heading}</Link></div>
    <div className="footer-column footer-articles"><h2>熱門文章</h2><Link href="/articles"><strong>瀏覽全部文章</strong></Link>{articles.map((article) => <Link href={`/articles/${article.slug}`} key={article.slug}>{article.title}</Link>)}</div>
    <nav className="footer-city-directory" aria-label="全部城市頁面">
      <h2>全部城市</h2>
      <div>{regions.flatMap((region) => region.cities.map((city) => <Link href={`/regions/${region.slug}/${city.slug}`} key={`${region.slug}-${city.slug}`}>{city.name}</Link>))}</div>
    </nav>
  </div><div className="footer-bottom"><p>{settings.brand.copyright_text}</p><div><Link href="/privacy">隱私權政策</Link><Link href="/terms">使用條款</Link><span>僅限年滿 18 歲成年人</span></div></div></footer>;
}
