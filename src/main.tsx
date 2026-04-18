import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface AndroidStatusBar {
  getTop(): number;
  getBottom(): number;
}

function applyAndroidInsets() {
  const bar = (window as unknown as { AndroidStatusBar?: AndroidStatusBar })
    .AndroidStatusBar;
  if (!bar) return;
  const top = bar.getTop();
  if (top === 0) {
    // Insets not received yet, retry shortly
    setTimeout(applyAndroidInsets, 100);
    return;
  }
  document.documentElement.style.setProperty("--sat", `${top}px`);
  document.documentElement.style.setProperty("--sab", `${bar.getBottom()}px`);
}

applyAndroidInsets();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
