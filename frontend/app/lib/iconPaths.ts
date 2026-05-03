const ICON_ASSET_VERSION = "20260503";

function appendIconAssetVersion(path: string, queryString: string | undefined): string {
  if (!path.startsWith("/icons/")) {
    return queryString ? `${path}?${queryString}` : path;
  }

  if (queryString && /(?:^|&)v=/.test(queryString)) {
    return `${path}?${queryString}`;
  }

  const nextQuery = queryString
    ? `${queryString}&v=${ICON_ASSET_VERSION}`
    : `v=${ICON_ASSET_VERSION}`;

  return `${path}?${nextQuery}`;
}

export function encodeIconPublicPath(path: string | undefined | null): string | undefined {
  if (!path) return undefined;

  const [basePath, queryString] = path.split("?");
  const lastSlashIndex = basePath.lastIndexOf("/");
  if (lastSlashIndex < 0) return path;

  const prefix = basePath.slice(0, lastSlashIndex + 1);
  const rawFileName = basePath.slice(lastSlashIndex + 1);

  let decodedFileName = rawFileName;
  try {
    decodedFileName = decodeURIComponent(rawFileName);
  } catch {
    decodedFileName = rawFileName;
  }

  const encodedPath = `${prefix}${encodeURIComponent(decodedFileName)}`;
  return appendIconAssetVersion(encodedPath, queryString);
}

export function getAbilityIconPath(name: string | undefined | null): string | null {
  if (!name) return null;
  return encodeIconPublicPath(`/icons/${name}.png`) ?? null;
}