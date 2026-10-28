import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import MobileMenu from "@/components/MobileMenu";
import RegionNav from "@/components/RegionNav";
import { getSiteSettings } from "@/lib/cms";

export default async function SiteHeader() {
  const settings = await getSiteSettings();
  return <>
    <header className="site-header article-site-header">
      <MobileMenu />
      <Link className="brand" href="/" aria-label={`${settings.brand.name}首頁`}><BrandMark /><span>{settings.brand.name}</span></Link>
      <nav aria-label="主要選單">
        <Link href="/#about">{settings.navigation.about}</Link><Link href="/#services">{settings.navigation.services}</Link><Link href="/#gallery">{settings.navigation.gallery}</Link><Link href="/articles">全部文章</Link>
        <a className="nav-cta" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">{settings.navigation.line_cta}</a>
      </nav>
    </header>
    <RegionNav />
  </>;
}
