const citySlugPrefixes: Array<[string, string]> = [
  ["台北", "taipei"], ["新北", "new-taipei"], ["基隆", "keelung"],
  ["桃園", "taoyuan"], ["新竹", "hsinchu"], ["苗栗", "miaoli"],
  ["台中", "taichung"], ["彰化", "changhua"], ["南投", "nantou"],
  ["雲林", "yunlin"], ["嘉義", "chiayi"], ["台南", "tainan"],
  ["高雄", "kaohsiung"], ["屏東", "pingtung"], ["宜蘭", "yilan"],
  ["花蓮", "hualien"], ["台東", "taitung"], ["澎湖", "penghu"],
  ["金門", "kinmen"],
];

export function profileSlugBaseFromCityName(cityName: string) {
  return citySlugPrefixes.find(([name]) => name === cityName)?.[1] ?? "profile";
}

export function toEnglishProfileSlug(slug: string) {
  for (const [cityName, englishPrefix] of citySlugPrefixes) {
    const match = slug.match(new RegExp(`^${cityName}(\\d+)$`));
    if (match) return `${englishPrefix}-${match[1]}`;
  }
  return slug;
}
