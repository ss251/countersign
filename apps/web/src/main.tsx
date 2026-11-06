import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <main>countersign</main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
