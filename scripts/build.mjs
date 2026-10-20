import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "vite";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: { entry: "src/background/index.ts", formats: ["es"], fileName: () => "background.js" },
    codeSplitting: false,
    target: "es2023",
    minify: false,
    sourcemap: true,
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: { entry: "src/content/index.ts", formats: ["iife"], name: "ContextWordHelper", fileName: () => "content.js" },
    codeSplitting: false,
    minify: false,
    sourcemap: true,
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: { entry: "src/options/index.ts", formats: ["iife"], name: "ContextWordHelperOptions", fileName: () => "options.js" },
    codeSplitting: false,
    target: "es2023",
    minify: false,
    sourcemap: true,
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: { entry: "src/library/index.ts", formats: ["iife"], name: "ContextWordHelperLibrary", fileName: () => "library.js" },
    codeSplitting: false,
    target: "es2023",
    minify: false,
    sourcemap: true,
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: { entry: "src/word/index.ts", formats: ["iife"], name: "ContextWordHelperWord", fileName: () => "word.js" },
    codeSplitting: false,
    target: "es2023",
    minify: false,
    sourcemap: true,
  },
});
