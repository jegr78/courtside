import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { declaredRoutes, ROUTER_FILES, routePattern } from "./declared-routes";

it("given nested, index, layout and catch-all routes, when the tree is read, then every page appears once with its full path", () => {
  // given
  const source = `<Routes>
    <Route element={<Shell open={a > b} />}>
      <Route index element={ready ? <Overview /> : <Navigate to="/x" replace />} />
      <Route path="facility">
        <Route index element={<Navigate to="/admin/facility/courts" replace />} />
        <Route path="courts" element={<Courts />} />
        <Route path="cards/:cardId" element={<Card />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>`;

  // when
  const routes = declaredRoutes(source, "/admin");

  // then
  expect(routes).toEqual([
    { path: "/admin", redirect: false },
    { path: "/admin/facility", redirect: true },
    { path: "/admin/facility/courts", redirect: false },
    { path: "/admin/facility/cards/:cardId", redirect: false }
  ]);
});

it("given the application's own router, when it is read, then every administration destination is one of its pages", () => {
  // given
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, "../src", file), "utf8");
  const pages = [...declaredRoutes(read("App.tsx")), ...declaredRoutes(read("views/AdminRoutes.tsx"), "/admin")];
  const destinations = [...read("components/AdminNavigation.tsx").matchAll(/\bto: "([^"]+)"/g)].map((match) => match[1]);

  // when
  const unmatched = destinations.filter((destination) => !pages.some((page) => routePattern(page.path).test(destination)));

  // then
  expect(destinations.length, "the navigation's destinations are read").toBeGreaterThan(10);
  expect(unmatched, "a destination the router does not declare").toEqual([]);
});

it("given the application's sources, when they are searched for route declarations, then only the files the sweeps read declare any", () => {
  // given
  const sources = resolve(import.meta.dirname, "../src");

  // when
  const declaring = readdirSync(sources, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) => /<Route\b/.test(readFileSync(resolve(sources, file), "utf8")))
    .map((file) => file.split(sep).join("/"))
    .sort();

  // then
  expect(declaring, "a router file the page sweeps would never open").toEqual(ROUTER_FILES.map(({ file }) => file).sort());
});

it("when a parameter route is matched, then only one path segment fills the parameter", () => {
  // when
  const pattern = routePattern("/admin/roster/:personId");

  // then
  expect([pattern.test("/admin/roster/42"), pattern.test("/admin/roster/42/edit"), pattern.test("/admin/roster")])
    .toEqual([true, false, false]);
});
