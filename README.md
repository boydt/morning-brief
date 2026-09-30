# Morning Brief

A static web page for Boyd's daily morning briefs. The briefs are written by April, Boyd's assistant. Today's brief is shown expanded at the top, and earlier days are listed underneath, collapsed. Every headline has a short code, a source link and a **More info** button. When April writes a deeper "deep dive" for a headline, it shows inside that headline's card.

This is plain HTML, CSS and JavaScript. It has **no server, no build step, no `.env` and no secrets**. Boyd publishes it himself by importing this repository into **Grok Build**. Nothing in this repo deploys anything.

**The published page reads its data live from this public GitHub repo.** New briefs and deep dives appear as soon as `tools/sync.sh` pushes them to `main`. **You only need to republish for design or code changes** (`index.html`, `assets/`), not for data.

## Structure
```
index.html              the page (at the repo root)
assets/config.js        data source settings (GitHub raw URL, repo/branch, bundled path, April's chat link)
assets/app.js           front-end logic (plain JS)
assets/styles.css       styles (light/dark via prefers-color-scheme, mobile-friendly)
assets/vendor/          marked 18.0.14 + DOMPurify 3.4.16 (local copies, MIT/Apache-2.0 licences included)
data/index.json         generated manifest of available days
data/YYYY-MM-DD.json    one file per day (written by April)
tools/build_index.py    copies real day files + regenerates data/index.json
tools/sync.sh           copy April's files → rebuild index → commit → git push origin main
tools/preview.sh        local static preview on http://127.0.0.1:8787/
tools/test/             Playwright checks (dev only; `npm install` there first)
```
## Where the page gets its data
Set in `assets/config.js` (`dataBaseUrl` = `https://raw.githubusercontent.com/boydt/morning-brief/main/data/`). For each file, the page tries these sources in order:
1. **GitHub raw, pinned to the latest commit on `main`.** The page resolves the commit with one call to `api.github.com/repos/boydt/morning-brief/commits/main` and then reads `raw.githubusercontent.com/boydt/morning-brief/<sha>/data/…?t=<now>` (`cache: 'no-store'`).
   - Commit-pinned URLs never go stale.
   - Plain `raw…/main/…` is cached by GitHub's CDN for up to 5 minutes, even with a unique `?t=` query.
2. **`dataBaseUrl` itself** (raw `main`, cache-busted). The page uses this when the GitHub API is unavailable, for example because of its limit of 60 unauthenticated requests per hour per IP. When the API reports it is rate-limited, the page stops calling it until the limit resets. In this mode, updates can take up to about 5 minutes to show.
3. **GitHub contents API** (`application/vnd.github.raw`), as a secondary source.
4. **The bundled `data/` copy that ships with the published site**, reached by relative paths. The top bar then shows a subtle "⚠ Offline copy" note.

There is **no background polling**. Data loads:
- when the page opens;
- when Boyd taps **↻ Refresh** in the top bar, which re-fetches without reloading, re-renders only the headline cards that changed, and keeps the reading position;
- once when the tab becomes visible again after being hidden for 10+ minutes. If that finds a new day's brief, a small "Show" banner appears instead of the page jumping.

All paths are relative (no leading slash), so the page works on any static host, in a sub-folder, or with `python3 -m http.server`.

## Data contract
`data/YYYY-MM-DD.json`:
```json
{
  "date": "2026-09-30", "title": "Morning Brief", "intro_md": "optional",
  "sections": [
    { "id": "world", "title": "World", "icon": "🌍", "body_md": "optional",
      "items": [
        { "id": "W1", "headline_md": "…", "summary_md": "…",
          "source": { "name": "Reuters", "url": "https://…" },
          "details_md": null, "details_updated": null }
      ] }
  ]
}
```
- **Section ids** (with default title and icon):

  | id | default title | default icon | item ids |
  | --- | --- | --- | --- |
  | `world` | World | 🌍 | W1, W2… |
  | `business` | Business | 💼 | B1… |
  | `games` | Games | 🎮 | G1… |
  | `emulation` | Video Game Emulation | 🕹️ | E1, E2… |
  | `ai` | AI | 🤖 | A1… |
  | `tech` | Tech | 💻 | T1… |
  | `markets` | Markets | 📈 | M1… |
  | `weather` | Weather | 🌤️ | X1–X3 |
  | `worth-reading` | Worth Reading | 📚 | R1… |

  - Sections appear in the order they are in the file. April puts `emulation` right after `games`. It covers PS5 and Switch 2 emulators running commercial games, decomp/recomp projects (r/decomp), and emulation legal news.
  - Missing icons and titles fall back to defaults. Unknown sections are shown with 📰, and missing optional fields are fine.
  - Weather can be one item per city (X1 Phoenix, X2 Show Low, X3 Snowflake) or `body_md`.
