const MINIMUM_LENGTH = 3;
export const MAXIMUM_SHORT_LABEL_LENGTH = 4;

export function shortLabels(labels: string[]): Map<string, string> {
  const distinct = [...new Set(labels)];
  const folded = distinct.map((label) => label.toLocaleLowerCase());
  const preferred = distinct.map((label, index) =>
    uniquePrefix(label, folded.filter((_, other) => other !== index)) ?? wordStarts(label));
  const shared = new Map<string, number>();
  for (const code of preferred) shared.set(code.toLocaleLowerCase(), (shared.get(code.toLocaleLowerCase()) ?? 0) + 1);
  const ordinals = new Map<string, number>();
  return new Map(distinct.map((label, index) => {
    const key = preferred[index].toLocaleLowerCase();
    if (shared.get(key) === 1) return [label, preferred[index]];
    const ordinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, ordinal);
    const stem = [...label].slice(0, MAXIMUM_SHORT_LABEL_LENGTH - String(ordinal).length).join("").trimEnd();
    return [label, `${stem}${ordinal}`];
  }));
}

function uniquePrefix(label: string, others: string[]): string | undefined {
  const letters = [...label];
  const longest = Math.min(MAXIMUM_SHORT_LABEL_LENGTH, letters.length);
  for (let length = Math.min(MINIMUM_LENGTH, letters.length); length <= longest; length++) {
    if (length === letters.length) return label;
    if (/\s/.test(letters[length - 1])) continue;
    const code = letters.slice(0, length).join("");
    if (!others.some((other) => other.startsWith(code.toLocaleLowerCase()))) return code;
  }
  return undefined;
}

function wordStarts(label: string): string {
  const [first, ...rest] = label.split(/[\s-]+/).filter(Boolean);
  const code = rest.length === 0 ? [...label] : [...[...first].slice(0, 2), ...rest.map((word) => [...word][0])];
  return code.slice(0, MAXIMUM_SHORT_LABEL_LENGTH).join("");
}
