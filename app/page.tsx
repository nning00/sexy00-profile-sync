import Image from "next/image";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import AgeGate from "@/components/AgeGate";
import RegionNav from "@/components/RegionNav";
import MobileMenu from "@/components/MobileMenu";
import { getContentSettings, getPublicNavigation, getPublishedArticles, getSiteSettings, mediaUrl, serviceMediaUrl } from "@/lib/cms";
import ArticleCards from "@/components/ArticleCards";
import JsonLd from "@/components/JsonLd";
import { regions as fallbackRegions } from "@/data/regions";
import { optimizedMediaSrcSet, optimizedMediaUrl } from "@/lib/media-image";
import type { CSSProperties } from "react";

const fallbackFaqs = [
  { question: "如何進行預約諮詢？", answer: "請點選網站上的 LINE 按鈕，簡單說明希望了解的內容、日期與方便聯絡的時間。我們會透過 LINE 回覆並確認後續流程。" },
  { question: "網站提供哪些服務？", answer: "本站提供成人形象展示、合法的外出陪伴、定點會面與預約諮詢，不提供或安排任何違法服務。實際內容與界線皆須在預約前清楚確認。" },
  { question: "我的聯絡資料會被公開嗎？", answer: "不會。聯絡內容僅用於回覆諮詢與行程確認。我們不會在未經同意的情況下公開或任意分享你的個人資料。" },
  { question: "臨時需要更改或取消怎麼辦？", answer: "請儘早透過原本的 LINE 對話告知。實際變更與取消方式會依雙方預約時確認的內容處理。" },
  { question: "未滿 18 歲可以瀏覽或聯絡嗎？", answer: "不可以。本網站及相關諮詢僅限年滿 18 歲的成年人，未滿 18 歲請立即離開網站。" },
];

