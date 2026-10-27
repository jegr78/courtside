import { createHash } from "node:crypto";

export function runDataMaskProbe({ mode }) {
  const root = document.documentElement;
  const width = mode === "full" ? Math.max(root.scrollWidth, innerWidth) : innerWidth;
  const height = mode === "full" ? Math.max(root.scrollHeight, document.body.scrollHeight, innerHeight) : innerHeight;
  const capture = { width, height, devicePixelRatio, userAgent: navigator.userAgent, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, mode, scrollX, scrollY };
  const masks = [];
  const styles = new WeakMap();
  const styleOf = (element) => {
    if (!styles.has(element)) styles.set(element, getComputedStyle(element));
    return styles.get(element);
  };
  const rounded = (number) => Math.round(number * 1000) / 1000;
  const path = (node) => {
    const parts = [];
    for (let current = node; current && current !== document.body && current.parentNode; current = current.parentNode) {
      parts.unshift(`${current.nodeType === Node.TEXT_NODE ? "text" : current.nodeName.toLowerCase()}:${[...current.parentNode.childNodes].indexOf(current)}`);
    }
    return parts.join("/");
  };
  const visible = (element) => {
    const style = styleOf(element);
    return style.display !== "none" && style.visibility === "visible" && Number(style.opacity) !== 0
      && (typeof element.checkVisibility !== "function" || element.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  };
  const elements = [document.documentElement, document.body, ...document.body.querySelectorAll("*")];
  const containedControlPseudo = (element, pseudo) => {
    const control = styleOf(element);
    if (!element.matches('input[type="checkbox"], input[type="radio"]') || !["grid", "inline-grid"].includes(control.display)
      || control.alignContent !== "center" || control.justifyContent !== "center" || control.transform !== "none" || control.filter !== "none") return false;
    const paint = getComputedStyle(element, pseudo);
    const origin = paint.transformOrigin.split(" ").map(parseFloat);
    const scale = paint.transform === "none" ? [1, 0, 0, 1, 0, 0] : /^matrix\(([^)]+)\)$/.exec(paint.transform)?.[1].split(",").map(Number);
    return paint.content === '""' && paint.position === "static" && paint.boxShadow === "none" && paint.filter === "none"
      && [paint, control].every((style) => [style.translate, style.rotate, style.scale, style.offsetPath].every((value) => ["none", "", undefined].includes(value)))
      && [paint.gridColumnStart, paint.gridColumnEnd, paint.gridRowStart, paint.gridRowEnd].every((value) => value === "auto")
      && control.gridTemplateColumns === paint.width && control.gridTemplateRows === paint.height
      && origin[0] === parseFloat(paint.width) / 2 && origin[1] === parseFloat(paint.height) / 2 && (origin[2] ?? 0) === 0
      && paint.outlineStyle === "none" && paint.backgroundImage === "none" && paint.textShadow === "none"
      && [paint.marginTop, paint.marginRight, paint.marginBottom, paint.marginLeft, paint.paddingTop, paint.paddingRight, paint.paddingBottom, paint.paddingLeft].every((value) => parseFloat(value) === 0)
      && [paint.borderTopWidth, paint.borderRightWidth, paint.borderBottomWidth, paint.borderLeftWidth].every((value) => parseFloat(value) === 0)
      && parseFloat(paint.width) <= element.clientWidth && parseFloat(paint.height) <= element.clientHeight
      && scale?.length === 6 && scale.every(Number.isFinite) && scale[0] >= 0 && scale[0] <= 1 && scale[3] >= 0 && scale[3] <= 1
      && [scale[1], scale[2], scale[4], scale[5]].every((value) => value === 0);
  };
  if (elements.some((element) => {
    const style = styleOf(element);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    return (style.display === "list-item" && style.listStyleType !== "none")
      || ["::before", "::after"].some((pseudo) => !["none", "normal", ""].includes(getComputedStyle(element, pseudo).content) && !containedControlPseudo(element, pseudo));
  })) return { safe: true, capture, masks };
  const painted = elements.filter(visible).map((element) => {
    const box = element.getBoundingClientRect();
    let fixed = false;
    for (let parent = element; parent; parent = parent.parentElement) {
      if (["fixed", "sticky"].includes(styleOf(parent).position)) fixed = true;
    }
    return { element, box, fixed };
  });
  const add = (element, key, kind, rectangles) => {
    if (!visible(element) || rectangles.length === 0 || rectangles.length > 4) return;
    const style = styleOf(element);
    const properties = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantNumeric", "fontFeatureSettings", "lineHeight", "letterSpacing", "wordSpacing",
      "whiteSpace", "textOverflow", "overflowX", "overflowY", "color", "backgroundColor", "textDecoration", "textShadow", "direction", "textAlign", "colorScheme", "webkitTextFillColor", "webkitTextStrokeColor", "webkitTextStrokeWidth", "textDecorationThickness", "textUnderlineOffset"];
    const backgrounds = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const paint = styleOf(ancestor);
      if (paint.backgroundImage !== "none" || paint.filter !== "none" || paint.transform !== "none"
        || paint.clipPath !== "none" || !["none", ""].includes(paint.maskImage ?? "none") || paint.mixBlendMode !== "normal") return;
      for (const pseudo of ["::before", "::after"]) {
        if (!["none", "normal", ""].includes(getComputedStyle(ancestor, pseudo).content)) return;
      }
      backgrounds.push([path(ancestor), paint.backgroundColor, paint.opacity, paint.boxShadow,
        paint.borderTopColor, paint.borderRightColor, paint.borderBottomColor, paint.borderLeftColor,
        paint.color, paint.textDecoration, paint.textDecorationThickness, paint.textUnderlineOffset, paint.textShadow]);
    }
    const fingerprint = JSON.stringify([element.tagName, element.getAttribute("type") ?? "",
      element.closest("[lang]")?.getAttribute("lang") ?? "", properties.map((name) => style[name]), backgrounds]);
    const rects = [];
    for (const rectangle of rectangles) {
      if (rectangle.width <= 0 || rectangle.height <= 0) continue;
      let unsupported = false;
      for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const parentStyle = styleOf(ancestor);
        if (mode === "full" && ["fixed", "sticky"].includes(parentStyle.position)) unsupported = true;
        if (parentStyle.overflowX !== "visible" || parentStyle.overflowY !== "visible") {
          const clip = ancestor.getBoundingClientRect();
          if (rectangle.left < clip.left || rectangle.right > clip.right || rectangle.top < clip.top || rectangle.bottom > clip.bottom) unsupported = true;
        }
      }
      if (unsupported) return;
      if (painted.some((other) => {
        if (other.element === element || other.element.contains(element) || other.box.width <= 0 || other.box.height <= 0) return false;
        const horizontal = other.box.left < rectangle.right && other.box.right > rectangle.left;
        return horizontal && ((mode === "full" && other.fixed) || (other.box.top < rectangle.bottom && other.box.bottom > rectangle.top));
      })) return;
      const x = rectangle.left + (mode === "full" ? scrollX : 0);
      const y = rectangle.top + (mode === "full" ? scrollY : 0);
      if (x < 0 || y < 0 || x + rectangle.width > width || y + rectangle.height > height) return;
      if (mode !== "full") {
        const hit = document.elementFromPoint(rectangle.left + rectangle.width / 2, rectangle.top + rectangle.height / 2);
        if (!hit || !(hit === element || hit.contains(element))) return;
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
    if (!element || element.closest("script,style,textarea,select,option,svg,canvas,math,video") || !visible(element)) continue;
    const label = element.closest('[data-testid$="-label"]');
    const dateBucket = label?.matches('[data-testid^="statistics-bucket-"]') && label.closest('[data-testid="statistics-progression"]');
    if (label && !dateBucket) continue;
    const temporal = dateBucket || element.closest('time, [data-testid="usage-period"], [data-testid="utilisation-period"], [data-testid="booking-period"], [data-testid="allocation-period"], [data-testid="managed-period"], [data-testid="cancellation-period"], [data-testid^="day-selector-"], [data-testid^="mobile-day-selector-"]');
    const text = node.textContent ?? "";
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) continue;
    const matches = [];
    const record = (kind, expression, group = 0) => {
      for (const match of text.matchAll(expression)) {
        const value = match[group];
        const start = match.index + (group ? match[0].indexOf(value) : 0);
        const pattern = ["date", "time", "count"].includes(kind) ? value.replace(/\p{L}+/gu, "word").replace(/\d+/g, "number") : kind;
        matches.push({ kind, pattern, start, end: start + value.length });
      }
    };
    if (element.closest('[data-testid="build-identity"]')) {
      record("version", /\bv?\d+\.\d+\.\d+(?:-rc\.\d+)?(?:\s*[·•]\s*[a-f0-9]{7,40})?\b/g);
    } else {
      if (temporal) { record("date", dates); record("time", times); }
      if (element.closest('[data-testid^="day-selector-"], [data-testid^="mobile-day-selector-"]')) record("date", /\b\d{1,2}[/.]\d{1,2}\.?\b/g);
      const count = element.closest('[data-testid="my-messages-unread"], [data-testid="notifications-count"], [data-testid="series-creatable-count"]')
        || (element.closest('[data-testid="usage-report"]') && element.closest('[data-testid^="usage-"][data-testid$="-value"]'));
      if (count && /^\s*\d[\d.,\s]*(?:%|\+)?\s*$/.test(text)) record("count", /\d[\d.,]*(?:\s?%)?/g);
      record("generated-name", /\b(?:UAT-wording-|acceptance-welcome-|acceptance-headerless-|ACC-)([a-z0-9]{6,16})(?=[\s@-]|$)/g, 1);
      record("generated-name", /\b(?:Acceptance headerless |Acceptance Welcome )([a-z0-9]{6,16})\b/g, 1);
    }
    const accepted = [];
    for (const [index, match] of matches.entries()) {
      if (accepted.some((other) => match.start < other.end && match.end > other.start)) continue;
      accepted.push(match);
      const range = document.createRange();
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      add(element, `${path(node)}/${match.kind}:${index}:${match.pattern}`, match.kind, [...range.getClientRects()]);
    }
  }
  for (const input of document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"], input[type="text"][data-date-time-type]')) {
    if (!input.value || input.scrollLeft !== 0 || !visible(input)) continue;
    const localized = input.type === "text";
    const type = localized ? input.getAttribute("data-date-time-type") : input.type;
    if (localized) {
      const date = "(?:\\d{1,2}\\.\\d{1,2}\\.\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4})";
      const time = "(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,3})?)?(?:\\s?[AP]M)?";
      const pattern = type === "date" ? date : type === "time" ? time : type === "datetime-local" ? `${date} ${time}` : null;
      if (!pattern || input.hasAttribute("data-date-time-unparsed") || input.hasAttribute("data-empty") || !input.validity.valid || !new RegExp(`^${pattern}$`).test(input.value)) continue;
    }
    const box = input.getBoundingClientRect();
    const style = styleOf(input);
    if (style.direction !== "ltr" || !["start", "left"].includes(style.textAlign)) continue;
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const contentWidth = box.width - (left - box.left) - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) - (localized ? 0 : 32);
    const contentHeight = box.height - (top - box.top) - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    add(input, `${path(input)}/${localized ? `localized-input:${type}:${input.value.replace(/\d+/g, "number").replace(/[AP]M/g, "period")}` : "input:0"}`, type === "time" ? "time" : "date", [{ left, top, right: left + contentWidth, bottom: top + contentHeight, width: contentWidth, height: contentHeight }]);
  }
  return { safe: masks.length <= 500, capture, masks };
}

export function screenshotComparison(bytes, before, after) {
  return { schemaVersion: 3, safe: before.safe && after.safe && JSON.stringify(before) === JSON.stringify(after),
    image: { digest: createHash("sha256").update(bytes).digest("hex"), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    capture: before.capture, masks: before.masks.map((mask) => ({ ...mask, style: createHash("sha256").update(mask.style).digest("hex") })) };
}
