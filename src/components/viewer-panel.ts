/**
 * Viewer Panel component
 * Displays 3D (binary STL from OpenSCAD) using three.js, or 2D (SVG/DXF) inline.
 */

import {
  css,
  customElement,
  html,
  LitElement,
  query,
  state,
} from "../_share/lit.ts";
import { blurHashToImage, imageToBlurhash } from "../io/image_hashes.ts";
import { appStore } from "../state/store.ts";
import {
  GLTFExporter,
  GLTFLoader,
  OrbitControls,
  STLLoader,
  THREE,
} from "../_share/three.ts";

// three.js modules are exposed via the import map (`?three` query) defined in
// `_share/html/imaps.ts`. We dynamically import inside the component so SSR /
// non-3D paths don't pay the cost.

type ThreeNS = typeof THREE;

interface GLTFLoadResult {
  scene: THREE.Object3D;
  scenes: THREE.Object3D[];
  animations: unknown[];
  cameras: unknown[];
  asset: unknown;
}

interface ThreeRuntime {
  THREE: ThreeNS;
  OrbitControls: new (
    cam: THREE.Camera,
    el: HTMLElement,
  ) => {
    enableDamping: boolean;
    dampingFactor: number;
    target: THREE.Vector3;
    update: () => void;
    dispose: () => void;
  };
  STLLoader: new () => {
    parse: (buf: ArrayBuffer | string) => THREE.BufferGeometry;
  };
  GLTFLoader: new () => {
    parse: (
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTFLoadResult) => void,
      onError?: (err: ErrorEvent | Error) => void,
    ) => void;
  };
  GLTFExporter: new () => {
    parse: (
      input: THREE.Object3D | THREE.Object3D[],
      onCompleted: (result: ArrayBuffer | Record<string, unknown>) => void,
      onError: (err: ErrorEvent | Error) => void,
      options?: {
        binary?: boolean;
        onlyVisible?: boolean;
        embedImages?: boolean;
      },
    ) => void;
  };
}

interface ModelViewerOrbit {
  theta: number;
  phi: number;
  radius: number;
  toString: () => string;
}

interface ModelViewerElement extends HTMLElement {
  cameraOrbit: string;
  interactionPrompt: string;
  getCameraOrbit: () => ModelViewerOrbit;
  toDataURL: (type?: string, encoderOptions?: number) => Promise<string>;
}

let _threeRuntime: Promise<ThreeRuntime> | null = null;
function loadThreeRuntime(): Promise<ThreeRuntime> {
  if (_threeRuntime) return _threeRuntime;
  _threeRuntime = (async () => {
    return { THREE, OrbitControls, STLLoader, GLTFLoader, GLTFExporter };
  })();
  return _threeRuntime;
}

export const PREDEFINED_ORBITS: [string, number, number][] = [
  ["Diagonal", Math.PI / 4, Math.PI / 4],
  ["Front", 0, Math.PI / 2],
  ["Right", Math.PI / 2, Math.PI / 2],
  ["Back", Math.PI, Math.PI / 2],
  ["Left", -Math.PI / 2, Math.PI / 2],
  ["Top", 0, 0],
  ["Bottom", 0, Math.PI],
];
const originalOrbit = (([, theta, phi]) => `${theta}rad ${phi}rad auto`)(
  PREDEFINED_ORBITS[0],
);

