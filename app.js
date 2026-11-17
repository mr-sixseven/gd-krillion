/* GD Krillion 1.0.0 — five-round rare-level game.
 * Vanilla JS with synthesized Web Audio sound effects.
 * Rarity boundaries are unchanged from the beta; the curve is a softer log.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants                                                           *
   * ------------------------------------------------------------------ */
  const VERSION = '1.0.0';
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
  const SEARCH_COUNT = 10;
  const TIMEOUT_MS = 10000;
  const MAX_ATTEMPTS = 3;
  const BEST_KEY = 'gdkrillion.best.v1';
  const MUTE_KEY = 'gdkrillion.muted.v1';

  // Rarity curve softness: the offset inside the logarithm keeps the exact
  // same min/max boundaries while making mid-range levels score higher.
  const RARITY_SOFTNESS = 10;

  // Question banks. Values are chosen to be well-known and easy to answer.
  const LIST_URL = 'https://pointercrate.com/api/v2/demons/listed/?limit=100';
  const FALLBACK_LIST = [
    'GRIEF', 'Artemis 13', 'Society', 'Thinking Space II', 'Amethyst', 'Flamewall',
    'Tidal Wave', 'Slaughterhouse', 'Acheron', 'Abyss of Darkness', 'Kyouki',
    'Anathema', 'Bloodbath', 'Cataclysm', 'Nine Circles', 'Deadlocked',
    'Sakupen Circles', 'Sonic Wave', 'Aeternus', 'Tartarus', 'Zodiac',
    'Yatagarasu', 'Erebus', 'Digital Descent', 'Artificial Ascent'
  ];
  const SONGS = [
    { value: 'At the Speed of Light', author: 'Dimrain47', id: 467339, example: 'Bloodbath' },
    { value: 'HyperioxX', author: 'ParagonX9', id: 223469, example: 'Bloodbath Z' },
    { value: 'F-777 - Sonic Blaster', author: 'F-777', id: 574484, example: 'Sonic Wave' },
    { value: 'Deadlocked', author: 'RobTop', official: 20, example: 'Deadlocked auto' },
    { value: 'Stereo Madness', author: 'RobTop', official: 1, example: 'Stereo Madness X' }
  ];
  const TRAITS = [
    { type: 'length', value: 'Tiny', lead: 'Name a', tail: 'level', hint: 'Short and common — try a small level.', matches: (l) => eq(l.length, 'Tiny') },
    { type: 'length', value: 'Short', lead: 'Name a', tail: 'level', hint: 'Look for a compact level.', matches: (l) => eq(l.length, 'Short') },
    { type: 'length', value: 'Medium', lead: 'Name a', tail: 'level', hint: 'A mid-sized level will do.', matches: (l) => eq(l.length, 'Medium') },
    { type: 'length', value: 'Long', lead: 'Name a', tail: 'level', hint: 'Most classic levels are long.', matches: (l) => eq(l.length, 'Long') },
    { type: 'length', value: 'XL', lead: 'Name a', tail: 'level', hint: 'Extra-long levels are common among well-known ones.', matches: (l) => eq(l.length, 'XL') },
    { type: 'stars', value: 10, lead: 'Name a level worth', tail: 'stars', hint: 'Fully rated levels are usually worth 10.', matches: (l) => Number(l.stars) === 10 },
    { type: 'stars', value: 9, lead: 'Name a level worth', tail: 'stars', hint: 'Look for a level rated nine stars.', matches: (l) => Number(l.stars) === 9 },
    { type: 'featured', value: 'Featured', lead: 'Name a', tail: 'level', hint: 'Plenty of popular levels are featured.', matches: (l) => truthy(l.featured) || eq(l.rating, 'featured') },
    { type: 'epic', value: 'Epic', lead: 'Name an', tail: 'level', hint: 'Epic levels are highlighted in-game.', matches: (l) => truthy(l.epic) || eq(l.rating, 'epic') },
    { type: 'legendary', value: 'Legendary', lead: 'Name a', tail: 'level', hint: 'Legendary levels are rare but well known.', matches: (l) => truthy(l.legendary) || eq(l.rating, 'legendary') },
    { type: 'twoPlayer', value: '2-player', lead: 'Name a', tail: 'level', hint: 'Levels built for two players.', matches: (l) => truthy(l.twoPlayer) },
    { type: 'platformer', value: 'Platformer', lead: 'Name a', tail: 'level', hint: 'A level made in the 2.2 platformer mode.', matches: (l) => truthy(l.platformer) },
    { type: 'gameVersion', value: '2.1', lead: 'Name a', tail: 'level', hint: 'Most modern levels were made in 2.1.', matches: (l) => eq(l.gameVersion, '2.1') },
    { type: 'gameVersion', value: '2.0', lead: 'Name a', tail: 'level', hint: 'Older levels were made in 2.0.', matches: (l) => eq(l.gameVersion, '2.0') },
    { type: 'coins', value: 3, lead: 'Name a level with', tail: 'user coins', hint: 'Many rated levels hide three coins.', matches: (l) => Number(l.coins) === 3 },
    { type: 'coins', value: 2, lead: 'Name a level with', tail: 'user coins', hint: 'Look for a level with two collectable coins.', matches: (l) => Number(l.coins) === 2 }
  ];

  const TIER_COLORS = { gold: '#ffd166', cyan: '#4de3ff', pink: '#ff5d8f', muted: '#7d93b8' };
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
    used: new Set(),
    busy: false,
    started: false
  };

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const eq = (a, b) => norm(a) === norm(b);
  const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const sfx = (name) => { try { window.GDKSfx?.play(name); } catch { /* audio is optional */ } };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Demon List index: starts with a curated fallback, then refreshes from
  // Pointercrate in the background when a run begins.
  let listIndex = {
    names: new Set(FALLBACK_LIST.map(norm)),
    ids: new Set()
  };

  function refreshListIndex() {
    fetchJSON(LIST_URL, { attempts: 1, timeout: 5000 }).then((data) => {
      if (!Array.isArray(data) || !data.length) return;
      // Augment the curated baseline rather than replacing it, so a later
      // failed refresh can never narrow the set of accepted demons.
      for (const d of data) {
        const name = norm(d.name);
        if (name) listIndex.names.add(name);
        const id = String(d.level_id ?? '');
        if (id && id !== 'undefined' && id !== 'null') listIndex.ids.add(id);
      }
    }).catch(() => { /* keep the curated fallback */ });
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

  function fmt(n) { return Number(n).toLocaleString(); }
  function avgOf(list) {
    return list.length ? list.reduce((sum, r) => sum + r.total, 0) / list.length : 0;
  }
  function tierFor(score) {
    if (score >= 80) return 'gold';
    if (score >= 60) return 'cyan';
    if (score >= 40) return 'pink';
    return 'muted';
  }
  function quipFor(score) {
    if (score >= 90) return 'A genuine deep cut. Krillion territory!';
    if (score >= 75) return 'Rare catch. That is a strong dive.';
    if (score >= 50) return 'A solid find. Keep going deeper.';
    if (score >= 25) return 'Familiar waters — try something more obscure.';
    return 'Everyone knows that one. Go deeper next time.';
  }

  /* ------------------------------------------------------------------ *
   * Rarity — same boundaries as the beta, softer logarithmic curve      *
   * ------------------------------------------------------------------ */
  function calculateRarity(value, min, max) {
    value = Math.max(min, Math.min(max, value));
    const offset = min * RARITY_SOFTNESS;
    const low = Math.log(min + offset);
    const position = (Math.log(value + offset) - low) / (Math.log(max + offset) - low);
    const r = 100 * (1 - position);
    return Math.max(0, Math.min(100, r));
  }

  function rarityOf(downloads, likes) {
    likes = Math.abs(Number(likes) || 0);
    downloads = Math.max(0, Number(downloads) || 0);
    const d = calculateRarity(Math.max(downloads, MIN_DOWNLOADS), MIN_DOWNLOADS, MAX_DOWNLOADS);
    const l = likes === 0 ? 100 : calculateRarity(likes, MIN_LIKES, MAX_LIKES);
    return { d, l, total: (d + l) / 2 };
  }

  /* ------------------------------------------------------------------ *
   * GDBrowser access with timeout, retry and clear errors               *
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

  function isWantedDifficulty(level, wanted) {
    return norm(difficultyOf(level)) === norm(wanted);
  }

  /* ------------------------------------------------------------------ *
   * Questions                                                           *
   * ------------------------------------------------------------------ */
  function difficultyQuestion(difficulty) {
    return {
      type: 'difficulty', category: 'DIFFICULTY', value: difficulty, diff: difficulty,
      lead: 'Name a', tail: 'level',
      hint: 'Any level with this difficulty counts. Obscure ones score bigger.',
      matches: (l) => isWantedDifficulty(l, difficulty),
      reason: (l) => difficultyOf(l) || difficulty,
      tag: difficulty
    };
  }

  function songQuestion(song) {
    return {
      type: 'song', category: 'SONG', value: song.value,
      lead: 'Name a level that uses', tail: '',
      hint: `Try ${song.example} — or any level using this track.`,
      matches: (l) =>
        (song.id != null && String(l.songID ?? l.customSong) === String(song.id)) ||
        (song.official != null && Number(l.officialSong) === song.official) ||
        norm(l.songName).includes(norm(song.value)),
      reason: () => song.value,
      tag: 'SONG'
    };
  }

  function listDemonQuestion() {
    return {
      type: 'listDemon', category: 'DEMON LIST', value: 'List Demon',
      lead: 'Name a', tail: '',
      hint: 'Any demon on the current top-100 community Demon List counts.',
      matches: (l) =>
        listIndex.ids.has(String(l.id)) ||
        (listIndex.names.has(norm(l.name)) && /demon/i.test(difficultyOf(l))),
      reason: () => 'Demon List',
      tag: 'LIST DEMON'
    };
  }

  function traitQuestion(cfg) {
    return {
      type: cfg.type, category: 'LEVEL TRAIT', value: cfg.value,
      lead: cfg.lead, tail: cfg.tail, hint: cfg.hint,
      matches: cfg.matches,
      reason: () => String(cfg.value),
      tag: String(cfg.value).toUpperCase()
    };
  }

  function buildQueue() {
    // Every run contains one song, one Demon List and one difficulty prompt,
    // plus two different level traits — shuffled so no run feels the same.
    return shuffle([
      songQuestion(pick(SONGS)),
      listDemonQuestion(),
      difficultyQuestion(pick(DIFFICULTIES)),
      ...shuffle(TRAITS.map(traitQuestion)).slice(0, 2)
    ]);
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
        const color = state.results[i] ? TIER_COLORS[tierFor(state.results[i].total)] : TIER_COLORS.cyan;
        dot.style.setProperty('--dot-color', color);
      } else if (i === state.roundIdx) {
        dot.className = 'active';
      }
      wrap.append(dot);
    }
  }

  function updateHud(phaseLabel) {
    $('hudRound').textContent = String(Math.min(state.roundIdx + 1, ROUNDS));
    $('hudAvg').textContent = state.results.length ? avgOf(state.results).toFixed(2) : '--.--';
    if (phaseLabel) $('hudPhase').textContent = phaseLabel;
    $('usedCount').textContent = String(state.used.size);
    renderDots();
  }

  /* ------------------------------------------------------------------ *
   * Game flow                                                           *
   * ------------------------------------------------------------------ */
  function startGame() {
    state.queue = buildQueue();
    refreshListIndex();
    state.roundIdx = 0;
    state.results = [];
    state.used = new Set();
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
    showStatus('');
    setBusy(false);
    updateHud('NAME A LEVEL');

    requestAnimationFrame(() => { try { $('levelInput').focus(); } catch { /* noop */ } });
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
    setBusy(true);
    showStatus('SEARCHING GDBROWSER…', 'loading');
    sfx('search');

    try {
      const data = await fetchJSON(
        `${API_BASE}/search/${encodeURIComponent(query)}?count=${SEARCH_COUNT}`
      );
      const list = extractList(data);

      // Check every returned result (the beta only looked at the first three).
      const candidates = list.filter((level) =>
        level && level.id && question.matches(level)
      );
      if (!candidates.length) {
        showStatus(NOT_FOUND, 'error');
        shakeDock();
        sfx('error');
        return;
      }

      // Prefer an exact name match, then keep GDBrowser's relevance order.
      const exact = candidates.filter((level) => norm(level.name) === norm(query));
      const match = (exact.length ? exact : candidates)[0];
      const id = String(match.id);

      if (state.used.has(id)) {
        showStatus('You already used that level. Try something else.', 'error');
        shakeDock();
        sfx('error');
        return;
      }

      let downloads = match.downloads;
      let likes = match.likes;
      if (downloads == null || likes == null) {
        showStatus('LOADING LEVEL DATA…', 'loading');
        const full = await fetchJSON(`${API_BASE}/level/${encodeURIComponent(id)}`);
        if (!full || typeof full !== 'object') throw new ApiError('data');
        if (downloads == null) downloads = full.downloads;
        if (likes == null) likes = full.likes;
      }
      if (!Number.isFinite(Number(downloads)) || !Number.isFinite(Number(likes))) {
        showStatus('That level came back with incomplete data. Try another.', 'error');
        shakeDock();
        sfx('error');
        return;
      }

      downloads = Math.max(0, Number(downloads));
      likes = Math.abs(Number(likes) || 0);

      state.used.add(id);
      const rarity = rarityOf(downloads, likes);
      const found = {
        id,
        name: String(match.name || 'Unknown level'),
        author: String(match.author || 'Unknown'),
        difficulty: difficultyOf(match) || question.value,
        qTag: question.tag,
        qText: `${question.lead} ${question.value} ${question.tail}`.replace(/\s+/g, ' ').trim(),
        matchReason: question.reason(match),
        downloads,
        likes,
        ...rarity
      };
      state.results.push(found);
      sfx('success');
      renderRoundResult(found);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : API_MESSAGES.http, 'error');
      shakeDock();
      sfx('error');
    } finally {
      setBusy(false);
    }
  }

  function renderRoundResult(found) {
    const tier = tierFor(found.total);
    const card = $('roundResult');
    card.dataset.tier = tier;

    $('foundName').textContent = found.name;
    $('foundMeta').textContent =
      `By ${found.author} · ${found.difficulty} · ID ${found.id} · ` +
      `${fmt(found.downloads)} downloads, ${fmt(found.likes)} likes`;
    $('foundMatch').textContent = `MATCHED · ${found.matchReason}`;
    $('roundScore').textContent = found.total.toFixed(2);
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

    // Restart the score/arrival animations for each round.
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
    const tier = tierFor(average);
    const previous = readBest();
    const isBest = previous == null || average > previous;
    if (isBest) writeBest(average);
    sfx('results');
    if (isBest) sfx('best');

    document.body.dataset.phase = 'results';
    $('playScreen').hidden = true;
    $('resultsScreen').dataset.tier = tier;
    $('resultsScreen').hidden = false;
    $('finalScore').textContent = average.toFixed(2);
    $('bestScore').textContent = (isBest ? average : previous).toFixed(2);

    // Dive profile chart: five columns, one per round.
    const chart = $('chart');
    chart.replaceChildren();
    state.results.forEach((r, i) => {
      const column = document.createElement('div');
      column.className = 'dive-column';
      column.style.setProperty('--dot-color', TIER_COLORS[tierFor(r.total)]);
      const stem = document.createElement('div');
      stem.className = 'dive-stem';
      stem.style.setProperty('--drop', `${Math.max(8, r.total)}px`);
      const dot = document.createElement('div');
      dot.className = 'dive-dot';
      const label = document.createElement('span');
      label.textContent = `R${i + 1} · ${r.total.toFixed(0)}`;
      column.append(stem, dot, label);
      chart.append(column);
    });

    // Round log.
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
      score.textContent = r.total.toFixed(2);
      li.append(diff, name, score);
      summary.append(li);
    });

    updateHud('DIVE COMPLETE');
    requestAnimationFrame(() => { try { $('resultsScreen').focus(); } catch { /* noop */ } });
  }

  async function shareResult() {
    const average = avgOf(state.results);
    const lines = state.results.map((r, i) =>
      `${i + 1}. ${r.difficulty} — ${r.name} (${r.total.toFixed(2)})`
    );
    const text = `GD Krillion ${VERSION} — ${average.toFixed(2)} average rarity over 5 rounds!\n${lines.join('\n')}\nTry to beat it!`;

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
  function openHelp() {
    const dialog = $('helpDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('nextBtn').addEventListener('click', nextStep);
  $('shareBtn').addEventListener('click', shareResult);
  $('answerForm').addEventListener('submit', submitGuess);
  $('helpBtn').addEventListener('click', openHelp);
  $('helpClose').addEventListener('click', () => $('helpDialog').close());
  $('soundBtn').addEventListener('click', () => {
    const muted = !readMuted();
    setMuted(muted);
    if (!muted) sfx('next');
  });
  setMuted(readMuted());

  $('helpDialog').addEventListener('click', (event) => {
    if (event.target === $('helpDialog')) $('helpDialog').close();
  });

  $('levelInput').addEventListener('input', () => {
    if ($('status').dataset.kind === 'error') showStatus('');
  });
})();
