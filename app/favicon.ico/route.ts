import { NextResponse, type NextRequest } from "next/server";
import { getSiteSettings, mediaUrl } from "@/lib/cms";

export async function GET(request: NextRequest) {
  const { brand } = await getSiteSettings();
  return NextResponse.redirect(new URL(mediaUrl(brand.favicon_image), request.url), 307);
}
