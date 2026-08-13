const { core, event, sidebar, file, menu, console, input, preferences, utils, overlay } = iina;

const FAVORITES_PATH = "@data/favorites.json";
const PREF_ADD_FAVORITE_KEYBINDING = "addFavoriteKeyBinding";
const PREF_SHOW_FAVORITES_KEYBINDING = "showFavoritesKeyBinding";
const PREF_MISSING_SEARCH_ROOTS = "missingSearchRoots";

const VIDEO_EXTENSIONS = [
  "mp4", "mkv", "mov", "m4v", "webm", "flv", "wmv", "mpg",
  "mpeg", "ts", "m2ts", "avi", "rmvb", "3gp",
];

let missingScanStarted = false;

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

function pathDirname(p) {
  if (!p) return p;
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

function pathBasename(p) {
  if (!p) return p;
  const idx = p.lastIndexOf("/");
  return idx < 0 ? p : p.slice(idx + 1);
}

function pathJoin(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.replace(/\/+$/, "") + "/" + String(b).replace(/^\/+/, "");
}

function pathToFileUrl(p) {
  return "file://" + encodeURIComponent(p).replace(/%2F/gi, "/");
}

function decodeFilePath(url) {
  if (typeof url !== "string" || !url.startsWith("file://")) return null;
  const raw = url.slice("file://".length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function hasVideoExtension(filename) {
  const dot = (filename || "").lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(filename.slice(dot + 1).toLowerCase());
}

function baseName(filename) {
  const dot = (filename || "").lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function similarityScore(originalBase, candidateBase) {
  const a = normalizeForMatch(originalBase);
  const b = normalizeForMatch(candidateBase);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return 0.8 + (Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 0.15;
  }
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter++;
  const union = tokensA.size + tokensB.size - inter;
  const jaccard = union ? inter / union : 0;
  if (jaccard > 0) {
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return jaccard * 0.6 + lenRatio * 0.4;
  }
  return 0;
}

function getMissingSearchRoots() {
  const value = preferences?.get(PREF_MISSING_SEARCH_ROOTS);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function findCandidates(originalPath, originalFilename) {
  const candidates = [];
  const seen = new Set();
  const originalBase = baseName(originalFilename);

  const add = (candidatePath, filename) => {
    const url = pathToFileUrl(candidatePath);
    if (seen.has(url)) return;
    seen.add(url);
    if (!hasVideoExtension(filename)) return;
    const score = similarityScore(originalBase, baseName(filename));
    if (score >= 0.35) candidates.push({ url, filename, score });
  };

  const dir = pathDirname(originalPath);
  if (dir && file.exists(dir)) {
    try {
      for (const entry of file.list(dir)) {
        if (!entry.isDir) add(pathJoin(dir, entry.path), entry.filename);
      }
    } catch { }
  }

  const nameQuery = `kMDItemFSName == "*${originalBase}*"c`;
  const roots = getMissingSearchRoots();
  try {
    if (roots.length) {
      for (const root of roots) {
        if (!file.exists(root)) continue;
        const output = await utils.exec("/usr/bin/mdfind", ["-onlyin", root, nameQuery]);
        for (const line of (output || "").split("\n")) {
          const trimmed = line.trim();
          if (trimmed) add(trimmed, pathBasename(trimmed));
        }
      }
    } else {
      const output = await utils.exec("/usr/bin/mdfind", [nameQuery]);
      for (const line of (output || "").split("\n")) {
        const trimmed = line.trim();
        if (trimmed) add(trimmed, pathBasename(trimmed));
      }
    }
  } catch { }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6);
}

async function scanMissingFavorites() {
  const favorites = loadFavorites();
  const missing = [];
  for (const fav of favorites) {
    if (typeof fav.url !== "string" || !fav.url.startsWith("file://")) continue;
    const path = decodeFilePath(fav.url);
    if (!path || file.exists(path)) continue;
    const filename = fav.filename || pathBasename(path);
    missing.push({
      id: fav.id,
      url: fav.url,
      filename,
      path,
      candidates: await findCandidates(path, filename),
    });
  }
  return missing;
}

async function broadcastMissingFavorites() {
  try {
    const missing = await scanMissingFavorites();
    sidebar.postMessage("missing-favorites", { missing });
    if (missing.length) {
      core.osd(`${missing.length} favorite${missing.length > 1 ? "s" : ""} missing`);
    }
  } catch { }
}

function updateFavoritePath(id, path, filename) {
  const favorites = loadFavorites().slice();
  const idx = favorites.findIndex((f) => f.id === id);
  if (idx < 0) return;
  favorites[idx].url = pathToFileUrl(path);
  favorites[idx].filename = filename || favorites[idx].filename;
  saveFavorites(favorites);
  broadcastFavorites();
  broadcastMissingFavorites();
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
  broadcastMissingFavorites();
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

  sidebar.onMessage("rescan-missing", () => {
    broadcastMissingFavorites();
  });

  sidebar.onMessage("choose-replacement", async ({ id }) => {
    try {
      const path = await utils.chooseFile("Select replacement file", {
        chooseDir: false,
        allowedFileTypes: VIDEO_EXTENSIONS.slice(),
      });
      if (!path) return;
      updateFavoritePath(id, path, pathBasename(path));
    } catch { }
  });

  sidebar.onMessage("set-favorite-path", ({ id, url, filename }) => {
    const path = decodeFilePath(url);
    if (!path) return;
    updateFavoritePath(id, path, filename);
  });

  if (!missingScanStarted) {
    missingScanStarted = true;
    broadcastMissingFavorites();
  }
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
