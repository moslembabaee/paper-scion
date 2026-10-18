# Canvas post-processing

Select a shader layer (or the canvas background shader), then use **Paper Shaders → Post-processing → Add finishing stack**. Presets provide starting points; passes run from top to bottom. Add, duplicate, move, remove, bypass or mix individual passes. The stack is saved with the shader paint and participates in document history, imports and exports. Existing documents need no migration.

Supported passes: bloom (soft luminance threshold, intensity, radius, knee), radial or directional chromatic aberration, animated monochrome or RGB film grain, tinted vignette, and color grade. There are four pass blend modes and an eight-pass limit. Grain freezes at the saved frame when shader playback is static or reduced motion is requested.

`PostProcessingCompositor` accepts a preserved source canvas and an ordered `CanvasPostProcessingPipeline`. It compiles programs when a stack is configured and reuses two full-resolution ping-pong targets and two half-resolution bloom targets. Bloom extracts highlights, blurs horizontally and vertically, then composites with its input. Intermediate textures use premultiplied alpha. The preview has a 1.5 million pixel budget, and frame rendering runs outside React. Hidden/cull states use the existing shader surface lifecycle. An unavailable compositor leaves the source shader visible. GPU resources are released on resize and disposal.

The finishing stack processes each shader canvas, including background shaders. Vector geometry, the 120px engineering grid, rulers and selection tools remain outside the effect. PNG and SVG shader captures run the same stack at export resolution with a fixed grain seed. Generated standalone shader source does not currently embed the compositor; use the saved document or raster export to retain the finish.

Verification:

```sh
npm run build
node --experimental-strip-types --test tests/postprocessing.test.mjs tests/shaders.test.mjs tests/shader-pipeline.test.mjs
npx playwright test e2e/postprocessing.spec.ts
```

The browser test checks actual GPU pixels, bloom spill, thresholds, alpha, grain timing, stack ordering, bypass, and live inspector updates. It requires Chromium with WebGL 2 and permission to run the local Vite server. Performance depends on the GPU, shader complexity and active layer count; 60fps is a rendering target, not a measured guarantee on every device.
