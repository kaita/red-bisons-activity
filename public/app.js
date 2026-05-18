const state = {
  token: localStorage.getItem("redBisonsToken") || "",
  config: null,
  user: null,
  isAdmin: false,
  linkedMemberIds: [],
  members: [],
  activities: [],
  responses: [],
  comments: [],
  selectedActivityId: "",
  filter: "all",
  view: "list",
  roleView: localStorage.getItem("redBisonsRoleView") || "",
};

const app = document.querySelector("#app");

init().catch((error) => {
  renderFatal(error.message || "アプリの初期化に失敗しました。");
});

async function init() {
  state.config = await apiConfig();
  renderLogin();
  if (state.token) {
    await loadBootstrap();
  }
  setupGoogleSignIn();
}

async function apiConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("設定を取得できませんでした。");
  }
  return response.json();
}

function setupGoogleSignIn() {
  if (!state.config.googleClientId) {
    if (!state.config.demoMode) renderFatal("Google OAuth Client ID が未設定です。");
    return;
  }

  const timer = setInterval(() => {
    if (!window.google?.accounts?.id) return;
    clearInterval(timer);
    window.google.accounts.id.initialize({
      client_id: state.config.googleClientId,
      callback: async (credentialResponse) => {
        state.token = credentialResponse.credential;
        localStorage.setItem("redBisonsToken", state.token);
        await loadBootstrap();
      },
    });
    const target = document.querySelector("#google-signin");
    if (target) {
      window.google.accounts.id.renderButton(target, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
      });
    }
  }, 80);
}

async function loadBootstrap(options = {}) {
  try {
    const previousSelectedActivityId = options.selectedActivityId || state.selectedActivityId;
    const data = await apiGet("/api/bootstrap");
    Object.assign(state, data);
    if (!state.isAdmin) {
      state.roleView = "guardian";
    } else if (!["admin", "guardian"].includes(state.roleView)) {
      state.roleView = "admin";
    }
    state.selectedActivityId = state.activities.some((activity) => activity.id === previousSelectedActivityId)
      ? previousSelectedActivityId
      : state.activities[0]?.id || "";
    renderApp();
  } catch (error) {
    localStorage.removeItem("redBisonsToken");
    state.token = "";
    renderLogin(error.message);
    setupGoogleSignIn();
  }
}

async function apiGet(path) {
  const response = await fetch(path, {
    headers: authHeaders(),
  });
  return readApiResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return readApiResponse(response);
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "処理に失敗しました。");
  }
  return data;
}

function renderLogin(errorMessage = "") {
  app.innerHTML = "";
  const main = element("main", "login-screen");
  const mark = element("img", "login-mark");
  mark.src = "/red-bisons-mark.svg";
  mark.alt = "RED BISONS";
  main.append(
    mark,
    element("h1", "", "RED BISONS 活動管理"),
    element("p", "", "Googleログインで活動予定、出欠、見守り状況を確認します。")
  );
  if (errorMessage) main.append(element("div", "error", errorMessage));
  const signin = element("div");
  signin.id = "google-signin";
  main.append(signin);
  if (state.config?.demoMode) {
    const demoButton = element("button", "button primary", "デモで見る");
    demoButton.type = "button";
    demoButton.addEventListener("click", async () => {
      state.token = "demo-local-token";
      localStorage.setItem("redBisonsToken", state.token);
      await loadBootstrap();
    });
    const adminDemoButton = element("button", "button", "管理者デモで見る");
    adminDemoButton.type = "button";
    adminDemoButton.addEventListener("click", async () => {
      state.token = "demo-admin-token";
      localStorage.setItem("redBisonsToken", state.token);
      await loadBootstrap();
    });
    const demoActions = element("div", "login-actions", "", [demoButton, adminDemoButton]);
    main.append(demoActions, element("p", "muted small", "ローカル限定のサンプルデータで画面を確認します。"));
  } else {
    main.append(element("p", "muted small", "登録済みの保護者・管理者アカウントのみ利用できます。"));
  }
  app.append(main);
}

