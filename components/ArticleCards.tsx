import Link from "next/link";
import Image from "next/image";
import { mediaUrl, type CmsArticle } from "@/lib/cms";

export function articleCategoryName(article: CmsArticle) { return article.article_categories?.name || article.category || "未分類"; }
export default function ArticleCards({ articles }: { articles: CmsArticle[] }) {
  return <div className="article-center-grid">{articles.map((article) => <Link className="article-center-card" href={`/articles/${article.slug}`} key={article.id || article.slug}>
    {article.cover_image_path && <div className="article-center-card-image"><Image src={mediaUrl(article.cover_image_path)} alt={article.cover_image_alt || article.title} fill sizes="(max-width: 560px) 100vw, (max-width: 900px) 50vw, 33vw" /></div>}
    <div className="article-center-card-copy"><span>{articleCategoryName(article)}</span><h2>{article.title}</h2><p>{article.excerpt || "點擊查看完整文章內容與相關說明。"}</p><strong>閱讀文章 →</strong></div>
  </Link>)}</div>;
}
