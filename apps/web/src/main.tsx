// First, so Buffer exists before Privy's embedded wallet can sign (see polyfills.ts).
import "./polyfills.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App.tsx";
import { Providers } from "./app/Providers.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