function renderApp() {
  const selected = selectedActivity();
  app.innerHTML = "";
  app.append(renderTopbar(), renderLayout(selected));
}

function renderTopbar() {
  const header = element("header", "topbar");
  const brand = element("div", "brand");
  const mark = element("img");
  mark.src = "/red-bisons-mark.svg";
  mark.alt = "";
  brand.append(mark, element("div", "", "", [
    element("strong", "", "RED BISONS"),
    element("span", "", "活動管理"),
  ]));

  const menu = element("div", "user-menu");
  if (state.user?.picture) {
    const picture = element("img");
    picture.src = state.user.picture;
    picture.alt = "";
    menu.append(picture);
  }
  menu.append(element("span", "user-name", state.user?.name || state.user?.email || ""));
  if (state.isAdmin) menu.append(element("span", "badge", isAdminMode() ? "管理者モード" : "保護者表示"));
  const signout = element("button", "button ghost", "ログアウト");
  signout.type = "button";
  signout.addEventListener("click", () => {
    localStorage.removeItem("redBisonsToken");
    state.token = "";
    renderLogin();
    setupGoogleSignIn();
  });
  menu.append(signout);
  header.append(brand, menu);
  return header;
}

function renderLayout(selected) {
  const layout = element("div", "layout");
  const sidebar = element("aside", "panel sidebar");
  sidebar.append(renderToolbar(), renderCalendar(), renderActivityList());
  const content = element("main", "panel content");
  content.id = "activity-detail";
  content.tabIndex = -1;
  if (!selected) {
    content.append(element("div", "empty", "表示できる活動がありません。"));
  } else {
    content.append(renderActivityDetail(selected));
  }
  layout.append(sidebar, content);
  return layout;
}

function renderToolbar() {
  const toolbar = element("div", "toolbar");
  const stats = computeStats();
  const statBox = element("div", "stats");
  statBox.append(
    renderStat(stats.upcoming, "今後の活動"),
    renderStat(stats.unanswered, "未回答"),
    renderStat(stats.shortage, "要見守り")
  );

  const filters = element("div", "segmented three");
  [
    ["all", "すべて"],
    ["mine", "自分関連"],
    ["shortage", "見守り不足"],
  ].forEach(([key, label]) => {
    const button = element("button", key === state.filter ? "active" : "", label);
    button.type = "button";
    button.addEventListener("click", () => {
      state.filter = key;
      renderApp();
    });
    filters.append(button);
  });

  const views = element("div", "segmented");
  [
    ["list", "リスト"],
    ["calendar", "カレンダー"],
  ].forEach(([key, label]) => {
    const button = element("button", key === state.view ? "active" : "", label);
    button.type = "button";
    button.addEventListener("click", () => {
      state.view = key;
      renderApp();
    });
    views.append(button);
  });

  if (state.isAdmin) toolbar.append(renderRoleViewSwitch());
  toolbar.append(statBox, filters, views);
  if (state.config?.calendarSubscribeUrl) {
    const calendar = element("a", "button ghost", "共有カレンダーを開く");
    calendar.href = state.config.calendarSubscribeUrl;
    calendar.target = "_blank";
    calendar.rel = "noreferrer";
    toolbar.append(calendar);
  }
  if (isAdminMode()) {
    const create = element("button", "button primary", "新規活動を追加");
    create.type = "button";
    create.addEventListener("click", () => {
      state.selectedActivityId = "__new__";
      renderApp();
    });
    toolbar.append(create);
  }
  return toolbar;
}

