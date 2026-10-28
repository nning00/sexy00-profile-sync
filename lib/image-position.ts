export const imagePositionOptions = [
  { value: "center center", label: "中央" },
  { value: "center top", label: "上方中央（臉部優先）" },
  { value: "left top", label: "左上" },
  { value: "right top", label: "右上" },
  { value: "left center", label: "左側中央" },
  { value: "right center", label: "右側中央" },
  { value: "center bottom", label: "下方中央" },
] as const;

export type ImagePosition = (typeof imagePositionOptions)[number]["value"];

const validImagePositions = new Set<string>(imagePositionOptions.map((option) => option.value));

export function normalizeImagePosition(value: unknown, fallback: ImagePosition = "center center"): ImagePosition {
  return typeof value === "string" && validImagePositions.has(value)
    ? value as ImagePosition
    : fallback;
}
