import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { configureBrowserSession } from "./api/session";

window.upsideDownSession = { update: configureBrowserSession };

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import './obsidian.css';
