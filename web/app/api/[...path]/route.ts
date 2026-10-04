import type { NextRequest } from "next/server";

// Server-side proxy to the Neon Function. Keeps APP_API_KEY out of the browser and avoids CORS.
async function proxy(req: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const url = `${process.env.API_BASE_URL}/${path.join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${process.env.APP_API_KEY}` };
  const type = req.headers.get("content-type");
  if (type) headers["content-type"] = type; // keeps the multipart boundary for photo uploads
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.method === "GET" ? undefined : await req.arrayBuffer(),
    cache: "no-store",
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

export { proxy as GET, proxy as POST };
