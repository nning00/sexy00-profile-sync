export const services = [
  { slug: "service-one", number: "01", title: "服務項目一", subtitle: "請在後台修改副標題", text: "這是可自由替換的服務項目示範內容。", image: "/placeholders/card-01.svg", points: ["示範說明一", "示範說明二", "示範說明三"] },
  { slug: "service-two", number: "02", title: "服務項目二", subtitle: "請在後台修改副標題", text: "這是可自由替換的服務項目示範內容。", image: "/placeholders/card-02.svg", points: ["示範說明一", "示範說明二", "示範說明三"] },
  { slug: "service-three", number: "03", title: "服務項目三", subtitle: "請在後台修改副標題", text: "這是可自由替換的服務項目示範內容。", image: "/placeholders/card-03.svg", points: ["示範說明一", "示範說明二", "示範說明三"] },
] as const;

export type Service = (typeof services)[number];
