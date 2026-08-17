import React from "react";
import ReactDOM from "react-dom/client";
// Las tipografías se empaquetan con la app: Desktop es local-first y no puede
// depender de una CDN ni degradar a la fuente del sistema.
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@deks-js/react/styles.css";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
