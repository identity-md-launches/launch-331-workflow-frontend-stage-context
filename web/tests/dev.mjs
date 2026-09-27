import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  configFile: root + "vite.config.ts",
  server: { host: "127.0.0.1", port: 0 },
});
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  for (const path of [
    "imd-deployment.json",
    "abi/LaunchToken.json",
    "abi/TokenFaucet.json",
  ]) {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200);
    assert.equal(
      await response.text(),
      await readFile(new URL("../../dist/" + path, import.meta.url), "utf8"),
    );
  }
  assert.equal((await fetch(new URL("src/main.tsx", origin))).status, 200);
  console.log(
    "PASS development serves the exact production deployment and ABI bytes, plus source.",
  );
} finally {
  await server.close();
}
