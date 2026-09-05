export const IMPORT_STEPS = ["source", "preview", "execution"] as const;

export type ImportStep = typeof IMPORT_STEPS[number];
