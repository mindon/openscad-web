// Portions of this file are Copyright 2021 Google LLC, and licensed under GPL2+. See COPYING.

import chroma from "chroma-js";
import { css, customElement, html, LitElement, state } from "../_share/lit.ts";
import { appStore } from "../state/store.ts";

@customElement("openscad-multimaterial-dialog")
export class MultimaterialColorsDialog extends LitElement {
  @state()
  private accessor state: any = null;
  @state()
  private accessor model: any = null;
  @state()
  private accessor tempColors: string[] = [];

  static styles = css`
    :host {
      display: block;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }

    .modal-content {
      background: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
    }

    .modal-header {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 16px;
    }

    .modal-description {
      margin-bottom: 12px;
      color: #666;
      font-size: 14px;
    }

    .color-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .color-preview {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      border: 1px solid #ccc;
      cursor: pointer;
    }

    input[type="color"] {
      width: 32px;
      height: 32px;
      border: none;
      padding: 0;
      cursor: pointer;
    }

    input[type="text"] {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
    }

    input.invalid {
      border-color: #d32f2f;
      background: #ffebee;
    }

    .btn-remove {
      padding: 4px 8px;
      border: none;
      background: transparent;
      color: #d32f2f;
      cursor: pointer;
      font-size: 16px;
    }

    .btn-remove:hover {
      background: #ffebee;
      border-radius: 4px;
    }

    .btn-add {
      padding: 6px 12px;
      border: 1px dashed #ccc;
      background: transparent;
      cursor: pointer;
      border-radius: 4px;
      color: #666;
      font-size: 13px;
    }

    .btn-add:hover {
      background: #f5f5f5;
    }

    .btn-add:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    .btn-cancel {
      background: transparent;
      border: 1px solid #ccc;
      color: #333;
    }

    .btn-cancel:hover {
      background: #f5f5f5;
    }

    .btn-save {
      background: #1976d2;
      border: 1px solid #1976d2;
      color: white;
    }

    .btn-save:hover {
      background: #1565c0;
    }

    .btn-save:disabled {
      background: #ccc;
      border-color: #ccc;
      cursor: not-allowed;
    }
  `;

  constructor() {
    super();
    this.model = appStore.model;
    this.state = this.model?.state ?? null;
    this.tempColors = this.state?.params?.extruderColors ?? [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = appStore.subscribe(() => {
      this.model = appStore.model;
      this.state = this.model?.state ?? null;
    });
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    super.disconnectedCallback();
  }

  private _unsubscribe?: () => void;
  private _oldVisibility: string | undefined = undefined;

  updated(changedProperties: any) {
    if (changedProperties.has("state") && this.state) {
      const currentVisibility = this.state.view?.extruderPickerVisibility;
      if (currentVisibility && !this._oldVisibility) {
        this.tempColors = [...(this.state.params?.extruderColors ?? [])];
      }
      this._oldVisibility = currentVisibility;
    }
  }

  private setColor(index: number, color: string) {
    this.tempColors = this.tempColors.map((c, i) => i === index ? color : c);
  }

  private removeColor(index: number) {
    this.tempColors = this.tempColors.filter((_, i) => i !== index);
  }

  private addColor() {
    this.tempColors = [...this.tempColors, ""];
  }

  private get canAddColor(): boolean {
    return !this.tempColors.some((c) => c.trim() === "");
  }

  private cancel() {
    this.tempColors = [...(this.state?.params?.extruderColors ?? [])];
    this.model?.mutate((s: any) => s.view.extruderPickerVisibility = undefined);
  }

  private save() {
    const wasExporting =
      this.state?.view?.extruderPickerVisibility === "exporting";
    this.model?.mutate((s: any) => {
      s.params.extruderColors = this.tempColors.filter((c) => c.trim() !== "");
      s.view.extruderPickerVisibility = undefined;
    });
    if (wasExporting) {
      this.model?.export();
    }
  }

  render() {
    if (!this.state?.view?.extruderPickerVisibility) {
      return html`

      `;
    }

    const hasValidColors = this.tempColors.every((c) =>
      c.trim() === "" || chroma.valid(c)
    );

    return html`
      <div class="modal-overlay" @click="${() => this.cancel()}">
        <div class="modal-content" @click="${(e: Event) =>
          e.stopPropagation()}">
          <div class="modal-header">Multimaterial Color Picker</div>
          <div class="modal-description">
            To print on a multimaterial printer using PrusaSlicer, BambuSlicer or
            OrcaSlicer, we map the model's colors to the closest match in the list of
            extruder colors. Please define the colors of your extruders below.
          </div>

          <div class="colors-list">
            ${this.tempColors.map((color, index) =>
              html`
                <div class="color-row">
                  <input
                    type="color"
                    .value="${chroma.valid(color)
                      ? chroma(color).hex()
                      : "#000000"}"
                    @input="${(e: Event) => {
                      const newColor = (e.target as HTMLInputElement).value;
                      this.setColor(index, chroma(newColor).name());
                    }}"
                  />
                  <input
                    type="text"
                    .value="${color}"
                    class="${color.trim() === "" || !chroma.valid(color)
                      ? "invalid"
                      : ""}"
                    placeholder="#RRGGBB or color name"
                    @input="${(e: Event) => {
                      let newColor = (e.target as HTMLInputElement).value
                        .trim();
                      try {
                        newColor = chroma(newColor).name();
                      } catch (e) {
                        // keep as-is
                      }
                      this.setColor(index, newColor);
                    }}"
                    @keydown="${(e: KeyboardEvent) => {
                      if (e.key === "Enter" && this.canAddColor) {
                        this.addColor();
                      }
                    }}"
                  />
                  <button class="btn-remove" @click="${() =>
                    this.removeColor(index)}">✕</button>
                </div>
              `
            )}
          </div>

          <button
            class="btn-add"
            ?disabled="${!this.canAddColor}"
            @click="${() => this.addColor()}"
          >
            ＋ Add Color
          </button>

          <div class="modal-footer">
            <button class="btn btn-cancel" @click="${() =>
              this.cancel()}">Cancel</button>
            <button
              class="btn btn-save"
              ?disabled="${!hasValidColors}"
              @click="${() => this.save()}"
            >
              ${this.state?.view?.extruderPickerVisibility === "exporting"
                ? "Export"
                : "Save"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
