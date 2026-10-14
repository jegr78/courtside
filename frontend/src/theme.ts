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
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyTheme(theme);
  // Reading a computed value settles the new colours while transitions are off, so none fades in.
  void window.getComputedStyle(root).color;
  root.classList.remove("theme-switching");
}

applyTheme(initialTheme());
