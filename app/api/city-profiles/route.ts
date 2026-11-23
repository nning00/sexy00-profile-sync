import { NextRequest, NextResponse } from "next/server";
import { getPublishedProfilePageForCity, mediaUrl, profileCardPath } from "@/lib/cms";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export async function GET(request: NextRequest) {
  const region = request.nextUrl.searchParams.get("region")?.trim() ?? "";
  const city = request.nextUrl.searchParams.get("city")?.trim() ?? "";
  const rawOffset = request.nextUrl.searchParams.get("offset") ?? "0";
  const rawLimit = request.nextUrl.searchParams.get("limit") ?? "24";
  const offset = Number(rawOffset);
  const limit = Number(rawLimit);
  if (!SLUG_PATTERN.test(region) || !SLUG_PATTERN.test(city) || !/^(0|[1-9]\d{0,5})$/.test(rawOffset) || !/^[1-9]\d?$/.test(rawLimit) || offset > 239976 || limit > 48) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }

  const page = await getPublishedProfilePageForCity(region, city, offset, limit);
  const profiles = page.profiles.map((profile) => ({
    id: profile.id,
    slug: profile.slug,
    name: profile.display_name,
    image: mediaUrl(profileCardPath(profile)),
    imageAlt: `${profile.display_name}合法形象展示照片`,
  }));

  return NextResponse.json(
    { profiles, total: page.total },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } },
  );
}
