function formatTime(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "00:00";
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

let state = { favorites: [], currentUrl: null, sortOrder: "manual", sortAsc: true, missing: [] };

function requestFavorites() {
  if (!window.iina) return;
  window.iina.postMessage("get-favorites");
}

function renderMissing() {
  const section = document.getElementById("missingSection");
  const missing = state.missing || [];
  section.style.display = missing.length ? "block" : "none";
  document.getElementById("missingCount").textContent = `(${missing.length})`;

  const listEl = document.getElementById("missingList");
  listEl.innerHTML = "";

  for (const m of missing) {
    const card = el("div", "missing-item");

    const head = el("div", "missing-item-top");
    const name = el("div", "missing-name");
    name.textContent = m.filename || "Unknown";
    const actions = el("div", "item-actions");

    const findBtn = el("button", "btn");
    findBtn.textContent = "Find file…";
    findBtn.addEventListener("click", () => {
      if (window.iina) window.iina.postMessage("choose-replacement", { id: m.id });
    });

    const delBtn = el("button", "btn danger");
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", () => {
      if (window.iina) window.iina.postMessage("delete-favorite", { id: m.id });
    });

    actions.appendChild(findBtn);
    actions.appendChild(delBtn);
    head.appendChild(name);
    head.appendChild(actions);

    const origPath = el("div", "missing-path");
    origPath.textContent = m.path || m.url || "";
    origPath.title = "Original path not found";

    card.appendChild(head);
    card.appendChild(origPath);

    if (m.candidates && m.candidates.length) {
      const cands = el("div", "missing-candidates");
      const candTitle = el("div", "missing-cand-title");
      candTitle.textContent = "Similar files:";
      cands.appendChild(candTitle);
      for (const c of m.candidates) {
        const row = el("div", "candidate-row");
        const info = el("div", "candidate-info");
        const cname = el("div", "candidate-name");
        cname.textContent = c.filename;
        const cpath = el("div", "candidate-path");
        cpath.textContent = c.url || "";
        info.appendChild(cname);
        info.appendChild(cpath);
        const useBtn = el("button", "btn");
        useBtn.textContent = "Use";
        useBtn.addEventListener("click", () => {
          if (window.iina) window.iina.postMessage("set-favorite-path", { id: m.id, url: c.url, filename: c.filename });
        });
        row.appendChild(info);
        row.appendChild(useBtn);
        cands.appendChild(row);
      }
      card.appendChild(cands);
    }

    listEl.appendChild(card);
  }
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function render() {
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  const count = document.getElementById("count");

  list.innerHTML = "";

  count.textContent = `(${state.favorites.length})`;
  empty.style.display = state.favorites.length ? "none" : "block";

  if (state.sortOrder !== "manual") {
    const dir = state.sortAsc ? 1 : -1;
    state.favorites.sort((a, b) => {
      let valA, valB;
      if (state.sortOrder === "filename") {
        valA = a.filename || "";
        valB = b.filename || "";
      } else if (state.sortOrder === "date") {
        valA = a.createdAt || "";
        valB = b.createdAt || "";
      } else if (state.sortOrder === "path") {
        valA = a.url || "";
        valB = b.url || "";
      }
      return (valA || "").localeCompare(valB || "") * dir;
    });
    // Persist sorted order immediately
    if (window.iina) window.iina.postMessage("update-favorites", { favorites: state.favorites });
    // Reset to manual to allow further manual adjustments
    state.sortOrder = "manual";
    document.getElementById("sortOrder").value = "manual";
  }

  for (const fav of state.favorites) {
    const item = el("div", "item");
    if (fav.url && state.currentUrl && fav.url === state.currentUrl) item.classList.add("active");

    const top = el("div", "item-top");
    const filename = el("div", "filename");
    filename.textContent = fav.filename || "Unknown";

    const pathEl = el("div", "path");
    let displayPath = fav.url || "";
    if (displayPath.startsWith("file://")) {
      displayPath = decodeURIComponent(displayPath.slice("file://".length));
    }
    pathEl.textContent = displayPath;
    pathEl.title = "Click to open in Finder";
    pathEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.iina) window.iina.postMessage("open-in-finder", { url: fav.url });
    });

    const actions = el("div", "item-actions");

    const moveUpBtn = el("button", "icon-btn");
    moveUpBtn.textContent = "↑";
    moveUpBtn.title = "Move Up";
    moveUpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.iina) window.iina.postMessage("move-favorite", { id: fav.id, direction: -1 });
    });

    const moveDownBtn = el("button", "icon-btn");
    moveDownBtn.textContent = "↓";
    moveDownBtn.title = "Move Down";
    moveDownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.iina) window.iina.postMessage("move-favorite", { id: fav.id, direction: 1 });
    });

    const finderBtn = el("button", "icon-btn");
    finderBtn.textContent = "📂";
    finderBtn.title = "Open in Finder";
    finderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.iina) window.iina.postMessage("open-in-finder", { url: fav.url });
    });

    const playBtn = el("button", "icon-btn");
    playBtn.textContent = "▶";
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.iina) window.iina.postMessage("play-favorite", { url: fav.url, position: fav.position });
    });
    const delBtn = el("button", "icon-btn danger");
    delBtn.textContent = "❌";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.iina) window.iina.postMessage("delete-favorite", { id: fav.id });
    });

    actions.appendChild(moveUpBtn);
    actions.appendChild(moveDownBtn);
    actions.appendChild(finderBtn);
    actions.appendChild(playBtn);
    actions.appendChild(delBtn);

    top.appendChild(filename);
    top.appendChild(actions);

    const meta = el("div", "meta");

    const timePill = el("span", "pill");
    timePill.textContent = `Time: ${formatTime(fav.position)}`;

    const datePill = el("span", "pill");
    datePill.textContent = `Added: ${formatDate(fav.createdAt)}`;

    meta.appendChild(timePill);
    meta.appendChild(datePill);

    item.appendChild(top);
    item.appendChild(pathEl);
    item.appendChild(meta);

    item.addEventListener("click", () => {
      if (window.iina) window.iina.postMessage("play-favorite", { url: fav.url, position: fav.position });
    });

    list.appendChild(item);
  }

  renderMissing();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refresh").addEventListener("click", () => requestFavorites());
  document.getElementById("deleteCurrent").addEventListener("click", () => {
    if (window.iina) window.iina.postMessage("delete-current-favorite");
  });
  document.getElementById("rescanMissing").addEventListener("click", () => {
    if (window.iina) window.iina.postMessage("rescan-missing");
  });

  const sortSelect = document.getElementById("sortOrder");
  sortSelect.addEventListener("change", (e) => {
    state.sortOrder = e.target.value;
    render();
  });

  const sortDirBtn = document.getElementById("sortDir");
  sortDirBtn.addEventListener("click", () => {
    state.sortAsc = !state.sortAsc;
    sortDirBtn.textContent = state.sortAsc ? "↑" : "↓";
  });

  if (window.iina) {
    window.iina.onMessage("favorites", (payload) => {
      state.favorites = payload.favorites || [];
      state.currentUrl = payload.currentUrl || null;
      render();
    });
    window.iina.onMessage("favorites-updated", (payload) => {
      state.favorites = payload.favorites || [];
      state.currentUrl = payload.currentUrl || null;
      render();
    });
    window.iina.onMessage("missing-favorites", (payload) => {
      state.missing = payload.missing || [];
      renderMissing();
    });
  }

  requestFavorites();
  if (window.iina) window.iina.postMessage("rescan-missing");
});
