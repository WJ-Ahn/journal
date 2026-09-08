let journal = { entries: [] };
let editingEntryId = null;
let editingReplyKey = null; // `${entryId}:${replyId}`
let revealedEntryId = null;
let revealedReplyKey = null;
let entryRevealTimer = null;
let replyRevealTimer = null;
let composerImageFile = null;
let composerImagePreviewUrl = null;
let openReplyComposerEntryId = null; // 댓글 입력창이 열려있는 entry id (한 번에 하나만 열림)
const replyDrafts = {}; // entryId -> 입력 중인 댓글 임시 텍스트 (자동 닫힘 시에도 유지)
const replyComposerCloseTimers = {}; // entryId -> 포커스 이탈 자동 닫힘 타이머 id
const imageUrlCache = {}; // driveFileId -> objectURL

// 저장이 실패한 채로 화면에 남아있는 글/댓글 (재시도 버튼을 보여주기 위한 표시용)
const failedEntryIds = new Set(); // entry.id
const failedReplyKeys = new Set(); // `${entryId}:${replyId}`

// 현재 검색어 (비어있으면 검색 중이 아님)
let currentSearchQuery = "";

// ---------- 연결 상태 ----------
// "connected" | "saving" | "disconnected"
let connState = "disconnected";
let tokenExpiresAt = null; // 토큰 만료 예정 시각 (ms epoch)
let connWatcherTimer = null;

const feedEl = document.getElementById("feed");
const menuBtn = document.getElementById("menu-btn");
const menuPanel = document.getElementById("menu-panel");
const themeToggle = document.getElementById("theme-toggle");
const connStatusBtn = document.getElementById("conn-status-btn");
const searchBtn = document.getElementById("search-btn");
const searchPanel = document.getElementById("search-panel");
const searchInput = document.getElementById("search-input");
const composerTextEl = document.getElementById("composer-text");
const composerPostBtn = document.getElementById("composer-post-btn");
const composerImageBtn = document.getElementById("composer-image-btn");
const cameraInput = document.getElementById("composer-file-input-camera");
const galleryInput = document.getElementById("composer-file-input-gallery");
const composerImagePreview = document.getElementById("composer-image-preview");
const composerImageTag = document.getElementById("composer-image-tag");
const composerImageRemove = document.getElementById("composer-image-remove");
const photoModalOverlay = document.getElementById("photo-modal-overlay");
const photoCameraBtn = document.getElementById("photo-camera-btn");
const photoGalleryBtn = document.getElementById("photo-gallery-btn");
const photoCancelBtn = document.getElementById("photo-cancel-btn");

const ICONS = {
  image: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  send: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
};

function iconBtn(name, className, title) {
  const btn = document.createElement("button");
  btn.className = className;
  btn.title = title;
  btn.innerHTML = ICONS[name];
  return btn;
}

composerImageBtn.innerHTML = ICONS.image;
composerImageRemove.innerHTML = ICONS.close;
composerPostBtn.innerHTML = ICONS.send;
menuBtn.innerHTML = ICONS.menu;
searchBtn.innerHTML = ICONS.search;

// ---------- 연결 상태 표시 ----------
const CONN_TITLES = {
  connected: "Google Drive 연결됨",
  saving: "저장 중...",
  disconnected: "연결 끊김 - 눌러서 재연결",
};

function setConnStatus(state) {
  connState = state;
  connStatusBtn.dataset.state = state;
  connStatusBtn.title = CONN_TITLES[state] || "";
}

// 토큰 만료 시각을 넘겼는지 주기적으로 확인 (실제 API 실패는 각 요청에서 즉시 반영됨)
function startConnWatcher() {
  clearInterval(connWatcherTimer);
  connWatcherTimer = setInterval(() => {
    if (tokenExpiresAt && Date.now() >= tokenExpiresAt && connState !== "saving") {
      setConnStatus("disconnected");
    }
  }, 30000);
}

connStatusBtn.addEventListener("click", () => {
  if (connState === "disconnected" && tokenClient) {
    tokenClient.requestAccessToken();
  }
});

// ---------- 메뉴 / 다크모드 ----------
menuBtn.addEventListener("click", () => {
  // 검색 패널이 열려있으면 먼저 닫는다 (동시에 두 패널이 열리지 않도록)
  if (searchPanel.classList.contains("open")) {
    closeSearchPanel();
  }
  menuPanel.classList.toggle("open");
});

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.setAttribute("aria-checked", theme === "dark" ? "true" : "false");
  localStorage.setItem("pj-theme", theme);
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

