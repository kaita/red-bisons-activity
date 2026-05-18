import { spawn } from "node:child_process";

const port = process.env.SMOKE_PORT || "18787";
const server = spawn(process.execPath, ["src/server.js"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForServer(`http://127.0.0.1:${port}/api/config`);
  const configResponse = await fetch(`http://127.0.0.1:${port}/api/config`);
  const config = await configResponse.json();
  assert(configResponse.ok, "/api/config should return 200");
  assert(Object.hasOwn(config, "googleClientId"), "/api/config should include googleClientId");

  const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
  const page = await pageResponse.text();
  assert(pageResponse.ok, "/ should return 200");
  assert(page.includes("RED BISONS 活動管理"), "index page should render app title");

  console.log("Local smoke check passed");
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited early:\n${output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Server did not become ready:\n${output}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