function renderRoleViewSwitch() {
  const switcher = element("div", "mode-switch");
  const label = element("span", "mode-label", "表示モード");
  const controls = element("div", "segmented");
  [
    ["guardian", "保護者"],
    ["admin", "管理者"],
  ].forEach(([key, labelText]) => {
    const button = element("button", state.roleView === key ? "active" : "", labelText);
    button.type = "button";
    button.addEventListener("click", () => {
      state.roleView = key;
      localStorage.setItem("redBisonsRoleView", key);
      if (!isAdminMode() && state.selectedActivityId === "__new__") {
        state.selectedActivityId = state.activities[0]?.id || "";
      }
      renderApp();
    });
    controls.append(button);
  });
  switcher.append(label, controls);
  return switcher;
}

function renderStat(value, label) {
  const node = element("div", "stat");
  node.append(element("b", "", String(value)), element("span", "", label));
  return node;
}

function renderCalendar() {
  if (state.view !== "calendar") return document.createDocumentFragment();
  const grid = element("div", "calendar-grid");
  const activities = filteredActivities();
  const first = activities[0] ? parseDate(activities[0].date) : new Date();
  const year = first.getFullYear();
  const month = first.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const offset = new Date(year, month, 1).getDay();
  for (let i = 0; i < offset; i += 1) {
    const empty = element("div", "calendar-day empty-day");
    empty.setAttribute("aria-hidden", "true");
    grid.append(empty);
  }
  for (let day = 1; day <= days; day += 1) {
    const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
    const matches = activities.filter((activity) => activity.date === iso);
    if (matches.length) {
      const cell = element("button", "calendar-day has-activity");
      cell.type = "button";
      cell.setAttribute("aria-label", `${month + 1}月${day}日の活動詳細を見る`);
      cell.append(document.createTextNode(String(day)));
      cell.append(element("span", "dot"));
      cell.title = `${matches.length}件の活動`;
      cell.addEventListener("click", () => {
        state.view = "list";
        openActivity(matches[0].id, { scrollToDetail: true });
      });
      grid.append(cell);
    } else {
      const cell = element("div", "calendar-day inactive-day", String(day));
      cell.setAttribute("aria-disabled", "true");
      grid.append(cell);
    }
  }
  return grid;
}

function renderActivityList() {
  const list = element("div", "activity-list");
  const activities = filteredActivities();
  if (!activities.length) {
    list.append(element("div", "empty", "条件に合う活動がありません。"));
    return list;
  }

  activities.forEach((activity) => {
    const shortage = watchShortage(activity);
    const button = element("button", `activity-button${activity.id === state.selectedActivityId ? " active" : ""}`);
    button.type = "button";
    button.setAttribute("aria-label", `${formatActivityTitle(activity)} の詳細を見る`);
    button.addEventListener("click", () => {
      openActivity(activity.id, { scrollToDetail: true });
    });
    const title = element("div", "activity-title");
    title.append(element("strong", "", formatActivityTitle(activity)));
    const titleActions = element("span", "activity-title-actions");
    if (shortage.hasShortage) titleActions.append(element("span", "attention-mark", "!"));
    titleActions.append(element("span", "activity-action", "詳細"));
    title.append(titleActions);
    button.append(title);
    button.append(element("div", "meta", "", [
      element("span", "badge", activity.place || "場所未定"),
      element("span", "badge", `${participantMembers(activity.id).length}名参加`),
      shortage.hasShortage ? element("span", "badge danger", "見守り不足") : element("span", "badge ok", "見守りあり"),
    ]));
    list.append(button);
  });
  return list;
}

function openActivity(activityId, options = {}) {
  state.selectedActivityId = activityId;
  renderApp();
  if (options.scrollToDetail && window.matchMedia("(max-width: 900px)").matches) {
    requestAnimationFrame(() => {
      const detail = document.querySelector("#activity-detail");
      detail?.scrollIntoView({ behavior: "smooth", block: "start" });
      detail?.focus({ preventScroll: true });
    });
  }
}