applyTheme(localStorage.getItem("pj-theme") === "dark" ? "dark" : "light");

// ---------- 검색 ----------
const CHOSUNG_LIST = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

// 문자열의 한글 음절을 초성으로 치환 (한글이 아닌 문자는 그대로 둠 -> 숫자/영문 섞인 검색어도 대응)
function toChosung(str) {
  let result = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const chosungIndex = Math.floor((code - 0xac00) / 588);
      result += CHOSUNG_LIST[chosungIndex];
    } else {
      result += ch;
    }
  }
  return result;
}

function isChosungOnlyQuery(query) {
  return [...query].every((ch) => CHOSUNG_LIST.includes(ch));
}

// 일반 텍스트 포함 검색 + 초성 검색
function textMatches(text, query) {
  if (!text) return false;
  if (text.toLowerCase().includes(query.toLowerCase())) return true;
  if (isChosungOnlyQuery(query)) {
    return toChosung(text).includes(query);
  }
  return false;
}

// 검색어가 순수 숫자 4/6/8자리이면 날짜 검색으로 취급
function isDateQuery(query) {
  return /^\d{4}$|^\d{6}$|^\d{8}$/.test(query);
}

function dateMatches(iso, query) {
  if (!iso) return false;
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const yyyymmdd = `${y}${m}${day}`;
  return yyyymmdd.startsWith(query);
}

// 글(entry) + 댓글(replies) 내용/날짜를 모두 대상으로 검색어 일치 여부 판단
function entryMatches(entry, query) {
  if (isDateQuery(query)) {
    if (dateMatches(entry.time, query)) return true;
    return entry.replies.some((r) => dateMatches(r.time, query));
  }
  if (textMatches(entry.text, query)) return true;
  return entry.replies.some((r) => textMatches(r.text, query));
}

function closeSearchPanel() {
  searchPanel.classList.remove("open");
  searchInput.value = "";
  currentSearchQuery = "";
  render();
}

searchBtn.addEventListener("click", () => {
  const willOpen = !searchPanel.classList.contains("open");
  if (willOpen) {
    // 메뉴 패널이 열려있으면 먼저 닫는다
    menuPanel.classList.remove("open");
    searchPanel.classList.add("open");
    searchInput.focus();
  } else {
    closeSearchPanel();
  }
});

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  currentSearchQuery = q;
  if (!q) {
    render();
    return;
  }
  renderSearchResults(q);
});

// 검색 결과만 걸러서 피드에 그림
function renderSearchResults(query) {
  feedEl.innerHTML = "";
  const filtered = journal.entries.filter((entry) => entryMatches(entry, query));
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "검색 결과가 없습니다";
    feedEl.appendChild(empty);
    return;
  }
  for (const entry of filtered) {
    feedEl.appendChild(buildEntryNode(entry));
  }
}

