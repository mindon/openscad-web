/**
 * Footer Panel component
 * Shows render status, progress, and action buttons
 */

import { css, customElement, html, LitElement, state } from "./_share/lit.ts";
import { appStore } from "./state/store.ts";
import type { AppState } from "./state/types.ts";
// Side-effect import: registers the <openscad-file-picker> custom element so the
// footer can use it for selecting/opening .scad files.
import "./components/file-picker.ts";

@customElement("footer-panel")
export class FooterPanel extends LitElement {
  @state()
  private accessor _state: AppState | null = null;
  @state()
  private accessor _rendering = false;
  @state()
  private accessor _previewing = false;
  @state()
  private accessor _exporting = false;
  @state()
  private accessor _error = "";

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      background: #f8f8f8;
      border-top: 1px solid #ddd;
      min-height: 36px;
      font-size: 13px;
    }

    .file-picker-wrap {
      flex: 0 0 220px;
      min-width: 0;
    }

    .status {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .status-text {
      color: #333;
    }

    .error-text {
      color: #d32f2f;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .progress-bar {
      width: 120px;
      height: 4px;
      background: #e0e0e0;
      border-radius: 2px;
      overflow: hidden;
    }

    .progress-bar .fill {
      height: 100%;
      background: #1976d2;
      transition: width 0.3s ease;
    }

    .progress-bar.indeterminate .fill {
      width: 40%;
      animation: indeterminate 1.5s infinite ease-in-out;
    }

    @keyframes indeterminate {
      0% {
        transform: translateX(-100%);
      }
      50% {
        transform: translateX(200%);
      }
      100% {
        transform: translateX(-100%);
      }
    }

    .actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .actions a {
      font-size: 1px;
    }

    button {
      padding: 4px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    button:hover:not(:disabled) {
      background: #f0f0f0;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.primary {
      background: #1976d2;
      color: white;
      border-color: #1976d2;
    }

    button.primary:hover:not(:disabled) {
      background: #1565c0;
    }

    .time {
      color: #666;
      font-size: 12px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = appStore.subscribe(() => {
      const model = appStore.model as { state?: AppState } | null;
      this._state = model?.state ?? null;
      if (this._state) {
        this._rendering = this._state.rendering ?? false;
        this._previewing = this._state.previewing ?? false;
        this._exporting = this._state.exporting ?? false;
        this._error = this._state.error ?? "";
      }
    });
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    super.disconnectedCallback();
  }

  private _unsubscribe?: () => void;

  private _getStatusText(): string {
    if (this._error) return "";
    if (this._previewing) return "Previewing...";
    if (this._rendering) return "Rendering...";
    if (this._exporting) return "Exporting...";

    const output = this._state?.output;
    if (output) {
      return `Done${
        output.formattedElapsedMillis
          ? ` (${output.formattedElapsedMillis})`
          : ""
      }`;
    }
    return "Ready";
  }

  protected render() {
    const isBusy = this._previewing || this._rendering || this._exporting;
    const statusText = this._getStatusText();

    return html`
      <div class="file-picker-wrap">
        <openscad-file-picker></openscad-file-picker>
      </div>
      <div class="status">
        <div class="toolbar">
          <label title="logs">
            <input
              type="checkbox"
              .checked="${!!this._state?.view?.logs}"
              @change="${(e: Event) => {
                const model = appStore.model as any;
                if (!model) return;
                // Route through the model so global `view.logs` is the single
                // source of truth; the editor panel mirrors it via its store
                // subscription.
                model.logsVisible = (e.target as HTMLInputElement).checked;
              }}"
            />
          </label>
        </div>

        ${isBusy
          ? html`
            <div class="progress-bar indeterminate">
              <div class="fill"></div>
            </div>
          `
          : ""} ${this._error
          ? html`
            <span class="error-text" title="${this._error}">${this
              ._error}</span>
          `
          : html`
            <span class="status-text">${statusText}</span>
          `} ${this._state?.output?.formattedOutFileSize
          ? html`
            <span class="time">${this._state.output.formattedOutFileSize}</span>
          `
          : ""}
      </div>
      <div class="actions">
        <a
          href="https://github.com/mindon/openscad-playground"
          target="_blank"
          title="OpenSCAD Web Playground (mindon's version)"
        ><svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            fill="currentColor"
            class="bi bi-github"
            viewBox="0 0 16 16"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
            />
          </svg></a>
        <a
          style="margin: 0 1rem 0 .25rem"
          href="https://openscad.org/"
          target="_blank"
          title="OpenSCAD"
        ><img src="https://openscad.org/assets/img/logo.png" height="24"></a>
        <button
          ?disabled="${isBusy}"
          @click="${() => this._dispatchAction("save")}"
          title="Save as .scad"
        >
          💾
        </button>
        <button
          class="primary"
          ?disabled="${isBusy}"
          @click="${() => this._dispatchAction("render")}"
          title="F5"
        >
          ▶ Render
        </button>
      </div>
      <openscad-multimaterial-dialog></openscad-multimaterial-dialog>
    `;
  }

  private _dispatchAction(action: string) {
    this.dispatchEvent(
      new CustomEvent("app-action", {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
