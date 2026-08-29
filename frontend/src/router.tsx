import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";

// The application keeps its own route tree behind one splat route: what a data router adds here is
// navigation blocking, which react-router refuses to provide under BrowserRouter.
export function createAppRouter() {
  return createBrowserRouter([{ path: "*", element: <App /> }]);
}
