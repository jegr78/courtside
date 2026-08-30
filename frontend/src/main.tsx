import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "@fontsource-variable/archivo";
import "@fontsource-variable/geist-mono";
import { createAppRouter } from "./router";
import "./i18n";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>
);