function renderActivityDetail(activity) {
  const fragment = document.createDocumentFragment();
  const shortage = watchShortage(activity);
  const header = element("div", "detail-header");
  const title = element("div");
  title.append(element("h2", "", formatActivityTitle(activity)));
  title.append(element("div", "meta", "", [
    element("span", "badge", activity.place || "場所未定"),
    element("span", "badge", `${activity.startTime || "--:--"} - ${activity.endTime || "--:--"}`),
    shortage.hasShortage ? element("span", "badge danger", "見守り不足") : element("span", "badge ok", "見守り充足"),
  ]));
  const actions = element("div", "detail-actions");
  if (activity.id !== "__new__") {
    const addCalendar = element("a", "button primary", "Googleカレンダーに追加");
    addCalendar.href = googleCalendarUrl(activity);
    addCalendar.target = "_blank";
    addCalendar.rel = "noreferrer";
    actions.append(addCalendar);
  }
  header.append(title, actions);
  fragment.append(header);

  if (activity.id === "__new__") {
    if (isAdminMode()) fragment.append(section("管理者", renderAdminArea(activity)));
    return fragment;
  }

  if (shortage.hasShortage) {
    fragment.append(section("見守りアラート", element("div", "notice", shortage.message)));
  }

  fragment.append(section("当番担当", renderDutyAssignments(activity)));
  fragment.append(section("見守り時間帯", renderCoverage(activity)));
  fragment.append(section("参加者一覧", renderParticipants(activity)));
  fragment.append(section("自分の回答", renderResponseForm(activity)));
  fragment.append(section("引き継ぎ・連絡", renderComments(activity)));
  if (isAdminMode()) fragment.append(section("管理者", renderAdminArea(activity)));
  return fragment;
}

function renderCoverage(activity) {
  const rows = element("div", "table-like");
  const slots = coverageSlots(activity);
  slots.forEach((slot) => {
    const row = element("div", `coverage-row${slot.count < slot.required ? " short" : ""}`);
    const bar = element("div", "coverage-bar");
    const width = Math.min(100, Math.round((slot.count / Math.max(slot.required, 1)) * 100));
    const fill = element("span");
    fill.style.width = `${width}%`;
    bar.append(fill);
    row.append(
      element("span", "", slot.label),
      bar,
      element("strong", "", `${slot.count}/${slot.required}`)
    );
    rows.append(row);
  });
  return rows;
}

function renderDutyAssignments(activity) {
  const wrap = element("div", "grid-two");
  wrap.append(
    renderDutyGroup("鍵開け", dutyMembers(activity.id, "canOpen")),
    renderDutyGroup("鍵閉め", dutyMembers(activity.id, "canClose")),
    renderDutyGroup("見守り", watchDutyRows(activity.id))
  );
  return wrap;
}

function renderDutyGroup(title, rows) {
  const node = element("div", "table-like");
  node.append(element("h3", "", title));
  if (!rows.length) {
    node.append(element("p", "muted", "未定"));
    return node;
  }
  rows.forEach((rowText) => {
    const row = element("div", "person-row");
    row.append(element("span", "", rowText));
    node.append(row);
  });
  return node;
}

function renderParticipants(activity) {
  const wrap = element("div", "grid-two");
  wrap.append(renderParticipantGroup("参加", participantMembers(activity.id)));
  wrap.append(renderParticipantGroup("欠席", absentMembers(activity.id)));
  wrap.append(renderParticipantGroup("未回答・未定", unansweredMembers(activity.id)));
  return wrap;
}

function renderParticipantGroup(title, members) {
  const node = element("div", "table-like");
  node.append(element("h3", "", title));
  if (!members.length) {
    node.append(element("p", "muted", "該当なし"));
    return node;
  }
  members.forEach((member) => {
    const row = element("div", "person-row");
    row.append(element("span", "", member.displayName || member.playerName), element("span", "badge", member.grade || ""));
    node.append(row);
  });
  return node;
}

