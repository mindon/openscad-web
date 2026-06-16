((sself: HTMLScriptElement) => {
  const q = new URL(sself.src).searchParams;
  const g = function (tag, props) {
    const t = document.createElement(tag);
    Object.keys(props).map((k) => t[k] = props[k]);
    return t;
  };
  const imaps = g("script", {
    type: "importmap",
    textContent: `{
  "imports": {
      "@lit/reactive-element/": "https://cdn.jsdelivr.net/npm/@lit/reactive-element@2.1.1/"${
      q.has("three")
        ? `,"three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.min.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/",
      "three/fonts/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/fonts/"`
        : ""
    }${
      q.has("qr")
        ? `,"qrcode-generator": "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm"`
        : ""
    }    ${
      q.has("monaco")
        ? `,"monaco-editor": "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/esm/vs/editor/editor.api.js",
      "monaco-editor/esm/vs/editor/editor.api": "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/esm/vs/editor/editor.api.js",
      "monaco-editor/": "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/",
      "@monaco-editor/loader": "https://cdn.jsdelivr.net/npm/@monaco-editor/loader@1.4.0/+esm"`
        : ""
    }}
}`,
  });
  const assets: Array<HTMLElement> = [imaps];

  if (q.has("d3")) {
    assets.push(g("script", {
      src:
        "https://tefs-static-cdn-1300241787.file.myqcloud.com/share/d3/d3.v7.min.js",
      crossOrigin: "anonymous",
    }));
  }

  if (q.has("bootstrap")) {
    assets.push(g("link", {
      rel: "stylesheet",
      href:
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css",
      integrity:
        "sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB",
      crossOrigin: "anonymous",
    }));
  }

  const head = document.querySelector("head")!;
  assets.map((s) => document.write(s.outerHTML)); // !!! block to MAKE SURE these assets LOADED first
  sself &&
    setTimeout(() => sself.parentElement?.removeChild(sself));
})(document.currentScript!);
