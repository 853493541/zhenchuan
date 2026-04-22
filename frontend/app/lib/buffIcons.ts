const BUFF_ICON_PATH_OVERRIDES: Record<string, string> = {
  "心诤": "/game/icons/心诤-buff.png",
  "散流霞": "/game/icons/散流霞-buff.png",
  "长针": "/game/icons/长针-buff.png",
  "风袖低昂": "/game/icons/风袖低昂-buff.png",
};

export const FALLBACK_BUFF_ICON_PATH = "/game/icons/fallback.png";

export function resolveBuffIconPath(name: string, iconPath?: string) {
  return iconPath ?? BUFF_ICON_PATH_OVERRIDES[name] ?? `/game/icons/${name}.png`;
}

export function getBuffIconBackgroundImage(name: string, iconPath?: string) {
  const primaryPath = resolveBuffIconPath(name, iconPath);
  return `url("${primaryPath}"), url("${FALLBACK_BUFF_ICON_PATH}")`;
}