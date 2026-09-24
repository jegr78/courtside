import { contrastBetween, type BrandContrast } from "../brandColor";

const DARK = "#0f172a";
const LIGHT = "#ffffff";

export function cardContrast(color: string): BrandContrast | undefined {
  return contrastBetween(color, DARK, LIGHT);
}

export function contrastColor(color: string): string {
  return cardContrast(color)?.textColor ?? DARK;
}
