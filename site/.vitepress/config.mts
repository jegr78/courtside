import { defineConfig } from "vitepress";

const repository = "https://github.com/jegr78/courtside";

export default defineConfig({
  title: "Courtside",
  cleanUrls: true,
  lastUpdated: true,
  // A project page is served under the repository name, so every asset and link needs that prefix.
  base: "/courtside/",
  head: [["link", { rel: "icon", href: "/courtside/favicon.svg" }]],
  locales: {
    root: {
      label: "Deutsch",
      lang: "de-DE",
      description: "Platzbuchung für Sportvereine",
      themeConfig: {
        nav: [{ text: "Start", link: "/" },
          { text: "Für Mitglieder", link: "/member-guide" },
          { text: "Für Vorstände", link: "/board-guide" }],
        socialLinks: [{ icon: "github", link: repository }],
        footer: {
          message: "AGPL-3.0",
          copyright: `<a href="${repository}">Quellcode auf GitHub</a>`
        },
        darkModeSwitchLabel: "Erscheinungsbild",
        returnToTopLabel: "Nach oben",
        langMenuLabel: "Sprache wechseln",
        outline: { label: "Auf dieser Seite" }
      }
    },
    en: {
      label: "English",
      lang: "en-US",
      description: "Court booking for sports clubs",
      themeConfig: {
        nav: [{ text: "Start", link: "/en/" },
          { text: "For members", link: "/en/member-guide" },
          { text: "For boards", link: "/en/board-guide" }],
        socialLinks: [{ icon: "github", link: repository }],
        footer: {
          message: "AGPL-3.0",
          copyright: `<a href="${repository}">Source on GitHub</a>`
        }
      }
    }
  }
});
