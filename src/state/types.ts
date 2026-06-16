/**
 * Shared types for the OpenSCAD Playground frontend
 */

export interface Source {
  path: string;
  url?: string;
  content?: string;
}

export interface FileOutput {
  fileId?: string;
  filename?: string;
  size?: number;
  logText?: string;
  elapsedMillis?: number;
  formattedElapsedMillis?: string;
  formattedOutFileSize?: string;
}

export interface AppState {
  params: {
    activePath: string;
    sources: Source[];
    vars?: Record<string, unknown>;
    features: string[];
    exportFormat2D: string;
    exportFormat3D: string;
    extruderColors?: string[];
  };
  view: {
    logs: boolean;
    layout:
      | { mode: "single"; focus: string }
      | {
        mode: "multi";
        editor: boolean;
        viewer: boolean;
        customizer: boolean;
      };
    extruderPickerVisibility?: "editing" | "exporting";
    color: string;
    bgColor?: string;
    showAxes: boolean;
    lineNumbers: boolean;
  };
  currentRunLogs?: [string, string][];
  lastCheckerRun?: {
    logText: string;
    markers: Marker[];
  };
  rendering?: boolean;
  previewing?: boolean;
  exporting?: boolean;
  checkingSyntax?: boolean;
  parameterSet?: unknown;
  error?: string;
  is2D?: boolean;
  output?: FileOutput & { isPreview: boolean };
  export?: FileOutput;
}

export interface Marker {
  message: string;
  severity: "error" | "warning" | "info";
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}
