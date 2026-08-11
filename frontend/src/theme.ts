export type Theme = "dark" | "light";

export function initialTheme(): Theme {
  return window.localStorage?.getItem("courtside.theme") === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme: Theme): void {
  window.localStorage?.setItem("courtside.theme", theme);
  applyTheme(theme);
}

applyTheme(initialTheme());
