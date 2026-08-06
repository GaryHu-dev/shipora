// Pre-bundle the Worker with a modern esbuild at target `esnext`, then deploy
// with `wrangler deploy dist/index.mjs --no-bundle` (see package.json scripts).
//
// Why: wrangler 3.x's bundled esbuild lowers class features to an older target,
// which breaks PDF.js's `static { … this._isSameOrigin = … }` initialiser block
// (the `this` becomes undefined at runtime → "Cannot set properties of undefined
// (setting '_isSameOrigin')" / "Right-hand side of 'instanceof' is not an object").
// unpdf/PDF.js then fails to load in the deployed Worker. Building here with a
// current esbuild at `esnext` keeps the static blocks native (workerd supports
// them) and deploying with --no-bundle stops wrangler from re-lowering them.
//
// Vitest (vite-pool-workers) bundles via Vite, which never hit this, so the test
// suite passes against `src/` directly and doesn't need this build.
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  target: "esnext",
  platform: "browser",
  conditions: ["workerd", "worker", "browser", "import", "default"],
  mainFields: ["module", "main"],
  external: ["node:*", "cloudflare:*"],
  outfile: "dist/index.mjs",
  logLevel: "info",
});
