// Nuclear option: guarantee ONNX WASM is always reachable at root
if (typeof ort !== 'undefined') {
  // force root paths so VAD never 404s on WASM.
  ort.env.wasm.wasmPaths = {
    wasm: '/ort-wasm-simd-threaded.wasm',
    mjs: '/ort-wasm-simd-threaded.mjs',
  };
  ort.env.wasm.numThreads = 1; // single-threaded to avoid complexity for now
}