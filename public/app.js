/* global io */

// ---------- DOM helpers ----------
const el = (id) => document.getElementById(id);

function setDisabled(id, v) {
  const n = el(id);
  if (n && "disabled" in n) n.disabled = !!v;
}

// ---------- Utilities ----------
function normalizeUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {}
  return "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setPill(target, text, kind = "") {
  const pill = typeof target === "string" ? el(target) : target;
  if (!pill) return;
  pill.textContent = text;
  pill.classList.toggle("good", kind === "good");
  pill.classList.toggle("warn", kind === "warn");
}

// ---------- Deck rules ----------
const COFFEE_CARD = "☕";

// (Optional safety net if any old rooms still have legacy values)
const HIDDEN_CARDS = new Set(["0.5", "89", "55", "0"]);

function toCardString(v) {
  return String(v ?? "").trim();
}

function uniquePreserveOrder(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function buildVotingDeck(deck) {
  const base = uniquePreserveOrder(
    (Array.isArray(deck) ? deck : [])
      .map(toCardString)
      .filter((v) => v && !HIDDEN_CARDS.has(v))
  );

  // Ensure coffee exists
  if (!base.includes(COFFEE_CARD)) base.push(COFFEE_CARD);
  return base;
}

function buildFinalizeDeck(deck) {
  const filtered = (Array.isArray(deck) ? deck : [])
    .map(toCardString)
    .filter((v) => v && !HIDDEN_CARDS.has(v));

  // numeric only (excludes ? and ☕)
  const numericOnly = filtered.filter((v) => Number.isFinite(Number(v)));
  return uniquePreserveOrder(numericOnly);
}

// ---------- URL params ----------
let currentRoom = null;
let modKey = null;
let lastState = null;

(function parseFromUrl() {
  const url = new URL(window.location.href);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "room" && parts[1]) currentRoom = parts[1].toUpperCase();
  modKey = url.searchParams.get("mod") ?? null;
  if (currentRoom) el("roomId").value = currentRoom;
})();

// ---------- Socket.IO ----------
const socket = io();

// ---------- Client → Server actions ----------
el("createRoomBtn")?.addEventListener("click", () => {
  const desiredRoomId = (el("roomId").value ?? "").trim().toUpperCase();
  const nameVal = (el("name").value ?? "").trim() || "Facilitator";
  setPill("modePill", "Creating room...", "");
  socket.emit("room:create", { desiredRoomId, name: nameVal });
});

el("joinBtn")?.addEventListener("click", () => {
  const roomId = ((el("roomId").value ?? "").trim().toUpperCase()) || currentRoom;
  const nameVal = (el("name").value ?? "").trim() || "Anonymous";

  if (!roomId) {
    setPill("modePill", "Enter a Team Name", "warn");
    el("roomId")?.focus();
    return;
  }

  setPill("modePill", "Joining...", "");
  socket.emit("room:join", { roomId, name: nameVal, modKey });
});

el("revealBtn")?.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("vote:reveal", { roomId: currentRoom });
});

el("clearBtn")?.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("vote:clear", { roomId: currentRoom });
});

el("addToQueueBtn")?.addEventListener("click", () => {
  if (!currentRoom) return;

  const title = (el("storyTitle")?.value ?? "").trim();
  const desc = (el("storyDesc")?.value ?? "").trim();
  const link = normalizeUrl((el("storyLink")?.value ?? "").trim());

  if (!title) {
    setPill("modePill", "Story title required", "warn");
    el("storyTitle")?.focus();
    return;
  }

  socket.emit("storyQueue:add", { roomId: currentRoom, story: { title, desc, link } });

  el("storyTitle").value = "";
  el("storyDesc").value = "";
  el("storyLink").value = "";
});

el("finalizeEstimateBtn")?.addEventListener("click", () => {
  if (!currentRoom) return;

  const storyId = lastState?.activeStoryId;
  const finalPoints = el("finalPointsSelect")?.value;

  if (!storyId) {
    setPill("modePill", "Set an active story before finalizing", "warn");
    return;
  }
  if (!finalPoints) {
    setPill("modePill", "Select final points", "warn");
    return;
  }

  socket.emit("storyQueue:finalize", { roomId: currentRoom, storyId, finalPoints });
});

// ---------- Server → Client events ----------
socket.on("connect", () => {
  setPill("modePill", "Connected (not in room)", "");

  // Facilitator link: auto-join
  if (currentRoom && modKey) {
    const nameVal = (el("name").value ?? "").trim() || "Facilitator";
    socket.emit("room:join", { roomId: currentRoom, name: nameVal, modKey });
  }
});

socket.on("room:created", ({ roomId, modKey: createdModKey }) => {
  currentRoom = roomId;
  modKey = createdModKey;

  const newUrl = `/room/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(modKey)}`;
  window.history.replaceState({}, "", newUrl);

  el("roomId").value = roomId;
  setPill("modePill", `Room ${roomId} created`, "good");
});

