// Re-export the runtime values from the CDN-hosted Lit build so that the
// browser only ever loads ONE copy of Lit (avoiding the
// "Multiple versions of Lit loaded" dev warning).
//
// We intentionally split the *runtime* re-export (which the browser executes)
// from the *type* re-export (which only the TypeScript type-checker sees).
// The CDN URL has no `.d.ts`, so we map types back to the npm `lit` package,
// which is installed for typing purposes only.

export {
  css,
  html,
  render,
  svg,
} from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
export {
  customElement,
  property,
  query,
  state,
} from "https://cdn.jsdelivr.net/npm/lit@3.3.1/decorators.js";

// LitElement: bring in the runtime value from the CDN, but its TS type from
// the npm `lit` package so subclasses inherit the full HTMLElement API
// (renderRoot, addEventListener, dispatchEvent, etc.).
import { LitElement as _LitElementCDN } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import type { LitElement as LitElementType } from "lit";
export const LitElement = _LitElementCDN as unknown as typeof LitElementType;
export type LitElement = LitElementType;
