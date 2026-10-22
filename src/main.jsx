import React from "react";
import { createRoot } from "react-dom/client";
import { TideCloakContextProvider } from "@tidecloak/react";
import App from "./App.jsx";
import "./style.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TideCloakContextProvider
      configUrl="/tidecloak.json"
      config={{
        useDPoP: {
          mode: "strict",
          alg: "ES256"
        }
      }}
    >
      <App />
    </TideCloakContextProvider>
  </React.StrictMode>
);