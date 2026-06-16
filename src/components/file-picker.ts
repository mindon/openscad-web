// Portions of this file are Copyright 2021 Google LLC, and licensed under GPL2+. See COPYING.

import { css, customElement, html, LitElement, state } from "../_share/lit.ts";
import { appStore } from "../state/store.ts";
import { getParentDir, join } from "../fs/filesystem.ts";
import { defaultSourcePath } from "../state/initial-state.ts";
import { zipArchives } from "../fs/zip-archives.ts";

interface TreeNode {
  icon: string;
  label: string;
  data?: string;
  key: string;
  children?: TreeNode[];
  selectable?: boolean;
}

function biasedCompare(a: string, b: string): number {
  if (a === "openscad") return -1;
  if (b === "openscad") return 1;
  return a.localeCompare(b);
}

function listFilesAsNodes(
  fs: any,
  path: string,
  accept?: (path: string) => boolean,
): TreeNode[] {
  const files: [string, string, boolean][] = [];
  const dirs: [string, string, boolean][] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(path);
  } catch (e) {
    return [];
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;

    const childPath = join(path, name);
    if (accept && !accept(childPath)) continue;

    let stat: any;
    try {
      stat = fs.lstatSync(childPath);
    } catch (e) {
      continue;
    }

    const isDirectory = stat.isDirectory();
    if (!isDirectory && !name.endsWith(".scad")) continue;

    (isDirectory ? dirs : files).push([name, childPath, isDirectory]);
  }

  [files, dirs].forEach((arr) => arr.sort(([a], [b]) => biasedCompare(a, b)));

  const nodes: TreeNode[] = [];
  for (const arr of [files, dirs]) {
    for (const [name, childPath, isDirectory] of arr) {
      let children: TreeNode[] = [];
      let label = name;

      if (path === "/" && zipArchives[name]) {
        const config = zipArchives[name];
        if (config?.gitOrigin) {
          children.push({
            icon: "📦",
            label: config.gitOrigin.repoUrl.replaceAll(
              "https://github.com/",
              "",
            ),
            key: config.gitOrigin.repoUrl,
            selectable: true,
          });

          for (const [docLabel, link] of Object.entries(config.docs ?? {})) {
            children.push({
              icon: "📖",
              label: docLabel,
              key: link as string,
              selectable: true,
            });
          }
        }
      }

      if (isDirectory) {
        const subChildren = listFilesAsNodes(fs, childPath, accept);
        children = [...children, ...subChildren];
        if (children.length === 0) continue;
      }

      nodes.push({
        icon: isDirectory
          ? "📁"
          : (childPath === defaultSourcePath ? "🏠" : "📄"),
        label,
        data: childPath,
        key: childPath,
        children,
        selectable: !isDirectory,
      });
    }
  }

  return nodes;
}

@customElement("openscad-file-picker")
export class FilePicker extends LitElement {
  @state()
  private accessor state: any = null;
  @state()
  private accessor model: any = null;
  @state()
  private accessor fs: any = null;
  @state()
  private accessor treeData: TreeNode[] = [];
  @state()
  private accessor selectedKey = "";
  @state()
  private accessor expandedKeys: Set<string> = new Set();
  @state()
  private accessor searchTerm = "";
  @state()
  private accessor dropdownOpen = false;

  static styles = css`
    :host {
      display: block;
      position: relative;
      flex: 1;
    }

    * {
      box-sizing: border-box;
    }

    .file-picker-trigger {
      padding: 6px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .file-picker-trigger:hover {
      border-color: #999;
    }

    .dropdown-arrow {
      margin-left: 8px;
      font-size: 10px;
    }

    .file-tree-dropdown {
      position: absolute;
      bottom: 0;
      left: 0;
      margin-top: 4px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      max-height: 400px;
      overflow-y: auto;
    }

    .search-box {
      padding: 8px;
      border-bottom: 1px solid #e0e0e0;
    }

    .search-box input {
      width: 100%;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
    }

    .tree-node {
      padding: 4px 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }

    .tree-node:hover {
      background: #f5f5f5;
    }

    .tree-node.selected {
      background: #e3f2fd;
    }

    .tree-node.indent-1 {
      padding-left: 20px;
    }
    .tree-node.indent-2 {
      padding-left: 40px;
    }
    .tree-node.indent-3 {
      padding-left: 60px;
    }

    .tree-toggle {
      width: 16px;
      text-align: center;
      font-size: 10px;
    }

    .no-results {
      padding: 12px;
      text-align: center;
      color: #999;
      font-size: 13px;
    }
  `;

