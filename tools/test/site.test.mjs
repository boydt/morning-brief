// Playwright checks for the static Morning Brief site.
//   LIVE=http://127.0.0.1:8787/   (tools/preview.sh must be running)   SHOTS=<dir for screenshots>
// Also serves a throw-away fixture (repo copy + sample history days) from a SUB-FOLDER on :8795
// to prove relative paths work on any static host. Never modifies the repo.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE = process.env.LIVE || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || path.join(REPO, 'tools/test/results');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SAMPLES = process.env.SAMPLES || '/workspace/news-site/sample-data';
const DATA_MAIN = 'https://raw.githubusercontent.com/boydt/morning-brief/main/data/';
const CHAT = 'grokbot://app/v1/agent?id=30d1a93b-3a8a-435f-8b71-efa1bd39e86a';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (n, c, x = '') => { results.push({ name: n, pass: !!c, extra: String(x) }); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => { const p = path.join(SHOTS, name); await page.waitForTimeout(350); await page.screenshot({ path: p }); console.log('  screenshot', p); };

// ---- fixture: repo copy in a sub-folder + sample history days ----
const HOST = '/tmp/mb-fixture-host', FIX = path.join(HOST, 'morning-brief');
fs.rmSync(HOST, { recursive: true, force: true });
fs.mkdirSync(HOST, { recursive: true });
execFileSync('cp', ['-r', REPO, FIX]);
for (const d of ['.git', 'tools/test/node_modules']) fs.rmSync(path.join(FIX, d), { recursive: true, force: true });
const fixIndex = JSON.parse(fs.readFileSync(path.join(FIX, 'data/index.json'), 'utf8'));
for (const f of fs.existsSync(SAMPLES) ? fs.readdirSync(SAMPLES) : []) {
  const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (!m || fixIndex.days.some((d) => d.date === m[1])) continue;
  const day = JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
  fs.writeFileSync(path.join(FIX, 'data', f), JSON.stringify(day));
  fixIndex.days.push({ date: m[1], title: day.title, headline_count: day.sections.reduce((n, s) => n + (s.items || []).length, 0) });
}
fixIndex.days.sort((a, b) => (a.date < b.date ? 1 : -1));
fs.writeFileSync(path.join(FIX, 'data/index.json'), JSON.stringify(fixIndex));
const fixSrv = spawn('python3', ['-m', 'http.server', '8795', '--bind', '127.0.0.1', '--directory', HOST], { stdio: 'ignore' });
const FIXURL = 'http://127.0.0.1:8795/morning-brief/';
for (let i = 0; i < 50; i++) { try { if ((await fetch(FIXURL)).ok) break; } catch {} await sleep(100); }

// ---- expected message ----
const liveIndex = await (await fetch(new URL('data/index.json', LIVE))).json();
const TODAY = liveIndex.days[0].date;
const today = await (await fetch(new URL(`data/${TODAY}.json`, LIVE))).json();
const allItems = today.sections.flatMap((s) => s.items || []);
const plain = (s) => String(s).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
const expected = (date, it) => `More info please on ${date} ${it.id}: ${plain(it.headline_md)}${it.source && it.source.url ? ` (source: ${new URL(it.source.url).href})` : ''}. Please write the deep dive into details_md for item ${it.id} in data/${date}.json.`;
const firstNoDetails = allItems.filter((i) => !i.details_md);
const withDetails = allItems.find((i) => i.details_md);

// ---- remote (GitHub) helpers ----
const PIN_SHA = process.env.PIN_SHA || execFileSync('git', ['-C', REPO, 'rev-parse', 'origin/main']).toString().trim();
const isRemote = (u) => /^https:\/\/(raw\.githubusercontent\.com|api\.github\.com)\//.test(u);
// Mock ONLY the GitHub API (the box's shared IP is often rate-limited); raw.githubusercontent.com is real.
async function mockApi(ctx, mode = 'ok') {
  await ctx.route('https://api.github.com/**', (route) => {
    if (mode === 'ratelimited') return route.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) }, body: '{"message":"API rate limit exceeded"}' });
    if (/\/commits\//.test(route.request().url())) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: PIN_SHA });
    return route.abort();
  });
}
const blockRemote = (ctx) => ctx.route(/^https:\/\/(raw\.githubusercontent\.com|api\.github\.com)\//, (r) => r.abort('internetdisconnected'));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
async function newCtx(vp, { perms = true, origin, api = 'ok', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.isMobile, deviceScaleFactor: vp.dpr || 1 });
  if (offline) await blockRemote(ctx); else await mockApi(ctx, api);
  if (perms) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origin || new URL(LIVE).origin });
  const pages = []; ctx.on('page', (p) => pages.push(p));
  const page = await ctx.newPage(); pages.length = 0;
  const problems = [], requests = [];
  const expectRemoteFail = offline || api !== 'ok';
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !(expectRemoteFail && /Failed to load resource/.test(m.text()))) problems.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !(expectRemoteFail && isRemote(r.url()))) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('popup', (p) => problems.push('popup: ' + p.url()));
  return { ctx, page, pages, problems, requests };
}

