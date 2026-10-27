import { createHash } from "node:crypto";

export function runDataMaskProbe({ mode }) {
  const root = document.documentElement;
  const width = mode === "full" ? Math.max(root.scrollWidth, innerWidth) : innerWidth;
  const height = mode === "full" ? Math.max(root.scrollHeight, document.body.scrollHeight, innerHeight) : innerHeight;
  const capture = { width, height, devicePixelRatio, userAgent: navigator.userAgent, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, mode, scrollX, scrollY };
  const masks = [];
  const rounded = (number) => Math.round(number * 1000) / 1000;
  const path = (node) => {
    const parts = [];
    for (let current = node; current && current !== document.body; current = current.parentNode) {
      parts.unshift(`${current.nodeType === Node.TEXT_NODE ? "text" : current.nodeName.toLowerCase()}:${[...current.parentNode.childNodes].indexOf(current)}`);
    }
    return parts.join("/");
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility === "visible" && Number(style.opacity) !== 0
      && (typeof element.checkVisibility !== "function" || element.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  };
  const add = (element, key, kind, rectangles) => {
    if (!visible(element) || rectangles.length === 0 || rectangles.length > 4) return;
    const style = getComputedStyle(element);
    const properties = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantNumeric", "lineHeight", "letterSpacing", "wordSpacing",
      "whiteSpace", "textOverflow", "overflowX", "overflowY", "color", "backgroundColor", "textDecoration", "direction", "textAlign"];
    const fingerprint = [element.tagName, element.getAttribute("type") ?? "", element.closest("[lang]")?.getAttribute("lang") ?? "", ...properties.map((name) => style[name])].join("|");
    const rects = [];
    for (const rectangle of rectangles) {
      if (rectangle.width <= 0 || rectangle.height <= 0) continue;
      let unsupported = false;
      for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const parentStyle = getComputedStyle(ancestor);
        if (mode === "full" && ["fixed", "sticky"].includes(parentStyle.position)) unsupported = true;
        if (parentStyle.overflowX !== "visible" || parentStyle.overflowY !== "visible") {
          const clip = ancestor.getBoundingClientRect();
          if (rectangle.left < clip.left || rectangle.right > clip.right || rectangle.top < clip.top || rectangle.bottom > clip.bottom) unsupported = true;
        }
      }
      if (unsupported) return;
      const x = rectangle.left + (mode === "full" ? scrollX : 0);
      const y = rectangle.top + (mode === "full" ? scrollY : 0);
      if (x < 0 || y < 0 || x + rectangle.width > width || y + rectangle.height > height) return;
      if (mode !== "full") {
        const hit = document.elementFromPoint(rectangle.left + rectangle.width / 2, rectangle.top + rectangle.height / 2);
        if (!hit || !(element.contains(hit) || hit.contains(element))) return;
      }
      rects.push({ x: rounded(x), y: rounded(y), width: rounded(rectangle.width), height: rounded(rectangle.height) });
    }
    if (rects.length) masks.push({ key, kind, style: fingerprint, rects });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const months = "Jan(?:uary|uar)?|Feb(?:ruary|ruar)?|Mar(?:ch)?|März|Apr(?:il)?|May|Mai|Jun(?:e|i)?|Jul(?:y|i)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Okt(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Dez(?:ember)?";
  const dates = new RegExp(`\\b(?:\\d{1,2}\\.\\d{1,2}\\.\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4}|\\d{1,2}\\.?\\s+(?:${months})\\s+\\d{4}|(?:${months})\\s+\\d{1,2},?\\s+\\d{4})\\b`, "giu");
  const times = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[AP]M)?\b/g;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || element.closest("script,style,textarea,select,option") || !visible(element)) continue;
    const text = node.textContent ?? "";
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) continue;
    const matches = [];
    const record = (kind, expression, group = 0) => {
      for (const match of text.matchAll(expression)) {
        const value = match[group];
        const start = match.index + (group ? match[0].indexOf(value) : 0);
        matches.push({ kind, start, end: start + value.length });
      }
    };
    if (element.closest('[data-testid="build-identity"]')) {
      record("version", /\bv?\d+\.\d+\.\d+(?:-rc\.\d+)?(?:\s*[·•]\s*[a-f0-9]{7,40})?\b/g);
    } else {
      record("date", dates);
      record("time", times);
      if (element.closest('[data-testid^="day-selector-"], [data-testid^="mobile-day-selector-"]')) record("date", /\b\d{1,2}[/.]\d{1,2}\.?\b/g);
      const count = element.closest('[data-testid="my-messages-unread"], [data-testid="usage-report"], [data-testid="notifications-count"], [data-testid="series-creatable-count"]');
      if (count && /^\s*\d[\d.,\s]*(?:%|\+)?\s*$/.test(text)) record("count", /\d[\d.,]*(?:\s?%)?/g);
      record("generated-name", /\b(?:UAT-wording-|acceptance-welcome-|acceptance-headerless-|ACC-)([a-z0-9]{6,16})(?=[\s@-]|$)/g, 1);
      record("generated-name", /\b(?:Acceptance headerless |Welcome )([a-z0-9]{6,16})\b/g, 1);
    }
    const accepted = [];
    for (const [index, match] of matches.entries()) {
      if (accepted.some((other) => match.start < other.end && match.end > other.start)) continue;
      accepted.push(match);
      const range = document.createRange();
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      add(element, `${path(node)}/${match.kind}:${index}`, match.kind, [...range.getClientRects()]);
    }
  }
  for (const input of document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]')) {
    if (!input.value || input.scrollLeft !== 0 || !visible(input)) continue;
    const box = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    if (style.direction !== "ltr" || !["start", "left"].includes(style.textAlign)) continue;
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const contentWidth = box.width - (left - box.left) - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) - 32;
    const contentHeight = box.height - (top - box.top) - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    add(input, `${path(input)}/input:0`, input.type === "time" ? "time" : "date", [{ left, top, right: left + contentWidth, bottom: top + contentHeight, width: contentWidth, height: contentHeight }]);
  }
  return { safe: masks.length <= 500, capture, masks };
}

export function screenshotComparison(bytes, before, after) {
  return { schemaVersion: 1, safe: before.safe && after.safe && JSON.stringify(before) === JSON.stringify(after),
    image: { digest: createHash("sha256").update(bytes).digest("hex"), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    capture: before.capture, masks: before.masks };
}
