import ReactDOM from "react-dom/client";
import "../index.css";
import { DemoApp } from "./DemoApp";

(function initTheme() {
  const t = localStorage.getItem("kiwifs-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (t === "dark" || (!t && prefersDark)) {
    document.documentElement.classList.add("dark");
  }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(<DemoApp />);