// Orbit math helpers — ported from the original ViewerPanel.tsx.
function spherePoint(theta: number, phi: number): [number, number, number] {
  return [
    Math.cos(theta) * Math.sin(phi),
    Math.sin(theta) * Math.sin(phi),
    Math.cos(phi),
  ];
}
function euclideanDist(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
const radDist = (a: number, b: number) =>
  Math.min(
    Math.abs(a - b),
    Math.abs(a - b + 2 * Math.PI),
    Math.abs(a - b - 2 * Math.PI),
  );
function getClosestPredefinedOrbitIndex(
  theta: number,
  phi: number,
): [number, number, number] {
  const point = spherePoint(theta, phi);
  const points = PREDEFINED_ORBITS.map(([_, t, p]) => spherePoint(t, p));
  const distances = points.map((p) => euclideanDist(point, p));
  const radDistances = PREDEFINED_ORBITS.map(([_, ptheta, pphi]) =>
    Math.max(radDist(theta, ptheta), radDist(phi, pphi))
  );
  const [index, dist] = distances.reduce(
    (acc, d, i) => (d < acc[1] ? [i, d] : acc),
    [0, Infinity] as [number, number],
  );
  return [index, dist, radDistances[index]];
}

/**
 * Convert a Three.js camera into spherical coords (theta, phi, radius)
 * compatible with model-viewer's camera-orbit string.
 */
function cameraToOrbit(
  cam: THREE.PerspectiveCamera & { position: THREE.Vector3 },
) {
  const pos = cam.position;
  const radius = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  const theta = Math.atan2(pos.x, pos.z);
  const phi = Math.acos(Math.max(-1, Math.min(1, pos.y / radius)));
  return { theta, phi, radius };
}

/**
 * Convert model-viewer orbit (theta, phi, radius) into a Three.js
 * camera position (assuming the controls target is at origin).
 */
function orbitToCamera(
  theta: number,
  phi: number,
  radius: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    radius * Math.cos(theta) * Math.sin(phi),
    radius * Math.cos(phi),
    radius * Math.sin(theta) * Math.sin(phi),
  );
}

/**
 * Pick an asset loader based on the URL/MIME hint.
 * - `*.glb` / `*.gltf` / `model/gltf-binary` / `model/gltf+json` → GLTF
 * - default                                                     → STL
 */
function detectAssetKind(url: string, mime?: string): "gltf" | "stl" {
  const m = (mime || "").toLowerCase();
  if (m.includes("gltf")) return "gltf";
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "gltf";
  return "stl";
}

/** Default viewer background color (used when state has no `bgColor`). */
export const DEFAULT_BG_COLOR = "#ffffff";

@customElement("viewer-panel")
export class ViewerPanel extends LitElement {
  @state()
  private accessor _fileId = "";
  @state()
  private accessor _fileUrl = "";
  @state()
  private accessor _is2D = false;
  @state()
  private accessor _showAxes = true;
  @state()
  private accessor _bgColor = DEFAULT_BG_COLOR;
  @state()
  private accessor _loading = false;
  @state()
  private accessor _error = "";
  @state()
  private accessor _blurHashUri = "";
  @state()
  private accessor _assetKind: "gltf" | "stl" | "" = "";
  @state()
  private accessor _assetUrl = "";
  @state()
  private accessor _loadedUrl = "";
  @state()
  private accessor _interactionPrompt = "auto";

