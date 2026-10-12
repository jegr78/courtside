const MINIMUM_LENGTH = 3;

export function shortLabels(labels: string[]): Map<string, string> {
  const distinct = [...new Set(labels)];
  const folded = distinct.map((label) => label.toLocaleLowerCase());
  return new Map(distinct.map((label, index) => {
    const letters = [...label];
    const others = folded.filter((_, other) => other !== index);
    for (let length = Math.min(MINIMUM_LENGTH, letters.length); length < letters.length; length++) {
      if (/\s/.test(letters[length - 1])) continue;
      const code = letters.slice(0, length).join("");
      if (!others.some((other) => other.startsWith(code.toLocaleLowerCase()))) return [label, code];
    }
    return [label, label];
  }));
}
