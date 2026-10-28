// The distributable template intentionally contains no articles.
// Create original articles from the administrator dashboard.
export type TemplateArticle = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  sections: Array<[string, string]>;
  seo_title?: string;
  seo_description?: string;
};

export const articles: TemplateArticle[] = [];