  constructor() {
    super();
    this.model = appStore.model;
    this.state = this.model?.state ?? null;
    this.fs = appStore.fs;
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = appStore.subscribe(() => {
      this.model = appStore.model;
      this.state = this.model?.state ?? null;
      this.fs = appStore.fs;
      this.buildTree();
    });
    this.buildTree();
    document.addEventListener("click", this._onDocumentClick, true);
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    document.removeEventListener("click", this._onDocumentClick, true);
    super.disconnectedCallback();
  }

  private _unsubscribe?: () => void;

  // Close the dropdown if a click happens outside this picker.
  private _onDocumentClick = (e: Event) => {
    if (!this.dropdownOpen) return;
    const path = e.composedPath();
    if (!path.includes(this)) this.dropdownOpen = false;
  };

  private buildTree() {
    const nodes: TreeNode[] = [];

    if (this.state?.params?.sources) {
      for (const { path } of this.state.params.sources) {
        const parent = getParentDir(path);
        if (parent === "/") {
          nodes.push({
            icon: "🏠",
            label: path.split("/").pop(),
            data: path,
            key: path,
            selectable: true,
          });
        }
      }
    }

    if (this.fs) {
      nodes.push(...listFilesAsNodes(this.fs, "/"));
    }

    this.treeData = nodes;
  }

  private toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
    if (this.dropdownOpen) {
      this.buildTree();
    }
  }

  private selectNode(node: TreeNode) {
    const hasChildren = !!(node.children && node.children.length > 0);
    const isDirectory = hasChildren && node.selectable === false;

    // External link: open and close dropdown
    if (node.key.startsWith("https://")) {
      window.open(node.key, "_blank");
      this.dropdownOpen = false;
      return;
    }

    // Selectable leaf (a .scad file or a synthetic selectable child like
    // the repo URL row). Pick the file and close the dropdown.
    if (node.selectable !== false && !isDirectory) {
      this.model?.openFile(node.key);
      this.selectedKey = node.key;
      this.dropdownOpen = false;
      return;
    }

    // Directory: toggle expand/collapse, KEEP the dropdown open.
    if (hasChildren) {
      if (this.expandedKeys.has(node.key)) {
        this.expandedKeys = new Set(
          [...this.expandedKeys].filter((k) => !k.startsWith(node.key)),
        );
      } else {
        this.expandedKeys = new Set([...this.expandedKeys, node.key]);
      }
    }
  }

  private onSearch(e: Event) {
    this.searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
  }

  private renderNode(node: TreeNode, depth: number): any {
    if (
      this.searchTerm && !node.label.toLowerCase().includes(this.searchTerm) &&
      !node.children
    ) {
      return html`

      `;
    }

    const isExpanded = this.expandedKeys.has(node.key);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = this.selectedKey === node.key;

    let childrenRendered: any = html`

    `;
    if (hasChildren && isExpanded) {
      childrenRendered = html`
        ${node.children!.map((child) => this.renderNode(child, depth + 1))}
      `;
    }

    return html`
      <div
        class="tree-node indent-${Math.min(depth, 3)} ${isSelected
          ? "selected"
          : ""}"
        @click="${() => this.selectNode(node)}"
      >
        ${hasChildren
          ? html`
            <span class="tree-toggle">${isExpanded ? "▼" : "▶"}</span>
          `
          : html`
            <span class="tree-toggle"></span>
          `}
        <span>${node.icon || "📄"}</span>
        <span>${node.label}</span>
      </div>
      ${childrenRendered}
    `;
  }

  render() {
    const currentPath = this.state?.params?.activePath ?? "";

    return html`
      <div>
        <div class="file-picker-trigger" @click="${() =>
          this.toggleDropdown()}">
          <span>${currentPath.split("/").pop() || "Select file..."}</span>
          <span class="dropdown-arrow">${this.dropdownOpen ? "▲" : "▼"}</span>
        </div>

        ${this.dropdownOpen
          ? html`
            <div class="file-tree-dropdown" @click="${(e: Event) =>
              e.stopPropagation()}">
              <div class="search-box">
                <input
                  type="text"
                  placeholder="Search files..."
                  .value="${this.searchTerm}"
                  @input="${this.onSearch}"
                />
              </div>
              ${this.treeData.length === 0
                ? html`
                  <div class="no-results">No files found</div>
                `
                : html`
                  ${this.treeData.map((node) => this.renderNode(node, 0))}
                `}
            </div>
          `
          : ""}
      </div>
    `;
  }
}
