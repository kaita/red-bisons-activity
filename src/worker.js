const TABLES = {
  Members: ["id", "playerName", "grade", "familyName", "displayName", "parentEmails", "calendarEmail", "active"],
  Activities: [
    "id",
    "date",
    "startTime",
    "endTime",
    "place",
    "handoverNote",
    "status",
    "requiredAdults",
    "watchTimeUnitMinutes",
    "calendarEventId",
    "calendarSyncStatus",
    "updatedAt",
  ],
  Responses: [
    "activityId",
    "memberId",
    "parentEmail",
    "attendanceStatus",
    "canOpen",
    "canClose",
    "canWatch",
    "watchStartTime",
    "watchEndTime",
    "comment",
    "updatedAt",
  ],
  ActivityComments: ["id", "activityId", "userEmail", "displayName", "body", "createdAt", "updatedAt"],
};

const ATTENDANCE_STATUSES = new Set(["参加", "欠席", "未回答", "未定"]);
const ACTIVITY_STATUSES = new Set(["公開", "下書き", "中止"]);
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
].join(" ");
const MAX_JSON_BODY_BYTES = 24_000;

let cachedGoogleCerts = null;
let cachedServiceToken = null;
let demoData = null;

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return optionsResponse(request, env);
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status, request, env);
      }
      console.error("request_failed", error.name, error.message);
      return json({ error: "サーバー処理に失敗しました。" }, 500, request, env);
    }
  },
};

async function handleApi(request, env, url) {
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({
      googleClientId: env.GOOGLE_CLIENT_ID || "",
      demoMode: isDemoMode(env),
      calendarSubscribeUrl: env.CALENDAR_SUBSCRIBE_URL || "",
    }, 200, request, env);
  }

  if (isDemoMode(env)) {
    return handleDemoApi(request, env, url);
  }

  const user = await requireUser(request, env);
  const userIsAdmin = isAdminUser(user, env);

  if (url.pathname === "/api/setup" && request.method === "POST") {
    requireAdmin(user, env);
    await ensureSchema(env);
    return json({ ok: true }, 200, request, env);
  }

  if (url.pathname === "/api/bootstrap" && request.method === "GET") {
    const data = await readAllData(env, { includeInactive: userIsAdmin, includeDrafts: userIsAdmin });
    const context = buildUserContext(user, data, env);
    requireMemberOrAdmin(context);
    return json(toBootstrapPayload(context, data), 200, request, env);
  }

  if (url.pathname === "/api/responses" && request.method === "POST") {
    const payload = await readJson(request);
    const data = await readAllData(env);
    const context = buildUserContext(user, data, env);
    requireMemberOrAdmin(context);
    const response = await upsertResponse(payload, context, data, env);
    return json({ ok: true, response }, 200, request, env);
  }

  if (url.pathname === "/api/comments" && request.method === "POST") {
    const payload = await readJson(request);
    const data = await readAllData(env);
    const context = buildUserContext(user, data, env);
    requireMemberOrAdmin(context);
    const comment = await appendActivityComment(payload, context, data, env);
    return json({ ok: true, comment }, 200, request, env);
  }

  if (url.pathname === "/api/activities" && request.method === "POST") {
    requireAdmin(user, env);
    const payload = await readJson(request);
    const data = await readAllData(env, { includeInactive: true, includeDrafts: true });
    const activity = await upsertActivity(payload, data, env);
    return json({ ok: true, activity }, 200, request, env);
  }

  if (url.pathname === "/api/members" && request.method === "POST") {
    requireAdmin(user, env);
    const payload = await readJson(request);
    const data = await readAllData(env, { includeInactive: true, includeDrafts: true });
    const member = await upsertMember(payload, data, env);
    return json({ ok: true, member: sanitizeMember(member, { includePrivate: true }) }, 200, request, env);
  }

  return json({ error: "APIが見つかりません。" }, 404, request, env);
}

