/**
 * Main App component for OpenSCAD Playground
 * Lit Web Component (no TSX)
 */

import { css, customElement, html, LitElement, state } from "./_share/lit.ts";
import { appStore } from "./state/store.ts";
import type { AppState } from "./state/types.ts";

@customElement("openscad-app")
export class App extends LitElement {
  @state()
  private accessor _state: AppState | null = null;
  @state()
  private accessor _model: unknown = null;
  @state()
  private accessor _logs: [string, string][] = [];
  @state()
  private accessor _logsVisible = false;
  // Tracks whether we already auto-showed the logs for the current error
  // state, so we don't re-open logs on every sync() while the error
  // persists. Resets when all errors clear.
  private _autoShowedLogs = false;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
    }

    .app-container {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .panels-container {
      display: flex;
      flex: 1;
      position: relative;
    }

    .panels-container.multi {
      flex-direction: row;
      /* avoid the row collapsing each panel below a usable width */
      overflow-x: auto;
    }

    .panels-container.multi .panel {
      /* keep the editor/viewer/customizer readable on borderline widths */
      min-width: 320px;
    }

    .panels-container.single {
      flex-direction: column;
      position: relative;
    }

    .panel {
      flex: 1;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .panel.hidden {
      display: none !important;
    }

    .panel.opacity-animated {
      transition: opacity 0.3s ease;
    }

    .panel.opacity-0 {
      opacity: 0;
      pointer-events: none;
    }

    .panel.absolute-fill {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }

    /*
    * Floating toggle: shown when exactly one of editor/viewer is visible
    * (in multi mode), letting the user swap which one is shown without
    * going through the menu. Placed against the inner edge so it appears
    * to "peek out" from the hidden side.
    */
    .panel-toggle {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 10;
      width: 22px;
      height: 56px;
      border: 1px solid #bbb;
      background: rgba(255, 255, 255, 0.92);
      color: #333;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      padding: 0;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
      transition: background 0.15s ease;
    }
    .panel-toggle:hover {
      background: #f0f0f0;
    }
    .panel-toggle.left {
      left: 0;
      border-left: none;
      border-top-right-radius: 6px;
      border-bottom-right-radius: 6px;
      background: #333333f0;
      color: #f6f6f6;
    }
    .panel-toggle.right {
      right: 0;
      border-right: none;
      border-top-left-radius: 6px;
      border-bottom-left-radius: 6px;
    }

    .logs-container {
      max-height: 200px;
      overflow: auto;
      background: #1e1e1ecc;
      color: #d4d4d4;
      font-family: monospace;
      font-size: 12px;
      padding: 8px;
      border-top: 1px solid #333;
      flex-shrink: 0;
      position: absolute;
      bottom: 45px;
      left: 0;
      right: 0;
      z-index: 11;
    }

    .log-line {
      white-space: pre-wrap;
      line-height: 1.4;
    }

    .log-stdout {
      color: #4ec9b0;
    }

    .log-stderr {
      color: #f48771;
    }
  `;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
    const sync = () => {
      this._model = appStore.model;
      this._state = (this._model as { state?: AppState } | null)?.["state"] ??
        null;

      // Drive the logs panel from global state.
      const wantVisible = !!this._state?.view?.logs;
      if (wantVisible !== this._logsVisible) {
        this._logsVisible = wantVisible;
      }
      if (this._logsVisible && this._state) {
        this._logs = this._collectLogsFromState(this._state);
      }

      // Auto-show logs when there is an error OR syntax-check markers
      // indicate errors, OR the render produced warnings (e.g.
      // "Current top level object is empty").
      // Uses _autoShowedLogs to avoid re-opening logs on every
      // sync() while the same error state persists. Resets when all
      // errors clear.
      const currentError = this._state?.error ?? null;
      const hasSyntaxErrors = (this._state?.lastCheckerRun?.markers ?? [])
        .some((m: any) => m.severity === 8);
      // Detect render warnings in lastCheckerRun.logText (set by both
      // checkSyntax and render).  "Current top level object is empty"
      // is a common case where OpenSCAD produces no geometry.
      const logText = this._state?.lastCheckerRun?.logText ?? "";
      const hasRenderWarnings = /\b(ERROR|WARNING|empty)\b/i.test(logText);
      const hasErrors = !!(
        currentError ||
        hasSyntaxErrors ||
        (hasRenderWarnings && logText.length > 0)
      );
      const shouldShow = hasErrors && !this._state?.view?.logs;

      if (shouldShow && !this._autoShowedLogs) {
        const model = this._model as { logsVisible: boolean } | null;
        if (model) {
          console.log(
            "[app auto-show logs]",
            "error:",
            currentError,
            "syntax:",
            hasSyntaxErrors,
          );
          model.logsVisible = true;
          this._autoShowedLogs = true;
        }
      }
      // Reset tracker when all errors clear, so a later re-occurrence
      // counts as new.
      if (!hasErrors) {
        this._autoShowedLogs = false;
      }
    };
    // pull current value immediately so we don't stay stuck in Loading
    sync();
    this._unsubscribe = appStore.subscribe(sync);
    // Bridge footer button events to actual editor actions.
    (this as LitElement).addEventListener(
      "app-action",
      this._onAppAction as EventListener,
    );
    // `preview-ready` (and `render-log`) are dispatched from <editor-panel>
    // and bubble up to <openscad-app> via composed events, but they don't
    // reach the sibling <viewer-panel> on their own. Forward them.
    (this as LitElement).addEventListener(
      "preview-ready",
      this._forwardToViewer as EventListener,
    );
    window.addEventListener("keydown", this._handleKeyDown);

    // Auto-switch between multi (>=768px) and single (<768px) layouts so the
    // editor doesn't get squeezed off-screen on narrow viewports.
    this._mql = window.matchMedia("(min-width: 768px)");
    const onMql = (e?: MediaQueryListEvent) => {
      const wantMulti = e ? e.matches : this._mql!.matches;
      const model = appStore.model as
        | { changeLayout: (mode: "multi" | "single") => void }
        | null;
      if (model) model.changeLayout(wantMulti ? "multi" : "single");
    };
    this._onMql = onMql;
    // Newer browsers: addEventListener; fall back to addListener for older.
    if (this._mql.addEventListener) {
      this._mql.addEventListener("change", onMql);
    } else {
      // @ts-ignore - legacy API
      this._mql.addListener(onMql);
    }
    // Apply once on mount in case the viewport size already disagrees with
    // the persisted/initial layout mode.
    onMql();
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    (this as LitElement).removeEventListener(
      "app-action",
      this._onAppAction as EventListener,
    );
    (this as LitElement).removeEventListener(
      "preview-ready",
      this._forwardToViewer as EventListener,
    );
    window.removeEventListener("keydown", this._handleKeyDown);
    if (this._mql && this._onMql) {
      if (this._mql.removeEventListener) {
        this._mql.removeEventListener("change", this._onMql);
      } else {
        // @ts-ignore - legacy API
        this._mql.removeListener(this._onMql);
      }
    }
    super.disconnectedCallback();
  }

  private _mql?: MediaQueryList;
  private _onMql?: (e?: MediaQueryListEvent) => void;

  private _handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "F5") {
      event.preventDefault();
      const editor = this._editorPanel();
      if (editor) {
        (editor as any).runPreviewRender?.();
      }
    } else if (event.key === "F6") {
      event.preventDefault();
      const editor = this._editorPanel();
      if (editor) {
        const fmt = this._state?.params.exportFormat3D || "stl";
        editor.runRender(fmt);
      }
    } else if (event.key === "F7") {
      event.preventDefault();
      const editor = this._editorPanel();
      if (editor) {
        const fmt = this._state?.is2D
          ? this._state?.params.exportFormat2D || "svg"
          : this._state?.params.exportFormat3D || "stl";
        editor.runExport(fmt);
      }
    }
  };

  private _forwardToViewer = (e: Event) => {
    const root = (this as unknown as { renderRoot: ParentNode }).renderRoot;
    const viewer = root.querySelector("viewer-panel");
    if (!viewer) return;
    // Re-dispatch a fresh CustomEvent on viewer so its `addEventListener`
    // handler fires. We can't simply forward `e` because dispatchEvent on
    // an already-dispatched event is a no-op.
    const ce = e as CustomEvent;
    viewer.dispatchEvent(
      new CustomEvent(e.type, {
        detail: ce.detail,
        bubbles: false,
        composed: false,
      }),
    );
  };

  private _unsubscribe?: () => void;

  private _editorPanel(): {
    getCurrentSource(): string;
    runRender(
      format?: string,
    ): Promise<{ fileId?: string; is2D?: boolean } | null>;
    runExport(format?: string): Promise<void>;
  } | null {
    const root = (this as unknown as { renderRoot: ParentNode }).renderRoot;
    return root.querySelector("editor-panel") as unknown as
      | {
        getCurrentSource(): string;
        runRender(
          format?: string,
        ): Promise<{ fileId?: string; is2D?: boolean } | null>;
        runExport(format?: string): Promise<void>;
      }
      | null;
  }

  /**
   * Make sure the viewer panel is visible. In `multi` mode we flip the
   * `viewer` flag on; in `single` mode we focus the viewer. No-op if it's
   * already visible.
   */
  private _ensureViewerVisible() {
    const model = appStore.model as
      | {
        state?: AppState;
        changeMultiVisibility?: (
          target: "editor" | "viewer" | "customizer",
          visible: boolean,
        ) => void;
        changeSingleVisibility?: (
          focus: "editor" | "viewer" | "customizer",
        ) => void;
      }
      | null;
    if (!model || !model.state) return;
    const layout = model.state.view.layout;
    if (layout.mode === "multi") {
      if (!layout.viewer) model.changeMultiVisibility?.("viewer", true);
    } else {
      if (layout.focus !== "viewer") model.changeSingleVisibility?.("viewer");
    }
  }

  /**
   * Swap which of editor/viewer is shown when exactly one of them is
   * currently visible. Used by the edge floating toggle button.
   */
  private _swapEditorViewer = () => {
    const model = appStore.model as
      | {
        state?: AppState;
        changeMultiVisibility?: (
          target: "editor" | "viewer" | "customizer",
          visible: boolean,
        ) => void;
        changeSingleVisibility?: (
          focus: "editor" | "viewer" | "customizer",
        ) => void;
      }
      | null;
    if (!model || !model.state) return;
    const layout = model.state.view.layout;
    if (layout.mode === "multi") {
      if (layout.editor && !layout.viewer) {
        // Show viewer first, then hide editor (changeMultiVisibility refuses
        // to leave zero panels visible, so order matters).
        model.changeMultiVisibility?.("viewer", true);
        model.changeMultiVisibility?.("editor", false);
      } else if (!layout.editor && layout.viewer) {
        model.changeMultiVisibility?.("editor", true);
        model.changeMultiVisibility?.("viewer", false);
      }
    } else {
      if (layout.focus === "editor") {
        model.changeSingleVisibility?.("viewer");
      } else if (layout.focus === "viewer") {
        model.changeSingleVisibility?.("editor");
      }
    }
  };

  /**
   * Build the lines shown in `.logs-container` from global app state.
   *
   * Priority:
   *  1. `currentRunLogs` — live stdout/stderr captured during the most recent
   *     preview/render.
   *  2. `lastCheckerRun.logText` — parsed line-by-line, classifying lines that
   *     mention ERROR/WARNING as stderr.
   * In all cases `state.error` (the surfaced fatal error) is prepended so it's
   * always visible when present.
   */
  private _collectLogsFromState(
    state: AppState,
  ): [string, string][] {
    const lines: [string, string][] = [];
    if (state?.error) {
      lines.push(["stderr", `[error] ${state.error}`]);
    }
    const runLogs = state?.currentRunLogs as
      | ["stderr" | "stdout", string][]
      | undefined;
    if (runLogs && runLogs.length) {
      for (const [pipe, line] of runLogs) {
        if (line == null || line === "") continue;
        lines.push([pipe, line]);
      }
      return lines;
    }
    const logText = state?.lastCheckerRun?.logText as string | undefined;
    if (logText) {
      for (const ln of logText.split(/\r?\n/)) {
        if (!ln) continue;
        const pipe = /\b(ERROR|WARNING)\b/.test(ln) ? "stderr" : "stdout";
        lines.push([pipe, ln]);
      }
    }
    return lines;
  }

  private _onAppAction = (e: Event) => {
    const detail = (e as CustomEvent<{ action: string; format?: string }>)
      .detail;
    const action = detail?.action;
    const overrideFmt = detail?.format;
    const editor = this._editorPanel();
    if (!editor) {
      console.warn("[app] no editor-panel found for action", action);
      return;
    }
    switch (action) {
      case "render": {
        // Ensure the viewer is shown when the user explicitly hits Render.
        // Otherwise the rendered geometry would silently appear in a hidden
        // panel.
        this._ensureViewerVisible();
        const fmt = overrideFmt || this._state?.params.exportFormat3D || "stl";
        editor.runRender(fmt);
        break;
      }
      case "export": {
        const fmt = overrideFmt ||
          (this._state?.is2D
            ? this._state?.params.exportFormat2D || "svg"
            : this._state?.params.exportFormat3D || "stl");
        editor.runExport(fmt);
        break;
      }
      case "save": {
        // Save: download current source as a .scad file.
        const src = editor.getCurrentSource();
        const blob = new Blob([src], { type: "application/x-openscad" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const name = this._state?.params.activePath?.split("/").pop() ||
          "model.scad";
        a.download = name.endsWith(".scad") ? name : `${name}.scad`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        break;
      }
      default:
        console.warn("[app] unknown action", action);
    }
  };

  protected render() {
    if (!this._state) {
      return html`
        <div class="app-container"><p>Loading...</p></div>
      `;
    }

    const layout = this._state.view.layout;
    const isMulti = layout.mode === "multi";

    const zIndexOfPanelsDependingOnFocus: Record<
      string,
      Record<string, number>
    > = {
      editor: {
        editor: 3,
        viewer: 1,
        customizer: 0,
      },
      viewer: {
        editor: 2,
        viewer: 3,
        customizer: 1,
      },
      customizer: {
        editor: 0,
        viewer: 1,
        customizer: 3,
      },
    };

    const hasCustomizer =
      ((this._state as any).parameterSet?.parameters?.length ?? 0) > 0;

    const getPanelClassesAndStyles = (
      id: "editor" | "viewer" | "customizer",
    ) => {
      if (isMulti) {
        let visible = false;
        if (id === "editor") visible = !!layout.editor;
        if (id === "viewer") visible = !!layout.viewer;
        if (id === "customizer") visible = !!layout.customizer && hasCustomizer;

        const activeCount = (layout.editor ? 1 : 0) +
          (layout.viewer ? 1 : 0) +
          (layout.customizer && hasCustomizer ? 1 : 0);

        const maxWidth = activeCount > 0 ? Math.floor(100 / activeCount) : 100;

        return {
          classes: visible ? "panel" : "panel hidden",
          styles: visible
            ? `flex: 1; max-width: ${maxWidth}%; display: flex;`
            : "display: none;",
        };
      } else {
        let visible = true;
        if (id === "customizer" && !hasCustomizer) {
          visible = false;
        }
        const isFocused = layout.focus === id;
        const zIndex =
          zIndexOfPanelsDependingOnFocus[id]?.[layout.focus ?? "editor"] ?? 1;

        let classes = "panel opacity-animated absolute-fill";
        if (!isFocused) {
          classes += " opacity-0";
        }
        if (!visible) {
          classes += " hidden";
        }

        return {
          classes,
          styles: visible
            ? `flex: 1; z-index: ${zIndex}; display: flex;`
            : "display: none;",
        };
      }
    };

    const editorConfig = getPanelClassesAndStyles("editor");
    const viewerConfig = getPanelClassesAndStyles("viewer");
    const customizerConfig = getPanelClassesAndStyles("customizer");

    // Decide whether to show the floating edge toggle: only when exactly one
    // of editor/viewer is visible (and the customizer panel isn't taking up
    // the other side, to avoid overlapping it).
    let editorVisible: boolean;
    let viewerVisible: boolean;
    let customizerVisible: boolean;
    if (isMulti) {
      editorVisible = !!layout.editor;
      viewerVisible = !!layout.viewer;
      customizerVisible = !!layout.customizer && hasCustomizer;
    } else {
      editorVisible = layout.focus === "editor";
      viewerVisible = layout.focus === "viewer";
      customizerVisible = layout.focus === "customizer" && hasCustomizer;
    }
    const onlyEditor = editorVisible && !viewerVisible && !customizerVisible;
    const onlyViewer = viewerVisible && !editorVisible && !customizerVisible;
    // When only the editor is visible, the toggle (which reveals the viewer)
    // is anchored to the right edge; when only the viewer is visible it sits
    // on the left edge.
    const toggleSide = onlyEditor ? "right" : onlyViewer ? "left" : null;
    const toggleLabel = onlyEditor ? "Show viewer" : "Show editor";
    const toggleGlyph = onlyEditor ? "▶" : "◀";

    return html`
      <div class="app-container">
        <div class="panels-container ${isMulti ? "multi" : "single"}">
          <div class="${editorConfig.classes}" style="${editorConfig.styles}">
            <editor-panel style="flex: 1; height: 100%;"></editor-panel>
          </div>
          <div class="${viewerConfig.classes}" style="${viewerConfig.styles}">
            <viewer-panel style="flex: 1; height: 100%;"></viewer-panel>
          </div>
          <div class="${customizerConfig.classes}" style="${customizerConfig
            .styles}">
            <customizer-panel style="flex: 1; height: 100%;"></customizer-panel>
          </div>
          ${toggleSide
            ? html`
              <button
                class="panel-toggle ${toggleSide}"
                title="${toggleLabel}"
                aria-label="${toggleLabel}"
                @click="${this._swapEditorViewer}"
              >
                ${toggleGlyph}
              </button>
            `
            : ""}
        </div>
        ${this._logsVisible
          ? html`
            <div
              class="logs-container"
              title="Double-click to hide"
              @dblclick="${() =>
                (this._model as { logsVisible: boolean }).logsVisible = false}"
            >
              ${this._logs.map(
                ([pipe, line]) =>
                  html`
                    <div class="log-line log-${pipe}">${line}</div>
                  `,
              )}
            </div>
          `
          : ""}
        <footer-panel></footer-panel>
      </div>
    `;
  }
}
