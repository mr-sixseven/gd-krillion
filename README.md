# GD Krillion 1.1.0

A five-round Geometry Dash rarity game with a much wider question catalog. Each round gives a different prompt — a difficulty, a Demon List demon, a Gauntlet, a creator, or another piece of rated-level trivia. Name a matching community level; GDBrowser verifies it live, with a verified offline snapshot as backup. Rarer levels (fewer downloads and likes) earn a higher score, and your final score is the average across all five rounds. Scores are shown as Krillion tier names by default; Settings can show exact numbers instead, or both together.

## Run

The whole project is a single `gd-krillion` folder with no subfolders — plain HTML, CSS and JavaScript, with no build step or dependencies.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly also works in most browsers; a local server is recommended so the manifest and font load predictably. The separate missing-letter prototype lives in `gap-prototype.html` and is not part of the main five-round game.

## What is preserved from the beta

- Five rounds. Levels may repeat across rounds.
- GDBrowser level search (`/api/search`), with clear timeout/rate-limit messages and local API caching.
- The exact same rarity **boundaries**:

  ```js
  downloads: min 2,000  → max 100,000,000
  likes:     min 1      → max 4,000,000   (0 likes scores 100)
  level rarity = (download rarity + like rarity) / 2
  ```

  A value at a range's minimum still scores 100; a value at its maximum still scores 0.

- Round results, final average score and Play Again restart.
- The original five-round feel, CRT/ocean visual language, keyboard support and results/restart flow.

## Question categories

Every run has one **Difficulty**, one **List Demon**, and three rotating bonus categories. The bonus rotation covers all of these, so short sessions still see real variety:

- **Difficulty** — one of the ten rated GD difficulties (Auto, Easy … Extreme Demon).
- **List Demon** — a demon ranked in the current Pointercrate top 150 by list position or rated rank, matched by level ID or name.
- **Gauntlet** — one of the five rated levels in a named Gauntlet, matched by Gauntlet level ID.
- **Creator** — a rated level by the named creator, matched by account ID.
- **Level traits** — Tiny–XL length, 8/9/10 stars, Featured, Epic, two-player.
- **GD trivia** — official soundtrack, a number in the level name, a short level name, 2/3/4-word names, ALL-CAPS or lowercase names, names that start and end with the same compact letter, and rated platformers.

**Game-version prompts (`2.0` / `2.1`) were removed.** Hints stay generic and never name a valid answer, so they guide without spoiling the trivia.

## Rarity and validity

The logarithmic curve is now a lot more forgiving — the offset is ten times the previous release:

```js
calculateRarity(v, min, max) = 100 * (1 - position)
offset    = min * RARITY_SOFTNESS        // RARITY_SOFTNESS = 100
position  = (log(clamp(v, min, max) + offset) - log(min + offset))
            / (log(max + offset) - log(min + offset))
```

At `v = min`, score 100; at `v = max`, score 0. Popular levels keep a respectable score instead of sinking immediately.

The round score is just the level rarity, rounded to two decimals. **Krillion tier names are score bands, not prompt difficulties.** They use OpenKrillion's six fixed point values (10 / 15 / 30 / 60 / 85 / 100) as 0–100 cutoffs, with the top band reserved for 99% and up:

| Tier | Score band | OpenKrillion points |
| --- | --- | ---: |
| PLANKTON | 0–10 | 10 |
| TOO CLEVER | 11–15 | 15 |
| SCHOOLER | 16–30 | 30 |
| RARE | 31–60 | 60 |
| DEEP CUT | 61–98 | 85 |
| ONE IN A KRILLION | 99–100 | 100 |

**Show Tier Names is on by default.** The HUD average, round landing, final score and round log show the tier name (e.g. `SCHOOLER`, `DEEP CUT`). Turn on **Show Exact Numbers** in Settings to show both the tier and `0.00`–`100.00`; turn tier names off for numbers only. At least one display always stays on, and the choice is saved on the browser. The tier labels the score you earned; it never changes which levels satisfy a prompt.

**Unrated levels never count.** Every candidate must be rated (`stars ≥ 1`), public, non-deleted, searchable, have a plausible download/like count, and pass the exact prompt check. Answers are accepted only when the submitted name matches the verified level name — partial text is never accepted silently. Levels can be reused across rounds.

If an exact name can't be verified, the app checks for close names in the live search results and the bundled snapshot, retrying GDBrowser with the first meaningful words of long titles (e.g. `limbo` from `limbo but uwu ig idk`). It then offers a **Did you mean …?** confirmation with the exact level name; nothing is accepted until you press Yes. A found level that doesn't fit the current prompt gets a specific "doesn't fit this round" message instead of a generic miss.

## Verified data fallback

`catalog.js` is a generated snapshot of **1,797 rated levels, 50 Gauntlets, 20 songs, 12 creators and 165 Demon List entries**. It is built from live public APIs, not invented data:

- [GDHistory](https://history.geometrydash.eu/api) advanced search — rated, public, non-deleted records and their stats. GDHistory's 0-based `cache_audiotrack` is converted to GDBrowser's 1-based `officialSong`.
- [GDBrowser](https://gdbrowser.com/api) — Gauntlet membership, exact level names, song names and official-song mapping.
- [Pointercrate](https://pointercrate.com/) — the current Demon List.

The app tries GDBrowser first, then a live GDHistory query, then the bundled snapshot. GDHistory currently has no browser CORS header, so `server.js` exposes a same-origin `/api/history` proxy that fetches the live API and returns it to the page. The app uses that proxy first; a plain static host falls back to a direct GDHistory request and then the bundled snapshot. GDBrowser searches, Pointercrate pages and Gauntlet data are cached in `localStorage` for 10 minutes, with stale cache reused if a later request fails. When live verification fails, the play screen shows `[NO INTERNET! DEFAULTING TO LOCAL LEVELS]`. Pointercrate's `position` and `rated_position` can differ (e.g. `limbo but uwu ig idk` sits at position 158 but rated rank 143), so three pages are fetched and either top-150 ranking is accepted.

Serve the game (including the live GDHistory fallback) with:

```sh
node server.js
# or: npm start
```

Static-only hosts still work, but will reach the bundled snapshot instead of live GDHistory because of browser CORS.

Regenerate the snapshot with:

```sh
python3 build-catalog.py
```

## Sound and interface

- Synthesized Web Audio cues (`audio.js`, `window.GDKSfx`) for start, search, next, success, error, results and personal best. No audio files are loaded.
- Header speaker button toggles sound; the choice is persisted under `gdkrillion.muted.v1`.
- Dynamic prompt cards show category and a contextual hint. Result cards show why the answer matched, download and like breakdowns, and the score band earned after the round.
- Robust loading states, shake feedback for invalid entries, personal best and shareable results.

## Credits

Geometry Dash is a game by RobTop Games. This is an unofficial fan project, not affiliated with RobTop Games or Krillion. Visual styling is adapted from the MIT-licensed [OpenKrillion](https://openkrillion.com) service; the bundled VT323 font is licensed under the SIL Open Font License (see `VT323-LICENSE.txt`).
