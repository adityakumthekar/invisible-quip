import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
// Before index.css so the overlay's .chat-md rules win over KaTeX's defaults.
import "katex/dist/katex.min.css"
import "./index.css"
import {
  getGlassStrength,
  getGlassTheme,
  setGlassStrength,
  setGlassTheme
} from "./lib/glassTheme"

setGlassTheme(getGlassTheme())
setGlassStrength(getGlassStrength())

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
