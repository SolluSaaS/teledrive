import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initVault } from "./lib/secure/vault";
import { ErrorBoundary } from "./components/ErrorBoundary";

initVault()
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    console.error("Critical error: Failed to init vault:", err);
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
