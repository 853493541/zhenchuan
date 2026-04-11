import { NextRequest } from "next/server";

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://127.0.0.1:5000";

async function proxyToBackend(req: NextRequest, path: string): Promise<Response> {
  const upstreamUrl = new URL(path, BACKEND_ORIGIN).toString();
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    cache: "no-store",
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);

  return new Response(req.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return proxyToBackend(req, "/full-exports/list");
}

export async function HEAD(req: NextRequest): Promise<Response> {
  return proxyToBackend(req, "/full-exports/list");
}
