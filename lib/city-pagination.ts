export const CITY_PAGE_SIZE = 24;
export const MAX_CITY_PAGE = 10000;
export function isCityPageOutOfRange(error: { code?: string } | null, offset: number) {
  return offset > 0 && error?.code === "PGRST103";
}
export function cityPageNumber(value: unknown): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value)) return null;
  const page = Number(value);
  return page <= MAX_CITY_PAGE ? page : null;
}
export function cityPageHref(base: string, page: number) { return page === 1 ? base : `${base}?page=${page}`; }
export function cityPageLinks(page: number, totalPages: number) {
  return [...new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2])]
    .filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
}
