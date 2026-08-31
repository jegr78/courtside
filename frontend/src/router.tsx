import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { App } from "./App";
import { ClubConfigurationProvider } from "./club/ClubConfigurationProvider";
import { ApplicationErrorView } from "./views/ApplicationErrorView";

// The application keeps its own route tree behind one splat route: what a data router adds here is
// navigation blocking, which react-router refuses to provide under BrowserRouter.
export const appRoute: RouteObject = {
  path: "*",
  element: <ClubConfigurationProvider><App /></ClubConfigurationProvider>,
  errorElement: <ApplicationErrorView />
};

export function createAppRouter() {
  return createBrowserRouter([appRoute]);
}
