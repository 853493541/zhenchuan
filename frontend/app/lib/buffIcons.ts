export const FALLBACK_BUFF_ICON_PATH = "/game/icons/buffs/fallback.png";

export function resolveBuffIconPath(name: string, iconPath?: string) {
  return iconPath ?? `/game/icons/buffs/${name}.png`;
}

export function getBuffIconBackgroundImage(name: string, iconPath?: string) {
  const primaryPath = resolveBuffIconPath(name, iconPath);
  return `url("${primaryPath}"), url("${FALLBACK_BUFF_ICON_PATH}")`;
}