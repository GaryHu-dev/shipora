import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// Auto-update the app: check for a new version on an interval and whenever the
// app is brought back to the foreground; autoUpdate installs it and reloads.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (!r) return;
    setInterval(() => { r.update(); }, 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") r.update();
    });
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
