import { createReadStream } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { cookies } from "next/headers";
import { collectResourcePackFiles, RESOURCE_PACK_CACHE_NAME, type ResourcePackFile } from "../resourcePackFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAR_BLOCK_SIZE = 512;

function buildPackageManifest(files: ResourcePackFile[]) {
  return {
    schemaVersion: 1,
    format: "zhenchuan-resource-pack-tar-gzip-v1",
    generatedAt: Date.now(),
    cacheName: RESOURCE_PACK_CACHE_NAME,
    assets: files.map(({ url, size, category, packagePath, contentType }) => ({
      url,
      size,
      category,
      packagePath,
      contentType,
    })),
    totalAssets: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

function writeAscii(buffer: Buffer, value: string, offset: number, length: number) {
  const bytes = Buffer.from(value, "utf8");
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number) {
  const text = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, "0").slice(-(length - 1)) + "\0";
  buffer.write(text, offset, length, "ascii");
}

function buildTarHeader(name: string, size: number, mtime: number) {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  writeAscii(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, mtime, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeAscii(header, "ustar\0", 257, 6);
  writeAscii(header, "00", 263, 2);
  writeAscii(header, "zhenchuan", 265, 32);
  writeAscii(header, "zhenchuan", 297, 32);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

async function writeChunk(stream: PassThrough, chunk: Buffer | Uint8Array) {
  if (stream.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function writeTarBufferEntry(stream: PassThrough, name: string, body: Buffer, mtime: number) {
  await writeChunk(stream, buildTarHeader(name, body.length, mtime));
  await writeChunk(stream, body);
  const padding = (TAR_BLOCK_SIZE - (body.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  if (padding > 0) await writeChunk(stream, Buffer.alloc(padding));
}

async function writeTarFileEntry(stream: PassThrough, file: ResourcePackFile, mtime: number) {
  await writeChunk(stream, buildTarHeader(file.packagePath, file.size, mtime));
  for await (const chunk of createReadStream(file.filePath)) {
    await writeChunk(stream, chunk as Buffer);
  }
  const padding = (TAR_BLOCK_SIZE - (file.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  if (padding > 0) await writeChunk(stream, Buffer.alloc(padding));
}

async function ensureAdmin() {
  const cookieStore = await cookies();
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:5000";
  const res = await fetch(`${backendUrl}/api/auth/me`, {
    cache: "no-store",
    headers: {
      cookie: cookieStore.toString(),
    },
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null) as { user?: { isAdmin?: boolean } } | null;
  return data?.user?.isAdmin === true;
}

export async function GET() {
  const allowed = await ensureAdmin();
  if (!allowed) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const files = await collectResourcePackFiles();
  const manifest = Buffer.from(JSON.stringify(buildPackageManifest(files)), "utf8");
  const mtime = Math.floor(Date.now() / 1000);
  const tarStream = new PassThrough();
  const gzipStream = createGzip({ level: 9 });
  tarStream.pipe(gzipStream);

  void (async () => {
    try {
      await writeTarBufferEntry(tarStream, "manifest.json", manifest, mtime);
      for (const file of files) {
        await writeTarFileEntry(tarStream, file, mtime);
      }
      await writeChunk(tarStream, Buffer.alloc(TAR_BLOCK_SIZE * 2));
      tarStream.end();
    } catch (err) {
      tarStream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(Readable.toWeb(gzipStream) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="zhenchuan-resource-pack-${stamp}.tgz"`,
    },
  });
}
