import { articles } from "@/data/articles";
import { getPublishedArticles } from "@/lib/cms";
import { SitemapUrl, sitemapSiteUrl, urlSetResponse, validSitemapDate } from "@/lib/sitemap-xml";

export const revalidate = 3600;

export async function GET() {
  const cmsArticles = await getPublishedArticles();
  const articleSource = cmsArticles.length ? cmsArticles : articles;
  const articlePages: SitemapUrl[] = articleSource.map((article) => ({
    url: `${sitemapSiteUrl}/articles/${article.slug}`,
    lastModified: validSitemapDate("updated_at" in article ? article.updated_at ?? article.published_at : article.date),
    changeFrequency: "monthly",
    priority: 0.65,
  }));

  return urlSetResponse(articlePages);
}
