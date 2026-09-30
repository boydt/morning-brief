/* Morning Brief — static front-end. No server: reads data/index.json and data/<date>.json
   via RELATIVE paths, so it works on any static host, in a sub-folder, or via `python3 -m http.server`.
   Uses vendored marked + DOMPurify (assets/vendor). No background polling: data loads on open/reload. */
(() => {
  'use strict';
  const TZ = 'America/Phoenix';
  const HISTORY_PAGE = 7;
  const APRIL_CHAT_URL = 'grokbot://app/v1/agent?id=30d1a93b-3a8a-435f-8b71-efa1bd39e86a';
  const ASKED_KEY = 'morning-brief:asked';
  const SCROLL_KEY = 'morning-brief:scroll';
  const DEFAULT_ICONS = { world: '🌍', business: '💼', games: '🎮', ai: '🤖', tech: '💻', markets: '📈', weather: '🌤️', 'worth-reading': '📚' };
  const DEFAULT_TITLES = { world: 'World', business: 'Business', games: 'Games', ai: 'AI', tech: 'Tech', markets: 'Markets', weather: 'Weather', 'worth-reading': 'Worth Reading' };

  // ---------- markdown (sanitized) ----------
  marked.use({ gfm: true, breaks: false });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const PURIFY = { FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe'], FORBID_ATTR: ['style'] };
  const md = (s) => DOMPurify.sanitize(marked.parse(String(s ?? '')), PURIFY);
  const mdInline = (s) => DOMPurify.sanitize(marked.parseInline(String(s ?? '')), PURIFY);
  const safeUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  const plain = (mdText) => { const d = document.createElement('div'); d.innerHTML = mdInline(mdText || ''); return d.textContent.replace(/\s+/g, ' ').trim(); };

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const todayPhx = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function fmtDate(iso, opts) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  }
  // Accepts ISO timestamps with 'Z' or an offset (e.g. -07:00); always shows Arizona time.
  function fmtTime(ts, withDate) {
    const d = new Date(ts); if (isNaN(d)) return '';
    return d.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', ...(withDate ? { month: 'short', day: 'numeric' } : {}), timeZoneName: 'short' });
  }
  const key = (date, id) => `${date}|${id}`;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  async function getJSON(relPath) {
    // Relative URL (no leading slash). 'no-cache' = revalidate with the host, so a reload shows fresh data.
    const r = await fetch(relPath, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${relPath} → HTTP ${r.status}`);
    return r.json();
  }
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------- state ----------
  const state = {
    days: [], latest: null,
    dayData: new Map(),       // date -> json
    historyLimit: HISTORY_PAGE,
    historyEls: new Map(),    // date -> <details>
    loadedHistory: new Set(),
    deepOpen: new Map(),      // key -> bool
    asked: store.get(ASKED_KEY, {}), // key -> ISO time Boyd asked (this browser only)
  };

  const sectionsOf = (day) => (Array.isArray(day && day.sections) ? day.sections.filter((s) => s && typeof s === 'object') : []);
  const itemsOf = (sec) => (Array.isArray(sec.items) ? sec.items.filter((i) => i && typeof i === 'object' && i.id != null) : []);
  const countItems = (day) => sectionsOf(day).reduce((n, s) => n + itemsOf(s).length, 0);
  const hasDetails = (it) => typeof it.details_md === 'string' && it.details_md.trim() !== '';
  function findItem(date, id) {
    for (const s of sectionsOf(state.dayData.get(date))) for (const it of itemsOf(s)) if (String(it.id) === String(id)) return it;
    return null;
  }

  // ---------- More info: copy request, then show toast ----------
  function buildMessage(date, it) {
    const url = it.source && safeUrl(it.source.url);
    const head = plain(it.headline_md) || '(untitled)';
    return `More info please on ${date} ${it.id}: ${head}${url ? ` (source: ${url})` : ''}. ` +
      `Please write the deep dive into details_md for item ${it.id} in data/${date}.json.`;
  }
  // Legacy synchronous copy (works without the async Clipboard API / secure context).
  function execCopy(text) {
    const active = document.activeElement;
    const ta = h('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none' });
    ta.value = text; document.body.append(ta);
    ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); if (active && active.focus) try { active.focus({ preventScroll: true }); } catch {}
    return ok;
  }
  // Must be called synchronously from the click handler (keeps the user gesture).
  // Returns a Promise<boolean>.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      let p;
      try { p = navigator.clipboard.writeText(text); } catch { p = Promise.reject(); }
      return p.then(() => true, () => execCopy(text));
    }
    return Promise.resolve(execCopy(text));
  }

  function onMoreInfo(date, id) {
    const it = findItem(date, id); if (!it) return;
    const text = buildMessage(date, it);
    const copied = copyText(text);   // 1) copy FIRST, synchronously inside the click
    state.asked[key(date, id)] = new Date().toISOString(); store.set(ASKED_KEY, state.asked);
    showToast(text, null);           // 2) then show the toast (no window/link is opened automatically)
    copied.then((ok) => updateToastStatus(ok));
    patchCard(date, id);
  }

  function closeToast() { const t = $('#toast'); if (t) t.remove(); }
  function showToast(text) {
    closeToast();
    const box = h('textarea', { class: 'toast-text', id: 'toast-text', readonly: true, rows: 4, 'aria-label': 'Request message', onfocus: (e) => e.target.select() });
    box.value = text;
    const again = h('button', { class: 'btn', id: 'toast-copy', type: 'button', onclick: () => {
      copyText(box.value).then((ok) => { again.textContent = ok ? '✓ Copied' : 'Select the text and copy it'; if (!ok) { box.focus(); box.select(); } updateToastStatus(ok); });
    } }, '📋 Copy again');
    const toast = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'toast-row' },
        h('div', { class: 'toast-msg', id: 'toast-msg' }, '📋 Copying request…'),
        h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Close', onclick: closeToast }, '×')),
      box,
      h('div', { class: 'toast-actions' }, again,
        h('a', { class: 'btn primary', id: 'toast-open', href: APRIL_CHAT_URL }, '💬 Open April’s chat')),
      h('div', { class: 'toast-hint' }, 'Paste it in April’s chat. Her deep dive appears under the headline after you reload this page.'));
    document.body.append(toast);
  }
  function updateToastStatus(ok) {
    const t = $('#toast'); const m = $('#toast-msg'); if (!t || !m) return;
    t.classList.toggle('ok', ok); t.classList.toggle('warn', !ok);
    m.textContent = ok ? '✅ Request copied — paste it in April’s chat' : '⚠ Couldn’t copy automatically — select the text below and copy it';
    if (!ok) { const b = $('#toast-text'); if (b) { b.focus({ preventScroll: true }); b.select(); } }
  }

  // ---------- rendering ----------
  function buildButton(date, it) {
    const k = key(date, it.id);
    if (hasDetails(it)) {
      const open = state.deepOpen.get(k) !== false;
      return h('button', { class: 'btn done', type: 'button', 'aria-expanded': String(open), onclick: () => { state.deepOpen.set(k, !open); patchCard(date, it.id); } },
        open ? '▾ Hide deep dive' : '▸ Show deep dive');
    }
    const asked = state.asked[k];
    if (asked) return h('button', { class: 'btn asked', type: 'button', title: `Asked ${fmtTime(asked, true)} — click to copy the request again`, onclick: () => onMoreInfo(date, it.id) }, '✓ Asked April · copy again');
    return h('button', { class: 'btn', type: 'button', onclick: () => onMoreInfo(date, it.id) }, '🔎 More info');
  }

  function buildCard(date, it) {
    const k = key(date, it.id);
    const src = it.source && typeof it.source === 'object' ? it.source : null;
    const url = src && safeUrl(src.url);
    let srcName = src && src.name; if (!srcName && url) srcName = new URL(url).hostname;
    const open = state.deepOpen.get(k) !== false;
    return h('article', { class: 'card', id: `item-${date}-${it.id}` },
      h('div', { class: 'headline-row' },
        h('span', { class: 'badge', title: 'Headline code' }, String(it.id)),
        h('div', {},
          h('h3', { class: 'headline md', html: mdInline(it.headline_md || '(untitled)') }),
          it.summary_md ? h('div', { class: 'summary md', html: md(it.summary_md) }) : null)),
      h('div', { class: 'meta-row' },
        h('div', { class: 'source' }, srcName ? ['Source: ', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, srcName) : srcName] : ''),
        buildButton(date, it)),
      hasDetails(it) && open ? h('div', { class: 'deep' },
        h('div', { class: 'deep-head' }, h('span', {}, '🧠 Deep dive from April'), it.details_updated ? h('time', { datetime: it.details_updated }, fmtTime(it.details_updated, true)) : null),
        h('div', { class: 'md', html: md(it.details_md) })) : null);
  }

  // Re-render one card in place (user toggles only). Keeps the clicked card's on-screen position.
  function patchCard(date, id) {
    const it = findItem(date, id);
    const old = document.getElementById(`item-${date}-${id}`);
    if (!it || !old) return;
    const top = old.getBoundingClientRect().top;
    const card = buildCard(date, it);
    old.replaceWith(card);
    const delta = card.getBoundingClientRect().top - top;
    if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
  }

  function renderSections(date, day, into) {
    into.textContent = '';
    for (const sec of sectionsOf(day)) {
      const id = String(sec.id || 'other');
      const items = itemsOf(sec);
      const secEl = h('section', { class: `section ${id.replace(/[^a-z0-9-]/gi, '')}`, 'data-section': id },
        h('div', { class: 'section-head' },
          h('span', { class: 'section-icon', 'aria-hidden': 'true' }, sec.icon || DEFAULT_ICONS[id] || '📰'),
          h('h2', { class: 'section-title' }, sec.title || DEFAULT_TITLES[id] || id),
          items.length ? h('span', { class: 'section-count' }, String(items.length)) : null),
        sec.body_md ? h('div', { class: 'section-body md', html: md(sec.body_md) }) : null);
      if (items.length) secEl.append(h('div', { class: 'items' }, items.map((it) => buildCard(date, it))));
      into.append(secEl);
    }
    if (!sectionsOf(day).length) into.append(h('div', { class: 'empty' }, 'No sections in this brief yet.'));
  }

  function renderTop() {
    const root = $('#today');
    const date = state.latest;
    if (!date) { root.innerHTML = '<div class="empty">No briefs yet.</div>'; return; }
    const day = state.dayData.get(date);
    root.textContent = '';
    const isSample = /\(sample\)/i.test(day.title || '');
    root.append(
      h('div', { class: 'day-head' },
        h('div', { class: 'day-kicker' }, date === todayPhx() ? 'Today' : 'Latest brief', isSample ? h('span', { class: 'pill sample' }, 'Sample') : null),
        h('h1', { class: 'day-title' }, day.title || 'Morning Brief'),
        h('div', { class: 'day-date' }, fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), ` · ${countItems(day)} headlines`)),
      day.intro_md ? h('div', { class: 'intro md', html: md(day.intro_md) }) : null);
    const body = h('div', { class: 'day-body' });
    renderSections(date, day, body);
    root.append(body);
    document.title = `${day.title || 'Morning Brief'} · ${fmtDate(date, { month: 'short', day: 'numeric' })}`;
  }

  function renderHistory() {
    const all = state.days.filter((d) => d.date !== state.latest);
    $('#history').hidden = all.length === 0;
    $('#load-older').hidden = all.length <= state.historyLimit;
    const list = $('#history-list');
    for (const meta of all.slice(0, state.historyLimit)) {
      if (state.historyEls.has(meta.date)) continue;
      const body = h('div', { class: 'hday-body' }, h('div', { class: 'loading' }, 'Loading…'));
      const el = h('details', { class: 'hday', 'data-date': meta.date },
        h('summary', {},
          h('span', { class: 'hday-date' }, fmtDate(meta.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
          h('span', { class: 'hday-count' }, `${meta.headline_count ?? '?'} headlines`)),
        body);
      el.addEventListener('toggle', async () => {
        if (!el.open || state.loadedHistory.has(meta.date)) return;
        try {
          const json = await getJSON(`data/${meta.date}.json`);
          state.dayData.set(meta.date, json);
          renderSections(meta.date, json, body);
          state.loadedHistory.add(meta.date);
        } catch {
          body.textContent = ''; body.append(h('div', { class: 'empty' }, 'Couldn’t load this day. Close and reopen it to retry.'));
        }
      });
      state.historyEls.set(meta.date, el);
      list.append(el);
    }
  }

  async function load() {
    try {
      const idx = await getJSON('data/index.json');
      const days = (Array.isArray(idx) ? idx : (idx && idx.days) || []).filter((d) => d && DATE_RE.test(d.date));
      days.sort((a, b) => (a.date < b.date ? 1 : -1));
      state.days = days;
      state.latest = days.length ? days[0].date : null;
      if (state.latest) state.dayData.set(state.latest, await getJSON(`data/${state.latest}.json`));
      renderTop();
      renderHistory();
      $('#status').textContent = `Loaded ${fmtTime(new Date())}`;
      restoreScroll();
    } catch (e) {
      $('#today').innerHTML = '';
      $('#today').append(h('div', { class: 'empty' }, 'Couldn’t load the brief. ', h('a', { href: '' }, 'Reload'), ' to try again.'));
      $('#status').textContent = '⚠ Load failed';
      console.warn(e);
    }
  }

  // Keep the reading position across reloads (content renders async, so do it by hand).
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  function restoreScroll() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
      if (saved && saved.path === location.pathname && typeof saved.y === 'number') window.scrollTo(0, saved.y);
    } catch {}
  }
  window.addEventListener('pagehide', () => { try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ path: location.pathname, y: window.scrollY })); } catch {} });

  $('#load-older').addEventListener('click', () => { state.historyLimit += HISTORY_PAGE; renderHistory(); });
  load();
})();
