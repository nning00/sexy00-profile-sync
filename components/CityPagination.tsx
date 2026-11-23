import Link from "next/link";
import { cityPageHref, cityPageLinks } from "@/lib/city-pagination";
export default function CityPagination({ base, page, totalPages }: { base: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const pages = cityPageLinks(page, totalPages);
  return <nav className="city-pagination" aria-label="形象列表分頁">
    {page > 1 && <Link href={cityPageHref(base, page - 1)} rel="prev" prefetch={false}>上一頁</Link>}
    {pages.map((number, index) => <span className="city-page-item" key={number}>
      {index > 0 && number > pages[index - 1] + 1 && <span className="city-page-gap" aria-hidden="true">…</span>}
      <Link href={cityPageHref(base, number)} aria-label={`第 ${number} 頁`} aria-current={number === page ? "page" : undefined} prefetch={false}>{number}</Link>
    </span>)}
    {page < totalPages && <Link href={cityPageHref(base, page + 1)} rel="next" prefetch={false}>下一頁</Link>}
  </nav>;
}