try {
  for (const vp of [{ tag: 'desktop', width: 1280, height: 900 }, { tag: 'mobile', width: 390, height: 844, isMobile: true, dpr: 2 }]) {
    // ================= LIVE preview =================
    const { ctx, page, pages, problems, requests } = await newCtx(vp);
    await page.goto(LIVE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#today .card');
    {
      const pinned = `https://raw.githubusercontent.com/boydt/morning-brief/${PIN_SHA}/data/`;
      const usedRemote = requests.some((u) => u.startsWith(pinned + 'index.json?t=')) && requests.some((u) => u.startsWith(pinned + `${TODAY}.json?t=`));
      const usedLocal = requests.some((u) => /127\.0\.0\.1:\d+\/data\//.test(u));
      ok(`[${vp.tag}] data fetched at runtime from GitHub raw (pinned to main's commit, cache-busted), not the bundled copy`, usedRemote && !usedLocal && (await page.evaluate(() => [...window.__brief.state.round.sources].join(','))) === 'github',
        requests.filter(isRemote).map((u) => u.replace(/t=\d+/, 't=…')).join(' | '));
      ok(`[${vp.tag}] Refresh button in top bar, status shows live time`, (await page.locator('#refresh').isVisible()) && /Updated .* MST/.test(await page.locator('#status').innerText()));
    }
    const cards = await page.locator('#today .card').count();
    ok(`[${vp.tag}] today's real brief (${TODAY}) loads with all ${allItems.length} headlines`, cards === allItems.length && /today|latest/i.test(await page.locator('.day-kicker').innerText()), `${cards} cards; ${await page.locator('.day-date').innerText()}`);
    ok(`[${vp.tag}] not marked as sample`, (await page.locator('.pill.sample').count()) === 0);
    ok(`[${vp.tag}] every headline has badge, source link, button`, await page.evaluate(() => [...document.querySelectorAll('#today .card')].every((c) => c.querySelector('.badge') && c.querySelector('.btn') && (c.querySelector('.source a[target=_blank]') || true))));
    const histCount = liveIndex.days.length - 1;
    ok(`[${vp.tag}] history: ${histCount} previous real day(s), all collapsed`, (await page.locator('details.hday').count()) === histCount && (await page.evaluate(() => [...document.querySelectorAll('details.hday')].every((d) => !d.open))) && (await page.locator('#history').isHidden()) === (histCount === 0));
    ok(`[${vp.tag}] no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth}/${window.innerWidth}`));
    await shot(page, `${vp.tag}-today.png`);

    if (withDetails) {
      const c = page.locator(`[id="item-${TODAY}-${withDetails.id}"]`);
      const info = await c.evaluate((el) => { const d = el.querySelector('.deep'), hd = el.querySelector('.headline');
        return { deep: !!d, after: !!d && !!(hd.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING), strong: d ? d.querySelectorAll('strong').length : 0,
          links: d ? [...d.querySelectorAll('a')].every((a) => a.target === '_blank') : false, time: d && d.querySelector('time') ? d.querySelector('time').textContent : '' }; });
      ok(`[${vp.tag}] ${withDetails.id} deep dive renders inline inside its card under the headline`, info.deep && info.after && info.strong > 0 && info.links, JSON.stringify(info));
      ok(`[${vp.tag}] deep-dive time shown in Arizona time`, /MST$/.test(info.time), info.time);
      await page.evaluate((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }, `item-${TODAY}-${withDetails.id}`);
      await shot(page, `${vp.tag}-${withDetails.id}-deepdive.png`);
      // Toggle keeps the card in place.
      const t0 = await c.evaluate((el) => el.getBoundingClientRect().top);
      await c.locator('.btn').click();
      const t1 = await page.locator(`[id="item-${TODAY}-${withDetails.id}"]`).evaluate((el) => el.getBoundingClientRect().top);
      ok(`[${vp.tag}] hide/show deep dive keeps scroll stable`, Math.abs(t1 - t0) <= 1 && (await page.locator(`[id="item-${TODAY}-${withDetails.id}"] .deep`).count()) === 0, `${t0.toFixed(1)} → ${t1.toFixed(1)}`);
      await page.locator(`[id="item-${TODAY}-${withDetails.id}"] .btn`).click();
    }

    // More info: ONE click → clipboard has the text, toast shows it, nothing opens.
    const it = firstNoDetails[vp.tag === 'desktop' ? 0 : 5];
    const card = page.locator(`[id="item-${TODAY}-${it.id}"]`);
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
    const urlBefore = page.url();
    await card.locator('.btn').click();
    await page.waitForSelector('#toast.ok', { timeout: 3000 }).catch(() => {});
    await sleep(500);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ok(`[${vp.tag}] one click on More info (${it.id}) → clipboard holds the exact message`, clip === expected(TODAY, it), clip);
    ok(`[${vp.tag}] no popup / new window / navigation`, pages.length === 0 && page.url() === urlBefore && ctx.pages().length === 1, `pages=${ctx.pages().length} url=${page.url()}`);
    ok(`[${vp.tag}] toast: "Request copied" + selectable box with message`, /Request copied — paste it in April’s chat/.test(await page.locator('#toast-msg').innerText()) && (await page.locator('#toast-text').inputValue()) === clip);
    const link = page.locator('#toast-open');
    ok(`[${vp.tag}] toast: "Open April’s chat" link (href correct, no target, not auto-clicked)`, (await link.getAttribute('href')) === CHAT && (await link.getAttribute('target')) === null);
    await page.evaluate(() => navigator.clipboard.writeText('SENTINEL2'));
    await page.locator('#toast-copy').click(); await sleep(300);
    ok(`[${vp.tag}] toast says April's answer appears after tapping Refresh`, /April’s answer will appear under this headline after you tap ↻ Refresh/.test(await page.locator('#toast-hint').innerText()));
    ok(`[${vp.tag}] "Copy again" copies the message again`, (await page.evaluate(() => navigator.clipboard.readText())) === expected(TODAY, it) && /Copied/.test(await page.locator('#toast-copy').innerText()));
    await shot(page, `${vp.tag}-moreinfo-toast.png`);
    ok(`[${vp.tag}] button shows "Asked April" afterwards`, /Asked April/.test(await card.locator('.btn').innerText()));
    // Reload: asked state persists (localStorage) and scroll position is restored.
    await page.evaluate(() => window.scrollTo(0, 1500)); await sleep(100);
    const yBefore = await page.evaluate(() => window.scrollY);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#today .card'); await sleep(200);
    const yAfter = await page.evaluate(() => window.scrollY);
    ok(`[${vp.tag}] reload keeps reading position`, Math.abs(yAfter - yBefore) <= 2, `${yBefore} → ${yAfter}`);
    ok(`[${vp.tag}] "Asked April" persists across reload (this browser)`, /Asked April/.test(await page.locator(`[id="item-${TODAY}-${it.id}"] .btn`).innerText()));
    ok(`[${vp.tag}] no console errors / failed requests / popups on live preview`, problems.length === 0, problems.join('; '));
    await ctx.close();

    // ================= clipboard fallbacks =================
    { // Async Clipboard API missing → textarea + execCommand path.
      const { ctx: c2, page: p2, pages: pg2 } = await newCtx(vp);
      await c2.addInitScript(() => { window.__realClip = navigator.clipboard; Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true }); });
      await p2.goto(LIVE, { waitUntil: 'networkidle' });
      await p2.evaluate(() => window.__realClip.writeText('SENTINEL'));
      const it2 = firstNoDetails[1];
      await p2.locator(`[id="item-${TODAY}-${it2.id}"] .btn`).click(); await sleep(400);
      ok(`[${vp.tag}] fallback (no Clipboard API): execCommand copy puts the message on the clipboard`, (await p2.evaluate(() => window.__realClip.readText())) === expected(TODAY, it2) && (await p2.locator('#toast.ok').count()) === 1 && pg2.length === 0);
      await c2.close();
    }
    { // Everything fails → warning toast with the text pre-selected for manual copy.
      const { ctx: c3, page: p3, pages: pg3 } = await newCtx(vp, { perms: false });
      await c3.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => ({ writeText: () => Promise.reject(new Error('denied')) }), configurable: true }); document.execCommand = () => false; });
      await p3.goto(LIVE, { waitUntil: 'networkidle' });
      const it3 = firstNoDetails[2];
      await p3.locator(`[id="item-${TODAY}-${it3.id}"]`).scrollIntoViewIfNeeded();
      await p3.locator(`[id="item-${TODAY}-${it3.id}"] .btn`).click(); await sleep(400);
      const sel = await p3.evaluate(() => { const b = document.getElementById('toast-text'); return document.activeElement === b && b.selectionEnd - b.selectionStart === b.value.length; });
      ok(`[${vp.tag}] copy failure → warning toast, message box visible & pre-selected, Copy again + link present, nothing opened`,
        (await p3.locator('#toast.warn').count()) === 1 && (await p3.locator('#toast-text').inputValue()) === expected(TODAY, it3) && sel && (await p3.locator('#toast-copy').isVisible()) && (await p3.locator('#toast-open').getAttribute('href')) === CHAT && pg3.length === 0);
      await shot(p3, `${vp.tag}-moreinfo-copy-failed.png`);
      await c3.close();
    }

    // ================= remote: rate-limited API → raw main =================
    {
      const { ctx: c5, page: p5, requests: rq5, problems: pr5 } = await newCtx(vp, { api: 'ratelimited' });
      await p5.goto(LIVE, { waitUntil: 'networkidle' }); await p5.waitForSelector('#today .card');
      const src = await p5.evaluate(() => [...window.__brief.state.round.sources].join(','));
      const apiCalls1 = rq5.filter((u) => u.startsWith('https://api.github.com/')).length;
      await p5.locator('#refresh').click(); await p5.waitForFunction(() => !window.__brief.state.refreshing);
      const apiCalls2 = rq5.filter((u) => u.startsWith('https://api.github.com/')).length;
      ok(`[${vp.tag}] API rate-limited → reads raw main?t=… and stops calling the API`, src === 'github-main' && rq5.some((u) => u.startsWith(DATA_MAIN + 'index.json?t=')) && apiCalls1 === 1 && apiCalls2 === 1 && pr5.length === 0, `sources=${src} apiCalls=${apiCalls1}->${apiCalls2} ${pr5.join('; ')}`);
      await c5.close();
    }
    // ================= remote blocked → bundled fallback =================
    {
      const { ctx: c6, page: p6, requests: rq6, problems: pr6 } = await newCtx(vp, { offline: true });
      await p6.goto(LIVE, { waitUntil: 'networkidle' }); await p6.waitForSelector('#today .card');
      const st = await p6.locator('#status').innerText();
      ok(`[${vp.tag}] GitHub unreachable → bundled data/ copy + subtle "Offline copy" note`, (await p6.locator('#today .card').count()) === allItems.length && /Offline copy/.test(st) && rq6.some((u) => /127\.0\.0\.1:\d+\/data\/index\.json/.test(u)) && pr6.length === 0, `${st} ${pr6.join('; ')}`);
      await shot(p6, `${vp.tag}-offline-fallback.png`);
      await c6.close();
    }
    // ================= Refresh patches a changed deep dive without moving scroll =================
    {
      const { ctx: c7, page: p7, problems: pr7, requests: rq7 } = await newCtx(vp);
      let updated = null;
      await c7.route(/^https:\/\/raw\.githubusercontent\.com\/.*\/data\/\d{4}-\d{2}-\d{2}\.json/, async (route) => {
        if (!updated) return route.continue();
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(updated) });
      });
      await p7.goto(LIVE, { waitUntil: 'networkidle' }); await p7.waitForSelector('#today .card');
      await p7.locator('#refresh').click(); await p7.waitForFunction(() => !window.__brief.state.refreshing);
      ok(`[${vp.tag}] Refresh with nothing new → "no changes"`, /no changes/.test(await p7.locator('#status').innerText()));
      const target = firstNoDetails[3], reading = firstNoDetails[12];
      await p7.evaluate((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); el.__marker = 7; }, `item-${TODAY}-${reading.id}`);
      await sleep(100);
      const topBefore = await p7.locator(`[id="item-${TODAY}-${reading.id}"]`).evaluate((el) => el.getBoundingClientRect().top);
      const yBefore = await p7.evaluate(() => scrollY);
      updated = JSON.parse(JSON.stringify(today));
      const tItem = updated.sections.flatMap((x) => x.items).find((x) => x.id === target.id);
      tItem.details_md = `**Simulated update (test)**\n\n- first point\n- second point with a [link](https://example.com/x)\n\n` + 'Filler sentence to make the card taller. '.repeat(15);
      tItem.details_updated = '2026-09-30T17:30:00Z';
      const idxReqs = rq7.filter((u) => u.includes('/index.json')).length;
      await p7.locator('#refresh').click(); await p7.waitForFunction(() => !window.__brief.state.refreshing);
      const deep = p7.locator(`[id="item-${TODAY}-${target.id}"] .deep`);
      const topAfter = await p7.locator(`[id="item-${TODAY}-${reading.id}"]`).evaluate((el) => el.getBoundingClientRect().top);
      const yAfter = await p7.evaluate(() => scrollY);
      ok(`[${vp.tag}] Refresh patched ${target.id}'s new deep dive inline (no page reload)`, (await deep.count()) === 1 && (await deep.locator('li').count()) === 2 && /10:30 AM MST/.test(await deep.locator('time').innerText()) && rq7.filter((u) => u.includes('/index.json')).length === idxReqs + 1);
      ok(`[${vp.tag}] Refresh kept the reading position (card above grew, view did not jump)`, Math.abs(topAfter - topBefore) <= 1 && yAfter > yBefore, `top ${topBefore.toFixed(1)}→${topAfter.toFixed(1)}, scrollY ${yBefore}→${yAfter}`);
      ok(`[${vp.tag}] only the changed card was re-rendered`, await p7.evaluate((id) => document.getElementById(id).__marker === 7, `item-${TODAY}-${reading.id}`));
      ok(`[${vp.tag}] status reports the update`, /1 update/.test(await p7.locator('#status').innerText()));
      await p7.evaluate((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }, `item-${TODAY}-${target.id}`);
      await shot(p7, `${vp.tag}-refresh-patched-deepdive.png`);
      ok(`[${vp.tag}] refresh flow: no console errors`, pr7.length === 0, pr7.join('; '));
      await c7.close();
    }
    // ================= tab visible again after 10+ min → one quiet re-fetch =================
    {
      const { ctx: c8, page: p8, requests: rq8 } = await newCtx(vp);
      await p8.clock.install();
      await p8.goto(LIVE, { waitUntil: 'networkidle' }); await p8.waitForSelector('#today .card');
      await p8.evaluate(() => window.scrollTo(0, 2000));
      const vis = (v) => p8.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
      const count = () => rq8.filter((u) => u.includes('/index.json')).length;
      const n0 = count();
      await p8.clock.runFor(30 * 60 * 1000); await sleep(200);
      const idle = count() - n0;
      await vis('hidden'); await p8.clock.fastForward(5 * 60 * 1000); await vis('visible'); await sleep(500);
      const short = count() - n0;
      await vis('hidden'); await p8.clock.fastForward(11 * 60 * 1000); await vis('visible');
      await p8.waitForFunction(() => !window.__brief.state.refreshing); await sleep(800);
      const long = count() - n0;
      ok(`[${vp.tag}] no background polling; re-fetch only after 10+ min hidden, without scrolling`, idle === 0 && short === 0 && long === 1 && (await p8.evaluate(() => scrollY)) === 2000, `idle=${idle} after5min=${short} after11min=${long}`);
      await c8.close();
    }

    // ================= fixture: sub-folder host + sample history (bundled data; GitHub blocked) =================
    const { ctx: c4, page: p4, problems: pr4 } = await newCtx(vp, { origin: 'http://127.0.0.1:8795', offline: true });
    await p4.goto(FIXURL, { waitUntil: 'networkidle' });
    await p4.waitForSelector('#today .card');
    const hd = p4.locator('details.hday');
    ok(`[${vp.tag}] sub-folder hosting works (relative paths) and history lists collapsed days`, (await hd.count()) === fixIndex.days.length - 1 && (await p4.evaluate(() => [...document.querySelectorAll('details.hday')].every((d) => !d.open))),
      (await p4.locator('.hday > summary').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
    await p4.evaluate(() => { document.getElementById('history').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
    await shot(p4, `${vp.tag}-history-collapsed.png`);
    const h29 = p4.locator('details.hday').first();
    await h29.locator('summary').click();
    await p4.waitForFunction(() => document.querySelector('details.hday').querySelectorAll('.card').length > 0);
    ok(`[${vp.tag}] history day expands on click (lazy-loaded) with inline deep dives`, (await h29.locator('.card').count()) > 0 && (await h29.locator('.deep').count()) >= 1);
    await h29.locator('summary').click();
    ok(`[${vp.tag}] history day collapses on click`, !(await h29.evaluate((d) => d.open)));
    ok(`[${vp.tag}] fixture: no console errors / failed requests`, pr4.length === 0, pr4.join('; '));
    await c4.close();
  }
} finally {
  await browser.close();
  fixSrv.kill();
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
