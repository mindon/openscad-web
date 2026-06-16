/**
 * OpenSCAD Playground - Frontend Entry Point
 * Uses biu for building, no bundler config needed.
 */

// Import Lit components (biu will handle bundling)
import "./app.ts";
import "./components/editor-panel.ts";
import "./components/viewer-panel.ts";
import "./components/multimaterial-colors-dialog.ts";
import "./footer.ts";
import "./components/customizer-panel.ts";

// Import Monaco Editor loader
import "@monaco-editor/loader";

// BrowserFS provides the in-browser filesystem (global `BrowserFS`).
// Must be imported before any createEditorFS() call.
import "/browserfs.min.js";

import { appStore } from "./state/store.ts";
import { createInitialState } from "./state/initial-state.ts";
import type { AppState } from "./state/types.ts";
import { Model } from "./state/model.ts";
import { createEditorFS } from "./fs/filesystem.ts";
import { registerOpenSCADLanguage } from "./language/openscad-register-language.ts";
import { zipArchives } from "./fs/zip-archives.ts";

// Build a minimal AppState compatible value from the legacy createInitialState.
// The two type definitions overlap structurally enough for the UI shell.
function buildInitialAppState(): AppState {
  const legacy = createInitialState(null) as unknown as AppState;
  // Fill in fields that AppState marks as required but legacy leaves optional.
  legacy.view.logs ??= false;
  legacy.view.showAxes ??= true;
  legacy.view.lineNumbers ??= true;
  return legacy;
}

// App initialization
async function initApp() {
  // Initialize the in-browser filesystem and mount the library/example ZIP
  // archives so the file-picker can browse and open built-in .scad files.
  // The archives are deployed under /libraries/*.zip, so the main thread
  // must point librariesUrl there (the worker uses the default ./libraries/).
  let fs: any = null;
  try {
    fs = await createEditorFS({
      prefix: "/libraries/",
      allowPersistence: false,
      librariesUrl: "./libraries/",
    });
    await registerOpenSCADLanguage(fs, "/", zipArchives);
  } catch (e) {
    console.warn(
      "Filesystem init failed; library/example browsing disabled.",
      e,
    );
  }

  const initialState = buildInitialAppState();
  const model = new Model(
    fs as any,
    initialState as any,
    () => {
      appStore.notify();
    },
  );
  // Seed the store BEFORE mounting so <openscad-app> renders past the Loading state.
  appStore.fs = fs;
  appStore.model = model;

  // Create and mount app
  const app = document.createElement("openscad-app");
  const root = document.getElementById("root");
  if (root) {
    root.appendChild(app);
  }

  // Kick off the initial preview render of the default playground.scad
  // (or whatever source was restored from URL/storage). Model.init() is a
  // no-op when the state already has output / is mid-flight.
  try {
    model.init();
  } catch (e) {
    console.warn("Initial render failed to start:", e);
  }
}

// Wait for DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
