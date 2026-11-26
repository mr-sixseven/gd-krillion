/* GD Krillion 1.1.0 — five-round rare-level game.
 * Vanilla JS with synthesized Web Audio sound effects.
 * Rarity boundaries are unchanged from the beta; the curve is a much softer log.
 * Krillion tier names label score bands, not prompt difficulties. The
 * "Show Tier Names" and "Show Exact Numbers" settings control score display.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants                                                           *
   * ------------------------------------------------------------------ */
  const VERSION = '1.1.0';
  const ROUNDS = 5;
  const DIFFICULTIES = [
    'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
    'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon'
  ];

  // Kept exactly as in the beta — do not tune these.
  const MIN_DOWNLOADS = 2000, MAX_DOWNLOADS = 100000000;
  const MIN_LIKES = 1, MAX_LIKES = 4000000;
  const NOT_FOUND = "We didn't find that! Try something else";

  const API_BASE = 'https://gdbrowser.com/api';
  const HISTORY_API = 'https://history.geometrydash.eu/api/v1/search/level/advanced/';
  // Same-origin proxy from server.js. GDHistory has no browser CORS header.
  const HISTORY_PROXY = '/api/history';
  // Pointercrate caps limit at 100. Rank (`position`) and `rated_position`
  // differ for some demons, so three pages cover both top-150 rankings.
  const LIST_URLS = [
    'https://pointercrate.com/api/v2/demons/listed/?limit=100',
    'https://pointercrate.com/api/v2/demons/listed/?limit=50&after=100',
    'https://pointercrate.com/api/v2/demons/listed/?limit=50&after=150'
  ];
  const SEARCH_COUNT = 15;
  const TIMEOUT_MS = 10000;
  const MAX_ATTEMPTS = 2;
  const BEST_KEY = 'gdkrillion.best.v1';
  const MUTE_KEY = 'gdkrillion.muted.v1';
  const SHOW_TIER_KEY = 'gdkrillion.showTierNames.v1';
  const SHOW_EXACT_KEY = 'gdkrillion.showExactNumbers.v1';
  const LEGACY_SHOW_DIFFICULTY_KEY = 'gdkrillion.showDifficulty.v1';
  const API_CACHE_KEY = 'gdkrillion.apiCache.v1';
  const API_CACHE_TTL = 10 * 60 * 1000;
  const API_CACHE_MAX = 60;

  // Three of these rotate into every run after the two baseline questions.
  const BONUS_GROUPS = [
    'gauntlet', 'creator', 'length', 'stars',
    'featured', 'epic', 'twoPlayer', 'official', 'numberName', 'shortName',
    'nameShape', 'platformer'
  ];

  // Offset logarithm: same min/max boundaries as the beta, but a much more
  // forgiving curve — ten times the old offset keeps popular levels afloat.
  const RARITY_SOFTNESS = 100;

  // OpenKrillion's six fixed tier point values become 0–100 score bands here.
  // They label the score AFTER a round; they are never prompt difficulties.
  // The top band is deliberately tiny: One in a Krillion starts at 99%.
  const TIERS = [
    { key: 'plankton', name: 'PLANKTON', score: 10, min: 0, max: 10, color: '#8fa3c4', blurb: 'The answer everyone blurts out.' },
    { key: 'tooclever', name: 'TOO CLEVER', score: 15, min: 11, max: 15, color: '#ff9f43', blurb: 'The obscure pick everyone reaches for.' },
    { key: 'schooler', name: 'SCHOOLER', score: 30, min: 16, max: 30, color: '#4de3ff', blurb: 'Solid — swims with the school.' },
    { key: 'rare', name: 'RARE', score: 60, min: 31, max: 60, color: '#ff5252', blurb: 'An uncommon answer. Nice pull.' },
    { key: 'deepcut', name: 'DEEP CUT', score: 85, min: 61, max: 98, color: '#9d7bff', blurb: 'True obscurity. Few go this deep.' },
    { key: 'krillion', name: 'ONE IN A KRILLION', score: 100, min: 99, max: 100, color: '#ffd166', blurb: 'The designated gem. Trench floor.' }
  ];

  const DIFF_NAMES = {
    1: 'Auto', 2: 'Easy', 3: 'Normal', 4: 'Hard', 5: 'Harder', 6: 'Insane',
    7: 'Demon', 8: 'Easy Demon', 9: 'Medium Demon', 10: 'Hard Demon',
    11: 'Insane Demon', 12: 'Extreme Demon'
  };
  const LEN_NAMES = { 0: 'Tiny', 1: 'Short', 2: 'Medium', 3: 'Long', 4: 'XL', 5: 'Plat' };

  // Filler words are ignored when retrying a long level name with a short query.
  const FUZZY_STOP_WORDS = new Set([
    'the', 'a', 'an', 'but', 'and', 'ig', 'idk', 'i', 'guess', 'id', 'level', 'my', 'is', 'it'
  ]);
  const FUZZY_MIN_SCORE = 0.62;

  const API_MESSAGES = {
    network: "GDBrowser couldn't be reached. Check your connection and try again.",
    timeout: 'GDBrowser took too long to respond. Try again.',
    rate: 'GDBrowser is busy right now. Wait a moment and try again.',
    server: 'GDBrowser is having server trouble. Try again shortly.',
    http: 'GDBrowser returned an unexpected response. Try again.',
    data: 'GDBrowser sent unreadable data. Try again.'
  };

  /* ------------------------------------------------------------------ *
   * State + helpers                                                     *
   * ------------------------------------------------------------------ */
  const state = {
    queue: [],
    roundIdx: 0,
    results: [],
    busy: false,
    started: false,
    showTierNames: true,
    showExactNumbers: false,
    offlineMode: false,
    currentFound: null,
    pendingSuggestion: null,
    bonusCursor: Math.floor(Math.random() * BONUS_GROUPS.length)
  };

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const compact = (s) => norm(s).replace(/[^a-z0-9]/g, '');
  const nameWords = (s) => String(s ?? '').trim().split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const hasLetters = (s) => /[\p{L}]/u.test(String(s ?? ''));
  const sameCompactEdge = (s) => {
    const key = compact(s);
    return key.length >= 2 && key[0] === key[key.length - 1];
  };
  const eq = (a, b) => norm(a) === norm(b);
  const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const num = (v) => Number(String(v ?? '').replace(/,/g, ''));
  const round2 = (n) => Math.round(n * 100) / 100;
  const sfx = (name) => { try { window.GDKSfx?.play(name); } catch { /* audio is optional */ } };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function fuzzyTokens(s) {
    return String(s ?? '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }
  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function nameSimilarity(a, b) {
    const ca = compact(a).slice(0, 100), cb = compact(b).slice(0, 100);
    if (!ca || !cb) return 0;
    if (ca === cb) return 1;
    if (ca.includes(cb) || cb.includes(ca)) {
      // A short word inside a long title is a weak hint, not a strong match.
      const ratio = Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length);
      return 0.35 + 0.65 * ratio;
    }
    const ta = new Set(fuzzyTokens(a)), tb = new Set(fuzzyTokens(b));
    let shared = 0, total = 0;
    for (const t of ta) {
      const w = Math.min(t.length, 12);
      total += w;
      if (tb.has(t)) shared += w;
    }
    for (const t of tb) if (!ta.has(t)) total += Math.min(t.length, 12);
    if (!shared || ![...ta].some((t) => tb.has(t) && t.length >= 3)) return 0;
    const tokenScore = shared / total;
    const editScore = 1 - editDistance(ca, cb) / Math.max(ca.length, cb.length);
    return Math.max(tokenScore, editScore * 0.9);
  }

  /* ------------------------------------------------------------------ *
   * Verified level catalog                                              *
   * ------------------------------------------------------------------ */
  const DATA = window.GDK_DATA || {};

  function fromCatalog(row) {
    const flags = Number(row[11]) || 0;
    return {
      id: String(row[0]),
      name: String(row[1] || ''),
      author: String(row[2] || ''),
      account: String(row[3] || 0),
      stars: Number(row[4]) || 0,
      difficulty: DIFF_NAMES[Number(row[5])] || '',
      length: LEN_NAMES[Number(row[6])] || '',
      downloads: Number(row[7]) || 0,
      likes: Number(row[8]) || 0,
      songID: String(row[9] || 0),
      official: Number(row[10]) || 0,
      featured: (flags & 1) !== 0,
      epic: (flags & 2) !== 0,
      twoPlayer: (flags & 4) !== 0,
      platformer: Number(row[6]) === 5 || (flags & 8) !== 0,
      source: 'snapshot'
    };
  }

  function fromGd(l) {
    return {
      id: String(l?.id ?? ''),
      name: String(l?.name ?? ''),
      author: String(l?.author ?? ''),
      account: String(l?.accountID ?? 0),
      stars: num(l?.stars),
      difficulty: difficultyOf(l),
      length: String(l?.length ?? ''),
      downloads: num(l?.downloads),
      likes: num(l?.likes),
      songID: String(l?.songID ?? l?.customSong ?? 0),
      official: num(l?.officialSong),
      featured: truthy(l?.featured) || eq(l?.rating, 'featured'),
      epic: truthy(l?.epic) || eq(l?.rating, 'epic'),
      legendary: truthy(l?.legendary) || eq(l?.rating, 'legendary'),
      twoPlayer: truthy(l?.twoPlayer),
      platformer: truthy(l?.platformer) || eq(l?.length, 'Plat'),
      source: 'gdbrowser'
    };
  }

  function fromHistory(h) {
    const flags = Number(h?.cache_featured || 0) > 0 ? 1 : 0;
    return {
      id: String(h?.online_id ?? ''),
      name: String(h?.cache_level_name ?? ''),
      author: String(h?.cache_username ?? ''),
      account: String(h?.cache_account_id ?? 0),
      stars: num(h?.cache_stars),
      difficulty: DIFF_NAMES[Number(h?.cache_filter_difficulty)] || '',
      length: LEN_NAMES[Number(h?.cache_length)] || '',
      downloads: num(h?.cache_downloads),
      likes: num(h?.cache_likes),
      songID: String(h?.cache_song_id ?? 0),
      // GDHistory is 0-based here; GDBrowser and the snapshot use 1-based IDs.
      official: (() => { const n = num(h?.cache_audiotrack); return n > 0 ? n + 1 : 0; })(),
      featured: Boolean(flags),
      epic: Number(h?.cache_epic || 0) > 0,
      twoPlayer: h?.cache_two_player === true,
      platformer: truthy(h?.cache_platformer) || Number(h?.cache_length) === 5,
      deleted: h?.is_deleted === true,
      public: h?.is_public !== false,
      searchAvailable: h?.cache_search_available !== false,
      source: 'gdhistory'
    };
  }

  // Unrated, deleted, inaccessible, auto and junk records are refused for
  // every question type — not just songs and creators.
  function isUsableLevel(l) {
    if (!l || !/^\d+$/.test(String(l.id)) || Number(l.id) <= 0) return false;
    if (typeof l.name !== 'string' || l.name.length < 1 || l.name.length > 80) return false;
    if (!/[\p{L}\p{N}]/u.test(l.name)) return false;
    if (!Number.isFinite(l.stars) || l.stars < 1) return false;
    if (!l.difficulty || /^(auto|n\/a)$/i.test(l.difficulty)) return false;
    if (!Number.isFinite(l.downloads) || l.downloads < MIN_DOWNLOADS || l.downloads >= 999999999) return false;
    if (!Number.isFinite(l.likes) || l.likes < 0 || l.likes > 50000000) return false;
    if (l.deleted === true || l.public === false || l.searchAvailable === false) return false;
    return true;
  }

  const catalog = (DATA.levels || []).map(fromCatalog).filter(isUsableLevel);
  const catalogByID = new Map(catalog.map((l) => [l.id, l]));
  const catalogByName = new Map();
  const catalogByCompact = new Map();
  for (const l of catalog) {
    const key = norm(l.name);
    const ck = compact(l.name);
    if (!catalogByName.has(key)) catalogByName.set(key, []);
    catalogByName.get(key).push(l);
    if (!catalogByCompact.has(ck)) catalogByCompact.set(ck, []);
    catalogByCompact.get(ck).push(l);
  }

  function catalogCandidates(query) {
    const key = norm(query);
    const ck = compact(query);
    if (catalogByName.has(key)) return catalogByName.get(key);
    if (catalogByCompact.has(ck)) return catalogByCompact.get(ck);
    return catalog.filter((l) => norm(l.name).startsWith(key) || compact(l.name).startsWith(ck)).slice(0, 20);
  }

  /* ------------------------------------------------------------------ *
   * Live indexes (snapshot first, then augmented from the APIs)          *
   * ------------------------------------------------------------------ */
  let demonIndex = {
    names: new Set((DATA.demons || []).map((d) => norm(d.name)).filter(Boolean)),
    ids: new Set((DATA.demons || []).map((d) => String(d.id)).filter(Boolean))
  };
  let gauntletIndex = new Map((DATA.gauntlets || []).map((g) =>
    [String(g.id), new Set((g.levels || []).map(String))]
  ));

  function addDemonData(data) {
    if (!Array.isArray(data)) return;
    for (const d of data) {
      const position = Number(d?.position ?? Infinity);
      const rated = Number(d?.rated_position ?? Infinity);
      // Accept list rank 1–150 or rated rank 1–150. Some demons sit below
      // position 150 while still being rated inside the top 150.
      if (position > 150 && rated > 150) continue;
      const name = norm(d?.name);
      const id = String(d?.level_id ?? '');
      if (name) demonIndex.names.add(name);
      if (id && id !== 'undefined' && id !== 'null') demonIndex.ids.add(id);
    }
  }
  function addGauntletData(data) {
    if (!Array.isArray(data)) return;
    for (const g of data) {
      if (!g || g.id == null || !Array.isArray(g.levels)) continue;
      gauntletIndex.set(String(g.id), new Set(g.levels.map(String)));
    }
  }
  function loadCachedIndexes() {
    const cache = readApiCache();
    for (const url of LIST_URLS) {
      const hit = cache[`index:${url}`];
      if (hit) addDemonData(hit.data);
    }
    const gauntlets = cache['index:gauntlets'];
    if (gauntlets) addGauntletData(gauntlets.data);
  }
  function refreshIndexes() {
    loadCachedIndexes();
    for (const url of LIST_URLS) {
      cachedFetchJSON(url, { attempts: 1, timeout: 5000 }, `index:${url}`)
        .then(({ data }) => addDemonData(data))
        .catch(() => { /* keep the verified snapshot */ });
    }
    cachedFetchJSON(`${API_BASE}/gauntlets`, { attempts: 1, timeout: 5000 }, 'index:gauntlets')
      .then(({ data }) => addGauntletData(data))
      .catch(() => { /* keep the verified snapshot */ });
  }

  function readBest() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch { return null; }
  }
  function writeBest(value) {
    try { localStorage.setItem(BEST_KEY, String(value)); } catch { /* storage disabled */ }
  }
  function readMuted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }
  function setMuted(value) {
    try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* storage disabled */ }
    if (window.GDKSfx) window.GDKSfx.enabled = !value;
    const btn = $('soundBtn');
    btn.classList.toggle('muted', value);
    btn.setAttribute('aria-pressed', String(value));
    btn.setAttribute('aria-label', value ? 'Unmute sounds' : 'Mute sounds');
    btn.title = value ? 'Sound off' : 'Sound on';
  }
  function readScoreDisplay() {
    let showTier = true, showExact = false;
    try {
      const tierRaw = localStorage.getItem(SHOW_TIER_KEY);
      const exactRaw = localStorage.getItem(SHOW_EXACT_KEY);
      const legacy = localStorage.getItem(LEGACY_SHOW_DIFFICULTY_KEY);
      if (tierRaw === null && exactRaw === null && legacy !== null) {
        showTier = legacy !== '0';
        showExact = legacy === '0';
        localStorage.setItem(SHOW_TIER_KEY, showTier ? '1' : '0');
        localStorage.setItem(SHOW_EXACT_KEY, showExact ? '1' : '0');
        localStorage.removeItem(LEGACY_SHOW_DIFFICULTY_KEY);
      } else {
        showTier = tierRaw === null ? true : tierRaw !== '0';
        showExact = exactRaw === '1';
      }
    } catch { /* storage disabled */ }
    if (!showTier && !showExact) showExact = true;
    return { showTier, showExact };
  }
  function setScoreDisplay(showTier, showExact, refresh = true) {
    showTier = Boolean(showTier);
    showExact = Boolean(showExact);
    if (!showTier && !showExact) showExact = true;
    state.showTierNames = showTier;
    state.showExactNumbers = showExact;
    try {
      localStorage.setItem(SHOW_TIER_KEY, showTier ? '1' : '0');
      localStorage.setItem(SHOW_EXACT_KEY, showExact ? '1' : '0');
    } catch { /* storage disabled */ }
    document.body.dataset.showTierNames = String(showTier);
    document.body.dataset.showExactNumbers = String(showExact);
    const tierToggle = $('showTierNamesToggle');
    const exactToggle = $('showExactNumbersToggle');
    if (tierToggle) tierToggle.checked = showTier;
    if (exactToggle) exactToggle.checked = showExact;
    if (refresh) refreshScoreDisplays();
  }

  function fmt(n) { return Number(n).toLocaleString(); }
  function avgOf(list) {
    return list.length ? list.reduce((sum, r) => sum + r.total, 0) / list.length : 0;
  }
  function tierForScore(score) {
    const value = Math.max(0, Math.min(100, Number(score) || 0));
    for (let i = TIERS.length - 1; i >= 0; i--) {
      if (value >= TIERS[i].min) return TIERS[i];
    }
    return TIERS[0];
  }
  function displayScore(score) {
    const tier = tierForScore(score).name;
    const exact = Number(score).toFixed(2);
    if (state.showTierNames && state.showExactNumbers) return `${tier} · ${exact}`;
    return state.showTierNames ? tier : exact;
  }
  function scoreSubText() {
    if (state.showTierNames && state.showExactNumbers) return 'TIER · OUT OF 100.00';
    return state.showTierNames ? 'DIFFICULTY REACHED' : 'OUT OF 100.00';
  }
  function setScoreText(el, score) {
    if (!el) return;
    el.textContent = displayScore(score);
    el.classList.toggle('is-tier', state.showTierNames);
  }
  function setAvgText() {
    const el = $('hudAvg');
    if (!el) return;
    if (!state.results.length) {
      el.textContent = '--.--';
      el.classList.remove('is-tier');
    } else {
      setScoreText(el, avgOf(state.results));
    }
  }
  function quipFor(score) {
    const key = tierForScore(score).key;
    if (key === 'krillion') return 'The designated gem. Trench floor!';
    if (key === 'deepcut') return 'True obscurity. Few go this deep.';
    if (key === 'rare') return 'An uncommon answer. Nice pull.';
    if (key === 'schooler') return 'Solid — swims with the school.';
    if (key === 'tooclever') return 'A clever pick, but not as obscure as it looks.';
    return 'The answer everyone blurts out.';
  }

  // Re-label numbers already on screen when a score-display switch flips.
  function renderResultScores() {
    const average = avgOf(state.results);
    const tier = tierForScore(average);
    const results = $('resultsScreen');
    if (results) results.dataset.tier = tier.key;
    setScoreText($('finalScore'), average);
    $('finalTier').textContent = `${tier.name} · ${tier.score} PTS`;

    const bestEl = $('bestScore');
    if (state.bestDisplay == null) {
      bestEl.textContent = '--.--';
      bestEl.classList.remove('is-tier');
    } else {
      setScoreText(bestEl, state.bestDisplay);
    }

    const columns = $('chart') ? Array.from($('chart').children) : [];
    columns.forEach((column, i) => {
      const label = column.lastElementChild;
      const r = state.results[i];
      if (!label || !r) return;
      label.textContent = `R${i + 1} · ${displayScore(r.total)}`;
      label.classList.toggle('is-tier', state.showTierNames);
    });

    const rows = $('summary') ? Array.from($('summary').children) : [];
    rows.forEach((li, i) => {
      const r = state.results[i];
      if (!r) return;
      li.dataset.tier = tierForScore(r.total).key;
      setScoreText(li.querySelector('.sum-score'), r.total);
    });
  }

  function refreshScoreDisplays() {
    setAvgText();
    const card = $('roundResult');
    if (card && !card.hidden && state.currentFound) {
      setScoreText($('roundScore'), state.currentFound.total);
      $('scoreSub').textContent = scoreSubText();
    }
    if ($('resultsScreen') && !$('resultsScreen').hidden) renderResultScores();
  }

  /* ------------------------------------------------------------------ *
   * Rarity — beta boundaries, much softer log, no question weights       *
   * ------------------------------------------------------------------ */
  function calculateRarity(value, min, max) {
    value = Math.max(min, Math.min(max, value));
    const offset = min * RARITY_SOFTNESS;
    const low = Math.log(min + offset);
    const position = (Math.log(value + offset) - low) / (Math.log(max + offset) - low);
    return Math.max(0, Math.min(100, 100 * (1 - position)));
  }

  function rarityOf(downloads, likes) {
    likes = Math.abs(Number(likes) || 0);
    downloads = Math.max(0, Number(downloads) || 0);
    const d = calculateRarity(Math.max(downloads, MIN_DOWNLOADS), MIN_DOWNLOADS, MAX_DOWNLOADS);
    const l = likes === 0 ? 100 : calculateRarity(likes, MIN_LIKES, MAX_LIKES);
    return { d, l, levelTotal: (d + l) / 2 };
  }

  /* ------------------------------------------------------------------ *
   * Network helpers                                                     *
   * ------------------------------------------------------------------ */
  class ApiError extends Error {
    constructor(kind) { super(API_MESSAGES[kind] || API_MESSAGES.http); this.kind = kind; }
  }

  async function fetchJSON(url, options = {}) {
    const attempts = options.attempts || MAX_ATTEMPTS;
    const timeout = options.timeout || TIMEOUT_MS;
    let last = new ApiError('network');
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        if (res.status === 429) throw new ApiError('rate');
        if (res.status >= 500) throw new ApiError('server');
        if (!res.ok) throw new ApiError('http');
        try {
          return await res.json();
        } catch {
          throw new ApiError('data');
        }
      } catch (err) {
        if (err instanceof ApiError) last = err;
        else if (err && err.name === 'AbortError') last = new ApiError('timeout');
        else last = new ApiError('network');
        const retryable = ['rate', 'server', 'timeout', 'network'].includes(last.kind);
        if (!retryable || attempt === attempts - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw last;
  }

  function extractList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const key of ['levels', 'results', 'data']) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return [];
  }

  function readApiCache() {
    try {
      const raw = localStorage.getItem(API_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      return cache && typeof cache === 'object' ? cache : {};
    } catch { return {}; }
  }
  function writeApiCache(cache) {
    try {
      const keys = Object.keys(cache).sort((a, b) => (cache[b].t || 0) - (cache[a].t || 0));
      const trimmed = {};
      for (const key of keys.slice(0, API_CACHE_MAX)) trimmed[key] = cache[key];
      localStorage.setItem(API_CACHE_KEY, JSON.stringify(trimmed));
    } catch { /* storage disabled or full */ }
  }
  async function cachedFetchJSON(url, options = {}, cacheKey = url) {
    const cache = readApiCache();
    const hit = cache[cacheKey];
    const fresh = hit && Date.now() - (hit.t || 0) < API_CACHE_TTL;
    if (fresh) return { data: hit.data, cached: true };
    try {
      const data = await fetchJSON(url, options);
      cache[cacheKey] = { t: Date.now(), data };
      writeApiCache(cache);
      setOfflineMode(false);
      return { data, cached: false };
    } catch (err) {
      if (hit) {
        setOfflineMode(true);
        return { data: hit.data, cached: true, stale: true };
      }
      setOfflineMode(true);
      throw err;
    }
  }

  // GDBrowser normally returns the full difficulty ("Easy Demon"), but some
  // responses split demons into difficulty + demonDifficulty. Handle both.
  function difficultyOf(level) {
    const base = String(level?.difficulty ?? level?.diff ?? '').trim();
    const sub = String(level?.demonDifficulty ?? level?.demon ?? '').trim();
    if (!base) return sub ? sub : '';
    if (/^demon$/i.test(base)) {
      if (!sub) return base;
      return /demon/i.test(sub) ? sub : `${sub} Demon`;
    }
    return base;
  }

  /* ------------------------------------------------------------------ *
   * Questions                                                           *
   * ------------------------------------------------------------------ */
  function makeQuestion(cfg) {
    const pool = catalog.filter((l) => cfg.matches(l));
    if (!pool.length && !cfg.allowEmptyPool) return null;
    return {
      id: cfg.id,
      type: cfg.type,
      category: cfg.category,
      value: cfg.value,
      diff: cfg.diff,
      lead: cfg.lead,
      tail: cfg.tail || '',
      hint: typeof cfg.hint === 'function' ? cfg.hint(pool, cfg) : (cfg.hint || ''),
      matches: cfg.matches,
      reason: cfg.reason || (() => String(cfg.value)),
      tag: cfg.tag || String(cfg.value).toUpperCase(),
      poolSize: pool.length
    };
  }

  function buildQuestionBank() {
    const bank = {};

    bank.difficulty = DIFFICULTIES.map((d) => makeQuestion({
      id: `diff:${d}`, type: 'difficulty', category: 'DIFFICULTY', value: d,
      diff: d, lead: 'Name a', tail: 'level',
      hint: () => `Any rated ${d} level counts. Obscure picks score higher.`,
      matches: (l) => eq(l.difficulty, d),
      reason: (l) => l.difficulty
    })).filter(Boolean);

    bank.listDemon = [makeQuestion({
      id: 'list:demon', type: 'listDemon', category: 'DEMON LIST', value: 'List Demon',
      lead: 'Name a', tail: '',
      hint: () => 'Any demon ranked in the current top 150 (list position or rated rank) counts.',
      matches: (l) =>
        demonIndex.ids.has(l.id) ||
        (demonIndex.names.has(norm(l.name)) && /demon/i.test(l.difficulty)),
      reason: () => 'Demon List',
      tag: 'LIST DEMON',
      allowEmptyPool: true
    })].filter(Boolean);

    bank.gauntlet = (DATA.gauntlets || []).slice(0, 26).map((g) => makeQuestion({
      id: `gauntlet:${g.id}`, type: 'gauntlet', category: 'GAUNTLET', value: g.name,
      lead: 'Name a level from the', tail: 'Gauntlet',
      hint: () => `One of the five hand-picked ${g.name} Gauntlet levels.`,
      matches: (l) => {
        const ids = gauntletIndex.get(String(g.id));
        return (ids || new Set((g.levels || []).map(String))).has(l.id);
      },
      reason: () => `${g.name} Gauntlet`,
      tag: 'GAUNTLET'
    })).filter(Boolean);

    bank.creator = (DATA.creators || []).map((c) => makeQuestion({
      id: `creator:${c.account}`, type: 'creator', category: 'CREATOR', value: c.name,
      lead: 'Name a rated level by', tail: '',
      hint: () => 'Name one of their rated levels.',
      matches: (l) => c.account && l.account !== '0'
        ? String(l.account) === String(c.account)
        : eq(l.author, c.name),
      reason: (l) => `by ${l.author}`,
      tag: 'CREATOR'
    })).filter(Boolean);

    const traits = [];
    for (const value of ['Tiny', 'Short', 'Medium', 'Long', 'XL']) {
      traits.push({
        id: `len:${value}`, type: 'length', category: 'LEVEL TRAIT', value,
        lead: 'Name a', tail: 'level',
        hint: () => `A ${value.toLowerCase()} rated level will do.`,
        matches: (l) => eq(l.length, value),
        reason: () => value,
        tag: value.toUpperCase()
      });
    }
    for (const value of [10, 9, 8]) {
      traits.push({
        id: `stars:${value}`, type: 'stars', category: 'LEVEL TRAIT', value,
        lead: 'Name a level worth', tail: 'stars',
        hint: () => `Any fully rated ${value}-star level will do.`,
        matches: (l) => Number(l.stars) === value,
        reason: () => `${value} stars`,
        tag: `${value} STARS`
      });
    }
    traits.push(
      { id: 'trait:featured', type: 'featured', category: 'LEVEL TRAIT', value: 'Featured', lead: 'Name a', tail: 'level',
        hint: () => 'Any featured rated level counts.', matches: (l) => l.featured === true, reason: () => 'Featured', tag: 'FEATURED' },
      { id: 'trait:epic', type: 'epic', category: 'LEVEL TRAIT', value: 'Epic', lead: 'Name an', tail: 'level',
        hint: () => 'Any epic rated level counts.', matches: (l) => l.epic === true, reason: () => 'Epic', tag: 'EPIC' },
      { id: 'trait:twoPlayer', type: 'twoPlayer', category: 'LEVEL TRAIT', value: '2-player', lead: 'Name a', tail: 'level',
        hint: () => 'Any rated 2-player level counts.', matches: (l) => l.twoPlayer === true, reason: () => '2-player', tag: '2P' },
      { id: 'trait:official', type: 'official', category: 'GD TRIVIA', value: 'official soundtrack', lead: 'Name a level using an', tail: 'official song',
        hint: () => 'Any rated level using an official soundtrack song counts.', matches: (l) => Number(l.official) > 0, reason: () => 'Official song', tag: 'OST' },
      { id: 'trait:number', type: 'numberName', category: 'GD TRIVIA', value: 'number in its name', lead: 'Name a level with a', tail: '',
        hint: () => 'Any rated level with a number in its name counts.', matches: (l) => /\d/.test(l.name), reason: () => 'Number in name', tag: 'NUMBER' },
      { id: 'trait:short', type: 'shortName', category: 'GD TRIVIA', value: 'short name', lead: 'Name a level with a', tail: '',
        hint: () => 'Any rated level with a 4–6 character name counts.', matches: (l) => compact(l.name).length >= 4 && compact(l.name).length <= 6, reason: () => 'Short name', tag: 'SHORT NAME' },
      { id: 'shape:2', type: 'nameShape', category: 'NAME SHAPE', value: '2 words', lead: 'Name a level with', tail: '',
        hint: () => 'Any rated level whose name has exactly 2 words counts.', matches: (l) => nameWords(l.name) === 2, reason: () => '2 words in name', tag: '2 WORDS' },
      { id: 'shape:3', type: 'nameShape', category: 'NAME SHAPE', value: '3 words', lead: 'Name a level with', tail: '',
        hint: () => 'Any rated level whose name has exactly 3 words counts.', matches: (l) => nameWords(l.name) === 3, reason: () => '3 words in name', tag: '3 WORDS' },
      { id: 'shape:4', type: 'nameShape', category: 'NAME SHAPE', value: '4 words', lead: 'Name a level with', tail: '',
        hint: () => 'Any rated level whose name has exactly 4 words counts.', matches: (l) => nameWords(l.name) === 4, reason: () => '4 words in name', tag: '4 WORDS' },
      { id: 'shape:caps', type: 'nameShape', category: 'NAME SHAPE', value: 'ALL-CAPS level', lead: 'Name an', tail: '',
        hint: () => 'Any rated level whose letters are all uppercase counts.', matches: (l) => hasLetters(l.name) && l.name === l.name.toUpperCase(), reason: () => 'ALL-CAPS name', tag: 'ALL CAPS' },
      { id: 'shape:lower', type: 'nameShape', category: 'NAME SHAPE', value: 'lowercase level', lead: 'Name a', tail: '',
        hint: () => 'Any rated level whose letters are all lowercase counts.', matches: (l) => hasLetters(l.name) && l.name === l.name.toLowerCase(), reason: () => 'lowercase name', tag: 'LOWERCASE' },
      { id: 'shape:edges', type: 'nameShape', category: 'NAME SHAPE', value: 'same letter', lead: 'Name a level that starts and ends with the', tail: '',
        hint: () => 'Any rated level whose compact name starts and ends with the same letter counts.', matches: (l) => sameCompactEdge(l.name), reason: () => 'Same first/last letter', tag: 'SAME LETTER' },
      { id: 'trait:platformer', type: 'platformer', category: 'GD TRIVIA', value: 'platformer level', lead: 'Name a', tail: '',
        hint: () => 'Any rated platformer level counts.', matches: (l) => l.platformer === true || eq(l.length, 'Plat'), reason: () => 'Platformer', tag: 'PLATFORMER' }
    );
    bank.trait = [];
    for (const cfg of traits) {
      const q = makeQuestion(cfg);
      if (!q) continue;
      bank.trait.push(q);
      if (!bank[cfg.type]) bank[cfg.type] = [];
      bank[cfg.type].push(q);
    }
    return bank;
  }

  const BANK = buildQuestionBank();

  function pickFrom(group) {
    const list = BANK[group] || [];
    return list.length ? pick(list) : BANK.trait[0];
  }

  function buildQueue() {
    // One List Demon, one difficulty, plus three rotating categories.
    // Each bonus category is guaranteed a slot across consecutive runs, so a
    // short session still sees real variety instead of only the famous traits.
    const start = state.bonusCursor;
    const extras = [0, 1, 2].map((i) => BONUS_GROUPS[(start + i) % BONUS_GROUPS.length]);
    state.bonusCursor = (start + 3) % BONUS_GROUPS.length;
    return shuffle([
      pickFrom('listDemon'),
      pickFrom('difficulty'),
      ...extras.map(pickFrom)
    ]);
  }

  function pickMatch(list, question, query) {
    const good = list.filter((l) => isUsableLevel(l) && question.matches(l));
    if (!good.length) return null;
    const exact = good.filter((l) => norm(l.name) === norm(query) || compact(l.name) === compact(query));
    return exact[0] || null;
  }

  async function historyCandidates(query) {
    const qs = `?query=${encodeURIComponent(query)}&limit=25`;
    // Try the same-origin live proxy first. A static host without server.js
    // falls through to the direct GDHistory request, then to the snapshot.
    for (const endpoint of [HISTORY_PROXY, HISTORY_API]) {
      try {
        const data = await fetchJSON(`${endpoint}${qs}`, { attempts: 1, timeout: 6000 });
        const hits = data && Array.isArray(data.hits) ? data.hits : [];
        if (hits.length) return hits.map(fromHistory).filter(isUsableLevel);
      } catch {
        /* try the next GDHistory route */
      }
    }
    return [];
  }

  async function resolveAnswer(query, question, seen = {}) {
    let gdbError = null;
    try {
      showStatus('SEARCHING GDBROWSER…', 'loading');
      const result = await cachedFetchJSON(
        `${API_BASE}/search/${encodeURIComponent(query)}?count=${SEARCH_COUNT}`,
        {},
        `search:${norm(query)}`
      );
      if (result.cached) showStatus(result.stale ? 'USING STALE CACHE…' : 'USING CACHED SEARCH…', 'loading');
      seen.gdb = extractList(result.data).map(fromGd);
      const match = pickMatch(seen.gdb, question, query);
      if (match) return { level: match, source: 'GDBROWSER' };
    } catch (err) {
      gdbError = err;
    }

    showStatus('CHECKING GDHISTORY…', 'loading');
    seen.history = await historyCandidates(query);
    const histMatch = pickMatch(seen.history, question, query);
    if (histMatch) return { level: histMatch, source: 'GDHISTORY' };

    showStatus('CHECKING VERIFIED SNAPSHOT…', 'loading');
    const snapMatch = pickMatch(catalogCandidates(query), question, query);
    if (snapMatch) return { level: snapMatch, source: 'SNAPSHOT' };

    if (gdbError) throw gdbError;
    return null;
  }

  // When the strict name check fails, look for a close level that would still
  // satisfy the round. Nothing is accepted automatically — the player gets a
  // "Did you mean?" confirmation with the exact level name.
  async function findSuggestion(query, question, seen = {}) {
    const candidates = [];
    let nearMiss = null;

    const consider = (level, source) => {
      const score = nameSimilarity(query, level.name);
      if (score <= 0) return;
      if (!nearMiss || score > nearMiss.score) nearMiss = { level, score };
      if (score < FUZZY_MIN_SCORE) return;
      if (!isUsableLevel(level)) return;
      if (!question.matches(level)) return;
      candidates.push({ level, source, score });
    };

    for (const level of seen.gdb || []) consider(level, 'GDBROWSER');
    for (const level of seen.history || []) consider(level, 'GDHISTORY');
    for (const level of catalog) consider(level, 'SNAPSHOT');

    // Long or oddly worded titles can miss GDBrowser's search. Retry with the
    // first meaningful words, then just the first word, until something close
    // turns up. This is what recovers titles like "limbo but uwu ig idk".
    const words = fuzzyTokens(query);
    const meaningful = words.filter((w) => !FUZZY_STOP_WORDS.has(w));
    const retries = [];
    if (meaningful.length > 1) retries.push(meaningful.slice(0, 2).join(' '));
    if (meaningful.length) retries.push(meaningful[0]);
    if (!meaningful.length && words.length) retries.push(words[0]);
    for (const short of [...new Set(retries)]) {
      if (!short || norm(short) === norm(query)) continue;
      try {
        showStatus('CHECKING SIMILAR NAMES…', 'loading');
        const result = await cachedFetchJSON(
          `${API_BASE}/search/${encodeURIComponent(short)}?count=${SEARCH_COUNT}`,
          { attempts: 1, timeout: 6000 },
          `search:${norm(short)}`
        );
        if (result.cached) showStatus('USING CACHED SEARCH…', 'loading');
        for (const level of extractList(result.data).map(fromGd)) consider(level, 'GDBROWSER');
      } catch {
        /* keep whatever local candidates we already found */
      }
      if (candidates.length) break;
    }

    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length) return candidates[0];
    if (nearMiss && nearMiss.score >= 0.85) return { mismatch: nearMiss.level };
    return null;
  }

  /* ------------------------------------------------------------------ *
   * UI helpers                                                          *
   * ------------------------------------------------------------------ */
  function showStatus(message, kind = '') {
    const el = $('status');
    el.textContent = message || '';
    if (kind) el.dataset.kind = kind;
    else delete el.dataset.kind;
  }

  function setOfflineMode(on) {
    state.offlineMode = Boolean(on);
    document.body.dataset.offline = String(state.offlineMode);
    const banner = $('offlineBanner');
    if (banner) banner.hidden = !state.offlineMode;
  }

  function setBusy(on) {
    state.busy = on;
    $('submitBtn').disabled = on;
    $('levelInput').disabled = on;
    $('answerForm').setAttribute('aria-busy', String(on));
    $('submitBtn').classList.toggle('loading', on);
    $('submitLabel').textContent = on ? 'SEARCHING' : 'SUBMIT';
  }

  function shakeDock() {
    const dock = $('answerForm');
    dock.classList.remove('shake');
    void dock.offsetWidth;
    dock.classList.add('shake');
  }

  function clearSuggestion() {
    state.pendingSuggestion = null;
    const box = $('suggestion');
    if (!box) return;
    box.hidden = true;
    $('suggestYes').textContent = '';
  }
  function showSuggestion(suggestion) {
    state.pendingSuggestion = suggestion;
    $('suggestYes').textContent = suggestion.level.name;
    $('suggestion').hidden = false;
    showStatus('');
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  function renderDots() {
    const wrap = $('roundDots');
    wrap.replaceChildren();
    for (let i = 0; i < ROUNDS; i++) {
      const dot = document.createElement('i');
      if (i < state.roundIdx) {
        dot.className = 'done';
        const color = state.results[i]
          ? tierForScore(state.results[i].total).color
          : TIERS[2].color;
        dot.style.setProperty('--dot-color', color);
      } else if (i === state.roundIdx) {
        dot.className = 'active';
      }
      wrap.append(dot);
    }
  }

  function updateHud(phaseLabel) {
    $('hudRound').textContent = String(Math.min(state.roundIdx + 1, ROUNDS));
    setAvgText();
    if (phaseLabel) $('hudPhase').textContent = phaseLabel;
    $('usedCount').textContent = String(state.results.length);
    renderDots();
  }

  /* ------------------------------------------------------------------ *
   * Game flow                                                           *
   * ------------------------------------------------------------------ */
  function startGame() {
    state.queue = buildQueue();
    refreshIndexes();
    state.roundIdx = 0;
    state.results = [];
    setOfflineMode(false);
    state.currentFound = null;
    state.bestDisplay = null;
    state.started = true;
    sfx('start');

    document.body.dataset.phase = 'play';
    $('introScreen').hidden = true;
    $('resultsScreen').hidden = true;
    $('playScreen').hidden = false;
    showQuestion();
  }

  function renderQuestion(q) {
    const heading = $('promptText');
    heading.replaceChildren();
    heading.append(document.createTextNode(`${q.lead} `));
    const chip = document.createElement('span');
    chip.className = 'diff-chip';
    chip.id = 'targetDiff';
    chip.textContent = String(q.value);
    if (q.diff) chip.dataset.diff = q.diff;
    else delete chip.dataset.diff;
    heading.append(chip);
    if (q.tail) heading.append(document.createTextNode(` ${q.tail}`));

    $('promptHint').textContent = q.hint;
    $('promptKind').textContent = q.category;
    $('promptCard').dataset.qtype = q.type;
    $('promptCard').dataset.qvalue = String(q.value);
  }

  function showQuestion() {
    const question = state.queue[state.roundIdx];
    $('promptRound').textContent = String(state.roundIdx + 1);
    renderQuestion(question);

    $('levelInput').value = '';
    $('promptCard').hidden = false;
    $('usedLine').hidden = false;
    $('promptCard').style.animation = 'none';
    void $('promptCard').offsetWidth;
    $('promptCard').style.animation = '';
    $('answerForm').hidden = false;
    $('answerForm').classList.remove('shake');
    $('roundResult').hidden = true;
    clearSuggestion();
    showStatus('');
    setBusy(false);
    updateHud('NAME A LEVEL');

    requestAnimationFrame(() => { try { $('levelInput').focus(); } catch { /* noop */ } });
  }

  function acceptLevel(level, source, question) {
    const id = String(level.id);
    const rarity = rarityOf(level.downloads, level.likes);
    const total = round2(rarity.levelTotal);
    const found = {
      id,
      name: level.name,
      author: level.author || 'Unknown',
      difficulty: level.difficulty || question.value,
      qTag: question.tag,
      qText: `${question.lead} ${question.value} ${question.tail}`.replace(/\s+/g, ' ').trim(),
      matchReason: `${question.reason(level)}${source === 'GDBROWSER' ? '' : ` · ${source}`}`,
      tier: tierForScore(total),
      source,
      downloads: level.downloads,
      likes: level.likes,
      d: rarity.d,
      l: rarity.l,
      levelTotal: rarity.levelTotal,
      total
    };
    state.results.push(found);
    sfx('success');
    renderRoundResult(found);
    return true;
  }

  async function submitGuess(event) {
    if (event) event.preventDefault();
    if (state.busy || !state.started || $('answerForm').hidden) return;

    const query = $('levelInput').value.trim();
    if (!query) {
      showStatus('Enter a level name.', 'error');
      shakeDock();
      sfx('error');
      return;
    }

    const question = state.queue[state.roundIdx];
    const seen = {};
    setBusy(true);
    sfx('search');

    try {
      const resolved = await resolveAnswer(query, question, seen);
      if (!resolved) {
        const suggestion = await findSuggestion(query, question, seen);
        if (suggestion && suggestion.level) {
          showSuggestion(suggestion);
          sfx('error');
          return;
        }
        if (suggestion && suggestion.mismatch) {
          showStatus(`Found ${suggestion.mismatch.name}, but it doesn't fit this round.`, 'error');
        } else {
          showStatus(NOT_FOUND, 'error');
        }
        shakeDock();
        sfx('error');
        return;
      }
      clearSuggestion();
      acceptLevel(resolved.level, resolved.source, question);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : API_MESSAGES.http, 'error');
      shakeDock();
      sfx('error');
    } finally {
      setBusy(false);
    }
  }

  function renderRoundResult(found) {
    const tier = found.tier;
    const card = $('roundResult');
    card.dataset.tier = tier.key;
    $('roundTier').textContent = `${tier.name} · ${tier.score} PTS`;

    $('foundName').textContent = found.name;
    $('foundMeta').textContent =
      `By ${found.author} · ${found.difficulty} · ID ${found.id} · ` +
      `${fmt(found.downloads)} downloads, ${fmt(found.likes)} likes`;
    $('foundMatch').textContent = `MATCHED · ${found.matchReason}`;
    state.currentFound = found;
    setScoreText($('roundScore'), found.total);
    $('scoreSub').textContent = scoreSubText();
    $('landQuip').textContent = quipFor(found.total);
    $('dlScore').textContent = found.d.toFixed(2);
    $('lkScore').textContent = found.l.toFixed(2);
    $('dlMeter').style.width = `${found.d.toFixed(2)}%`;
    $('lkMeter').style.width = `${found.l.toFixed(2)}%`;
    $('nextBtn').textContent = state.roundIdx + 1 === ROUNDS ? 'SEE FINAL SCORE' : 'NEXT ROUND';

    $('promptCard').hidden = true;
    $('usedLine').hidden = true;
    $('answerForm').hidden = true;
    showStatus('');
    card.hidden = false;
    updateHud('LEVEL FOUND');

    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
    const score = $('roundScore');
    score.classList.remove('slam');
    void score.offsetWidth;
    score.classList.add('slam');

    requestAnimationFrame(() => { try { $('nextBtn').focus(); } catch { /* noop */ } });
  }

  function nextStep() {
    if (state.busy || $('roundResult').hidden) return;
    state.roundIdx++;
    if (state.roundIdx < ROUNDS) {
      sfx('next');
      return showQuestion();
    }
    showResults();
  }

  function showResults() {
    const average = avgOf(state.results);
    const previous = readBest();
    const isBest = previous == null || average > previous;
    if (isBest) writeBest(average);
    sfx('results');
    if (isBest) sfx('best');

    document.body.dataset.phase = 'results';
    $('playScreen').hidden = true;
    $('resultsScreen').hidden = false;
    state.bestDisplay = isBest ? average : previous;

    const chart = $('chart');
    chart.replaceChildren();
    state.results.forEach((r, i) => {
      const column = document.createElement('div');
      column.className = 'dive-column';
      column.style.setProperty('--dot-color', tierForScore(r.total).color);
      const stem = document.createElement('div');
      stem.className = 'dive-stem';
      stem.style.setProperty('--drop', `${Math.max(8, r.total)}px`);
      const dot = document.createElement('div');
      dot.className = 'dive-dot';
      const label = document.createElement('span');
      column.append(stem, dot, label);
      chart.append(column);
    });

    const summary = $('summary');
    summary.replaceChildren();
    state.results.forEach((r, i) => {
      const li = document.createElement('li');
      const diff = document.createElement('span');
      diff.className = 'sum-diff';
      diff.dataset.diff = r.qTag === r.difficulty ? r.difficulty : '';
      diff.textContent = r.qTag || r.difficulty;
      diff.title = r.qText || '';
      const name = document.createElement('span');
      name.className = 'sum-name';
      name.textContent = `${i + 1}. ${r.name}`;
      const score = document.createElement('span');
      score.className = 'sum-score';
      li.append(diff, name, score);
      summary.append(li);
    });

    renderResultScores();
    updateHud('DIVE COMPLETE');
    requestAnimationFrame(() => { try { $('resultsScreen').focus(); } catch { /* noop */ } });
  }

  async function shareResult() {
    const average = avgOf(state.results);
    const lines = state.results.map((r, i) => {
      const tierName = tierForScore(r.total).name;
      const exact = r.total.toFixed(2);
      const score = state.showTierNames && state.showExactNumbers
        ? `${tierName} (${exact})`
        : state.showTierNames ? tierName : exact;
      return `${i + 1}. ${r.qText} — ${r.name} (${score})`;
    });
    const tierName = tierForScore(average).name;
    const headline = state.showTierNames && state.showExactNumbers
      ? `${tierName} · ${average.toFixed(2)} average rarity over 5 rounds!`
      : state.showTierNames
        ? `${tierName} difficulty over 5 rounds!`
        : `${average.toFixed(2)} average rarity over 5 rounds!`;
    const text = `GD Krillion ${VERSION} — ${headline}\n${lines.join('\n')}\nTry to beat it!`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy failed');
      }
      toast('RESULT COPIED');
    } catch {
      toast('COPY FAILED — TRY AGAIN');
    }
  }

  /* ------------------------------------------------------------------ *
   * Wiring                                                              *
   * ------------------------------------------------------------------ */
  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('nextBtn').addEventListener('click', nextStep);
  $('shareBtn').addEventListener('click', shareResult);
  $('answerForm').addEventListener('submit', submitGuess);
  $('helpBtn').addEventListener('click', () => openDialog($('helpDialog')));
  $('helpClose').addEventListener('click', () => $('helpDialog').close());
  $('settingsBtn').addEventListener('click', () => openDialog($('settingsDialog')));
  $('settingsClose').addEventListener('click', () => $('settingsDialog').close());
  $('showTierNamesToggle').addEventListener('change', (event) => {
    setScoreDisplay(event.target.checked, state.showExactNumbers);
    sfx('next');
  });
  $('showExactNumbersToggle').addEventListener('change', (event) => {
    setScoreDisplay(state.showTierNames, event.target.checked);
    sfx('next');
  });
  $('soundBtn').addEventListener('click', () => {
    const muted = !readMuted();
    setMuted(muted);
    if (!muted) sfx('next');
  });
  setMuted(readMuted());
  const display = readScoreDisplay();
  setScoreDisplay(display.showTier, display.showExact, false);

  for (const id of ['helpDialog', 'settingsDialog']) {
    $(id).addEventListener('click', (event) => {
      if (event.target === $(id)) $(id).close();
    });
  }
  $('suggestYes').addEventListener('click', () => {
    if (!state.pendingSuggestion || state.busy || $('answerForm').hidden) return;
    const { level, source } = state.pendingSuggestion;
    const question = state.queue[state.roundIdx];
    clearSuggestion();
    setBusy(true);
    try {
      if (acceptLevel(level, source, question)) sfx('next');
    } finally {
      setBusy(false);
    }
  });
  $('suggestNo').addEventListener('click', () => {
    clearSuggestion();
    try { $('levelInput').focus(); } catch { /* noop */ }
  });
  $('levelInput').addEventListener('input', () => {
    clearSuggestion();
    if ($('status').dataset.kind === 'error') showStatus('');
  });
})();
