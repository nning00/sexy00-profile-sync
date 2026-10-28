export async function refreshPublicContent(tags: string[], indexNowPaths: string[] = []) {
  const response = await fetch("/api/admin/revalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags, indexNowPaths }),
  });

  if (!response.ok) throw new Error("網站快取更新失敗，請重新整理後再試一次。");
}
