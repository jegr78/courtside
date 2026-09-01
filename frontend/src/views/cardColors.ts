const DARK = "#0f172a";
const LIGHT = "#ffffff";

export function contrastColor(color: string): string {
  const background = relativeLuminance(color);
  return contrastRatio(background, relativeLuminance(DARK)) >= contrastRatio(background, relativeLuminance(LIGHT))
    ? DARK : LIGHT;
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