// 날짜+시간을 함께 표시 (연도 포함, 기록이 여러 해에 걸쳐 쌓일 수 있으므로)
function formatDateTime(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const timePart = d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} · ${timePart}`;
}

// URL을 자동으로 <a> 링크로 변환 (나머지 텍스트는 이스케이프 처리)
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

// ---------- 터치 시에만 수정/삭제 아이콘 노출 (DOM 클래스만 토글, 재렌더링 없음) ----------
function revealEntry(id) {
  clearTimeout(entryRevealTimer);
  if (revealedEntryId !== null && revealedEntryId !== id) {
    const prevEl = feedEl.querySelector(`.entry[data-entry-id="${revealedEntryId}"]`);
    if (prevEl) prevEl.classList.remove("revealed");
  }
  revealedEntryId = id;
  const el = feedEl.querySelector(`.entry[data-entry-id="${id}"]`);
  if (el) el.classList.add("revealed");
  entryRevealTimer = setTimeout(() => {
    if (el) el.classList.remove("revealed");
    if (revealedEntryId === id) revealedEntryId = null;
  }, 2000);
}

function revealReply(key) {
  clearTimeout(replyRevealTimer);
  if (revealedReplyKey !== null && revealedReplyKey !== key) {
    const prevEl = feedEl.querySelector(`.reply-row[data-reply-key="${revealedReplyKey}"]`);
    if (prevEl) prevEl.classList.remove("revealed");
  }
  revealedReplyKey = key;
  const el = feedEl.querySelector(`.reply-row[data-reply-key="${key}"]`);
  if (el) el.classList.add("revealed");
  replyRevealTimer = setTimeout(() => {
    if (el) el.classList.remove("revealed");
    if (revealedReplyKey === key) revealedReplyKey = null;
  }, 2000);
}

// ---------- 댓글 입력창 자동 닫힘 (포커스 이탈 2초 후) ----------
function clearReplyComposerAutoClose(entryId) {
  if (replyComposerCloseTimers[entryId]) {
    clearTimeout(replyComposerCloseTimers[entryId]);
    delete replyComposerCloseTimers[entryId];
  }
}

function scheduleReplyComposerAutoClose(entryId) {
  clearReplyComposerAutoClose(entryId);
  replyComposerCloseTimers[entryId] = setTimeout(() => {
    delete replyComposerCloseTimers[entryId];
    if (openReplyComposerEntryId !== entryId) return;
    const textarea = feedEl.querySelector(
      `.entry[data-entry-id="${entryId}"] .reply-composer textarea`
    );
    // 포커스가 없는 상태라면 닫는다 (입력해둔 텍스트는 replyDrafts에 남아있으므로 유지됨)
    if (document.activeElement !== textarea) {
      openReplyComposerEntryId = null;
      updateEntry(entryId);
    }
  }, 2000);
}

// ---------- 로그인 / 자동 재연결 ----------
let tokenClient;
// 자동(조용한) 재연결이 진행 중일 때, 로그인 콜백 결과를 이 resolver로 되돌려줌
// (일반 로그인 흐름과 구분하기 위한 플래그 역할도 겸함)
let pendingReconnectResolve = null;

function initGis() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: async (response) => {
      if (response.error) {
        if (pendingReconnectResolve) {
          // 조용한 재연결 시도 중이었다면 알림 없이 실패로 처리 (호출부가 후속 처리)
          const resolve = pendingReconnectResolve;
          pendingReconnectResolve = null;
          resolve(false);
          return;
        }
        alert("로그인에 실패했습니다: " + response.error);
        setConnStatus("disconnected");
        return;
      }
      DriveClient.setToken(response.access_token);
      const expiresInSec = Number(response.expires_in) || 3600;
      tokenExpiresAt = Date.now() + expiresInSec * 1000;
      setConnStatus("connected");
      startConnWatcher();

      if (pendingReconnectResolve) {
        const resolve = pendingReconnectResolve;
        pendingReconnectResolve = null;
        resolve(true);
        return;
      }

      await startApp();
    },
  });

  const btnContainer = document.getElementById("google-signin-btn");
  const btn = document.createElement("button");
  btn.textContent = "Google로 계속하기";
  btn.className = "post-btn";
  btn.style.padding = "10px 20px";
  btn.onclick = () => tokenClient.requestAccessToken();
  btnContainer.appendChild(btn);
}

// 사용자 몰래 토큰 재발급을 한 번 시도. 성공하면 true, 실패(또는 상호작용 필요)하면 false.
function trySilentReconnect() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(false);
      return;
    }
    pendingReconnectResolve = resolve;
    try {
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (err) {
      pendingReconnectResolve = null;
      resolve(false);
    }
  });
}

// Drive 요청 함수(fn)를 실행하고, 실패하면 조용한 재연결을 한 번 시도한 뒤 재요청.
// 그것도 실패하면 최종 실패로 반환. (연결 상태 갱신은 호출부 책임)
async function callDriveWithReconnect(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const reconnected = await trySilentReconnect();
    if (reconnected) {
      try {
        return { ok: true, value: await fn() };
      } catch (err2) {
        return { ok: false, error: err2 };
      }
    }
    return { ok: false, error: err };
  }
}

async function startApp() {
  document.getElementById("signin-screen").style.display = "none";
  document.getElementById("app-screen").style.display = "flex";

  setConnStatus("saving");
  const result = await callDriveWithReconnect(() => DriveClient.loadJournal());
  if (result.ok) {
    journal = result.value;
    if (!journal.entries) journal.entries = [];
    setConnStatus("connected");
  } else {
    setConnStatus("disconnected");
    alert("Drive에서 기록을 불러오지 못했습니다. 상단 좌측 아이콘을 눌러 재연결해주세요.");
    journal = { entries: [] };
  }
  render();
}

// Drive 저장을 시도. 실패 시 조용한 재연결 후 한 번 더 시도.
// 최종 실패 여부를 boolean으로 반환 (호출부가 화면에 "저장 안 됨" 표시를 남길지 판단할 수 있도록).
async function persist() {
  setConnStatus("saving");
  const result = await callDriveWithReconnect(() => DriveClient.saveJournal(journal));
  if (result.ok) {
    setConnStatus("connected");
    return true;
  }
  setConnStatus("disconnected");
  alert("저장에 실패했습니다. 방금 변경한 내용이 Drive에 반영되지 않았을 수 있습니다. 상단 좌측 아이콘을 눌러 재연결한 뒤 다시 시도해주세요.");
  return false;
}

// ---------- 항목 단위 갱신 헬퍼 ----------
// 특정 글 하나만 다시 만들어 기존 자리에 교체 (피드 전체를 다시 그리지 않음)
// 검색 중일 때는 수정 결과가 더 이상 검색어와 일치하지 않으면 화면에서 제거함
function updateEntry(entryId) {
  const entry = journal.entries.find((e) => e.id === entryId);
  const oldNode = feedEl.querySelector(`.entry[data-entry-id="${entryId}"]`);
  if (!entry) {
    if (oldNode) oldNode.remove();
    return;
  }
  if (currentSearchQuery && !entryMatches(entry, currentSearchQuery)) {
    if (oldNode) oldNode.remove();
    return;
  }
  const newNode = buildEntryNode(entry);
  if (oldNode) {
    oldNode.replaceWith(newNode);
  } else if (currentSearchQuery) {
    renderSearchResults(currentSearchQuery);
  } else {
    render();
  }
}

// 특정 글 하나만 DOM에서 제거 (삭제)
function removeEntryNode(entryId) {
  const node = feedEl.querySelector(`.entry[data-entry-id="${entryId}"]`);
  if (node) {
    node.remove();
  } else if (currentSearchQuery) {
    renderSearchResults(currentSearchQuery);
  } else {
    render();
  }
}

// 새 글 하나만 만들어 맨 위에 추가 (작성). 검색 중이면 검색 결과 기준으로 다시 그림.
function prependEntryNode(entry) {
  if (currentSearchQuery) {
    renderSearchResults(currentSearchQuery);
    return;
  }
  const node = buildEntryNode(entry);
  feedEl.prepend(node);
}

// ---------- 렌더링 ----------
// 최초 로드 시에만 전체 피드를 그림
function render() {
  feedEl.innerHTML = "";
  for (const entry of journal.entries) {
    feedEl.appendChild(buildEntryNode(entry));
  }
}

// 글 하나의 DOM 노드를 만들어 반환 (화면에 붙이는 건 호출부 책임)
function buildEntryNode(entry) {
  const entryEl = document.createElement("div");
  entryEl.className = "entry";
  entryEl.dataset.entryId = entry.id;

  if (editingEntryId === entry.id) {
    entryEl.appendChild(buildEditBox(entry.text, async (newText) => {
      entry.text = newText;
      editingEntryId = null;
      await persist();
      updateEntry(entry.id);
    }, () => { editingEntryId = null; updateEntry(entry.id); }));
    return entryEl;
  }

  entryEl.classList.toggle("revealed", revealedEntryId === entry.id);
  entryEl.classList.toggle("failed", failedEntryIds.has(entry.id));
  entryEl.addEventListener("click", () => revealEntry(entry.id));

  if (entry.imageFileId) {
    const img = document.createElement("img");
    img.className = "entry-image";
    entryEl.appendChild(img);
    resolveImage(entry.imageFileId)
      .then((url) => (img.src = url))
      .catch(() => {
        setConnStatus("disconnected");
      });
  }

  if (entry.text) {
    const p = document.createElement("p");
    p.className = "entry-text";
    p.innerHTML = linkify(entry.text);
    entryEl.appendChild(p);
  }

  const meta = document.createElement("div");
  meta.className = "entry-meta";

  const time = document.createElement("span");
  time.className = "entry-time";
  time.textContent = formatDateTime(entry.time);
  meta.appendChild(time);

  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  meta.appendChild(spacer);

  const actions = document.createElement("div");
  actions.className = "icon-actions";

  const commentBtn = iconBtn("comment", "meta-icon-btn", "댓글");
  commentBtn.onclick = (e) => {
    e.stopPropagation();
    const previousId = openReplyComposerEntryId;
    const willOpen = openReplyComposerEntryId !== entry.id;
    openReplyComposerEntryId = willOpen ? entry.id : null;

    // 다른 글에 열려있던 입력창은 자동으로 닫는다 (한 번에 하나만 열림)
    if (previousId && previousId !== entry.id) {
      clearReplyComposerAutoClose(previousId);
      updateEntry(previousId);
    }
    updateEntry(entry.id);

    if (willOpen) {
      scheduleReplyComposerAutoClose(entry.id);
    } else {
      clearReplyComposerAutoClose(entry.id);
    }
  };
  actions.appendChild(commentBtn);

  const editBtn = iconBtn("edit", "meta-icon-btn", "수정");
  editBtn.onclick = (e) => {
    e.stopPropagation();
    editingEntryId = entry.id;
    updateEntry(entry.id);
  };
  actions.appendChild(editBtn);

  const deleteBtn = iconBtn("trash", "meta-icon-btn", "삭제");
  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm("이 기록을 삭제할까요?")) return;
    journal.entries = journal.entries.filter((e2) => e2.id !== entry.id);
    await persist();
    removeEntryNode(entry.id);
  };
  actions.appendChild(deleteBtn);
  meta.appendChild(actions);

  entryEl.appendChild(meta);

  // 저장이 실패한 채로 남아있는 글이면, 눈에 띄게 표시하고 재시도 버튼을 붙임
  if (failedEntryIds.has(entry.id)) {
    entryEl.appendChild(buildRetryBar(async (retryBtn) => {
      retryBtn.disabled = true;
      retryBtn.textContent = "다시 시도 중...";
      const success = await persist();
      if (success) failedEntryIds.delete(entry.id);
      updateEntry(entry.id);
    }));
  }

  // 답글 목록이 먼저, 그 아래에 댓글 입력창 (새 댓글은 항상 목록 맨 뒤에 추가되므로)
  const thread = document.createElement("div");
  thread.className = "thread";

  for (const reply of entry.replies) {
    thread.appendChild(buildReplyRow(entry, reply));
  }

  entryEl.appendChild(thread);

  const composerCollapse = document.createElement("div");
  composerCollapse.className =
    "reply-composer-collapse" + (openReplyComposerEntryId === entry.id ? " open" : "");
  composerCollapse.appendChild(buildReplyComposer(entry));
  entryEl.appendChild(composerCollapse);

  return entryEl;
}

// "저장되지 않음 / 다시 시도" 표시 바를 만들어 반환. onRetry(retryBtn)은 버튼 클릭 시 호출됨.
function buildRetryBar(onRetry) {
  const bar = document.createElement("div");
  bar.className = "retry-bar";

  const label = document.createElement("span");
  label.textContent = "저장되지 않음";
  bar.appendChild(label);

  const retryBtn = document.createElement("button");
  retryBtn.className = "retry-btn";
  retryBtn.textContent = "다시 시도";
  retryBtn.onclick = (e) => {
    e.stopPropagation();
    onRetry(retryBtn);
  };
  bar.appendChild(retryBtn);

  return bar;
}

// 댓글 한 줄의 DOM 노드를 만들어 반환
function buildReplyRow(entry, reply) {
  const replyKey = `${entry.id}:${reply.id}`;
  const row = document.createElement("div");
  row.className =
    "reply-row" +
    (revealedReplyKey === replyKey ? " revealed" : "") +
    (failedReplyKeys.has(replyKey) ? " failed" : "");
  row.dataset.replyKey = replyKey;
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    if (editingReplyKey === replyKey) return;
    revealReply(replyKey);
  });

  const line = document.createElement("div");
  line.className = "reply-line";
  row.appendChild(line);

  if (editingReplyKey === replyKey) {
    const editWrap = document.createElement("div");
    editWrap.style.flex = "1";
    editWrap.appendChild(buildEditBox(reply.text, async (newText) => {
      reply.text = newText;
      editingReplyKey = null;
      await persist();
      updateEntry(entry.id);
    }, () => { editingReplyKey = null; updateEntry(entry.id); }));
    row.appendChild(editWrap);
  } else {
    const textWrap = document.createElement("div");
    textWrap.style.flex = "1";
    const rp = document.createElement("p");
    rp.className = "reply-text";
    rp.innerHTML = linkify(reply.text);
    const metaRow = document.createElement("div");
    metaRow.className = "reply-meta";
    const rt = document.createElement("span");
    rt.className = "reply-time";
    rt.textContent = formatDateTime(reply.time);
    metaRow.appendChild(rt);

    const rSpacer = document.createElement("span");
    rSpacer.style.flex = "1";
    metaRow.appendChild(rSpacer);

    const actions = document.createElement("div");
    actions.className = "icon-actions";

    const rEditBtn = iconBtn("edit", "meta-icon-btn", "수정");
    rEditBtn.onclick = (e) => {
      e.stopPropagation();
      editingReplyKey = replyKey;
      updateEntry(entry.id);
    };
    actions.appendChild(rEditBtn);

    const rDeleteBtn = iconBtn("trash", "meta-icon-btn", "삭제");
    rDeleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("이 답글을 삭제할까요?")) return;
      entry.replies = entry.replies.filter((r) => r.id !== reply.id);
      await persist();
      updateEntry(entry.id);
    };
    actions.appendChild(rDeleteBtn);
    metaRow.appendChild(actions);

    textWrap.appendChild(rp);
    textWrap.appendChild(metaRow);

    if (failedReplyKeys.has(replyKey)) {
      textWrap.appendChild(buildRetryBar(async (retryBtn) => {
        retryBtn.disabled = true;
        retryBtn.textContent = "다시 시도 중...";
        const success = await persist();
        if (success) failedReplyKeys.delete(replyKey);
        updateEntry(entry.id);
      }));
    }

    row.appendChild(textWrap);
  }

  return row;
}

// 댓글 입력창 DOM 노드를 만들어 반환
function buildReplyComposer(entry) {
  const replyComposer = document.createElement("div");
  replyComposer.className = "reply-composer";
  const rline = document.createElement("div");
  rline.className = "reply-line";
  rline.style.alignSelf = "stretch";
  const input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = "";
  input.value = replyDrafts[entry.id] || ""; // 자동 닫힘으로 사라졌던 임시 텍스트 복원
  const sendBtn = document.createElement("button");
  sendBtn.className = "reply-send-btn";
  sendBtn.innerHTML = ICONS.send;
  sendBtn.classList.toggle("active", input.value.trim().length > 0);

  input.oninput = () => {
    replyDrafts[entry.id] = input.value;
    sendBtn.classList.toggle("active", input.value.trim().length > 0);
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  };

  input.onfocus = () => {
    clearReplyComposerAutoClose(entry.id);
  };

  input.onblur = () => {
    scheduleReplyComposerAutoClose(entry.id);
  };

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    const newReply = { id: `r${Date.now()}`, text, time: new Date().toISOString() };
    entry.replies.push(newReply);
    clearReplyComposerAutoClose(entry.id);
    delete replyDrafts[entry.id];
    openReplyComposerEntryId = null; // 등록 시도 시 입력창은 우선 닫음
    updateEntry(entry.id); // 저장 결과와 무관하게 화면에는 바로 반영

    const success = await persist();
    const replyKey = `${entry.id}:${newReply.id}`;
    if (!success) {
      failedReplyKeys.add(replyKey);
    } else {
      failedReplyKeys.delete(replyKey);
    }
    updateEntry(entry.id);
  };
  sendBtn.onclick = (e) => { e.stopPropagation(); submit(); };
  replyComposer.addEventListener("click", (e) => e.stopPropagation());

  replyComposer.appendChild(rline);
  replyComposer.appendChild(input);
  replyComposer.appendChild(sendBtn);
  return replyComposer;
}

// 수정 모드 공용 UI: textarea + 저장/취소 아이콘 버튼
function buildEditBox(initialText, onSave, onCancel) {
  const wrap = document.createElement("div");
  wrap.className = "edit-box";

  const textarea = document.createElement("textarea");
  textarea.className = "edit-textarea";
  textarea.value = initialText;
  textarea.rows = 2;
  textarea.addEventListener("input", () => autoResizeTextarea(textarea));
  requestAnimationFrame(() => autoResizeTextarea(textarea));

  const actions = document.createElement("div");
  actions.className = "edit-actions";

  const saveBtn = iconBtn("check", "meta-icon-btn edit-save", "저장");
  saveBtn.onclick = () => {
    const val = textarea.value.trim();
    if (!val) return;
    onSave(val);
  };

  const cancelBtn = iconBtn("close", "meta-icon-btn", "취소");
  cancelBtn.onclick = onCancel;

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  wrap.appendChild(textarea);
  wrap.appendChild(actions);
  return wrap;
}

async function resolveImage(fileId) {
  if (imageUrlCache[fileId]) return imageUrlCache[fileId];
  const url = await DriveClient.getImageObjectUrl(fileId);
  imageUrlCache[fileId] = url;
  return url;
}

// ---------- 작성창 ----------
function updatePostButtonState() {
  const hasText = composerTextEl.value.trim().length > 0;
  composerPostBtn.disabled = !hasText && !composerImageFile;
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

composerTextEl.addEventListener("input", () => {
  updatePostButtonState();
  autoResizeTextarea(composerTextEl);
});

// 사진 선택 바텀시트 모달
function openPhotoModal() {
  photoModalOverlay.style.display = "flex";
}
function closePhotoModal() {
  photoModalOverlay.style.display = "none";
}

composerImageBtn.addEventListener("click", openPhotoModal);
photoCancelBtn.addEventListener("click", closePhotoModal);
photoModalOverlay.addEventListener("click", (e) => {
  if (e.target === photoModalOverlay) closePhotoModal();
});
photoCameraBtn.addEventListener("click", () => {
  closePhotoModal();
  cameraInput.click();
});
photoGalleryBtn.addEventListener("click", () => {
  closePhotoModal();
  galleryInput.click();
});

function handleImageFile(file) {
  if (!file) return;
  composerImageFile = file;
  composerImagePreviewUrl = URL.createObjectURL(file);
  composerImageTag.src = composerImagePreviewUrl;
  composerImagePreview.style.display = "block";
  updatePostButtonState();
}
cameraInput.addEventListener("change", () => handleImageFile(cameraInput.files[0]));
galleryInput.addEventListener("change", () => handleImageFile(galleryInput.files[0]));

composerImageRemove.addEventListener("click", () => {
  composerImageFile = null;
  composerImagePreview.style.display = "none";
  cameraInput.value = "";
  galleryInput.value = "";
  updatePostButtonState();
});

composerPostBtn.addEventListener("click", async () => {
  const text = composerTextEl.value.trim();
  if (!text && !composerImageFile) return;

  composerPostBtn.disabled = true;

  let imageFileId = null;
  if (composerImageFile) {
    setConnStatus("saving");
    const uploadResult = await callDriveWithReconnect(() => DriveClient.uploadImage(composerImageFile));
    if (!uploadResult.ok) {
      setConnStatus("disconnected");
      alert("이미지 업로드에 실패했습니다. 상단 좌측 아이콘을 눌러 재연결한 뒤 다시 시도해주세요.");
      composerPostBtn.disabled = false;
      return;
    }
    imageFileId = uploadResult.value;
    setConnStatus("connected");
  }

  const newEntry = {
    id: `e${Date.now()}`,
    text,
    imageFileId,
    time: new Date().toISOString(),
    replies: [],
  };
  journal.entries.unshift(newEntry);
  prependEntryNode(newEntry); // 저장 결과와 무관하게 화면에는 바로 반영
  window.scrollTo({ top: 0, behavior: "smooth" });

composerTextEl.value = "";
  composerImageFile = null;
  composerImagePreview.style.display = "none";
  cameraInput.value = "";
  galleryInput.value = "";
  updatePostButtonState();

  const success = await persist();
  if (!success) {
    failedEntryIds.add(newEntry.id);
    updateEntry(newEntry.id); // "저장되지 않음 / 다시 시도" 표시를 붙여서 다시 그림
  }
});

// ---------- 시작 ----------
window.addEventListener("load", () => {
  // GIS 스크립트가 비동기로 로드되므로 약간의 지연 후 초기화
  const check = setInterval(() => {
    if (window.google && google.accounts) {
      clearInterval(check);
      initGis();
    }
  }, 100);
});
