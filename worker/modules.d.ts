// Non-JS modules bundled by wrangler (see "rules" in wrangler.jsonc).
declare module '*.ttf' {
  const data: ArrayBuffer;
  export default data;
}

declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