async function handleDemoApi(request, env, url) {
  const user = await requireUser(request, env);
  const data = getDemoData();
  const isAdmin = isAdminUser(user, env);
  const context = {
    user,
    isAdmin,
    linkedMemberIds: isAdmin ? data.members.map((member) => member.id) : ["member_minato"],
  };

  if (url.pathname === "/api/bootstrap" && request.method === "GET") {
    return json(toBootstrapPayload(context, data), 200, request, env);
  }

  if (url.pathname === "/api/responses" && request.method === "POST") {
    const payload = await readJson(request);
    const activity = data.activities.find((item) => item.id === clean(payload.activityId));
    const member = data.members.find((item) => item.id === clean(payload.memberId));
    if (!activity) throw new HttpError(400, "活動が見つかりません。");
    if (!member) throw new HttpError(400, "選手が見つかりません。");
    if (!context.isAdmin && !context.linkedMemberIds.includes(member.id)) {
      throw new HttpError(403, "この選手の回答を編集する権限がありません。");
    }
    const response = {
      activityId: activity.id,
      memberId: member.id,
      parentEmail: user.email,
      attendanceStatus: validateAttendance(payload.attendanceStatus),
      canOpen: boolString(payload.canOpen),
      canClose: boolString(payload.canClose),
      canWatch: boolString(payload.canWatch),
      watchStartTime: clean(payload.watchStartTime),
      watchEndTime: clean(payload.watchEndTime),
      comment: clean(payload.comment).slice(0, 800),
      updatedAt: new Date().toISOString(),
    };
    validateWatchTimes(response, activity);
    const index = data.responses.findIndex((item) => item.activityId === response.activityId && item.memberId === response.memberId);
    if (index >= 0) data.responses[index] = response;
    else data.responses.push(response);
    return json({ ok: true, response: sanitizeResponse(response) }, 200, request, env);
  }

  if (url.pathname === "/api/comments" && request.method === "POST") {
    const payload = await readJson(request);
    const activity = data.activities.find((item) => item.id === clean(payload.activityId));
    if (!activity) throw new HttpError(400, "活動が見つかりません。");
    const body = clean(payload.body).slice(0, 1000);
    if (!body) throw new HttpError(400, "コメントを入力してください。");
    const comment = {
      id: id("comment"),
      activityId: activity.id,
      userEmail: user.email,
      displayName: user.name,
      body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.comments.push(comment);
    return json({ ok: true, comment: sanitizeComment(comment) }, 200, request, env);
  }

  if (url.pathname === "/api/activities" && request.method === "POST") {
    requireAdmin(user, env);
    const payload = await readJson(request);
    const activity = await upsertDemoActivity(payload, data);
    return json({ ok: true, activity: sanitizeActivity(activity) }, 200, request, env);
  }

  if (url.pathname === "/api/members" && request.method === "POST") {
    requireAdmin(user, env);
    const payload = await readJson(request);
    const member = upsertDemoMember(payload, data);
    return json({ ok: true, member: sanitizeMember(member, { includePrivate: true }) }, 200, request, env);
  }

  return json({ error: "デモモードでは未対応のAPIです。" }, 404, request, env);
}

async function requireUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Googleログインが必要です。");
  if (isDemoMode(env) && match[1] === "demo-local-token") {
    return {
      email: "demo.parent@example.com",
      name: "デモ保護者",
      picture: "",
    };
  }
  if (isDemoMode(env) && match[1] === "demo-admin-token") {
    return {
      email: "demo.admin@example.com",
      name: "デモ管理者",
      picture: "",
    };
  }
  return verifyGoogleIdToken(match[1], env);
}

