import handler from "vinext/server/fetch-handler";

const PUBLIC_HTML_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
const CANONICAL_HOST = "sexy00.cc";

function withPublicHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const url = new URL(request.url);
  const isPublicPage = !url.pathname.startsWith("/admin") && !url.pathname.startsWith("/api");
  const isHtml = headers.get("content-type")?.toLowerCase().includes("text/html");
  if ((request.method === "GET" || request.method === "HEAD") && isPublicPage && isHtml && !headers.has("set-cookie")) {
    headers.set("Cache-Control", PUBLIC_HTML_CACHE_CONTROL);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname === "www.sexy00.cc" || (requestUrl.hostname === CANONICAL_HOST && requestUrl.protocol !== "https:")) {
      requestUrl.protocol = "https:";
      requestUrl.hostname = CANONICAL_HOST;
      return Response.redirect(requestUrl.toString(), 308);
    }
    const response = await handler.fetch(request, env, ctx);
    return withPublicHeaders(response, request);
  },
};

export default worker;