socket.on("room:state", (state) => {
  lastState = state;
  currentRoom = state.roomId;

  // Debug: confirm you receive activeStoryId changes
  console.log("[room:state] activeStoryId =", state.activeStoryId);

  setPill("modePill", state.youAreModerator ? "Facilitator" : "Participant", "good");
  setPill(
    "votePill",
    state.phase === "revealed" ? "Revealed" : "Voting",
    state.phase === "revealed" ? "warn" : "good"
  );

  // Users
  const usersArr = Object.values(state.users ?? {});
  if (el("usersPill")) el("usersPill").textContent = String(usersArr.length);

  const usersList = el("usersList");
  if (usersList) {
    usersList.innerHTML = "";
    for (const u of usersArr) {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="uname">${escapeHtml(u.name)}</span>` +
        `<span class="ustatus">${escapeHtml(u.vote ?? "")}</span>`;
      usersList.appendChild(li);
    }
  }

  // Story panel
  const storyView = el("storyView");
  if (storyView) {
    const title = escapeHtml(state.story?.title ?? "");
    const desc = escapeHtml(state.story?.desc ?? "");
    const link = normalizeUrl(state.story?.link ?? "");
    const fp = state.story?.finalPoints
      ? `<span class="pointsBadge">${escapeHtml(state.story.finalPoints)}</span>`
      : "";

    const linkHtml = link
      ? `<div class="storyLink"><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></div>`
      : `<div class="storyLink"></div>`;

    storyView.innerHTML = `
      <div class="storyTitle">${title}${fp}</div>
      <div class="storyDesc">${desc}</div>
      ${linkHtml}
    `;
  }

  // Deck + finalize select
  renderDeck(state.deck ?? [], state.phase);
  populateFinalSelect(state.deck ?? []);

  // Queue
  renderQueue(state.storyQueue ?? [], state.activeStoryId, !!state.youAreModerator);

  // Role-based enable/disable
  setDisabled("revealBtn", !state.youAreModerator);
  setDisabled("clearBtn", !state.youAreModerator);
  setDisabled("addToQueueBtn", !state.youAreModerator);
  setDisabled("finalPointsSelect", !state.youAreModerator);
  setDisabled("finalizeEstimateBtn", !state.youAreModerator);
});

socket.on("connect_error", (err) => console.error("[socket] connect_error", err));
socket.on("disconnect", (reason) => setPill("modePill", `Disconnected (${reason})`, "warn"));

// ---------- Rendering helpers ----------
function renderDeck(deck, phase) {
  const host = el("deck");
  if (!host) return;
  host.innerHTML = "";

  const shown = buildVotingDeck(deck);

  for (const v of shown) {
    const btn = document.createElement("button");
    btn.className = "deckBtn";
    btn.type = "button";
    btn.textContent = v;

    btn.disabled = !currentRoom || phase !== "voting";

    btn.addEventListener("click", () => {
      if (!currentRoom) return;
      socket.emit("vote:set", { roomId: currentRoom, vote: v });
    });

    host.appendChild(btn);
  }
}

function populateFinalSelect(deck) {
  const sel = el("finalPointsSelect");
  if (!sel) return;

  const current = sel.value;
  sel.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select final points…";
  sel.appendChild(placeholder);

  const finalOpts = buildFinalizeDeck(deck);
  for (const v of finalOpts) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }

  if (current && finalOpts.includes(current)) sel.value = current;
}

function renderQueue(queue, activeId, canManage) {
  const ul = el("storyQueueList");
  if (!ul) return;

  ul.innerHTML = "";

  if (!queue.length) {
    const li = document.createElement("li");
    li.className = "queueItem";
    li.innerHTML =
      '<div class="queueLeft"><div class="queueTitleRow"><span class="queueTitle">No Stories In Queue</span></div></div>';
    ul.appendChild(li);
    return;
  }

  for (const item of queue) {
    const li = document.createElement("li");
    li.className = "queueItem" + (item.id === activeId ? " queueActive" : "");

    const left = document.createElement("div");
    left.className = "queueLeft";

    const titleRow = document.createElement("div");
    titleRow.className = "queueTitleRow";

    const title = document.createElement("div");
    title.className = "queueTitle";
    title.textContent = item.title;

    const badge = document.createElement("div");
    badge.className = "queuePoints";
    badge.textContent = item.finalPoints ? `Final: ${item.finalPoints}` : "—";

    titleRow.appendChild(title);
    titleRow.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "queueMeta";
    meta.textContent = item.id === activeId ? "Active Story" : "";

    left.appendChild(titleRow);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "queueActions";

    if (item.link) {
      const a = document.createElement("a");
      a.className = "queueBtn queueLinkBtn";
      a.href = normalizeUrl(item.link);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "↗";
      actions.appendChild(a);
    }

    if (canManage) {
      const setActive = document.createElement("button");
      setActive.className = "queueBtn";
      setActive.type = "button";
      setActive.textContent = "Set Active";
      setActive.disabled = item.id === activeId;

      setActive.addEventListener("click", () => {
        if (!currentRoom) {
          setPill("modePill", "No room joined", "warn");
          return;
        }

        setPill("modePill", "Setting active story...", "");

        // ✅ ACK: server tells us if it got the request and why it failed
        socket.emit(
          "storyQueue:setActive",
          { roomId: currentRoom, storyId: item.id },
          (res) => {
            if (!res?.ok) {
              setPill("modePill", res?.reason || "Failed to set active story", "warn");
            } else {
              setPill("modePill", "Active story set", "good");
            }
          }
        );
      });

      actions.appendChild(setActive);
    }

    li.appendChild(left);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}