function renderResponseForm(activity) {
  const wrap = element("form", "response-form");
  const linkedMembers = state.members.filter((member) => state.linkedMemberIds.includes(member.id));
  const memberOptions = isAdminMode() ? state.members.filter((member) => member.active !== false) : linkedMembers;
  if (!memberOptions.length) {
    const message = state.isAdmin
      ? "保護者表示では、このGoogleアカウントに紐づく選手だけ回答できます。必要ならメンバー管理で保護者メールを追加してください。"
      : "このGoogleアカウントに紐づく選手がありません。管理者に登録を依頼してください。";
    wrap.append(element("div", "notice", message));
    return wrap;
  }

  const memberSelect = element("select");
  memberOptions.forEach((member) => {
    const option = element("option", "", member.displayName || member.playerName);
    option.value = member.id;
    memberSelect.append(option);
  });
  const firstMember = memberOptions[0];
  memberSelect.value = firstMember?.id || "";

  const attendance = element("select");
  ["参加", "欠席", "未回答", "未定"].forEach((status) => {
    const option = element("option", "", status);
    option.value = status;
    attendance.append(option);
  });

  const canOpen = checkbox("鍵開けできます");
  const canClose = checkbox("鍵閉めできます");
  const canWatch = checkbox("見守りできます");
  const watchStart = timeInput(activity.startTime || "09:00");
  const watchEnd = timeInput(activity.endTime || "12:00");
  watchStart.min = activity.startTime || "";
  watchStart.max = activity.endTime || "";
  watchEnd.min = activity.startTime || "";
  watchEnd.max = activity.endTime || "";
  const comment = element("textarea");
  comment.placeholder = "遅刻、早退、引率、共有したいこと";

  const syncWatchInputs = () => {
    watchStart.disabled = !canWatch.input.checked;
    watchEnd.disabled = !canWatch.input.checked;
  };
  const applyExisting = () => {
    const existing = responseFor(activity.id, memberSelect.value);
    attendance.value = existing?.attendanceStatus || "未回答";
    canOpen.input.checked = existing?.canOpen === "true";
    canClose.input.checked = existing?.canClose === "true";
    canWatch.input.checked = existing?.canWatch === "true";
    watchStart.value = existing?.watchStartTime || activity.startTime || "";
    watchEnd.value = existing?.watchEndTime || activity.endTime || "";
    comment.value = existing?.comment || "";
    syncWatchInputs();
  };
  memberSelect.addEventListener("change", applyExisting);
  canWatch.input.addEventListener("change", syncWatchInputs);
  applyExisting();

  const grid = element("div", "form-grid");
  grid.append(labelWrap("選手", memberSelect), labelWrap("出欠", attendance));
  const checks = element("div", "check-row");
  checks.append(canOpen.label, canClose.label, canWatch.label);
  const times = element("div", "form-grid");
  times.append(labelWrap("見守り開始", watchStart), labelWrap("見守り終了", watchEnd));
  const submit = element("button", "button primary", "回答を保存");
  submit.type = "submit";
  const actions = element("div", "form-actions");
  actions.append(submit);

  wrap.append(grid, checks, times, labelWrap("コメント", comment), actions);
  wrap.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "保存中";
    try {
      await apiPost("/api/responses", {
        activityId: activity.id,
        memberId: memberSelect.value,
        attendanceStatus: attendance.value,
        canOpen: canOpen.input.checked,
        canClose: canClose.input.checked,
        canWatch: canWatch.input.checked,
        watchStartTime: canWatch.input.checked ? watchStart.value : "",
        watchEndTime: canWatch.input.checked ? watchEnd.value : "",
        comment: comment.value,
      });
      await loadBootstrap({ selectedActivityId: activity.id });
    } catch (error) {
      wrap.prepend(element("div", "error", error.message));
    } finally {
      submit.disabled = false;
      submit.textContent = "回答を保存";
    }
  });
  return wrap;
}

