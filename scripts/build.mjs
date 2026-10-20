import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
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

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const archiveName = `limeEnglish_v${packageJson.version}.zip`;
const archiveFiles = {};

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const sourcePath = join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(sourcePath, relativePath);
    else archiveFiles[relativePath] = await readFile(sourcePath);
  }
}

await collectFiles("dist");
await writeFile(archiveName, zipSync(archiveFiles, { level: 9 }));
console.log(`Created ${archiveName}`);
