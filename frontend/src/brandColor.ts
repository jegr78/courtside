const DARK_TEXT = "#17211d";
const LIGHT_TEXT = "#fcfbf9";

export interface BrandContrast {
  textColor: string;
  tone: "dark" | "light";
  ratio: number;
}

export function brandContrast(background: string): BrandContrast | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return undefined;
  const darkRatio = contrastRatio(background, DARK_TEXT);
  const lightRatio = contrastRatio(background, LIGHT_TEXT);
  return darkRatio >= lightRatio
    ? { textColor: DARK_TEXT, tone: "dark", ratio: darkRatio }
    : { textColor: LIGHT_TEXT, tone: "light", ratio: lightRatio };
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
