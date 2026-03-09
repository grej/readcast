import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/readcast/web/frontend/app.jsx"],
  bundle: true,
  outfile: "src/readcast/web/static/bundle.js",
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  sourcemap: false,
  target: ["safari16"],
});