  @query(".main-viewer")
  private accessor _mainViewerEl!: ModelViewerElement | null;
  @query(".axes-overlay")
  private accessor _axesViewerEl!: ModelViewerElement | null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
    }

    .viewer-container,
    .model-viewer-container {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0; /* allow flex child to shrink below content height */
      overflow: hidden;
    }

    .main-viewer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transition: opacity 0.5s;
    }

    .three-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .svg-container {
      flex: 1;
      overflow: auto;
      padding: 16px;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .svg-container img,
    .svg-container svg {
      max-width: 100%;
      max-height: 100%;
    }

    .placeholder {
      color: #888;
      font-size: 14px;
      text-align: center;
      padding: 32px;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      padding: 4px 8px;
      background: #f3f3f3;
      border-bottom: 1px solid #ddd;
      align-items: center;
    }

    .export-btn {
      font-size: 12px;
      padding: 2px 8px;
      border: 1px solid #bbb;
      background: #fff;
      border-radius: 3px;
      cursor: pointer;
    }
    .export-btn:hover {
      background: #eef;
    }

    .bg-color-picker {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      cursor: pointer;
    }

    .bg-color-picker input[type="color"] {
      width: 22px;
      height: 18px;
      padding: 0;
      border: 1px solid #bbb;
      border-radius: 3px;
      background: none;
      cursor: pointer;
    }

    .axes-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
    }

    .status {
      position: absolute;
      top: 8px;
      left: 8px;
      color: #f48771;
      font-family: monospace;
      font-size: 12px;
      pointer-events: none;
    }

    .loading {
      position: absolute;
      top: 8px;
      right: 8px;
      color: #ccc;
      font-size: 12px;
      pointer-events: none;
    }
    .axes-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      z-index: 10;
      height: 100px;
      width: 100px;
      cursor: pointer;
    }

    .pulse-preview {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0% {
        opacity: 0.4;
      }
      50% {
        opacity: 0.7;
      }
      100% {
        opacity: 0.4;
      }
    }

    /* Fade-in transition for the main viewer once loaded */
    .viewer-container.loaded .three-canvas {
      animation: fadeIn 0.5s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `;

  // three.js scene state -- intentionally kept off the reactive state
  // so that we own the canvas/disposal lifecycle ourselves.
  private _renderer: THREE.WebGLRenderer | null = null;
  private _scene: THREE.Scene | null = null;
  private _camera: THREE.PerspectiveCamera | null = null;
  private _controls: { update: () => void; dispose: () => void } | null = null;
  // Holds the currently displayed root object. Either a single Mesh (STL)
  // or the root of a loaded GLTF scene tree.
  private _mesh: THREE.Object3D | null = null;
  private _axesHelper: THREE.Object3D | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _rafId: number | null = null;
  private _disposed = false;
  private _modelViewerSyncCleanup: (() => void) | null = null;
  private _orbitCycleIndex = 0;
  private _unsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    const sync = () => {
      const state = (appStore.model as any)?.state;
      if (!state) return;

      this._showAxes = state.view?.showAxes ?? this._showAxes;
      this._bgColor = state.view?.bgColor ?? this._bgColor;
      const output = state.output as any;
      if (!output) return;

      const fileUrl = state.is2D
        ? output.outFileURL
        : output.displayFileURL ?? output.outFileURL;
      if (!fileUrl || fileUrl === this._fileUrl) return;

      this._fileUrl = fileUrl;
      this._fileId = output.displayFile?.name ?? output.outFile?.name ??
        output.filename ?? fileUrl;
      this._is2D = state.is2D ?? false;
      this._error = "";
    };
    sync();
    this._unsubscribe = appStore.subscribe(sync);
    this.addEventListener(
      "preview-ready",
      this._onPreviewReady as EventListener,
    );
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this.removeEventListener(
      "preview-ready",
      this._onPreviewReady as EventListener,
    );
    this._teardownThree();
    super.disconnectedCallback();
  }

  private _onPreviewReady = (
    e: CustomEvent<{ fileId?: string; fileUrl?: string; is2D?: boolean }>,
  ) => {
    const fileUrl = e.detail.fileUrl ??
      (e.detail.fileId && /^(blob:|data:|https?:)/.test(e.detail.fileId)
        ? e.detail.fileId
        : "");
    if (fileUrl) {
      this._fileUrl = fileUrl;
      this._fileId = e.detail.fileId ?? fileUrl;
    }
    this._is2D = e.detail.is2D ?? false;
    this._error = "";
    // Don't clear _blurHashUri here — it's shown as a placeholder while
    // the new 3D asset loads in. It will be replaced once loading completes.
  };

  private async _ensureThree() {
    this._disposed = false;
    const container = this.renderRoot.querySelector(
      ".viewer-container",
    ) as HTMLElement | null;
    if (!container) return;
    if (this._renderer) {
      // Lit may have re-rendered the container (e.g. when switching from
      // the placeholder branch). Re-attach the canvas if needed.
      if (this._renderer.domElement.parentElement !== container) {
        container.appendChild(this._renderer.domElement);
        this._handleResize();
        if (this._resizeObserver) this._resizeObserver.observe(container);
      }
      return;
    }

    const { THREE, OrbitControls } = await loadThreeRuntime();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(this._bgColor);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      5000,
    );
    camera.position.set(60, 60, 60);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.classList.add("three-canvas");
    // Color management: GLTF assets bake colors / textures in sRGB. Without
    // setting outputColorSpace and toneMapping, baseColors look dim/washed-out
    // and "color not working" symptoms appear. ACES Filmic also gives nicer
    // highlights on metallic/roughness materials.
    const r = renderer as unknown as {
      outputColorSpace?: string;
      toneMapping?: number;
      toneMappingExposure?: number;
    };
    // three.js >=0.152 uses outputColorSpace; we set both names defensively.
    r.outputColorSpace = (THREE as unknown as { SRGBColorSpace?: string })
      .SRGBColorSpace ?? "srgb";
    r.toneMapping = (THREE as unknown as { ACESFilmicToneMapping?: number })
      .ACESFilmicToneMapping ?? 0;
    r.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // Lights - hemisphere + directional gives a clean CAD-ish look.
    // Bumped intensities slightly because tone mapping darkens the base image.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(1, 1, 1);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir2.position.set(-1, -0.5, -1);
    scene.add(dir2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    // Axes helper (absent otherwise since we render our own 3D view).
    const axes = new THREE.AxesHelper(50);

    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;
    this._controls = controls as unknown as typeof this._controls;
    this._axesHelper = axes;
    if (this._showAxes) scene.add(axes);

    // Animation loop.
    const tick = () => {
      if (this._disposed) return;
      this._controls?.update();
      this._renderer!.render(this._scene!, this._camera!);
      this._rafId = globalThis.requestAnimationFrame(tick);
    };
    tick();

    // Auto-resize.
    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(container);
  }

  private _handleResize() {
    const container = this.renderRoot.querySelector(
      ".viewer-container",
    ) as HTMLElement | null;
    if (!container || !this._renderer || !this._camera) return;
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 1);
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  /** Port of the original React model-viewer camera sync + axes click cycle. */
  private _setupModelViewerFeatures() {
    const modelViewer = this._mainViewerEl;
    const axesViewer = this._axesViewerEl;
    if (!modelViewer) return;

    this._modelViewerSyncCleanup?.();
    const cleanups: Array<() => void> = [];

    if (axesViewer) {
      for (
        const [ref, otherRef] of [
          [modelViewer, axesViewer],
          [axesViewer, modelViewer],
        ] as const
      ) {
        const handleCameraChange = (
          e: Event & { detail?: { source?: string } },
        ) => {
          if (e.detail?.source !== "user-interaction") return;
          const cameraOrbit = ref.getCameraOrbit();
          cameraOrbit.radius = otherRef.getCameraOrbit().radius;
          otherRef.cameraOrbit = cameraOrbit.toString();
        };
        ref.addEventListener(
          "camera-change",
          handleCameraChange as EventListener,
        );
        cleanups.push(() =>
          ref.removeEventListener(
            "camera-change",
            handleCameraChange as EventListener,
          )
        );
      }

      let mouseDownSpherePoint: [number, number, number] | undefined;
      const getSpherePoint = () => {
        const orbit = axesViewer.getCameraOrbit();
        return spherePoint(orbit.theta, orbit.phi);
      };
      const isAxesEvent = (e: MouseEvent) =>
        e.composedPath().includes(axesViewer);
      const onMouseDown = (e: MouseEvent) => {
        if (isAxesEvent(e)) mouseDownSpherePoint = getSpherePoint();
      };
      const onMouseUp = (e: MouseEvent) => {
        if (!isAxesEvent(e)) return;
        const euclEps = 0.01;
        const point = getSpherePoint();
        const clickDist = mouseDownSpherePoint
          ? euclideanDist(point, mouseDownSpherePoint)
          : Infinity;
        if (clickDist > euclEps) return;

        const modelOrbit = modelViewer.getCameraOrbit();
        this._orbitCycleIndex = (this._orbitCycleIndex + 1) %
          PREDEFINED_ORBITS.length;
        const [name, theta, phi] = PREDEFINED_ORBITS[this._orbitCycleIndex];
        Object.assign(modelOrbit, { theta, phi });
        const newOrbit = modelOrbit.toString();
        modelViewer.cameraOrbit = newOrbit;
        axesViewer.cameraOrbit = newOrbit;
        this._interactionPrompt = "none";
        this.dispatchEvent(
          new CustomEvent("view-change", {
            detail: { name },
            bubbles: true,
            composed: true,
          }),
        );
      };
      window.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);
      cleanups.push(() => {
        window.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mouseup", onMouseUp);
      });
    }

    this._modelViewerSyncCleanup = () => {
      for (const cleanup of cleanups) cleanup();
      this._modelViewerSyncCleanup = null;
    };
  }

  private async _onModelViewerLoad() {
    this._loadedUrl = this._assetUrl;
    this._loading = false;
    try {
      const uri = await this._mainViewerEl?.toDataURL("image/png", 0.5);
      if (!uri) return;
      const hash = await imageToBlurhash(uri);
      this._blurHashUri = blurHashToImage(hash, 100, 100);
    } catch {
      // Non-critical; screenshot/blurhash generation can fail in some browsers.
    }
  }

  /**
   * Capture a screenshot from the Three.js canvas, generate a blurhash,
   * and store the data URI for use as a loading placeholder on the next
   * asset load.
   */
  private async _captureBlurHash() {
    try {
      const canvas = this._renderer?.domElement;
      if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
      const dataUrl = canvas.toDataURL("image/png", 0.3);
      const hash = await imageToBlurhash(dataUrl);
      this._blurHashUri = blurHashToImage(hash, 100, 100);
    } catch {
      // Non-critical; silently ignore failures.
      this._blurHashUri = "";
    }
  }

  private _teardownThree() {
    this._disposed = true;
    if (this._rafId !== null) globalThis.cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._modelViewerSyncCleanup?.();
    this._modelViewerSyncCleanup = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._controls?.dispose();
    this._controls = null;
    if (this._mesh) {
      // Walk the (possibly GLTF) tree and free geometries/materials.
      this._disposeObject3D(this._mesh);
      this._mesh = null;
    }
    this._renderer?.dispose();
    this._renderer?.domElement.remove();
    this._renderer = null;
    this._scene = null;
    this._camera = null;
  }

  /**
   * Fetch a 3D asset (STL or GLB/GLTF) and load it into the scene.
   * The asset kind is decided by Content-Type then URL extension.
   * Frames the camera around the asset's bounding box.
   */
  private async _loadAsset(url: string) {
    this._error = "";
    this._loading = true;
    this._loadedUrl = "";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = res.headers.get("content-type") || "";
      const kind = detectAssetKind(url, mime);

      // GLB/GLTF path: use <model-viewer> as the primary viewer so we keep
      // the original model-viewer camera controls, AR support and axes sync.
      if (kind === "gltf") {
        if (this._renderer) this._teardownThree();
        this._assetKind = "gltf";
        this._assetUrl = url;
        await this.updateComplete;
        requestAnimationFrame(() => this._setupModelViewerFeatures());
        return;
      }

      // STL fallback path: use the existing three.js viewer.
      this._assetKind = "stl";
      this._assetUrl = url;
      const buf = await res.arrayBuffer();
      await this._ensureThree();
      if (!this._scene || !this._camera) return;
      const runtime = await loadThreeRuntime();

      // Replace previous content.
      if (this._mesh) {
        this._scene.remove(this._mesh);
        this._disposeObject3D(this._mesh);
        this._mesh = null;
      }

      const object = this._parseSTL(buf, runtime);
      this._scene.add(object);
      this._mesh = object;
      this._frameCamera(object, runtime.THREE);
      this._captureBlurHash();
      this._loading = false;
    } catch (e) {
      console.error("Asset load failed:", e);
      this._error = `Load failed: ${(e as Error).message}`;
      this._loading = false;
    }
  }

  /**
   * Parse a binary/ASCII STL into a Mesh with a default standard material.
   * The geometry is centered at the origin for stable orbiting.
   */
  private _parseSTL(buf: ArrayBuffer, rt: ThreeRuntime): THREE.Mesh {
    const { THREE, STLLoader } = rt;
    const loader = new STLLoader();
    const geometry = loader.parse(buf);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox!.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    const material = new THREE.MeshStandardMaterial({
      color: 0xf9d71c,
      metalness: 0.05,
      roughness: 0.7,
      flatShading: false,
    });
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Parse GLB (ArrayBuffer) or GLTF (text) using GLTFLoader.parse.
   * Centers the resulting scene at the origin so the camera framing logic
   * (which assumes content is roughly origin-centered) still works.
   */
  private _parseGLTF(
    buf: ArrayBuffer,
    rt: ThreeRuntime,
  ): Promise<THREE.Object3D> {
    const { THREE, GLTFLoader } = rt;
    return new Promise<THREE.Object3D>((resolve, reject) => {
      const loader = new GLTFLoader();
      // Heuristic: GLB files start with magic 'glTF' (0x46546C67) ASCII bytes.
      // If first 4 bytes don't match, decode as JSON text for .gltf.
      const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      const isBinary = head.length === 4 &&
        head[0] === 0x67 && head[1] === 0x6c &&
        head[2] === 0x54 && head[3] === 0x46;
      const data: ArrayBuffer | string = isBinary
        ? buf
        : new TextDecoder().decode(buf);

      loader.parse(
        data,
        "",
        (gltf: GLTFLoadResult) => {
          const root = gltf.scene;
          // Center the model at origin.
          const box = new THREE.Box3().setFromObject(root);
          const center = new THREE.Vector3();
          box.getCenter(center);
          root.position.sub(center);
          resolve(root);
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }

  /** Walk an Object3D tree and dispose all geometries/materials/textures. */
  private _disposeObject3D(root: THREE.Object3D) {
    root.traverse((child: THREE.Object3D) => {
      const m = child as unknown as {
        geometry?: { dispose?: () => void };
        material?:
          | { dispose?: () => void }
          | Array<{ dispose?: () => void }>;
      };
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) {
        for (const x of mat) x.dispose?.();
      } else {
        mat?.dispose?.();
      }
    });
  }

  /**
   * Position the camera to frame the given object's bounding sphere,
   * adjust near/far planes, and scale the axes helper to match.
   */
  private _frameCamera(object: THREE.Object3D, THREE: ThreeNS) {
    if (!this._camera) return;
    const box = new THREE.Box3().setFromObject(object);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = sphere.radius || 10;
    const dist = radius * 2.5;
    this._camera.position.set(dist, dist, dist);
    this._camera.near = Math.max(radius / 100, 0.01);
    this._camera.far = radius * 100 + 1000;
    this._camera.updateProjectionMatrix();
    (this._controls as unknown as { target: THREE.Vector3 })
      ?.target.set(0, 0, 0);
    if (this._axesHelper) {
      const s = radius * 1.2;
      this._axesHelper.scale.set(s / 50, s / 50, s / 50);
    }
  }

  /**
   * Export the currently loaded model as GLB (binary) or GLTF (json) and
   * trigger a browser download. Works for STL-derived meshes as well as
   * already-loaded GLTF scenes — three.js's GLTFExporter handles both.
   */
  async exportAsGLTF(binary = true): Promise<void> {
    try {
      // Fast path: exporting GLB while already viewing a GLB/GLTF asset (the
      // common OpenSCAD output case) — re-download the already-loaded bytes so
      // vertex colors / materials are preserved exactly as produced upstream.
      // In this mode the three.js scene/`_mesh` is never populated (the
      // <model-viewer> element owns the asset), which is why the previous
      // `if (!this._mesh)` guard incorrectly reported "No model loaded".
      if (
        binary && !this._mesh && this._assetKind === "gltf" && this._assetUrl
      ) {
        const res = await fetch(this._assetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        this._downloadBlob(blob, "glb");
        return;
      }

      const root = await this._resolveExportRoot();
      if (!root) {
        this._error = "No model loaded to export.";
        return;
      }

      const { GLTFExporter } = await loadThreeRuntime();
      const exporter = new GLTFExporter();
      const result = await new Promise<ArrayBuffer | Record<string, unknown>>(
        (resolve, reject) => {
          exporter.parse(
            root,
            (out) => resolve(out),
            (err) =>
              reject(err instanceof Error ? err : new Error(String(err))),
            { binary, onlyVisible: true, embedImages: true },
          );
        },
      );

      const ext = binary ? "glb" : "gltf";
      const mime = binary ? "model/gltf-binary" : "model/gltf+json";
      const blob = binary
        ? new Blob([result as ArrayBuffer], { type: mime })
        : new Blob([JSON.stringify(result)], { type: mime });
      this._downloadBlob(blob, ext);
    } catch (e) {
      console.error("GLTF export failed:", e);
      this._error = `Export failed: ${(e as Error).message}`;
    }
  }

  /**
   * Resolve an Object3D to feed into GLTFExporter.
   * - STL viewer keeps a live `_mesh` we can export directly.
   * - The model-viewer (GLTF) path doesn't retain a three.js object, so we
   *   re-fetch and parse the loaded asset bytes on demand.
   */
  private async _resolveExportRoot(): Promise<THREE.Object3D | null> {
    if (this._mesh) return this._mesh;
    if (this._assetKind === "gltf" && this._assetUrl) {
      const res = await fetch(this._assetUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const rt = await loadThreeRuntime();
      return await this._parseGLTF(buf, rt);
    }
    return null;
  }

  /** Trigger a same-origin download of an in-memory blob. */
  private _downloadBlob(blob: Blob, ext: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `model.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke shortly after; some browsers need the URL alive past the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected updated(changed: Map<string, unknown>) {
    if (
      (changed.has("_fileUrl") || changed.has("_fileId")) && this._fileUrl &&
      !this._is2D
    ) {
      const url = this._fileUrl;
      // Defer one frame so the viewer container is in the DOM after the
      // template change from the placeholder branch.
      requestAnimationFrame(() => this._loadAsset(url));
    }
    if (
      (changed.has("_assetKind") || changed.has("_assetUrl") ||
        changed.has("_showAxes")) &&
      this._assetKind === "gltf"
    ) {
      requestAnimationFrame(() => this._setupModelViewerFeatures());
    }
    if (changed.has("_showAxes") && this._scene && this._axesHelper) {
      if (this._showAxes) this._scene.add(this._axesHelper);
      else this._scene.remove(this._axesHelper);
    }
    if (changed.has("_bgColor")) {
      // Keep the host element background in sync so the <model-viewer> (which
      // renders with a transparent canvas) and any letterboxing show the
      // chosen color too, not just the three.js STL scene.
      this.style.background = this._bgColor;
      if (this._scene) {
        const col = this._scene.background as
          | { set?: (c: string) => void }
          | null;
        if (col && typeof col.set === "function") col.set(this._bgColor);
        else this._scene.background = new THREE.Color(this._bgColor);
      }
    }
  }

  protected render() {
    if (!this._fileUrl) {
      return html`
        <div class="viewer-container">
          <div class="placeholder">
            <p>Edit OpenSCAD code and press <strong>F5</strong> to preview</p>
          </div>
        </div>
      `;
    }

    const fileUrl = this._fileUrl;

    if (this._is2D) {
      return html`
        <div class="toolbar">
          <span>2D Preview (SVG)</span>
        </div>
        <div class="svg-container">
          <img src="${fileUrl}" alt="2D preview" />
        </div>
      `;
    }

    return html`
      ${this._assetKind === "gltf"
        ? this._renderModelViewer3D()
        : this._renderThreeViewer3D()}
      <div class="toolbar">
        <label class="axes-toggle">
          <input
            type="checkbox"
            .checked="${this._showAxes}"
            @change="${this._toggleAxes}"
          />
        </label>
        <button
          class="export-btn"
          title="Download current model as GLB (with vertex colors)"
          @click="${() => this.exportAsGLTF(true)}"
        >
          GLB
        </button>
        <button
          class="export-btn"
          title="Download current model as GLTF (JSON)"
          @click="${() => this.exportAsGLTF(false)}"
        >
          GLTF
        </button>
        <button
          class="export-btn"
          title="Re-render current source as STL and download"
          @click="${() => this._requestExport("stl")}"
        >
          STL
        </button>
        <button
          class="export-btn"
          title="Re-render current source as OFF and download"
          @click="${() => this._requestExport("off")}"
        >
          OFF
        </button>
        <button
          class="export-btn"
          title="Re-render current source as 3MF (with colors) and download"
          @click="${() => this._requestExport("3mf")}"
        >
          3MF
        </button>
        <span style="margin-left: auto">OpenSCAD Preview</span>
        <label class="bg-color-picker" title="Viewer background color">
          <input
            type="color"
            .value="${this._bgColor}"
            @input="${this._onBgColorChange}"
          />
        </label>
      </div>
    `;
  }

  private _renderModelViewer3D() {
    const loaded = this._loadedUrl === this._assetUrl;
    return html`
      <div class="model-viewer-container">
        ${!loaded && this._blurHashUri
          ? html`
            <img class="pulse-preview" src="${this._blurHashUri}" alt="" />
          `
          : ""}
        <model-viewer
          class="main-viewer"
          orientation="0deg -90deg 0deg"
          src="${this._assetUrl}"
          style="opacity: ${loaded ? 1 : 0}"
          camera-orbit="${originalOrbit}"
          interaction-prompt="${this._interactionPrompt}"
          environment-image="./skybox-lights.jpg"
          max-camera-orbit="auto 180deg auto"
          min-camera-orbit="auto 0deg auto"
          camera-controls
          ar
          @load="${this._onModelViewerLoad}"
        >
          <span slot="progress-bar"></span>
        </model-viewer>
        ${this._loading
          ? html`
            <div class="loading">Loading…</div>
          `
          : ""} ${this._error
          ? html`
            <div class="status">${this._error}</div>
          `
          : ""} ${this._showAxes ? this._renderAxesViewer() : ""}
      </div>
    `;
  }

  private _renderThreeViewer3D() {
    return html`
      <div class="viewer-container${this._fileUrl && !this._loading
        ? " loaded"
        : ""}">
        ${this._loading && this._blurHashUri
          ? html`
            <img class="pulse-preview" src="${this._blurHashUri}" alt="" />
          `
          : ""} ${this._loading
          ? html`
            <div class="loading">Loading…</div>
          `
          : ""} ${this._error
          ? html`
            <div class="status">${this._error}</div>
          `
          : ""}
      </div>
      ${this._showAxes ? this._renderAxesViewer() : ""}
    `;
  }

  private _renderAxesViewer() {
    return html`
      <model-viewer
        class="axes-overlay"
        orientation="0deg -90deg 0deg"
        src="./axes.glb"
        loading="eager"
        camera-orbit="${originalOrbit}"
        interpolation-decay="0"
        environment-image="./skybox-lights.jpg"
        max-camera-orbit="auto 180deg auto"
        min-camera-orbit="auto 0deg auto"
        orbit-sensitivity="5"
        interaction-prompt="none"
        camera-controls="false"
        disable-zoom
        disable-tap
        disable-pan
      >
        <span slot="progress-bar"></span>
      </model-viewer>
    `;
  }

  private _toggleAxes(e: Event) {
    this._showAxes = (e.target as HTMLInputElement).checked;
  }

  private _onBgColorChange(e: Event) {
    const color = (e.target as HTMLInputElement).value;
    this._bgColor = color;
    // Persist into shared app state so the choice survives re-renders and
    // is restored from the URL/local storage along with other view settings.
    const model = appStore.model as
      | { mutate?: (f: (s: any) => void) => void }
      | null;
    model?.mutate?.((s: any) => {
      s.view.bgColor = color;
    });
  }

  /**
   * Ask the host app to run an export with a server-side format. Used for
   * formats only OpenSCAD itself can produce (STL / OFF / 3MF), distinct
   * from the in-browser GLB/GLTF re-export above.
   */
  private _requestExport(format: string) {
    this.dispatchEvent(
      new CustomEvent("app-action", {
        detail: { action: "export", format },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
