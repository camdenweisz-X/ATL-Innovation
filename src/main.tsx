import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/public-sans";
import "./styles.css";
import { applyTheme } from "./lib/theme";
import { SessionProvider } from "./lib/session";
import { LangProvider } from "./lib/i18n";
import { registerServiceWorker } from "./lib/push";
import { ToastProvider } from "./ui/kit";
import { App } from "./App";

applyTheme();
registerServiceWorker();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <LangProvider>
        <SessionProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SessionProvider>
      </LangProvider>
    </BrowserRouter>
  </StrictMode>,
);