export default async function Home() {
  const [settings, content, navigation, publishedArticles] = await Promise.all([getSiteSettings(), getContentSettings(), getPublicNavigation(), getPublishedArticles()]);
  const featuredArticles = publishedArticles.filter((item) => item.is_featured).sort((a,b) => (a.featured_order ?? 0) - (b.featured_order ?? 0)).slice(0, 3);
  const faqItems = content.faqs.length ? content.faqs : fallbackFaqs;
  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  const quickRegionSource = navigation.regions.length ? navigation.regions : fallbackRegions;
  const quickRegions = quickRegionSource.slice(0, 4).map((region) => ({
    name: region.name,
    href: region.cities[0] ? `/regions/${region.slug}/${region.cities[0].slug}` : `/regions/${region.slug}`,
  }));
  const heroDesktop = optimizedMediaUrl(mediaUrl(settings.homepage.hero_image), 1600, 84);
  const heroMobile = optimizedMediaUrl(mediaUrl(settings.homepage.hero_image_mobile), 800, 82);
  return (
    <main className="home-page">
      <JsonLd data={faqStructuredData} />
      <link rel="preload" as="image" href={heroMobile} media="(max-width: 700px)" fetchPriority="high" />
      <link rel="preload" as="image" href={heroDesktop} media="(min-width: 701px)" fetchPriority="high" />
      <AgeGate />
      <header className="site-header home-header">
        <MobileMenu />
        <a className="brand" href="#top" aria-label={`${settings.brand.name}首頁`}>
          <BrandMark />
          <span>{settings.brand.name}</span>
        </a>
        <nav aria-label="主要選單">
          <a href="#about">{settings.navigation.about}</a>
          <a href="#services">{settings.navigation.services}</a>
          <a href="#gallery">{settings.navigation.gallery}</a>
          <a href="#faq">{settings.navigation.faq}</a>
          <a className="nav-cta" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">{settings.navigation.line_cta}</a>
        </nav>
      </header>
      <RegionNav />

      <section className="hero" id="top">
        <div className="hero-sun" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">{settings.brand.name} · TAIWAN</p>
          <h1>{settings.homepage.hero_title}</h1>
          <p className="hero-text">{settings.homepage.hero_text}</p>
          <div className="hero-actions">
            <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">{settings.homepage.hero_primary_cta}<span aria-hidden="true">↗</span></a>
            <a className="hero-text-link" href="#gallery">瀏覽形象內容 <span aria-hidden="true">↓</span></a>
          </div>
          <p className="adult-note">{settings.homepage.adult_note}</p>
        </div>
        <div className="hero-photo">
          <picture>
            <source media="(min-width: 701px)" srcSet={heroDesktop} />
            <img
              src={heroMobile}
              alt={settings.homepage.hero_image_alt}
              width="800"
              height="1000"
              fetchPriority="high"
              loading="eager"
              decoding="async"
              style={{
                "--hero-position-desktop": settings.homepage.hero_image_position_desktop,
                "--hero-position-mobile": settings.homepage.hero_image_position_mobile,
              } as CSSProperties}
            />
          </picture>
          <div className="hero-photo-note"><span>01</span><p>PRIVATE<br />JOURNAL</p></div>
        </div>
        <div className="hero-overlay" aria-hidden="true" />
      </section>

      <nav className="quick-regions" aria-label="熱門地區快速入口">
        <strong><span>EXPLORE</span> 熱門地區</strong>
        {quickRegions.map((region) => <Link href={region.href} key={region.href}>{region.name}</Link>)}
      </nav>

      <section className="intro section" id="about">
        <div className="intro-title">
          <span className="section-index">01</span>
          <p className="eyebrow">ABOUT THE EXPERIENCE</p>
          <h2>{settings.homepage.intro_title}</h2>
        </div>
        <div className="intro-copy">
          <p>{settings.homepage.intro_text}</p>
          <p>{settings.homepage.intro_legal_text}</p>
          <a href="#services">了解服務方式 <span aria-hidden="true">→</span></a>
        </div>
      </section>

      <section className="gallery-section section" id="gallery">
        <div className="section-heading gallery-heading">
          <div><span className="section-index">02</span><p className="eyebrow">VISUAL JOURNAL</p><h2>{settings.gallery.title}</h2></div>
          <p>{settings.gallery.description}</p>
        </div>
        <div className="gallery-grid">
          {settings.gallery.images.map((image, index) => {
            const imageUrl = mediaUrl(image.src);
            return (
              <figure className={`gallery-item item-${index + 1}`} key={`${index}-${image.src}`}>
                {/* Gallery uploads are already resized and converted before storage. Using the
                    original object preserves its true aspect ratio on every viewport. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={image.alt} width="900" height="1200" loading="lazy" decoding="async" fetchPriority="low" />
              </figure>
            )
          })}
        </div>
      </section>

      <section className="services section" id="services">
        <div className="section-heading">
          <span className="section-index">03</span>
          <p className="eyebrow">SERVICE GUIDE</p>
          <h2>{settings.homepage.services_title}</h2>
          <p>{settings.homepage.services_description}</p>
        </div>
        <div className="service-grid">
          {content.services.map((service, index) => (
            <article className="service-card" key={service.slug}>
              <Link className="service-image" href={`/services/${service.slug}`}>
                <Image src={serviceMediaUrl(service.image, settings.gallery.images[index % Math.max(settings.gallery.images.length, 1)]?.src ?? settings.homepage.hero_image)} alt={`${service.title}形象照`} fill sizes="(max-width: 560px) 33vw, 33vw" unoptimized style={{ objectPosition: service.image_position }} />
              </Link>
              <div className="service-body">
                <span>{service.number}</span>
                <h3>{service.title}</h3>
                <p>{service.text}</p>
                <Link href={`/services/${service.slug}`}>查看完整介紹 <span aria-hidden="true">→</span></Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="promise section">
        <div className="promise-image">
          {/* Supabase's image transformation endpoint supplies the responsive source. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={optimizedMediaUrl(mediaUrl(settings.homepage.promise_image), 1200, 82)} srcSet={optimizedMediaSrcSet(mediaUrl(settings.homepage.promise_image), [[640, 78], [900, 80], [1200, 82]])} alt={settings.homepage.promise_image_alt} width="1200" height="900" loading="lazy" decoding="async" fetchPriority="low" sizes="100vw" style={{ "--promise-position-desktop": settings.homepage.promise_image_position_desktop, "--promise-position-mobile": settings.homepage.promise_image_position_mobile } as CSSProperties} />
        </div>
        <div className="promise-overlay" aria-hidden="true" />
        <div className="promise-copy">
          <p className="eyebrow">OUR PROMISE</p>
          <h2>{settings.homepage.promise_title}</h2>
          <ul>
            <li><span>01</span><div><strong>{settings.homepage.promise_one_title}</strong><p>{settings.homepage.promise_one_text}</p></div></li>
            <li><span>02</span><div><strong>{settings.homepage.promise_two_title}</strong><p>{settings.homepage.promise_two_text}</p></div></li>
            <li><span>03</span><div><strong>{settings.homepage.promise_three_title}</strong><p>{settings.homepage.promise_three_text}</p></div></li>
          </ul>
        </div>
      </section>

      <section className="home-articles section" id="articles">
        <div className="section-heading centered"><span className="section-index">04</span><p className="eyebrow">READ & DISCOVER</p><h2>{settings.navigation.hot_articles}</h2><p>精選實用指南與最新內容，也可以依分類瀏覽完整文章。</p></div>
        <ArticleCards articles={featuredArticles.length ? featuredArticles : publishedArticles.slice(0, 3)} />
        <div className="home-articles-action"><Link className="button secondary" href="/articles">瀏覽全部文章</Link></div>
      </section>

      <section className="faq section" id="faq">
        <div className="section-heading centered">
          <span className="section-index">05</span>
          <p className="eyebrow">QUESTIONS & ANSWERS</p>
          <h2>{settings.homepage.faq_title}</h2>
          <p>{settings.homepage.faq_description}</p>
        </div>
        <div className="faq-list">
          {faqItems.map((faq, index) => (
            <details key={faq.question} open={index === 0}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{faq.question}</strong>
                <i aria-hidden="true">+</i>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="contact section" id="contact">
        <p className="eyebrow">READY WHEN YOU ARE</p>
        <h2>{settings.homepage.contact_title}</h2>
        <p>{settings.homepage.contact_text}</p>
        <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">{content.labels.line_cta}</a>
      </section>

    </main>
  );
}
