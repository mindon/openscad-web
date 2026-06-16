/**
 * Customizer Panel component
 * Shows OpenSCAD parameters for customization
 */

import { css, customElement, html, LitElement, state } from "../_share/lit.ts";
import { appStore } from "../state/store.ts";
import type { AppState } from "../state/types.ts";
import type { Parameter } from "../state/customizer-types.ts";

@customElement("customizer-panel")
export class CustomizerPanel extends LitElement {
  @state()
  private accessor _state: AppState | null = null;
  @state()
  private accessor _visible = true;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #fafafa;
      border-left: 1px solid #ddd;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      background: #f0f0f0;
      border-bottom: 1px solid #ddd;
      font-weight: 600;
      font-size: 13px;
    }

    .close-btn {
      margin-left: auto;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: #666;
    }

    .params-container {
      flex: 1;
      overflow: auto;
      padding: 8px 12px;
    }

    details {
      margin-bottom: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.4);
      overflow: hidden;
    }

    summary {
      padding: 8px 12px;
      background: #f5f5f5;
      font-size: 12px;
      font-weight: bold;
      color: #555;
      cursor: pointer;
      user-select: none;
      outline: none;
    }

    summary:hover {
      background: #eeeeee;
    }

    .group-content {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .param-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-bottom: 1px solid #f0f0f0;
      padding-bottom: 8px;
    }

    .param-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .param-label-container {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .param-name {
      font-weight: bold;
      font-size: 12px;
      color: #333;
    }

    .param-caption {
      font-size: 11px;
      color: #666;
      margin-top: 1px;
    }

    .param-input-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    input[type="text"],
    input[type="number"],
    select {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      background: white;
      min-width: 0;
    }

    input[type="text"]:focus,
    input[type="number"]:focus,
    select:focus {
      border-color: #1976d2;
      outline: none;
    }

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .number-input-container {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
    }

    .slider {
      flex: 1;
      height: 6px;
      cursor: pointer;
      accent-color: #1976d2;
    }

    .vector-container {
      display: flex;
      flex: 1;
      gap: 4px;
    }

    .vector-input {
      flex: 1;
      min-width: 0;
    }

    .btn-reset {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .btn-reset:hover {
      background: #e0e0e0;
    }

    .empty {
      color: #999;
      font-size: 13px;
      text-align: center;
      padding: 32px 16px;
      line-height: 1.6;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = appStore.subscribe(() => {
      const model = appStore.model as { state?: AppState } | null;
      this._state = model?.state ?? null;
    });
    // sync initial state
    const model = appStore.model as { state?: AppState } | null;
    this._state = model?.state ?? null;
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    super.disconnectedCallback();
  }

  private _unsubscribe?: () => void;

  private _handleChange(name: string, value: any) {
    const model = appStore.model as any;
    if (model) {
      model.setVar(name, value);
    }
  }

  private _setTabOpen(group: string, open: boolean) {
    const model = appStore.model as any;
    if (!model) return;
    const collapsedTabSet = new Set<string>(
      model.state?.view?.collapsedCustomizerTabs ?? [],
    );
    if (open) {
      collapsedTabSet.delete(group);
    } else {
      collapsedTabSet.add(group);
    }
    model.mutate((s: any) => {
      s.view.collapsedCustomizerTabs = Array.from(collapsedTabSet);
    });
  }

  protected render() {
    if (!this._visible || !this._state) {
      return html`

      `;
    }

    const parameters =
      (this._state.parameterSet as any)?.parameters as Parameter[] ?? [];

    // Group parameters
    const groupedParameters = parameters.reduce((acc, param) => {
      const groupName = param.group || "Parameters";
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(param);
      return acc;
    }, {} as Record<string, Parameter[]>);

    const groups = Object.entries(groupedParameters);
    const collapsedTabSet = new Set<string>(
      this._state.view?.collapsedCustomizerTabs ?? [],
    );

    return html`
      <div class="header">
        <span>Customizer</span>
        <button class="close-btn" @click="${() => (this._visible =
          false)}">✕</button>
      </div>
      <div class="params-container">
        ${groups.length === 0
          ? html`
            <div class="empty">
              No parameters found.<br />Add <code>// Params</code> comments to your OpenSCAD
              code.
            </div>
          `
          : html`
            ${groups.map(([group, params]) =>
              html`
                <details
                  ?open="${!collapsedTabSet.has(group)}"
                  @toggle="${(e: Event) => {
                    const open = (e.target as HTMLDetailsElement).open;
                    this._setTabOpen(group, open);
                  }}"
                >
                  <summary><strong>${group}</strong></summary>
                  <div class="group-content">
                    ${params.map((param) => this._renderParamRow(param))}
                  </div>
                </details>
              `
            )}
          `}
      </div>
    `;
  }

  private _renderParamRow(p: Parameter) {
    const vars = this._state?.params?.vars ?? {};
    const value = vars[p.name];
    const isDirty = value !== undefined &&
      JSON.stringify(value) !== JSON.stringify(p.initial);

    return html`
      <div class="param-row">
        <div class="param-label-container">
          <div>
            <div class="param-name">${p.name}</div>
            ${p.caption
              ? html`
                <div class="param-caption">${p.caption}</div>
              `
              : ""}
          </div>
          ${isDirty
            ? html`
              <button
                class="btn-reset"
                title="Reset to default"
                @click="${() => this._handleChange(p.name, p.initial)}"
              >
                🔄
              </button>
            `
            : ""}
        </div>
        <div class="param-input-wrapper">
          ${this._renderParamInput(p, value)}
        </div>
      </div>
    `;
  }

  private _renderParamInput(p: Parameter, value: any) {
    const displayVal = value !== undefined ? value : p.initial;

    // 1. Dropdown options for string/number options
    if ("options" in p && p.options && p.options.length > 0) {
      return html`
        <select
          .value="${String(displayVal)}"
          @change="${(e: Event) => {
            const selectVal = (e.target as HTMLSelectElement).value;
            const parsedVal = p.type === "number"
              ? Number(selectVal)
              : selectVal;
            this._handleChange(p.name, parsedVal);
          }}"
        >
          ${p.options.map((opt) =>
            html`
              <option .value="${String(opt.value)}">${opt.name}</option>
            `
          )}
        </select>
      `;
    }

    // 2. Boolean checkboxes
    if (p.type === "boolean") {
      return html`
        <input
          type="checkbox"
          .checked="${Boolean(displayVal)}"
          @change="${(e: Event) => {
            this._handleChange(p.name, (e.target as HTMLInputElement).checked);
          }}"
        />
      `;
    }

    // 3. Vectors / Array initial values
    if (Array.isArray(p.initial) && "min" in p) {
      const curArr = Array.isArray(value) ? value : [...(p.initial as any[])];
      return html`
        <div class="vector-container">
          ${p.initial.map((initVal, idx) => {
            const curVal = curArr[idx] ?? initVal;
            return html`
              <input
                type="number"
                class="vector-input"
                .value="${Number(curVal)}"
                ?min="${(p as any).min !== undefined}"
                .min="${(p as any).min}"
                ?max="${(p as any).max !== undefined}"
                .max="${(p as any).max}"
                ?step="${(p as any).step !== undefined}"
                .step="${(p as any).step}"
                @input="${(e: Event) => {
                  const numVal = (e.target as HTMLInputElement).valueAsNumber;
                  if (!isNaN(numVal)) {
                    const newArr = [...curArr];
                    newArr[idx] = numVal;
                    this._handleChange(p.name, newArr);
                  }
                }}"
              />
            `;
          })}
        </div>
      `;
    }

    // 4. Number inputs (with optional slider range)
    if (p.type === "number") {
      return html`
        <div class="number-input-container">
          <input
            type="number"
            .value="${Number(displayVal)}"
            ?min="${p.min !== undefined}"
            .min="${p.min}"
            ?max="${p.max !== undefined}"
            .max="${p.max}"
            ?step="${p.step !== undefined}"
            .step="${p.step}"
            @input="${(e: Event) => {
              const numVal = (e.target as HTMLInputElement).valueAsNumber;
              if (!isNaN(numVal)) {
                this._handleChange(p.name, numVal);
              }
            }}"
          />
          ${p.min !== undefined && p.max !== undefined
            ? html`
              <input
                type="range"
                class="slider"
                .value="${Number(displayVal)}"
                min="${p.min}"
                max="${p.max}"
                step="${p.step ?? 1}"
                @input="${(e: Event) => {
                  const numVal = Number((e.target as HTMLInputElement).value);
                  this._handleChange(p.name, numVal);
                }}"
              />
            `
            : ""}
        </div>
      `;
    }

    // 5. Default text string inputs
    return html`
      <input
        type="text"
        .value="${String(displayVal ?? "")}"
        @input="${(e: Event) => {
          this._handleChange(p.name, (e.target as HTMLInputElement).value);
        }}"
      />
    `;
  }
}
