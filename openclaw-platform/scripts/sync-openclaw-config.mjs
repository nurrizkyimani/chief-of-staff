import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("config/openclaw.config.json");
const targetPath = resolve(".openclaw-home/.openclaw/openclaw.json");

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const current = await readJsonIfExists(targetPath);

const currentToken = current?.gateway?.auth?.token;
if (currentToken) {
  source.gateway ??= {};
  source.gateway.auth ??= {};
  source.gateway.auth.token = currentToken;
}

await mkdir(dirname(targetPath), { recursive: true });
await writeFile(targetPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
console.log(`Synced OpenClaw config: ${sourcePath} -> ${targetPath}`);

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