function renderComments(activity) {
  const wrap = element("div", "table-like");
  if (activity.handoverNote) wrap.append(element("div", "notice", activity.handoverNote));
  const comments = state.comments.filter((comment) => comment.activityId === activity.id);
  comments.forEach((comment) => {
    const row = element("div", "person-row");
    row.append(element("span", "", `${comment.displayName}: ${comment.body}`), element("span", "muted small", formatDateTime(comment.createdAt)));
    wrap.append(row);
  });
  const form = element("form", "form-grid");
  const body = element("input");
  body.placeholder = "活動について共有する";
  const submit = element("button", "button", "投稿");
  submit.type = "submit";
  form.append(labelWrap("連絡", body), submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!body.value.trim()) return;
    submit.disabled = true;
    try {
      await apiPost("/api/comments", { activityId: activity.id, body: body.value });
      await loadBootstrap({ selectedActivityId: activity.id });
    } catch (error) {
      form.prepend(element("div", "error", error.message));
    } finally {
      submit.disabled = false;
    }
  });
  wrap.append(form);
  return wrap;
}

function renderAdminArea(activity) {
  const area = element("div", "admin-area");
  const form = element("form", "form-grid");
  const date = input("date", activity.date || "");
  const start = timeInput(activity.startTime || "");
  const end = timeInput(activity.endTime || "");
  const place = input("text", activity.place || "");
  const note = element("textarea");
  note.value = activity.handoverNote || "";
  const requiredAdults = input("number", activity.requiredAdults || "1");
  requiredAdults.min = "1";
  requiredAdults.max = "20";
  const watchTimeUnitMinutes = input("number", activity.watchTimeUnitMinutes || "30");
  watchTimeUnitMinutes.min = "5";
  watchTimeUnitMinutes.max = "120";
  watchTimeUnitMinutes.step = "5";
  const status = element("select");
  ["公開", "下書き", "中止"].forEach((value) => {
    const option = element("option", "", value);
    option.value = value;
    status.append(option);
  });
  status.value = activity.status || "公開";
  const submit = element("button", "button primary", "活動を保存");
  submit.type = "submit";
  const actions = element("div", "form-actions");
  actions.append(submit);
  form.append(
    labelWrap("日付", date),
    labelWrap("開始", start),
    labelWrap("終了", end),
    labelWrap("場所", place),
    labelWrap("状態", status),
    labelWrap("必要な見守り人数", requiredAdults),
    labelWrap("見守り単位(分)", watchTimeUnitMinutes),
    labelWrap("引き継ぎ", note),
    actions
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const result = await apiPost("/api/activities", {
        id: activity.id === "__new__" ? "" : activity.id,
        date: date.value,
        startTime: start.value,
        endTime: end.value,
        place: place.value,
        handoverNote: note.value,
        status: status.value,
        requiredAdults: requiredAdults.value,
        watchTimeUnitMinutes: watchTimeUnitMinutes.value,
      });
      await loadBootstrap({ selectedActivityId: result.activity.id });
    } catch (error) {
      form.prepend(element("div", "error", error.message));
    } finally {
      submit.disabled = false;
    }
  });
  area.append(element("h3", "", activity.id === "__new__" ? "新規活動" : "活動編集"), form, renderMemberAdminPanel());
  return area;
}

function renderMemberAdminPanel() {
  const panel = element("div", "admin-area");
  panel.append(element("h3", "", "メンバー管理"));
  state.members.forEach((member) => {
    panel.append(renderMemberAdminForm(member));
  });
  panel.append(renderMemberAdminForm());
  return panel;
}

