const HEADER_BYTES = 64 * 1024;
const SEPARATORS = [",", ";", "\t"];
const LINE_BREAK = 0x0a;

export async function readCsvHeader(file: File, encoding = "UTF-8", separator?: string): Promise<string[]> {
  const head = await file.slice(0, HEADER_BYTES).arrayBuffer();
  const text = decode(wholeLines(new Uint8Array(head)), encoding);
  const [columns = []] = splitRecords(text, separator ?? separatorOf(text), 1);
  return columns.filter((column) => column.length > 0);
}

// Only ever a suggestion for the form: the source stores what the club confirms, and the server
// reads by that. Counting columns settles nothing for a file with one column or no header at all.
export async function suggestSeparator(file: File, encoding = "UTF-8"): Promise<string> {
  const head = await file.slice(0, HEADER_BYTES).arrayBuffer();
  return separatorOf(decode(wholeLines(new Uint8Array(head)), encoding));
}

// Reading a whole member list here is deliberate: the categories a club exports live in the rows,
// not the header, and the alternative is uploading personal data to learn a handful of words.
export async function readCsvColumn(file: File, header: string, encoding = "UTF-8", separator?: string): Promise<string[]> {
  const text = decode(new Uint8Array(await file.arrayBuffer()), encoding);
  const [columns = [], ...rows] = splitRecords(text, separator ?? separatorOf(text));
  const index = columns.indexOf(header);
  if (index < 0) return [];
  const values = rows.map((row) => row[index] ?? "").filter((value) => value.length > 0);
  return [...new Set(values)];
}

function separatorOf(text: string): string {
  let widest = SEPARATORS[0];
  let columns = 0;
  for (const candidate of SEPARATORS) {
    const [first = []] = splitRecords(text, candidate, 1);
    if (first.length > columns) {
      columns = first.length;
      widest = candidate;
    }
  }
  return widest;
}

function splitRecords(text: string, separator: string, limit = Number.MAX_SAFE_INTEGER): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let position = 0; position < text.length && records.length < limit; position++) {
    const character = text[position];
    if (quoted) {
      if (character === '"' && text[position + 1] === '"') {
        cell += '"';
        position++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === separator) {
      cells.push(cell);
      cell = "";
    } else if (character === "\n") {
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (records.length < limit && (cell.length > 0 || cells.length > 0)) {
    cells.push(cell);
    records.push(cells);
  }
  return records.map((record) => record.map((value) => value.trim()));
}

export class NotUtf8Error extends Error {}

// The server reads every character set its platform has; a browser reads the WHATWG set and no more.
export class EncodingUnreadableHereError extends Error {}

// A byte order mark and valid UTF-8 are facts about the bytes and outrank the chosen encoding.
// Which 8-bit encoding a file uses is not readable from its content, so that one is chosen.
function decode(bytes: Uint8Array, encoding: string): string {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return utf8(bytes.subarray(3));
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (isUtf8(encoding)) throw new NotUtf8Error("The file is not UTF-8");
    return decoderFor(encoding).decode(bytes);
  }
}

const isUtf8 = (encoding: string) => encoding.trim().toLowerCase() === "utf-8";

function decoderFor(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding);
  } catch {
    throw new EncodingUnreadableHereError(encoding);
  }
}

const utf8 = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

// A slice can cut a multi-byte character in half, and a half character would fail the strict
// decode above and make a perfectly good UTF-8 file look like something else.
function wholeLines(bytes: Uint8Array): Uint8Array {
  const lastBreak = bytes.lastIndexOf(LINE_BREAK);
  return lastBreak < 0 ? bytes : bytes.subarray(0, lastBreak + 1);
}

function startsWith(bytes: Uint8Array, mark: number[]): boolean {
  return bytes.length >= mark.length && mark.every((byte, index) => bytes[index] === byte);
}
