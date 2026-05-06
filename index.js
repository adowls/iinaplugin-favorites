const { core, event, sidebar, file, menu, console, input, preferences, utils, overlay } = iina;

const FAVORITES_PATH = "@data/favorites.json";
const PREF_ADD_FAVORITE_KEYBINDING = "addFavoriteKeyBinding";
const PREF_SHOW_FAVORITES_KEYBINDING = "showFavoritesKeyBinding";

let favoritesCache = null;
let pendingSeek = null;

function nowISO() {
  return new Date().toISOString();
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => isObject(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      url: typeof item.url === "string" ? item.url : "",
      position: typeof item.position === "number" && Number.isFinite(item.position) ? item.position : 0,
      filename: typeof item.filename === "string" ? item.filename : "",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
    }))
    .filter((item) => item.id && item.url && item.filename && item.createdAt);
}

function loadFavorites() {
  if (favoritesCache) return favoritesCache;
  if (!file.exists(FAVORITES_PATH)) {
    favoritesCache = [];
    return favoritesCache;
  }
  const content = file.read(FAVORITES_PATH);
  const parsed = safeParseJSON(content);
  favoritesCache = sanitizeFavorites(parsed);
  return favoritesCache;
}

function saveFavorites(favorites) {
  favoritesCache = favorites;
  file.write(FAVORITES_PATH, JSON.stringify(favorites, null, 2));
}

function currentUrl() {
  if (!core || !core.status || core.status.idle) return null;
  const url = core.status.url;
  return typeof url === "string" && url ? url : null;
}

function filenameFromUrl(url) {
  if (!url) return "Unknown";
  const title = core?.status?.title;
  if (typeof title === "string" && title) return title;
  const sanitized = url.startsWith("file://") ? url.slice("file://".length) : url;
  const withoutQuery = sanitized.split("?")[0];
  const parts = withoutQuery.split("/");
  const last = parts[parts.length - 1] || "Unknown";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function broadcastFavorites() {
  try {
    const favorites = loadFavorites();
    const current = currentUrl();
    sidebar.postMessage("favorites-updated", {
      favorites: favorites,
      currentUrl: current,
    });
    updateOverlay(favorites, current);
  } catch { }
}

function updateOverlay(favorites, current) {
  if (current && favorites.some(f => f.url === current)) {
    overlay.simpleMode();
    overlay.setContent('<div class="heart">❤️</div>');
    overlay.setStyle(`
      .heart {
        position: absolute;
        bottom: 10px;
        left: 10px;
        font-size: 20px;
        filter: drop-shadow(0 0 5px rgba(0,0,0,0.6));
        user-select: none;
        pointer-events: none;
      }
    `);
    overlay.show();
  } else {
    overlay.hide();
  }
}

async function openInFinder(url) {
  if (typeof url !== "string" || !url.startsWith("file://")) {
    core.osd("Not a local file");
    return;
  }
  let path = url.slice("file://".length);
  try {
    path = decodeURIComponent(path);
    if (utils && typeof utils.exec === "function") {
      await utils.exec("/usr/bin/open", ["-R", path]);
    } else {
      core.osd("Finder integration not available");
    }
  } catch (e) {
    core.osd("Failed to open in Finder");
  }
}

function moveFavoriteById(id, direction) {
  const favorites = loadFavorites().slice();
  const idx = favorites.findIndex((f) => f.id === id);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= favorites.length) return;
  const [removed] = favorites.splice(idx, 1);
  favorites.splice(newIdx, 0, removed);
  saveFavorites(favorites);
  broadcastFavorites();
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addCurrentToFavorites() {
  const url = currentUrl();
  if (!url) {
    core.osd("No video is playing");
    return;
  }

  const position = typeof core.status.position === "number" ? core.status.position : 0;
  const filename = filenameFromUrl(url);
  const favorites = loadFavorites().slice();
  const idx = favorites.findIndex((f) => f.url === url);
  const entry = {
    id: idx >= 0 ? favorites[idx].id : makeId(),
    url,
    position,
    filename,
    createdAt: nowISO(),
  };
  if (idx >= 0) {
    favorites[idx] = entry;
  } else {
    favorites.unshift(entry);
  }
  saveFavorites(favorites);
  core.osd("Added to Favorites");
  broadcastFavorites();
}

function removeCurrentFavorite() {
  const url = currentUrl();
  if (!url) {
    core.osd("No video is playing");
    return;
  }
  const favorites = loadFavorites().filter((f) => f.url !== url);
  saveFavorites(favorites);
  core.osd("Removed from Favorites");
  broadcastFavorites();
}

function removeFavoriteById(id) {
  if (typeof id !== "string" || !id) return;
  const favorites = loadFavorites().filter((f) => f.id !== id);
  saveFavorites(favorites);
  broadcastFavorites();
}

function playFavorite(url, position) {
  if (typeof url !== "string" || !url) return;
  const seekTo = typeof position === "number" && Number.isFinite(position) ? position : 0;
  const current = currentUrl();
  if (current === url) {
    core.seekTo(seekTo);
    return;
  }
  pendingSeek = { url, position: seekTo };
  core.open(url);
}

function getAddFavoriteKeyBinding() {
  const value = preferences?.get(PREF_ADD_FAVORITE_KEYBINDING);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "Meta+b";
}

function getShowFavoritesKeyBinding() {
  const value = preferences?.get(PREF_SHOW_FAVORITES_KEYBINDING);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "Meta+f";
}

function showFavorites() {
  try {
    sidebar.show();
  } catch { }
}

function getKeyCandidates(binding) {
  const candidates = [];
  if (typeof binding === "string" && binding) candidates.push(binding);
  try {
    const normalized = input?.normalizeKeyCode?.(binding);
    if (typeof normalized === "string" && normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  } catch { }
  return candidates;
}

function setupMenu() {
  menu.removeAllItems();
  menu.addItem(
    menu.item("Show Favorites", showFavorites, { keyBinding: getShowFavoritesKeyBinding() })
  );
  menu.addItem(
    menu.item("Add Current to Favorites", addCurrentToFavorites, { keyBinding: getAddFavoriteKeyBinding() })
  );
  menu.addItem(menu.item("Remove Current Favorite", removeCurrentFavorite));
  menu.addItem(menu.item("Reload Hotkey", setupMenu));
}

setupMenu();

event.on("iina.window-loaded", () => {
  sidebar.loadFile("ui/sidebar/index.html");

  sidebar.onMessage("get-favorites", () => {
    sidebar.postMessage("favorites", {
      favorites: loadFavorites(),
      currentUrl: currentUrl(),
    });
  });

  sidebar.onMessage("play-favorite", ({ url, position }) => {
    playFavorite(url, position);
  });

  sidebar.onMessage("delete-favorite", ({ id }) => {
    removeFavoriteById(id);
  });

  sidebar.onMessage("delete-current-favorite", () => {
    removeCurrentFavorite();
  });

  sidebar.onMessage("open-in-finder", ({ url }) => {
    openInFinder(url);
  });

  sidebar.onMessage("move-favorite", ({ id, direction }) => {
    moveFavoriteById(id, direction);
  });

  sidebar.onMessage("update-favorites", ({ favorites }) => {
    saveFavorites(favorites);
  });
});

event.on("iina.file-loaded", () => {
  const url = currentUrl();
  if (pendingSeek && url === pendingSeek.url) {
    const seekTo = pendingSeek.position;
    pendingSeek = null;
    core.seekTo(seekTo);
  }
  broadcastFavorites();
});

event.on("iina.plugin-loaded", () => {
  loadFavorites();
});