async function verifyGoogleIdToken(token, env) {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(500, "Googleログイン設定が未設定です。");
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "ログイントークンが不正です。");

  const header = JSON.parse(base64urlDecodeString(parts[0]));
  const payload = JSON.parse(base64urlDecodeString(parts[1]));
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "ログイントークンが不正です。");

  const jwk = await findGoogleJwk(header.kid);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) throw new HttpError(401, "ログイントークンを検証できませんでした。");

  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new HttpError(401, "ログイントークンの発行元が不正です。");
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "ログイントークンの対象が不正です。");
  if (!payload.exp || payload.exp < now) throw new HttpError(401, "ログインの有効期限が切れています。");
  if (!payload.email || payload.email_verified !== true) throw new HttpError(403, "確認済みGoogleアカウントが必要です。");

  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    picture: payload.picture || "",
  };
}

async function findGoogleJwk(kid) {
  const now = Date.now();
  if (!cachedGoogleCerts || cachedGoogleCerts.expiresAt < now) {
    const response = await fetch(GOOGLE_CERTS_URL);
    if (!response.ok) throw new HttpError(502, "Googleログイン検証に失敗しました。");
    const maxAge = parseMaxAge(response.headers.get("Cache-Control")) || 3600;
    cachedGoogleCerts = {
      keys: (await response.json()).keys || [],
      expiresAt: now + maxAge * 1000,
    };
  }
  const jwk = cachedGoogleCerts.keys.find((key) => key.kid === kid);
  if (!jwk) throw new HttpError(401, "ログイントークンの鍵が見つかりません。");
  return jwk;
}

function buildUserContext(user, data, env) {
  const isAdmin = isAdminUser(user, env);
  const linkedMemberIds = data.members
    .filter((member) => truthy(member.active))
    .filter((member) => csv(member.parentEmails).map((email) => email.toLowerCase()).includes(user.email))
    .map((member) => member.id);
  return { user, isAdmin, linkedMemberIds };
}

function requireMemberOrAdmin(context) {
  if (!context.isAdmin && context.linkedMemberIds.length === 0) {
    throw new HttpError(403, "このGoogleアカウントはRED BISONSの保護者として登録されていません。");
  }
}

function requireAdmin(user, env) {
  if (!isAdminUser(user, env)) throw new HttpError(403, "管理者権限が必要です。");
}

function isAdminUser(user, env) {
  if (isDemoMode(env) && user.email === "demo.admin@example.com") return true;
  const adminEmails = csv(env.ADMIN_EMAILS).map((email) => email.toLowerCase());
  return adminEmails.includes(user.email);
}

async function readAllData(env, options = {}) {
  const [members, activities, responses, comments] = await Promise.all([
    readTable(env, "Members"),
    readTable(env, "Activities"),
    readTable(env, "Responses"),
    readTable(env, "ActivityComments"),
  ]);
  return {
    members: options.includeInactive ? members : members.filter((member) => truthy(member.active)),
    activities: activities
      .filter((activity) => options.includeDrafts || activity.status !== "下書き")
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)),
    responses,
    comments,
  };
}

function toBootstrapPayload(context, data) {
  return {
    user: context.user,
    isAdmin: context.isAdmin,
    linkedMemberIds: context.linkedMemberIds,
    members: data.members.map((member) => sanitizeMember(member, { includePrivate: context.isAdmin })),
    activities: data.activities.map(sanitizeActivity),
    responses: data.responses.map(sanitizeResponse),
    comments: data.comments.map(sanitizeComment),
  };
}

