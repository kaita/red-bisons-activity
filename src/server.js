import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

await loadEnvFile(".env");
await loadEnvFile(".dev.vars");

const env = {
  ...process.env,
  ASSETS: {
    fetch: serveAsset,
  },
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = await toRequest(incoming);
    const response = await worker.fetch(request, env);
    await writeResponse(outgoing, response);
  } catch (error) {
    console.error("server_error", error.name, error.message);
    outgoing.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ error: "サーバー処理に失敗しました。" }));
  }
});

server.listen(port, host, () => {
  console.log(`RED BISONS activity server listening on http://${host}:${port}`);
});

async function toRequest(incoming) {
  const headers = new Headers();
  Object.entries(incoming.headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  });

  const protocol = headers.get("x-forwarded-proto") || "http";
  const host = headers.get("host") || `localhost:${port}`;
  const url = `${protocol}://${host}${incoming.url || "/"}`;
  const method = incoming.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(incoming);
  return new Request(url, { method, headers, body });
}

function readBody(incoming) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => resolve(Buffer.concat(chunks)));
    incoming.on("error", reject);
  });
}

async function writeResponse(outgoing, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  outgoing.writeHead(response.status, headers);
  if (response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    outgoing.end(buffer);
  } else {
    outgoing.end();
  }
}

async function serveAsset(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const candidate = pathname === "/" ? "/index.html" : pathname;
  const filePath = safePublicPath(candidate);
  const target = filePath && existsSync(filePath) ? filePath : path.join(publicDir, "index.html");
  const body = await readFile(target);
  return new Response(body, {
    headers: {
      "Content-Type": contentType(target),
      "Cache-Control": "no-store",
    },
  });
}

function safePublicPath(pathname) {
  const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const resolved = path.resolve(publicDir, `.${normalized}`);
  if (!resolved.startsWith(publicDir)) return "";
  return resolved;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
  }[ext] || "application/octet-stream";
}

async function loadEnvFile(fileName) {
  const filePath = path.join(rootDir, fileName);
  if (!existsSync(filePath)) return;
  const text = await readFile(filePath, "utf8");
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const index = line.indexOf("=");
      if (index < 0) return;
      const key = line.slice(0, index).trim();
      const value = unquote(line.slice(index + 1).trim());
      if (!process.env[key]) process.env[key] = value;
    });
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\n/g, "\n");
  }
  return value;
}
