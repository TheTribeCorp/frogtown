import { mkdir, rm, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(packageDir, "../..");
const outputDir = path.join(workspaceDir, ".vercel/output");
const staticDir = path.join(outputDir, "static");
const functionDir = path.join(outputDir, "functions/api/[...path].func");

async function buildVercelOutput() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(functionDir, { recursive: true });

  await cp(
    path.join(workspaceDir, "artifacts/swamp-chat/dist/public"),
    staticDir,
    { recursive: true },
  );

  await esbuild({
    entryPoints: [path.join(packageDir, "src/vercel.ts")],
    platform: "node",
    target: "node24",
    bundle: true,
    format: "cjs",
    outdir: functionDir,
    logLevel: "info",
    external: ["*.node", "pg-native"],
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: { js: "globalThis.require = require;" },
  });

  await writeFile(
    path.join(functionDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs24.x",
        handler: "vercel.js",
        launcherType: "Nodejs",
        maxDuration: 60,
        supportsResponseStreaming: true,
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(outputDir, "config.json"),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { handle: "filesystem" },
          { src: "/(.*)", dest: "/index.html" },
        ],
      },
      null,
      2,
    ),
  );

  console.info("Vercel Build Output API files created in .vercel/output");
}

buildVercelOutput().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