async function upsertResponse(payload, context, data, env) {
  const activity = data.activities.find((item) => item.id === clean(payload.activityId));
  const member = data.members.find((item) => item.id === clean(payload.memberId));
  if (!activity) throw new HttpError(400, "活動が見つかりません。");
  if (!member) throw new HttpError(400, "選手が見つかりません。");
  if (!context.isAdmin && !context.linkedMemberIds.includes(member.id)) {
    throw new HttpError(403, "この選手の回答を編集する権限がありません。");
  }

  const response = {
    activityId: activity.id,
    memberId: member.id,
    parentEmail: context.user.email,
    attendanceStatus: validateAttendance(payload.attendanceStatus),
    canOpen: boolString(payload.canOpen),
    canClose: boolString(payload.canClose),
    canWatch: boolString(payload.canWatch),
    watchStartTime: clean(payload.watchStartTime),
    watchEndTime: clean(payload.watchEndTime),
    comment: clean(payload.comment).slice(0, 800),
    updatedAt: new Date().toISOString(),
  };

  validateWatchTimes(response, activity);

  const rows = await readRawTable(env, "Responses");
  const rowIndex = rows.objects.findIndex((item) => item.activityId === response.activityId && item.memberId === response.memberId);
  if (rowIndex >= 0) {
    await writeTableRow(env, "Responses", rows.startRow + rowIndex, response);
  } else {
    await appendTableRow(env, "Responses", response);
  }
  return sanitizeResponse(response);
}

