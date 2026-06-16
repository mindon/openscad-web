// Portions of this file are Copyright 2021 Google LLC, and licensed under GPL2+. See COPYING.

import { css, customElement, html, LitElement, state } from "../_share/lit.ts";
import { appStore } from "../state/store.ts";

interface ExportFormat {
  data: string;
  label: string;
  icon: string;
  command: () => void;
  buttonLabel?: string;
}

@customElement("openscad-export-button")
export class ExportButton extends LitElement {
  @state()
  private accessor state: any = null;
  @state()
  private accessor model: any = null;
  @state()
  private accessor dropdownOpen = false;

  static styles = css`
    :host {
      display: inline-block;
    }

    .export-container {
      position: relative;
    }

    .btn {
      padding: 6px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: #f5f5f5;
    }

    .btn-secondary:hover:not(:disabled) {
      background: #e0e0e0;
    }

    .dropdown-menu {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      min-width: 200px;
    }

    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
      font-size: 13px;
    }

    .dropdown-item:hover {
      background: #f5f5f5;
    }

    .dropdown-separator {
      height: 1px;
      background: #e0e0e0;
      margin: 4px 0;
    }
  `;

  constructor() {
    super();
    this.model = appStore.model;
    this.state = this.model?.state ?? null;
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

  private getExportFormats(): ExportFormat[] {
    if (!this.state) return [];

    if (this.state.is2D) {
      return [
        {
          data: "svg",
          buttonLabel: "SVG",
          label: "SVG (Simple Vector Graphics)",
          icon: "📄",
          command: () => this.model?.setFormats("svg", undefined),
        },
        {
          data: "dxf",
          buttonLabel: "DXF",
          label: "DXF (Drawing Exchange Format)",
          icon: "📐",
          command: () => this.model?.setFormats("dxf", undefined),
        },
      ];
    } else {
      return [
        {
          data: "glb",
          buttonLabel: "GLB",
          label: "GLB (binary glTF)",
          icon: "📦",
          command: () => this.model?.setFormats(undefined, "glb"),
        },
        {
          data: "stl",
          buttonLabel: "STL",
          label: "STL (binary)",
          icon: "📦",
          command: () => this.model?.setFormats(undefined, "stl"),
        },
        {
          data: "off",
          buttonLabel: "OFF",
          label: "OFF (Object File Format)",
          icon: "📦",
          command: () => this.model?.setFormats(undefined, "off"),
        },
        {
          data: "3mf",
          buttonLabel: "3MF",
          label: "3MF (Multimaterial)",
          icon: "📦",
          command: () => this.model?.setFormats(undefined, "3mf"),
        },
        { separator: true } as any,
        {
          data: "materials",
          buttonLabel: "Materials",
          label: `Edit materials ${
            (this.state.params?.extruderColors ?? []).length > 0
              ? `(${(this.state.params?.extruderColors ?? []).length})`
              : ""
          }`,
          icon: "🎨",
          command: () =>
            this.model?.mutate((s: any) =>
              s.view.extruderPickerVisibility = "editing"
            ),
        },
      ];
    }
  }

  private toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
  }

  private selectFormat(format: ExportFormat) {
    this.dropdownOpen = false;
    format.command();
  }

  private export() {
    this.model?.export();
  }

  render() {
    if (!this.state) {
      return html`

      `;
    }

    const formats = this.getExportFormats();
    const exportFormat = this.state.is2D
      ? this.state.params?.exportFormat2D
      : this.state.params?.exportFormat3D;
    const selectedItem =
      formats.find((f) => (f as any).data === exportFormat) || formats[0];
    const isDisabled = !this.state.output || this.state.output?.isPreview ||
      this.state.rendering || this.state.exporting;

    return html`
      <div class="export-container">
        <button
          class="btn btn-secondary"
          ?disabled="${isDisabled}"
          @click="${() => this.export()}"
        >
          ⬇️ ${(selectedItem as any)?.buttonLabel ?? "Export"}
        </button>
        <button
          class="btn btn-secondary"
          ?disabled="${isDisabled}"
          @click="${() => this.toggleDropdown()}"
        >
          ▼
        </button>

        ${this.dropdownOpen
          ? html`
            <div class="dropdown-menu">
              ${formats.map((format, i) =>
                (format as any).separator
                  ? html`
                    <div class="dropdown-separator"></div>
                  `
                  : html`
                    <button
                      class="dropdown-item"
                      @click="${() => this.selectFormat(format)}"
                    >
                      ${(format as any).icon} ${(format as any).label}
                    </button>
                  `
              )}
            </div>
          `
          : ""}
      </div>
    `;
  }
}
