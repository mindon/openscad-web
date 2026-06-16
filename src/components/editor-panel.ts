/**
 * Editor Panel component
 * Lit Web Component wrapping Monaco Editor
 */

import { css, customElement, html, LitElement, state } from "../_share/lit.ts";
import { appStore } from "../state/store.ts";
import openscadLanguage from "../language/openscad-language.ts";
// import {stylize} from "../_share/stylize.ts";

// Dynamically import Monaco Editor (loaded via CDN or bundled)
declare global {
  const monaco: typeof import("monaco-editor");
}

@customElement("editor-panel")
export class EditorPanel extends LitElement {
  @state()
  private accessor _source = "";
  @state()
  private accessor _markers: import("monaco-editor").editor.IMarkerData[] = [];

  // Tracks the active source path so we can detect file switches and reset
  // the editor's cursor / scroll position to the very beginning when the
  // user opens a different .scad example.
  private _activePath: string | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .editor-container {
      flex: 1;
      position: relative;
      min-height: 0; /* allow flex child to shrink below content height */
      overflow: hidden; /* clip monaco internal layout overflow */
    }

    .toolbar {
      display: flex;
      gap: 8px;
      padding: 4px 8px;
      background: #f3f3f3;
      border-bottom: 1px solid #ddd;
      align-items: center;
    }

    button {
      padding: 4px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 13px;
    }

    button:hover {
      background: #f0f0f0;
    }

    button.primary {
      background: #0078d4;
      color: white;
      border-color: #0078d4;
    }