async function appendActivityComment(payload, context, data, env) {
  const activity = data.activities.find((item) => item.id === clean(payload.activityId));
  if (!activity) throw new HttpError(400, "活動が見つかりません。");
  const body = clean(payload.body).slice(0, 1000);
  if (!body) throw new HttpError(400, "コメントを入力してください。");
  const comment = {
    id: id("comment"),
    activityId: activity.id,
    userEmail: context.user.email,
    displayName: context.user.name,
    body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await appendTableRow(env, "ActivityComments", comment);
  return sanitizeComment(comment);
}

async function upsertActivity(payload, data, env) {
  const existing = data.activities.find((item) => item.id === clean(payload.id));
  const activity = {
    id: existing?.id || clean(payload.id) || id("activity"),
    date: validateDate(payload.date),
    startTime: validateTime(payload.startTime, "開始時刻"),
    endTime: validateTime(payload.endTime, "終了時刻"),
    place: clean(payload.place).slice(0, 120),
    handoverNote: clean(payload.handoverNote).slice(0, 1200),
    status: ACTIVITY_STATUSES.has(clean(payload.status)) ? clean(payload.status) : "公開",
    requiredAdults: String(clampInt(payload.requiredAdults || existing?.requiredAdults || 1, 1, 20)),
    watchTimeUnitMinutes: String(clampInt(payload.watchTimeUnitMinutes || existing?.watchTimeUnitMinutes || 30, 5, 120)),
    calendarEventId: existing?.calendarEventId || "",
    calendarSyncStatus: "未同期",
    updatedAt: new Date().toISOString(),
  };
  if (toMinutes(activity.endTime) <= toMinutes(activity.startTime)) {
    throw new HttpError(400, "終了時刻は開始時刻より後にしてください。");
  }

  const synced = await syncCalendarEvent(activity, env);
  activity.calendarEventId = synced.calendarEventId;
  activity.calendarSyncStatus = synced.calendarSyncStatus;

  const rows = await readRawTable(env, "Activities");
  const rowIndex = rows.objects.findIndex((item) => item.id === activity.id);
  if (rowIndex >= 0) {
    await writeTableRow(env, "Activities", rows.startRow + rowIndex, activity);
  } else {
    await appendTableRow(env, "Activities", activity);
  }
  return sanitizeActivity(activity);
}

async function upsertMember(payload, data, env) {
  const existing = data.members.find((item) => item.id === clean(payload.id));
  const parentEmails = csv(payload.parentEmails).map((email) => validateEmail(email, "保護者メールアドレス").toLowerCase());
  const calendarEmail = clean(payload.calendarEmail) ? validateEmail(payload.calendarEmail, "カレンダー用メール").toLowerCase() : "";
  const member = {
    id: existing?.id || clean(payload.id) || id("member"),
    playerName: clean(payload.playerName).slice(0, 80),
    grade: clean(payload.grade).slice(0, 20),
    familyName: clean(payload.familyName).slice(0, 80),
    displayName: clean(payload.displayName || payload.playerName).slice(0, 80),
    parentEmails: parentEmails.join(","),
    calendarEmail,
    active: payload.active === false ? "false" : "true",
  };
  if (!member.playerName) throw new HttpError(400, "選手名を入力してください。");
  if (!member.parentEmails) throw new HttpError(400, "保護者メールアドレスを入力してください。");

  const rows = await readRawTable(env, "Members");
  const rowIndex = rows.objects.findIndex((item) => item.id === member.id);
  if (rowIndex >= 0) {
    await writeTableRow(env, "Members", rows.startRow + rowIndex, member);
  } else {
    await appendTableRow(env, "Members", member);
  }
  return member;
}

async function upsertDemoActivity(payload, data) {
  const existing = data.activities.find((item) => item.id === clean(payload.id));
  const activity = {
    id: existing?.id || clean(payload.id) || id("activity"),
    date: validateDate(payload.date),
    startTime: validateTime(payload.startTime, "開始時刻"),
    endTime: validateTime(payload.endTime, "終了時刻"),
    place: clean(payload.place).slice(0, 120),
    handoverNote: clean(payload.handoverNote).slice(0, 1200),
    status: ACTIVITY_STATUSES.has(clean(payload.status)) ? clean(payload.status) : "公開",
    requiredAdults: String(clampInt(payload.requiredAdults || existing?.requiredAdults || 1, 1, 20)),
    watchTimeUnitMinutes: String(clampInt(payload.watchTimeUnitMinutes || existing?.watchTimeUnitMinutes || 30, 5, 120)),
    calendarEventId: existing?.calendarEventId || "",
    calendarSyncStatus: "デモ",
    updatedAt: new Date().toISOString(),
  };
  if (toMinutes(activity.endTime) <= toMinutes(activity.startTime)) {
    throw new HttpError(400, "終了時刻は開始時刻より後にしてください。");
  }
  const index = data.activities.findIndex((item) => item.id === activity.id);
  if (index >= 0) data.activities[index] = activity;
  else data.activities.push(activity);
  data.activities.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  return activity;
}

function upsertDemoMember(payload, data) {
  const existing = data.members.find((item) => item.id === clean(payload.id));
  const parentEmails = csv(payload.parentEmails).map((email) => validateEmail(email, "保護者メールアドレス").toLowerCase());
  const calendarEmail = clean(payload.calendarEmail) ? validateEmail(payload.calendarEmail, "カレンダー用メール").toLowerCase() : "";
  const member = {
    id: existing?.id || clean(payload.id) || id("member"),
    playerName: clean(payload.playerName).slice(0, 80),
    grade: clean(payload.grade).slice(0, 20),
    familyName: clean(payload.familyName).slice(0, 80),
    displayName: clean(payload.displayName || payload.playerName).slice(0, 80),
    parentEmails: parentEmails.join(","),
    calendarEmail,
    active: payload.active === false ? "false" : "true",
  };
  if (!member.playerName) throw new HttpError(400, "選手名を入力してください。");
  if (!member.parentEmails) throw new HttpError(400, "保護者メールアドレスを入力してください。");
  const index = data.members.findIndex((item) => item.id === member.id);
  if (index >= 0) data.members[index] = member;
  else data.members.push(member);
  return member;
}

async function syncCalendarEvent(activity, env) {
  if (!env.CALENDAR_ID) {
    return { calendarEventId: activity.calendarEventId || "", calendarSyncStatus: "カレンダー未設定" };
  }
  const event = {
    summary: `RED BISONS ${activity.place || "活動"}`,
    location: activity.place || "",
    description: [activity.handoverNote, "参加者と見守り状況はアプリで確認してください。"].filter(Boolean).join("\n\n"),
    start: {
      dateTime: `${activity.date}T${activity.startTime}:00+09:00`,
      timeZone: "Asia/Tokyo",
    },
    end: {
      dateTime: `${activity.date}T${activity.endTime}:00+09:00`,
      timeZone: "Asia/Tokyo",
    },
  };

  try {
    if (activity.calendarEventId) {
      await googleApi(
        env,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events/${encodeURIComponent(activity.calendarEventId)}`,
        { method: "PUT", body: JSON.stringify(event) }
      );
      return { calendarEventId: activity.calendarEventId, calendarSyncStatus: "同期済み" };
    }
    const created = await googleApi(
      env,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events`,
      { method: "POST", body: JSON.stringify(event) }
    );
    return { calendarEventId: created.id || "", calendarSyncStatus: created.id ? "同期済み" : "同期確認必要" };
  } catch (error) {
    console.error("calendar_sync_failed", error.name, error.message);
    return { calendarEventId: activity.calendarEventId || "", calendarSyncStatus: "同期失敗" };
  }
}

async function ensureSchema(env) {
  const metadata = await googleApi(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}`);
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const requests = Object.keys(TABLES)
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (requests.length) {
    await googleApi(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }

  await Promise.all(
    Object.entries(TABLES).map(([sheetName, headers]) =>
      googleApi(
        env,
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${encodeURIComponent(`${sheetName}!A1:${columnName(headers.length)}1`)}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: [headers] }) }
      )
    )
  );
}

async function readTable(env, sheetName) {
  const raw = await readRawTable(env, sheetName);
  return raw.objects;
}

async function readRawTable(env, sheetName) {
  const headers = TABLES[sheetName];
  const data = await googleApi(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${encodeURIComponent(`${sheetName}!A:Z`)}`
  );
  const values = data.values || [];
  if (values.length === 0) return { headers, objects: [], startRow: 2 };
  const actualHeaders = values[0].length ? values[0] : headers;
  const objects = values
    .slice(1)
    .filter((row) => row.some((cell) => clean(cell)))
    .map((row) => rowToObject(actualHeaders, row));
  return { headers: actualHeaders, objects, startRow: 2 };
}

async function appendTableRow(env, sheetName, object) {
  const headers = TABLES[sheetName];
  await googleApi(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${encodeURIComponent(`${sheetName}!A:Z`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [objectToRow(headers, object)] }) }
  );
}

