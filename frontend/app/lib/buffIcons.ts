const BUFF_ICON_PATH_OVERRIDES: Record<string, string> = {
  "心诤": "/icons/心诤-buff.png",
  "散流霞": "/icons/散流霞-buff.png",
  "长针": "/icons/长针-buff.png",
  "风袖低昂": "/icons/风袖低昂-buff.png",
};

export const FALLBACK_BUFF_ICON_PATH = "/icons/fallback.png";

export function resolveBuffIconPath(name: string, iconPath?: string) {
  return iconPath ?? BUFF_ICON_PATH_OVERRIDES[name] ?? `/icons/${name}.png`;
}

export function getBuffIconBackgroundImage(name: string, iconPath?: string) {
  const primaryPath = resolveBuffIconPath(name, iconPath);
  return `url("${primaryPath}"), url("${FALLBACK_BUFF_ICON_PATH}")`;
}