import { buildResourcePackManifest, collectResourcePackFiles } from "../resourcePackFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const files = await collectResourcePackFiles();

  return Response.json(buildResourcePackManifest(files), {
    headers: {
      "Cache-Control": "no-cache",
    },
  });
}