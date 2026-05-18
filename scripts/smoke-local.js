import { spawn } from "node:child_process";

const port = process.env.SMOKE_PORT || "18787";
const server = spawn(process.execPath, ["src/server.js"], {
  env: {
    ...process.env,
    DEMO_MODE: "true",
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
  assert(config.demoMode === true, "/api/config should report demo mode");

  const unauthorized = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
  const unauthorizedBody = await unauthorized.text();
  assert(unauthorized.status === 401, `/api/bootstrap should require login, got ${unauthorized.status}: ${unauthorizedBody}\n${output}`);

  const parentBootstrap = await api("GET", "/api/bootstrap", "demo-local-token");
  assert(parentBootstrap.response.ok, "parent bootstrap should return 200");
  assert(parentBootstrap.data.isAdmin === false, "parent demo user should not be admin");
  assert(!Object.hasOwn(parentBootstrap.data.members[0], "parentEmails"), "parent bootstrap should not expose parent emails");

  const parentActivityWrite = await api("POST", "/api/activities", "demo-local-token", {
    date: "2026-06-20",
    startTime: "09:00",
    endTime: "12:00",
    place: "北小",
    status: "公開",
  });
  assert(parentActivityWrite.response.status === 403, "parent should not create activities");

  const blockedResponseWrite = await api("POST", "/api/responses", "demo-local-token", {
    activityId: "activity_2026_06_06",
    memberId: "member_akita",
    attendanceStatus: "参加",
    canOpen: false,
    canClose: false,
    canWatch: false,
  });
  assert(blockedResponseWrite.response.status === 403, "parent should not edit unlinked member response");

  const ownResponseWrite = await api("POST", "/api/responses", "demo-local-token", {
    activityId: "activity_2026_06_06",
    memberId: "member_minato",
    attendanceStatus: "参加",
    canOpen: false,
    canClose: true,
    canWatch: true,
    watchStartTime: "18:00",
    watchEndTime: "20:30",
    comment: "スモークテスト",
  });
  assert(ownResponseWrite.response.ok, "parent should edit linked member response");

  const adminBootstrap = await api("GET", "/api/bootstrap", "demo-admin-token");
  assert(adminBootstrap.response.ok, "admin bootstrap should return 200");
  assert(adminBootstrap.data.isAdmin === true, "admin demo user should be admin");
  assert(Object.hasOwn(adminBootstrap.data.members[0], "parentEmails"), "admin bootstrap should expose member emails");

  const activityWrite = await api("POST", "/api/activities", "demo-admin-token", {
    date: "2026-06-20",
    startTime: "09:00",
    endTime: "12:00",
    place: "北小",
    status: "公開",
    requiredAdults: "2",
    watchTimeUnitMinutes: "30",
  });
  assert(activityWrite.response.ok, "admin should create activities");
  assert(activityWrite.data.activity.id, "created activity should include id");

  const memberWrite = await api("POST", "/api/members", "demo-admin-token", {
    playerName: "山田 太郎",
    grade: "小5",
    familyName: "山田",
    displayName: "太郎",
    parentEmails: "parent-yamada@example.com",
    calendarEmail: "child-yamada@example.com",
    active: true,
  });
  assert(memberWrite.response.ok, "admin should create members");
  assert(memberWrite.data.member.parentEmails === "parent-yamada@example.com", "admin member response should include parent email");

  const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
  const page = await pageResponse.text();
  assert(pageResponse.ok, "/ should return 200");
  assert(page.includes("RED BISONS 活動管理"), "index page should render app title");
  assert(pageResponse.headers.get("x-content-type-options") === "nosniff", "page should include nosniff header");
  assert((pageResponse.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'"), "page should include CSP frame protection");

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

async function api(method, path, token, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
