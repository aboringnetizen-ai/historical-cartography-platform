import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioShell } from "./components/StudioShell.tsx";
import "./styles/studio.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <StudioShell />
    </StrictMode>,
  );
}