- **Item ids** are short codes that are unique within a day: W1, B2, G3, E1, A1, T1, M2, X1–X3, R1.
- **All text is Markdown.** It is rendered with marked and sanitized with DOMPurify, and links open in a new tab.
- **Deep dives:** `details_md` is rendered inside the item's card, directly under the headline, summary and source. Deep dives start **collapsed**: on load, on Refresh, and when a new one arrives. The card's button says **Show deep dive** / **Hide deep dive**. An expanded deep dive stays open through Refresh for the rest of that page session, but a reload collapses it again; the choice isn't saved. `details_updated` is an ISO time, either `Z` or `-07:00`, and is shown in Arizona time.
- **`data/index.json`** is generated by `tools/build_index.py`. Don't edit it by hand. Its format is `{"days":[{"date","title","headline_count","deep_dive_count"}], "generated_at"}`, newest first.
- **Sample files** (a title containing `(sample)`) and `requests.json` are never copied into this repo.

## More info (static)
There's no backend. Clicking **More info**:
1. **Copies** this message to the clipboard straight away, inside the click:
   > More info please on 2026-09-30 W1: <headline> (source: <url>). Please write the deep dive into details_md for item W1 in data/2026-09-30.json.

   It uses `navigator.clipboard.writeText`, with a hidden-textarea + `execCommand('copy')` fallback.
2. **Shows a toast** with the message in a selectable box, a **Copy again** button and an **Open April's chat** link (`grokbot://app/v1/agent?id=30d1a93b-3a8a-435f-8b71-efa1bd39e86a`).
   - Nothing opens automatically; Boyd clicks the link himself.
   - The Grok Bot link docs describe no message-prefill parameter, so none is used.
   - If copying fails, the toast says so and pre-selects the text.
3. The toast also says "April's answer will appear under this headline after you tap ↻ Refresh."
4. The button changes to "✓ Asked April · copy again". This is remembered only in this browser (localStorage).

After April writes `details_md` and `tools/sync.sh` has pushed it, Boyd taps **↻ Refresh** (or reloads). That headline's button then turns into **Show deep dive**, collapsed, and the view doesn't jump.

## Updating the data
April writes her day files to `/workspace/news-site/data/` for now. Then:
```bash
tools/sync.sh            # SRC=/other/dir tools/sync.sh to use another source folder
```
This copies the real days, rebuilds `data/index.json` and commits the changes. The commit is `Brief YYYY-MM-DD` for a new day, `Update deep dives` for deep-dive-only changes, or `Update brief …` otherwise. It then runs `git push origin main`. If the push fails, the script exits with status 1 and prints a clear message; the commit stays local and is pushed on the next run.

## Local preview
```bash
tools/preview.sh         # serves this folder on http://127.0.0.1:8787/ (python3 -m http.server, backgrounded)
tools/preview.sh stop
# or simply:  python3 -m http.server 8000   → http://127.0.0.1:8000/
```
Opening `index.html` straight from disk (`file://`) won't work, because browsers block `fetch` there. Use a local server.

## Tests
```bash
cd tools/test && npm install && LIVE=http://127.0.0.1:8787/ SHOTS=/tmp/mb-shots node site.test.mjs
```
The tests mock only `api.github.com`, because the box's shared IP is often rate-limited; `raw.githubusercontent.com` is fetched for real. They check:
- the page reads its data from GitHub, pinned to the latest commit;
- it falls back to raw `main` when the API is rate-limited, and to the bundled copy when GitHub is blocked;
- Refresh patches in a changed deep dive without moving the scroll position, and there is no idle polling;
- the page loads, with the history list collapsed and expanding when clicked;
- deep dives render inline;
- one click copies the exact message, with no popup or new window;
- the copy fallbacks work, and scroll stays stable;
- the layout works at 390 px wide;
- the site works when hosted in a sub-folder.

## Publishing
Boyd publishes the site through **Grok Build** by importing this repository (`main`). This repo has no hosting URL and no deploy config. After that, data updates need no republishing, because the page reads the public repo at runtime. Republish only after changing `index.html` or `assets/`.
The repo is **public**, so the briefs and deep dives in `data/` are readable by anyone. Anything published is also public unless Grok Build's own access controls are turned on.
