import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const sourceRoot = path.resolve(serverRoot, "..");
const publicRoot = path.join(serverRoot, "public");
const files = ["index.html", "portal-server-config.js", "portal-seed.js", "portal-curators.js", "portal-data.js", "portal-admin.js", "portal-calendar.js", "portal.js"];
await fs.rm(publicRoot, { recursive: true, force: true });
await fs.mkdir(publicRoot, { recursive: true });
for (const name of files) {
  let content = await fs.readFile(path.join(sourceRoot, name), "utf8");
  if (name === "portal-server-config.js") content = content.replace("window.TISK_SERVER_AUTH = false;", "window.TISK_SERVER_AUTH = true;");
  await fs.writeFile(path.join(publicRoot, name), content);
}
console.log(`Copied ${files.length} portal assets into server/public with database authentication enabled.`);