function renderMemberAdminForm(member = null) {
  const form = element("form", "form-grid");
  const playerName = input("text", member?.playerName || "");
  const grade = input("text", member?.grade || "");
  const familyName = input("text", member?.familyName || "");
  const displayName = input("text", member?.displayName || "");
  const parentEmails = input("text", member?.parentEmails || "");
  const calendarEmail = input("email", member?.calendarEmail || "");
  const active = checkbox("有効");
  active.input.checked = member?.active !== false;
  const activeRow = element("div", "check-row");
  activeRow.append(active.label);
  playerName.placeholder = "例: 山田 太郎";
  grade.placeholder = "例: 小6";
  familyName.placeholder = "例: 山田";
  displayName.placeholder = "例: 太郎";
  parentEmails.placeholder = "parent@example.com";
  calendarEmail.placeholder = "任意";
  const submit = element("button", "button", member ? "メンバーを保存" : "メンバーを追加");
  submit.type = "submit";
  const actions = element("div", "form-actions");
  actions.append(submit);
  form.append(
    element("h3", "", member ? `${member.displayName || member.playerName} の編集` : "メンバー追加"),
    labelWrap("選手名", playerName),
    labelWrap("学年", grade),
    labelWrap("家庭名", familyName),
    labelWrap("表示名", displayName),
    labelWrap("保護者Googleメール", parentEmails),
    labelWrap("カレンダー用メール", calendarEmail),
    activeRow,
    actions
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await apiPost("/api/members", {
        id: member?.id || "",
        playerName: playerName.value,
        grade: grade.value,
        familyName: familyName.value,
        displayName: displayName.value || playerName.value,
        parentEmails: parentEmails.value,
        calendarEmail: calendarEmail.value,
        active: active.input.checked,
      });
      await loadBootstrap({ selectedActivityId: state.selectedActivityId });
    } catch (error) {
      form.prepend(element("div", "error", error.message));
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

function selectedActivity() {
  if (state.selectedActivityId === "__new__") {
    return {
      id: "__new__",
      date: new Date().toISOString().slice(0, 10),
      startTime: "09:00",
      endTime: "12:00",
      place: "",
      handoverNote: "",
      status: "公開",
      requiredAdults: "1",
      watchTimeUnitMinutes: "30",
    };
  }
  return state.activities.find((activity) => activity.id === state.selectedActivityId) || state.activities[0];
}

function filteredActivities() {
  return state.activities.filter((activity) => {
    if (state.filter === "shortage") return watchShortage(activity).hasShortage;
    if (state.filter === "mine") {
      if (!state.linkedMemberIds.length) return false;
      return state.responses.some((response) => response.activityId === activity.id && state.linkedMemberIds.includes(response.memberId));
    }
    return true;
  });
}

function computeStats() {
  const upcoming = state.activities.length;
  const unanswered = state.activities.reduce((count, activity) => count + unansweredMembers(activity.id).length, 0);
  const shortage = state.activities.filter((activity) => watchShortage(activity).hasShortage).length;
  return { upcoming, unanswered, shortage };
}

function participantMembers(activityId) {
  const ids = new Set(state.responses.filter((response) => response.activityId === activityId && response.attendanceStatus === "参加").map((response) => response.memberId));
  return state.members.filter((member) => ids.has(member.id));
}

function absentMembers(activityId) {
  const ids = new Set(state.responses.filter((response) => response.activityId === activityId && response.attendanceStatus === "欠席").map((response) => response.memberId));
  return state.members.filter((member) => ids.has(member.id));
}

function unansweredMembers(activityId) {
  const answered = new Map(state.responses.filter((response) => response.activityId === activityId).map((response) => [response.memberId, response.attendanceStatus]));
  return state.members
    .filter((member) => member.active !== false)
    .filter((member) => !answered.has(member.id) || ["未回答", "未定"].includes(answered.get(member.id)));
}

function responseFor(activityId, memberId) {
  return state.responses.find((response) => response.activityId === activityId && response.memberId === memberId);
}

function watchResponses(activityId) {
  return state.responses.filter((response) => response.activityId === activityId);
}

function dutyMembers(activityId, key) {
  return watchResponses(activityId)
    .filter((response) => response[key] === "true")
    .map((response) => memberLabel(response.memberId));
}

function watchDutyRows(activityId) {
  return watchResponses(activityId)
    .filter((response) => response.canWatch === "true")
    .map((response) => `${memberLabel(response.memberId)} ${response.watchStartTime || "--:--"}-${response.watchEndTime || "--:--"}`);
}

function memberLabel(memberId) {
  const member = state.members.find((item) => item.id === memberId);
  return member?.displayName || member?.playerName || "未登録メンバー";
}

function watchShortage(activity) {
  const slots = coverageSlots(activity);
  const hasOpen = watchResponses(activity.id).some((response) => response.canOpen === "true");
  const hasClose = watchResponses(activity.id).some((response) => response.canClose === "true");
  const shortSlots = slots.filter((slot) => slot.count < slot.required);
  if (!hasOpen) return { hasShortage: true, message: "鍵開け担当がまだいません。" };
  if (!hasClose) return { hasShortage: true, message: "鍵閉め担当がまだいません。" };
  if (shortSlots.length) return { hasShortage: true, message: "見守りの大人が足りない時間帯があります。" };
  return { hasShortage: false, message: "" };
}

function coverageSlots(activity) {
  const start = minutes(activity.startTime || "09:00");
  const end = minutes(activity.endTime || "12:00");
  const step = Number(activity.watchTimeUnitMinutes || 30);
  const required = Number(activity.requiredAdults || 1);
  const slots = [];
  for (let cursor = start; cursor < end; cursor += step) {
    const next = Math.min(cursor + step, end);
    const count = watchResponses(activity.id).filter((response) => {
      if (response.canWatch !== "true") return false;
      const watchStart = minutes(response.watchStartTime || activity.startTime || "00:00");
      const watchEnd = minutes(response.watchEndTime || activity.endTime || "00:00");
      return watchStart <= cursor && watchEnd >= next;
    }).length;
    slots.push({ label: `${toTime(cursor)}-${toTime(next)}`, count, required });
  }
  return slots;
}

function googleCalendarUrl(activity) {
  const start = calendarDateTime(activity.date, activity.startTime);
  const end = calendarDateTime(activity.date, activity.endTime);
  const details = [
    "RED BISONS 活動",
    activity.handoverNote || "",
    "アプリで参加者と見守り状況を確認してください。",
  ].filter(Boolean).join("\n");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", `RED BISONS ${activity.place || "活動"}`);
  url.searchParams.set("dates", `${start}/${end}`);
  url.searchParams.set("location", activity.place || "");
  url.searchParams.set("details", details);
  return url.toString();
}

function formatActivityTitle(activity) {
  return `${formatDate(activity.date)} ${activity.startTime || ""}`;
}

function formatDate(value) {
  if (!value) return "日付未定";
  const date = parseDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日(${["日", "月", "火", "水", "木", "金", "土"][date.getDay()]})`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function calendarDateTime(date, time) {
  return `${date.replaceAll("-", "")}T${(time || "00:00").replace(":", "")}00`;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function minutes(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return hour * 60 + minute;
}

function toTime(value) {
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function section(title, body) {
  const node = element("section", "section");
  node.append(element("h3", "", title), body);
  return node;
}

function labelWrap(text, control) {
  const label = element("label");
  label.append(element("span", "", text), control);
  return label;
}

function checkbox(text) {
  const inputNode = element("input");
  inputNode.type = "checkbox";
  const labelNode = element("label");
  labelNode.append(inputNode, document.createTextNode(text));
  return { input: inputNode, label: labelNode };
}

function input(type, value) {
  const node = element("input");
  node.type = type;
  node.value = value;
  return node;
}

function timeInput(value) {
  const node = input("time", value || "");
  node.step = "300";
  return node;
}

function element(tag, className = "", text = "", children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  children.forEach((child) => node.append(child));
  return node;
}

function renderFatal(message) {
  app.innerHTML = "";
  app.append(element("main", "login-screen", "", [
    element("h1", "", "RED BISONS 活動管理"),
    element("div", "error", message),
  ]));
}

function isAdminMode() {
  return state.isAdmin && state.roleView === "admin";
}
