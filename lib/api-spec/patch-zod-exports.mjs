import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(directory, "../api-zod/src/index.ts");
let source = await readFile(indexPath, "utf8");

source = source.replace(/^export \* from ['"]\.\/generated\/types['"];?\r?\n/m, "");

const additionalExports = [
  'export type { TimelinePostsPage } from "./generated/types/timelinePostsPage";',
  'export type { TimelineCommentsPage } from "./generated/types/timelineCommentsPage";',
  'export type { TimelineReportInput } from "./generated/types/timelineReportInput";',
  'export type { TimelineReportResult } from "./generated/types/timelineReportResult";',
];

for (const line of additionalExports) {
  if (!source.includes(line)) source += `${source.endsWith("\n") ? "" : "\n"}${line}\n`;
}

await writeFile(indexPath, source);
