import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { chooseHub, DEFAULT_CONSOLE } from "./app/hubs.ts";
import { Phone } from "./app/phone.ts";
import "./styles.css";

// Both are public addresses. Never put a secret in a VITE_ variable: Vite inlines it into the page.
const { hub, ignored } = chooseHub(location.search, import.meta.env.VITE_HUB_URL);
const consoleUrl = import.meta.env.VITE_CONSOLE_URL || DEFAULT_CONSOLE;

if (ignored) console.warn(`countersign phone: ignored ?hub=${ignored}; this page only talks to ${hub}`);

const phone = new Phone(hub, consoleUrl);
void phone.boot();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App phone={phone} />
    </StrictMode>,
  );
}
