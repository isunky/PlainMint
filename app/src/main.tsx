import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./i18n";
import "./styles.css";

if (window.__TAURI_INTERNALS__) {
  document.documentElement.classList.add("is-tauri");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
