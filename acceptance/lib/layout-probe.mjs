export const GERMAN = /\b(und|nicht|für|buchen|Platz|Plätze|Mitglied|Buchung|Buchungen|Anmelden|Abmelden|Einstellungen|Woche|heute|Uhr|speichern|abbrechen|zurück|Verein)\b|[äöüß]/i;
export const KEY = /(^|[^@\w.\/-])([a-z][a-zA-Z]+(?:\.[a-zA-Z0-9]+){1,})(?![\w\/@-])/g;
export const TLD = /\.(org|com|net|de|io|dev|app|eu|ts\.net)$/;

export function layoutProbe({ locale, german, key, tld }) {
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const describe = (element) =>
    `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.getAttribute("data-testid") ? `[data-testid="${element.getAttribute("data-testid")}"]` : ""}`;
  const visible = (element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const shown = typeof element.checkVisibility === "function"
      ? element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
    return shown && style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
  };
  const insideScroller = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") return true;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll("*")].filter(visible);
  const overflow = all.filter((element) => {
    const box = element.getBoundingClientRect();
    return (box.right > width + 1 || box.left < -1) && !insideScroller(element);
  }).map((element) => ({ selector: describe(element), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) }));
  const modal = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].filter(visible).at(-1);
  const clippedAway = (element, x, y) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX === "visible" && getComputedStyle(parent).overflowY === "visible") continue;
      const clip = parent.getBoundingClientRect();
      if (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom) return true;
    }
    return false;
  };
  const occluded = [...(modal ?? document).querySelectorAll("button, a[href], input, select, [role=button]")]
    .filter(visible).flatMap((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x > width || y > height || clippedAway(element, x, y)) return [];
      const top = document.elementFromPoint(x, y);
      if (!top || element.contains(top) || top.contains(element)) return [];
      const label = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null);
      if (label?.contains(top)) return [];
      return [{ selector: describe(element), by: describe(top) }];
    });
  const truncated = all.filter((element) => element.children.length === 0 && element.textContent?.trim()
    && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== "visible")
    .map((element) => ({ selector: describe(element), text: element.textContent.trim().slice(0, 60) }));
  const smallTargets = [...document.querySelectorAll("button, a[href], input, select")].filter(visible)
    .filter((element) => { const box = element.getBoundingClientRect(); return box.width < 44 || box.height < 44; })
    .map((element) => describe(element));
  const text = document.body.innerText;
  const i18nKeys = [...new Set([...text.matchAll(new RegExp(key, "g"))].map((match) => match[2])
    .filter((candidate) => !new RegExp(tld).test(candidate) && /[A-Z]|\..+\./.test(candidate)))];
  const germanOnEn = locale === "en"
    ? text.split("\n").filter((line) => new RegExp(german, "i").test(line)).slice(0, 20) : [];
  return { documentOverflow: document.documentElement.scrollWidth > width + 1, overflow, occluded, truncated, smallTargets, i18nKeys, germanOnEn };
}

export const layoutProbeArguments = (locale) => ({ locale, german: GERMAN.source, key: KEY.source, tld: TLD.source });
