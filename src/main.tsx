import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/public-sans";
import "./styles.css";
import { applyTheme } from "./lib/theme";
import { SessionProvider } from "./lib/session";
import { ToastProvider } from "./ui/kit";
import { App } from "./App";

applyTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
