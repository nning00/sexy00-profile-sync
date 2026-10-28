import Link from "next/link";
import type { ArticleCategory } from "@/lib/cms";
export default function ArticleCenterNav({ categories, active = "all" }: { categories: ArticleCategory[]; active?: string }) {
  return <nav className="article-category-tabs" aria-label="文章分類">
    <Link className={active === "all" ? "active" : ""} href="/articles">全部文章</Link>
    <Link className={active === "featured" ? "active" : ""} href="/articles?view=featured">熱門文章</Link>
    {categories.map((category) => <Link className={active === category.slug ? "active" : ""} href={`/articles/category/${category.slug}`} key={category.id}>{category.name}</Link>)}
  </nav>;
}
