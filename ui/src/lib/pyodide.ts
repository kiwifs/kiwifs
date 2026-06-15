declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideInterface>;
  }
}

interface PyodideInterface {
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { get(name: string): unknown };
}

const CDN_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const SCRIPT_URL = `${CDN_BASE}pyodide.js`;

let pyodidePromise: Promise<PyodideInterface> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function getPyodide(): Promise<PyodideInterface> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = loadScript(SCRIPT_URL).then(() => {
    if (!window.loadPyodide) {
      throw new Error("Pyodide script loaded but loadPyodide not found");
    }
    return window.loadPyodide({ indexURL: CDN_BASE });
  });
  return pyodidePromise;
}

export type { PyodideInterface };
