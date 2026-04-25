import React from "react";
import ReactDOM from "react-dom/client";
import "monaco-editor/min/vs/editor/editor.main.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
