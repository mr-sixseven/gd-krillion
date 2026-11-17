# GD Krillion 1.0.0

A five-round Geometry Dash rarity game. Each round gives a different kind of prompt — a difficulty, a song, a Demon List demon, or a level trait. Name a matching community level; GDBrowser verifies it and its stats. Rarer levels (fewer downloads and likes) earn a higher score, and your final score is the average rarity across all five rounds.

## Run

No build step or dependencies — it is plain HTML, CSS and JavaScript.

```sh
cd gd-krillion
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly also works in most browsers; a local server is recommended so the manifest and font load predictably.

## What is preserved from the beta

- Five rounds and one-level-per-run duplicate prevention (by level ID).
- GDBrowser level search (`/api/search`) plus `/api/level` detail fallback.
- Difficulty validation — now one of several prompt types.
- The exact same rarity **boundaries**:

  ```js
  downloads: min 2,000  → max 100,000,000
  likes:     min 1      → max 4,000,000   (0 likes scores 100)
  round rarity = (download rarity + like rarity) / 2
  ```

  A value at a range's minimum still scores 100; a value at its maximum still scores 0.

- Round results, final average score and Play Again restart.

## Question types

Every run contains **one song prompt, one Demon List prompt, one difficulty prompt and two level traits**, shuffled. Hints always name at least one valid answer so the prompts stay approachable.

- **Difficulty** — name a level of the requested difficulty (one of the ten official GD difficulties, as in the beta).
- **Song** — name a level using the named track. Songs are well-known (`At the Speed of Light`, `HyperioxX`, `F-777 - Sonic Blaster`, `Deadlocked`, `Stereo Madness`) and validated via `songID` / `officialSong` / `songName`.
- **Demon List** — name a demon on the current top-100 community list. Fetched live from [Pointercrate](https://pointercrate.com/) (open CORS) and matched by level ID or name; a curated set of famous demons is always kept as an offline fallback.
- **Level traits** — length (`Tiny`–`XL`), star rating (9 or 10), `Featured` / `Epic` / `Legendary`, two-player, platformer, game version (`2.0` / `2.1`) and user coins (2 or 3).

Scoring is identical for every question type: the accepted level's download and like rarity are averaged as usual.

## What is new in V1

- Complete visual redesign inspired by [OpenKrillion](https://openkrillion.com): VT323 pixel type, CRT/vignette atmosphere, notched pixel frames, HUD pods, glowing difficulty chips and chunky arcade buttons. GD Krillion's own identity, name, icon and gameplay remain its own.
- **Softer rarity curve.** The endpoints are identical to the beta, but an offset inside the logarithm lifts mid-range scores so obscure-but-not-extreme levels are rewarded. `RARITY_SOFTNESS = 10`:

  ```js
  calculateRarity(v, min, max) = 100 * (1 - position)
  offset    = min * RARITY_SOFTNESS
  position  = (log(clamp(v, min, max) + offset) - log(min + offset))
              / (log(max + offset) - log(min + offset))
  ```

  At `v = min`, `position = 0` → score 100. At `v = max`, `position = 1` → score 0. In between, the curve is closer to linear than the beta's steep `log(v/min) / log(max/min)`, so the checks are less strict.

- **Sound effects via the Web Audio API** (`audio.js`, `window.GDKSfx`). All cues are synthesized at runtime with oscillators and noise buffers — there are no audio files to load. Cues play for start, search, next round, success, error, results and a new personal best. A speaker button in the header toggles sound on/off; the choice is persisted under `gdkrillion.muted.v1`. If `AudioContext` is unavailable, audio silently no-ops.
- Robust GDBrowser requests: 10-second timeout, retries on rate limits/server errors/network failures, and clear user-facing error messages.
- Loading states with a spinner and status line; shake feedback for invalid entries.
- Checks every search result (the beta only checked the first three), prefers exact name matches, and handles split `difficulty` / `demonDifficulty` responses.
- Dynamic prompt cards with a category label, contextual hint and a "MATCHED" badge on the result card showing why the level qualified. Round log chips show each prompt's category.
- Help dialog, personal best, shareable results, full keyboard/ARIA support and mobile-responsive layout.

Level data comes from GDBrowser. Geometry Dash is a game by RobTop Games. This is an unofficial fan project, not affiliated with RobTop Games or Krillion. Visual styling is adapted from the MIT-licensed OpenKrillion service; the bundled VT323 font is licensed under the SIL Open Font License (see `assets/VT323-LICENSE.txt`).
