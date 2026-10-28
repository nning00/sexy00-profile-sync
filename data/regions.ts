const city = (slug: string, name: string) => ({ slug, name });

// Neutral examples keep navigation usable before the database is configured.
export const regions = [
  { slug: "region-one", name: "專區一", english: "REGION ONE", summary: "請在後台修改專區介紹。", cities: [city("city-one", "城市一")], image: "/placeholders/card-01.svg" },
  { slug: "region-two", name: "專區二", english: "REGION TWO", summary: "請在後台修改專區介紹。", cities: [city("city-two", "城市二")], image: "/placeholders/card-02.svg" },
  { slug: "region-three", name: "專區三", english: "REGION THREE", summary: "請在後台修改專區介紹。", cities: [city("city-three", "城市三")], image: "/placeholders/card-03.svg" },
] as const;
