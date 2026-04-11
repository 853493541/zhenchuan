import { NextRequest } from "next/server";

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://127.0.0.1:5000";

type RouteParams = {
  packageName: string;
  filePath?: string[];
};

async function proxyToBackend(req: NextRequest, params: RouteParams): Promise<Response> {
  const segments = [params.packageName, ...(params.filePath || [])]
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));

  const relPath = `/full-exports/${segments.join("/")}`;
  const upstreamUrl = new URL(relPath, BACKEND_ORIGIN).toString();

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

export async function GET(
  req: NextRequest,
  context: { params: Promise<RouteParams> },
): Promise<Response> {
  const params = await context.params;
  return proxyToBackend(req, params);
}

export async function HEAD(
  req: NextRequest,
  context: { params: Promise<RouteParams> },
): Promise<Response> {
  const params = await context.params;
  return proxyToBackend(req, params);
}