    button.primary:hover {
      background: #106ebe;
    }
  `;

  private _editor: import("monaco-editor").editor.IStandaloneCodeEditor | null =
    null;
  private _debounceTimer: number | null = null;
  private _unsubscribe?: () => void;

  private _applyMarkers(
    markers: import("monaco-editor").editor.IMarkerData[],
  ) {
    if (!this._editor) return;
    const monaco =
      (window as unknown as { monaco: typeof import("monaco-editor") }).monaco;
    monaco.editor.setModelMarkers(
      this._editor.getModel()!,
      "openscad",
      markers,
    );
  }

  connectedCallback() {
    super.connectedCallback();
    const sync = () => {
      const model = appStore.model as any;
      if (!model) return;

      // Detect a file switch (e.g. user picked another example in the file
      // picker). When the active path changes we want the editor to scroll
      // to the very top instead of preserving the previous file's cursor /
      // viewport, so the user always sees the start of the new source.
      const activePath: string | null = model.state?.params?.activePath ?? null;
      const pathChanged = activePath !== this._activePath;
      if (pathChanged) {
        this._activePath = activePath;
      }

      if (model.source !== this._source) {
        this._source = model.source;
        if (this._editor && this._editor.getValue() !== this._source) {
          this._editor.setValue(this._source);
        }
      }

      if (pathChanged && this._editor) {
        // setValue (above) already resets the model's undo stack and moves
        // the cursor; we still explicitly snap to (1,1) and scroll to the
        // top so it works whether or not the content actually differed.
        this._editor.setPosition({ lineNumber: 1, column: 1 });
        this._editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        this._editor.revealLine(1);
      }

      const markers = (model.state?.lastCheckerRun?.markers ??
        []) as import("monaco-editor").editor.IMarkerData[];
      if (markers !== this._markers) {
        this._markers = markers as any;
        this._applyMarkers(markers);
      }
    };
    sync();
    this._unsubscribe = appStore.subscribe(sync);

    // Defer until after Lit's first render so `.editor-container` exists in
    // the shadow DOM and has been laid out, otherwise Monaco picks up a
    // stale/oversized initial size and overflows the host.
    this.updateComplete.then(() => {
      requestAnimationFrame(() => this._initMonaco());
    });
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._editor?.dispose();
    super.disconnectedCallback();
  }

  updated() {
    // stylize(this.renderRoot);
  }

  private async _initMonaco() {
    // Load Monaco Editor dynamically via the import map (`@monaco-editor/loader`).
    // Using a bare specifier lets `_share/html/imaps.ts` control the CDN URL/version.
    if (!(window as unknown as { monaco?: unknown }).monaco) {
      const loader = await import("@monaco-editor/loader");
      const monaco = await loader.default.init();
      (window as unknown as { monaco: typeof monaco }).monaco = monaco;
    }

    const monaco =
      (window as unknown as { monaco: typeof import("monaco-editor") }).monaco;

    // Register the `openscad` language so syntax highlighting works.
    // Guarded so repeated mounts don't double-register.
    const w = window as unknown as { __openscadLangRegistered?: boolean };
    if (!w.__openscadLangRegistered) {
      try {
        monaco.languages.register({
          id: "openscad",
          extensions: [".scad"],
          mimetypes: ["text/openscad"],
        });
        monaco.languages.setLanguageConfiguration(
          "openscad",
          openscadLanguage.conf,
        );
        monaco.languages.setMonarchTokensProvider(
          "openscad",
          openscadLanguage.language,
        );
        w.__openscadLangRegistered = true;
      } catch (e) {
        console.warn("OpenSCAD language registration failed:", e);
      }
    }

    const containerEl = this.renderRoot.querySelector(
      ".editor-container",
    ) as HTMLElement;
    this._editor = monaco.editor.create(containerEl, {
      value: this._source,
      language: "openscad",
      theme: "vs-dark",
      automaticLayout: true,
      lineNumbers: "on",
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: "'Droid Sans Mono', monospace",
    });
    this._applyMarkers(this._markers as any);

    // Force a re-layout once the container has its final flex-resolved size.
    requestAnimationFrame(() => this._editor?.layout());

    // Debounced source change
    this._editor.onDidChangeModelContent(() => {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = window.setTimeout(() => {
        this._onSourceChange();
      }, 500);
    });
  }

  private _onSourceChange() {
    const value = this._editor?.getValue() ?? "";
    this._source = value;
    const model = appStore.model as any;
    if (model) {
      // The Model setter already routes through runner/actions.ts for delayed
      // syntax checking and preview rendering. Do not call any API endpoint here.
      model.source = value;
    }
  }

  private async _renderPreview(source: string) {
    // Use GLB so OpenSCAD's `color()` is preserved (server transcodes 3MF→GLB
    // and bakes per-face color into vertex colors). The viewer auto-detects
    // GLB via Content-Type / `.glb` extension and uses GLTFLoader.
    return this._render(source, { format: "glb", isPreview: true });
  }

  /**
   * Trigger a preview render.
   */
  async runPreviewRender(): Promise<
    { fileId?: string; is2D?: boolean; logText?: string; error?: string } | null
  > {
    return this._renderPreview(this.getCurrentSource());
  }

  /**
   * Public API for parent components (e.g. <openscad-app> handling footer actions).
   */
  getCurrentSource(): string {
    return this._editor?.getValue() ?? this._source;
  }

  /**
   * Trigger a full (non-preview) render. Returns the resulting fileId / metadata.
   */
  async runRender(
    format: string = "stl",
  ): Promise<{ fileId?: string; is2D?: boolean } | null> {
    return this._render(this.getCurrentSource(), { format, isPreview: false });
  }

  /**
   * Trigger an export render with a specific format and offer it to the user as a download.
   *
   * `isExport: true` ensures we do not refresh the live preview with the
   * exported asset (e.g. an STL/OFF/3MF would otherwise replace the GLB
   * preview and clear vertex colors).
   */
  async runExport(format: string = "stl"): Promise<void> {
    const model = appStore.model as any;
    if (!model) return;

    const state = model.state;
    if (state?.is2D) {
      model.setFormats(format as any, undefined);
    } else {
      model.setFormats(undefined, format as any);
    }

    await model.export();
  }

  private async _render(
    source: string,
    opts: { format: string; isPreview: boolean; isExport?: boolean },
  ): Promise<
    {
      fileId?: string;
      fileUrl?: string;
      is2D?: boolean;
      logText?: string;
      error?: string;
    } | null
  > {
    const model = appStore.model as any;
    if (!model) return null;

    if (model.source !== source) {
      model.source = source;
    }

    try {
      await model.render({ isPreview: opts.isPreview, now: true });
    } catch (e) {
      console.error("Render request failed:", e);
      return null;
    }

    const state = model.state;
    const output = state?.output;
    const data = {
      fileId: output?.displayFile?.name ?? output?.outFile?.name ??
        output?.filename,
      fileUrl: state?.is2D
        ? output?.outFileURL
        : output?.displayFileURL ?? output?.outFileURL,
      is2D: state?.is2D ?? false,
      logText: state?.lastCheckerRun?.logText ?? "",
      error: state?.error,
    };

    // Auto-show the logs panel on a fatal error (only if not already visible).
    // The panel lives in <openscad-app> and mirrors `view.logs` via store
    // subscription; we just need to flip the flag.
    if (data.error && !model.logsVisible) {
      model.logsVisible = true;
    }

    if (data.fileUrl && !opts.isExport) {
      this.dispatchEvent(
        new CustomEvent("preview-ready", {
          detail: {
            fileId: data.fileId,
            fileUrl: data.fileUrl,
            is2D: data.is2D,
          },
          bubbles: true,
          composed: true,
        }),
      );
    }
    return data;
  }

  protected render() {
    return html`
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/editor/editor.main.css"
      />
      <div class="editor-container"></div>
    `;
  }
}
