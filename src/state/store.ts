/**
 * Simple store for sharing state between Lit components
 * Replacement for React Context API
 */

type Listener = () => void;

export class AppStore {
  private listeners = new Set<Listener>();
  private _model: unknown = null;
  private _fs: unknown = null;

  set model(value: unknown) {
    this._model = value;
    this.notify();
  }

  get model(): unknown {
    return this._model;
  }

  set fs(value: unknown) {
    this._fs = value;
    this.notify();
  }

  get fs(): unknown {
    return this._fs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

// Global store instance
export const appStore = new AppStore();
