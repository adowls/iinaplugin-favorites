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

let state = { favorites: [], currentUrl: null };

function requestFavorites() {
  if (!window.iina) return;
  window.iina.postMessage("get-favorites");
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

  for (const fav of state.favorites) {
    const item = el("div", "item");
    if (fav.url && state.currentUrl && fav.url === state.currentUrl) item.classList.add("active");

    const top = el("div", "item-top");
    const filename = el("div", "filename");
    filename.textContent = fav.filename || "Unknown";

    const actions = el("div", "item-actions");
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
    item.appendChild(meta);

    item.addEventListener("click", () => {
      if (window.iina) window.iina.postMessage("play-favorite", { url: fav.url, position: fav.position });
    });

    list.appendChild(item);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refresh").addEventListener("click", () => requestFavorites());
  document.getElementById("deleteCurrent").addEventListener("click", () => {
    if (window.iina) window.iina.postMessage("delete-current-favorite");
  });

  if (window.iina) {
    window.iina.onMessage("favorites", (payload) => {
      state = { favorites: payload.favorites || [], currentUrl: payload.currentUrl || null };
      render();
    });
    window.iina.onMessage("favorites-updated", (payload) => {
      state = { favorites: payload.favorites || [], currentUrl: payload.currentUrl || null };
      render();
    });
  }

  requestFavorites();
});