async function writeTableRow(env, sheetName, rowNumber, object) {
  const headers = TABLES[sheetName];
  await googleApi(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${encodeURIComponent(`${sheetName}!A${rowNumber}:${columnName(headers.length)}${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [objectToRow(headers, object)] }) }
  );
}

function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, clean(row[index])]));
}

function objectToRow(headers, object) {
  return headers.map((header) => object[header] ?? "");
}

async function googleApi(env, url, options = {}) {
  if (!env.SHEET_ID) throw new HttpError(500, "Google Sheet ID が未設定です。");
  const token = await serviceAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    console.error("google_api_failed", response.status, text.slice(0, 240));
    throw new HttpError(502, "Google APIの処理に失敗しました。");
  }
  if (response.status === 204) return {};
  return response.json();
}

async function serviceAccessToken(env) {
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) {
    return cachedServiceToken.token;
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new HttpError(500, "Googleサービスアカウント設定が未設定です。");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: GOOGLE_SCOPES,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64urlEncode(new Uint8Array(signature))}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new HttpError(502, "Googleサービス認証に失敗しました。");
  const data = await response.json();
  cachedServiceToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(1, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return cachedServiceToken.token;
}

function validateWatchTimes(response, activity) {
  if (response.canWatch !== "true") return;
  response.watchStartTime = validateTime(response.watchStartTime, "見守り開始時刻");
  response.watchEndTime = validateTime(response.watchEndTime, "見守り終了時刻");
  const start = toMinutes(response.watchStartTime);
  const end = toMinutes(response.watchEndTime);
  if (end <= start) throw new HttpError(400, "見守り終了時刻は開始時刻より後にしてください。");
  const activityStart = toMinutes(activity.startTime);
  const activityEnd = toMinutes(activity.endTime);
  if (start < activityStart || end > activityEnd) {
    throw new HttpError(400, "見守り時間は活動時間内で入力してください。");
  }
}

function validateAttendance(value) {
  const status = clean(value);
  if (!ATTENDANCE_STATUSES.has(status)) throw new HttpError(400, "出欠の値が不正です。");
  return status;
}

function validateDate(value) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "日付の形式が不正です。");
  return date;
}

function validateTime(value, label) {
  const time = clean(value);
  if (!/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, `${label}の形式が不正です。`);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new HttpError(400, `${label}の値が不正です。`);
  return time;
}

function validateEmail(value, label) {
  const email = clean(value);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, `${label}の形式が不正です。`);
  return email;
}

function sanitizeMember(member, options = {}) {
  const sanitized = {
    id: member.id,
    playerName: member.playerName,
    grade: member.grade,
    familyName: member.familyName,
    displayName: member.displayName,
    active: truthy(member.active),
  };
  if (options.includePrivate) {
    sanitized.parentEmails = member.parentEmails || "";
    sanitized.calendarEmail = member.calendarEmail || "";
  }
  return sanitized;
}

function sanitizeActivity(activity) {
  return {
    id: activity.id,
    date: activity.date,
    startTime: activity.startTime,
    endTime: activity.endTime,
    place: activity.place,
    handoverNote: activity.handoverNote,
    status: activity.status,
    requiredAdults: activity.requiredAdults || "1",
    watchTimeUnitMinutes: activity.watchTimeUnitMinutes || "30",
    calendarSyncStatus: activity.calendarSyncStatus || "",
  };
}

function sanitizeResponse(response) {
  return {
    activityId: response.activityId,
    memberId: response.memberId,
    attendanceStatus: response.attendanceStatus,
    canOpen: boolString(response.canOpen === true || response.canOpen === "true"),
    canClose: boolString(response.canClose === true || response.canClose === "true"),
    canWatch: boolString(response.canWatch === true || response.canWatch === "true"),
    watchStartTime: response.watchStartTime,
    watchEndTime: response.watchEndTime,
    comment: response.comment,
    updatedAt: response.updatedAt,
  };
}

function sanitizeComment(comment) {
  return {
    id: comment.id,
    activityId: comment.activityId,
    displayName: comment.displayName,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function getDemoData() {
  if (demoData) return demoData;
  demoData = {
    members: [
      {
        id: "member_minato",
        playerName: "皆田 幸輝",
        grade: "小6",
        familyName: "皆田",
        displayName: "幸輝",
        parentEmails: "demo.parent@example.com",
        calendarEmail: "",
        active: "true",
      },
      {
        id: "member_akita",
        playerName: "秋田 燈史朗",
        grade: "小6",
        familyName: "秋田",
        displayName: "燈史朗",
        parentEmails: "akita@example.com",
        calendarEmail: "",
        active: "true",
      },
      {
        id: "member_matsuzawa",
        playerName: "松澤",
        grade: "小6",
        familyName: "松澤",
        displayName: "松澤",
        parentEmails: "matsuzawa@example.com",
        calendarEmail: "",
        active: "true",
      },
    ],
    activities: [
      {
        id: "activity_2026_06_06",
        date: "2026-06-06",
        startTime: "18:00",
        endTime: "20:30",
        place: "北小アソビバ",
        handoverNote: "土曜活動。見守りが前半不足しています。",
        status: "公開",
        requiredAdults: "2",
        watchTimeUnitMinutes: "30",
        calendarSyncStatus: "デモ",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "activity_2026_06_07",
        date: "2026-06-07",
        startTime: "09:45",
        endTime: "12:15",
        place: "北小アソビバ",
        handoverNote: "鍵返却の確認をお願いします。",
        status: "公開",
        requiredAdults: "1",
        watchTimeUnitMinutes: "30",
        calendarSyncStatus: "デモ",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "activity_2026_06_14",
        date: "2026-06-14",
        startTime: "09:45",
        endTime: "12:15",
        place: "北小アソビバ",
        handoverNote: "松澤さん海外出張で不在。",
        status: "公開",
        requiredAdults: "1",
        watchTimeUnitMinutes: "30",
        calendarSyncStatus: "デモ",
        updatedAt: new Date().toISOString(),
      },
    ],
    responses: [
      {
        activityId: "activity_2026_06_06",
        memberId: "member_minato",
        parentEmail: "demo.parent@example.com",
        attendanceStatus: "参加",
        canOpen: "false",
        canClose: "false",
        canWatch: "true",
        watchStartTime: "19:00",
        watchEndTime: "20:30",
        comment: "レッスン後に参加します。",
        updatedAt: new Date().toISOString(),
      },
      {
        activityId: "activity_2026_06_06",
        memberId: "member_akita",
        parentEmail: "akita@example.com",
        attendanceStatus: "参加",
        canOpen: "true",
        canClose: "false",
        canWatch: "true",
        watchStartTime: "18:30",
        watchEndTime: "20:30",
        comment: "18:30から見守れます。",
        updatedAt: new Date().toISOString(),
      },
      {
        activityId: "activity_2026_06_07",
        memberId: "member_minato",
        parentEmail: "demo.parent@example.com",
        attendanceStatus: "参加",
        canOpen: "true",
        canClose: "true",
        canWatch: "true",
        watchStartTime: "09:45",
        watchEndTime: "12:15",
        comment: "",
        updatedAt: new Date().toISOString(),
      },
      {
        activityId: "activity_2026_06_14",
        memberId: "member_matsuzawa",
        parentEmail: "matsuzawa@example.com",
        attendanceStatus: "欠席",
        canOpen: "false",
        canClose: "false",
        canWatch: "false",
        watchStartTime: "",
        watchEndTime: "",
        comment: "海外出張で不在です。",
        updatedAt: new Date().toISOString(),
      },
    ],
    comments: [
      {
        id: "comment_demo_1",
        activityId: "activity_2026_06_06",
        userEmail: "akita@example.com",
        displayName: "秋田",
        body: "前半の見守りに入れる方がもう1人いると助かります。",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  return demoData;
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_JSON_BODY_BYTES) throw new HttpError(413, "送信内容が大きすぎます。");
  const text = await request.text();
  if (!text) return {};
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) throw new HttpError(413, "送信内容が大きすぎます。");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSONの形式が不正です。");
  }
}

function json(data, status = 200, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...securityHeaders(),
      ...corsHeaders(request, env),
    },
  });
}

function optionsResponse(request, env) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request, env),
      ...securityHeaders(),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Max-Age": "600",
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const allowed = new Set(csv(env.ALLOWED_ORIGINS));
  if (!allowed.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  Object.entries(securityHeaders()).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function securityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://lh3.googleusercontent.com data:",
      "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com",
      "frame-src https://accounts.google.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function isDemoMode(env) {
  return env.DEMO_MODE === "true";
}

function clean(value) {
  return String(value ?? "").trim();
}

function csv(value) {
  return clean(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value) {
  return value === true || ["true", "1", "yes", "有効", "active"].includes(clean(value).toLowerCase());
}

function boolString(value) {
  return value === true || value === "true" ? "true" : "false";
}

function toMinutes(value) {
  const [hour, minute] = clean(value).split(":").map(Number);
  return hour * 60 + minute;
}

function clampInt(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function id(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now().toString(36)}_${suffix}`;
}

function parseMaxAge(cacheControl) {
  const match = clean(cacheControl).match(/max-age=(\d+)/);
  return match ? Number(match[1]) : 0;
}

function columnName(length) {
  let column = "";
  let number = length;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    number = Math.floor((number - 1) / 26);
  }
  return column;
}

function base64urlEncode(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecodeString(value) {
  const bytes = base64urlToBytes(value);
  return new TextDecoder().decode(bytes);
}

function base64urlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pemToArrayBuffer(pem) {
  const normalized = clean(pem).replace(/\\n/g, "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
