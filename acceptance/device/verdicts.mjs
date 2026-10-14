export const MIN_TOUCH_TARGET = 44;
export const MIN_TEXT_CONTRAST = 4.5;

const channels = (rgb) => {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb ?? "");
  if (!match) throw new Error(`not an rgb colour: ${rgb}`);
  return match.slice(1, 4).map(Number);
};

const luminance = (rgb) => {
  const [r, g, b] = channels(rgb).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const pass = (reason) => ({ verdict: "pass", reason });
const fail = (reason) => ({ verdict: "fail", reason });

const JUDGES = {
  "theme-switch": ({ afterOneSecond }) => {
    const faint = afterOneSecond.filter((label) => contrast(label.color, label.background) < MIN_TEXT_CONTRAST);
    return faint.length === 0 ? pass("inherited text is readable one second after switching to light")
      : fail(`below ${MIN_TEXT_CONTRAST}:1 one second after the switch: ${faint.map((label) => label.label).join(", ")}`);
  },
  "select-heights": ({ fields }) => {
    const low = fields.filter((field) => field.tag === "select" && !(field.height >= MIN_TOUCH_TARGET));
    return low.length === 0 ? pass(`every select is at least ${MIN_TOUCH_TARGET} px high`)
      : fail(`lower than ${MIN_TOUCH_TARGET} px: ${low.map((field) => `${field.testId} ${field.height} px`).join(", ")}`);
  },
  "saved-message": ({ placement }) => placement.inView ? pass("the confirmation is in view after saving")
    : fail(`the confirmation sits ${placement.top < 0 ? -placement.top : placement.top - placement.viewport} px outside the viewport`),
  "service-worker": ({ controlled }) => controlled ? pass("a service worker controls the page") : fail("no service worker controls the page"),
  "outage": () => pass("the server became unreachable for the iPhone and came back"),
  "offline-bookings": ({ offline, plan, cancelled }) => {
    const missing = [
      !offline?.listed && "the booking in My bookings",
      !offline?.offlineStatus && "the offline status",
      !offline?.asOf && "the as-of note",
      !plan?.notice && "the plan's offline notice"
    ].filter(Boolean);
    if (!cancelled?.endsWith("verified")) missing.push("a verified cancellation of the test booking");
    return missing.length === 0 ? pass(`offline view after at most ${offline.within} s`) : fail(`missing: ${missing.join(", ")}`);
  }
};

export function judge(check) {
  if (check.skipped) return { verdict: "skipped", reason: check.skipped };
  if (check.error) return { verdict: "error", reason: check.error };
  const judgeOf = JUDGES[check.check];
  if (!judgeOf) throw new Error(`no verdict defined for ${check.check}`);
  return judgeOf(check);
}
