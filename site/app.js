// Physical AI Radar — vanilla JS SPA. All data is fetched as static JSON from data/.
// Routes:
//   #/                      home
//   #/browse?q=&cat=&use=&check=&sort=   catalog
//   #/p/<id>                project detail
//   #/compare?ids=a,b       side-by-side comparison (max 4)
//   #/paths  #/paths/<id>   learning paths
//   #/about                 methodology
// All project text is untrusted third-party metadata; it is only ever inserted via textContent/DOM APIs.
'use strict';

const PAGE = 30;
const MAX_COMPARE = 4;
const REPO_URL = 'https://github.com/agilealpha1/Physical_AI';
const THEME_KEY = 'physical-ai:theme';
const COMPARE_KEY = 'physical-ai:compare';
const ext = { target: '_blank', rel: 'noopener noreferrer' };
const SORTS = {
  relevance: { label: '関連度順', note: '検索語との一致が強い順。' },
  stars: { label: 'スター順', note: 'GitHub スターの多い順。掲載順ではありません。' },
  updated: { label: '更新が新しい順', note: 'リポジトリの最終 push が新しい順。' },
  name: { label: '名前順', note: '名前の五十音・アルファベット順。' },
  checked: { label: '確認が新しい順', note: 'サイト側で情報を確認した日が新しい順。' },
};
const CHECKS = [
  { id: 'vendor', label: '開発元が実機評価', test: (p) => p.flags.real_vendor },
  { id: 'sim', label: 'Sim 評価あり', test: (p) => p.flags.sim },
  { id: 'repro', label: '公式手順あり', test: (p) => p.flags.repro },
  { id: 'weights', label: '重み公開', test: (p) => p.availability.weights },
  { id: 'data', label: 'データ公開', test: (p) => p.availability.data },
];
const CHECK_BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
const REQ_LABELS = { os: 'OS', gpu: 'GPU', vram: 'VRAM', robot: '対応ロボット', sim: 'シミュレータ', runtime: 'ランタイム' };
const REQ_STATUS = { official: '公式確認', community: 'コミュニティ情報', unknown: '未確認', na: '該当なし' };
const LINK_LABELS = { github: 'GitHub', docs: 'ドキュメント', paper: '論文', weights: '重み', data: 'データ', demo: 'デモ' };
const SIM = {
  reported: ['評価あり', 'yes'], not_reported: ['記載なし', 'no'], na: ['該当なし', 'na'], unknown: ['未確認', 'unknown'],
};
const REAL = {
  vendor: ['開発元が実機評価', 'yes'], third_party: ['第三者・コミュニティ', 'yes'], community: ['コミュニティ例', 'partial'],
  not_reported: ['記載なし', 'no'], na: ['該当なし', 'na'], unknown: ['未確認', 'unknown'],
};
const REPRO = {
  official: ['公式手順あり', 'yes'], third_party: ['第三者再現あり', 'yes'], not_reported: ['記載なし', 'no'],
  na: ['該当なし', 'na'], unknown: ['未確認', 'unknown'],
};
const LIC_STATUS = { official: '公式確認', varies: '配布ごとに異なる', unknown: '未確認', na: 'n/a' };
const STATUS_LABEL = { active: '活発', maintenance: '保守中心', archived: 'アーカイブ' };

let DATA, STATS, PATHS, P_BY_ID = {}, PATH_BY_ID = {}, CAT_BY_ID = {}, USE_BY_ID = {}, FUSE;
let DETAIL_CACHE = {};
let CMP = [];
let SEL = -1;
let browseRefs = null;
const S = {
  view: 'home', q: '', cat: '', uses: [], checks: [], sort: 'stars',
  id: null, path: null, ids: [], limit: PAGE, missing: '',
};

// ---------- tiny DOM helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') {
      for (const [p, x] of Object.entries(v)) if (x != null) el.style.setProperty(p, x);
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [p, x] of Object.entries(v)) el.dataset[p] = String(x);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  for (const c of kids.flat(Infinity)) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const $ = (id) => document.getElementById(id);
const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>`\\]+$/i.test(u) ? u : null);
const num = (n) => Number(n || 0).toLocaleString('ja-JP');
const compact = (n) => new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);
const starOrder = (p) => p.stars == null ? -1 : Number(p.stars);
const starText = (n) => n == null ? '未取得' : compact(n);
const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d);
  if (s.includes('T')) {
    const x = new Date(s);
    if (!Number.isNaN(+x)) return x.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
  }
  return s.slice(0, 10).replace(/-/g, '.');
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(+x)) return '—';
  return x.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
};
const daysSince = (d) => (Date.now() - Date.parse(String(d).slice(0, 10) + 'T00:00:00Z')) / 864e5;
function ago(d) {
  if (!d) return '—';
  const n = Math.max(0, daysSince(d));
  if (n < 1) return '今日';
  if (n < 30) return `${Math.floor(n)}日前`;
  if (n < 365) return `${Math.floor(n / 30)}か月前`;
  return `${(n / 365).toFixed(1)}年前`;
}
function storeGet(k, fallback) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function safeStoreList() {
  try { const v = JSON.parse(storeGet(COMPARE_KEY, '[]')); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
function loadDetail(id) {
  if (!DETAIL_CACHE[id]) DETAIL_CACHE[id] = getJSON(`data/r/${encodeURIComponent(id)}.json`);
  return DETAIL_CACHE[id];
}
function extLink(url, label, cls = '') {
  const u = httpUrl(url);
  if (!u) return null;
  return h('a', { class: cls, href: u, ...ext }, label, ' ↗');
}
function catBadge(p) { return h('span', { class: 'cat-badge' }, p.category_label); }
function statusTag(s) { return s && s !== 'active' ? h('span', { class: `status-tag ${s}` }, STATUS_LABEL[s] || s) : null; }
function vbadge(kind, p) {
  const v = p.verification || {};
  const maps = { sim: SIM, real: REAL, repro: REPRO };
  const labels = { sim: 'Sim', real: '実機', repro: '再現' };
  const [text, cls] = maps[kind][v[kind]] || ['未確認', 'unknown'];
  return h('span', { class: `vbadge ${cls}`, title: `${labels[kind]}: ${text}` }, `${labels[kind]} ${text}`);
}
function allVBadges(p) { return [vbadge('real', p), vbadge('sim', p), vbadge('repro', p)].filter((b) => !b.classList.contains('na')); }
function projectHref(p) { return `#/p/${encodeURIComponent(p.id)}`; }
function catStyle(p) { return { '--cat': p.category_color || 'var(--accent)' }; }

function nav() {
  const on = (cond) => (cond ? 'on' : null);
  $('nav').replaceChildren(
    h('a', { href: '#/', class: on(S.view === 'home') }, 'ホーム'),
    h('a', { href: '#/browse', class: on(S.view === 'browse') }, 'カタログ'),
    h('a', { href: '#/compare', class: on(S.view === 'compare') }, '比較'),
    h('a', { href: '#/paths', class: on(S.view === 'paths' || S.view === 'path') }, '学習パス'),
    h('a', { href: '#/about', class: on(S.view === 'about') }, 'このサイトについて'),
    h('span', { class: 'sep', 'aria-hidden': 'true' }),
    ...DATA.categories.map((c) => h('a', { href: `#/browse?cat=${encodeURIComponent(c.id)}`, class: on(S.view === 'browse' && S.cat === c.id) },
      h('span', { class: 'dot', style: { background: c.color } }), c.label)),
  );
}

// ---------- URL state ----------
const SORT_KEYS = Object.keys(SORTS);
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const path = qi < 0 ? raw : raw.slice(0, qi);
  const p = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1));
  const seg = path.split('/').filter(Boolean).map(dec);
  S.view = 'home'; S.id = null; S.path = null; S.ids = []; S.missing = '';
  S.q = ''; S.cat = ''; S.uses = []; S.checks = []; S.sort = 'stars'; S.limit = PAGE;
  if (!seg.length) { S.view = 'home'; return; }
  if (seg[0] === 'browse' || seg[0] === 'search') {
    S.view = 'browse';
    S.q = p.get('q') || '';
    S.cat = CAT_BY_ID[p.get('cat')] ? p.get('cat') : '';
    S.uses = (p.get('use') || '').split(',').filter((u) => USE_BY_ID[u]);
    S.checks = (p.get('check') || '').split(',').filter((c) => CHECK_BY_ID[c]);
    const wanted = p.get('sort');
    S.sort = SORT_KEYS.includes(wanted) && (wanted !== 'relevance' || S.q) ? wanted : (S.q ? 'relevance' : 'stars');
    return;
  }
  if (seg[0] === 'p' && seg[1]) { S.view = 'detail'; S.id = seg.slice(1).join('/'); return; }
  if (seg[0] === 'compare') {
    S.view = 'compare';
    const ids = (p.get('ids') || '').split(',').map(dec).filter((id) => P_BY_ID[id]);
    S.ids = [...new Set(ids)].slice(0, MAX_COMPARE);
    return;
  }
  if (seg[0] === 'paths') { S.view = seg[1] ? 'path' : 'paths'; S.path = seg[1] || null; return; }
  if (seg[0] === 'about') { S.view = 'about'; return; }
  S.view = 'missing';
}
function hashFor(over = {}) {
  const st = { ...S, ...over };
  if (st.view === 'browse') {
    const p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.cat) p.set('cat', st.cat);
    if (st.uses.length) p.set('use', st.uses.join(','));
    if (st.checks.length) p.set('check', st.checks.join(','));
    if (st.sort && st.sort !== (st.q ? 'relevance' : 'stars')) p.set('sort', st.sort);
    const q = p.toString();
    return '#/browse' + (q ? '?' + q : '');
  }
  if (st.view === 'detail') return '#/p/' + encodeURIComponent(st.id || '');
  if (st.view === 'compare') return '#/compare' + (st.ids.length ? '?ids=' + st.ids.map(encodeURIComponent).join(',') : '');
  if (st.view === 'paths') return '#/paths';
  if (st.view === 'path') return '#/paths/' + encodeURIComponent(st.path || '');
  if (st.view === 'about') return '#/about';
  return '#/';
}
function syncUrl() { history.replaceState(null, '', hashFor()); }
function updateCompareCount() {
  $('compare-count').textContent = String(CMP.length);
  $('compare-count').hidden = CMP.length === 0;
  $('compare-link').setAttribute('aria-label', `比較リスト（${CMP.length}件）`);
}

// ---------- data / filtering ----------
const normText = (x) => String(x).toLowerCase().replace(/0/g, 'o');
function searchScore(p, terms) {
  const name = normText(p.name), full = normText(p.full_name), tags = normText(p.tags.join(' '));
  const summary = normText(p.summary), cat = normText(p.category_label), uses = normText(p.use_labels.join(' ')), search = normText(p.search_text || '');
  let score = 0;
  for (const t of terms) {
    if (name.includes(t)) score += 12;
    if (full.includes(t)) score += 6;
    if (tags.includes(t)) score += 4;
    if (summary.includes(t)) score += 2;
    if (uses.includes(t)) score += 1;
    if (cat.includes(t)) score += 1;
    if (search.includes(t)) score += 1;
  }
  return score;
}
function searchRows() {
  const q = S.q.trim();
  if (!q) return DATA.projects.slice();
  const terms = normText(q).split(/\s+/).filter(Boolean);
  const direct = DATA.projects.filter((p) => terms.every((t) => p.haystack.includes(t)));
  if (direct.length) {
    for (const p of direct) p._score = searchScore(p, terms);
    return direct.sort((a, b) => b._score - a._score || starOrder(b) - starOrder(a));
  }
  const fuse = FUSE.search(q).map((x) => x.item);
  fuse.forEach((p, i) => { p._score = 1000 - i; });
  return fuse;
}
function filtered() {
  let rows = searchRows();
  if (S.cat) rows = rows.filter((p) => p.category === S.cat);
  if (S.uses.length) rows = rows.filter((p) => S.uses.every((u) => p.uses.includes(u)));
  if (S.checks.length) rows = rows.filter((p) => S.checks.every((c) => CHECK_BY_ID[c].test(p)));
  return rows;
}
function sorted(rows) {
  const r = rows.slice();
  if (S.sort === 'relevance') r.sort((a, b) => (b._score || 0) - (a._score || 0) || starOrder(b) - starOrder(a));
  else if (S.sort === 'updated') r.sort((a, b) => (b.pushed || '').localeCompare(a.pushed || '') || starOrder(b) - starOrder(a));
  else if (S.sort === 'name') r.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  else if (S.sort === 'checked') r.sort((a, b) => (b.checked_at || '').localeCompare(a.checked_at || '') || starOrder(b) - starOrder(a));
  else r.sort((a, b) => starOrder(b) - starOrder(a) || a.name.localeCompare(b.name, 'ja'));
  return r;
}
function toggle(list, value) {
  const s = new Set(list);
  if (s.has(value)) s.delete(value); else s.add(value);
  return [...s];
}

// ---------- shared cards ----------
function projectCard(p) {
  const on = CMP.includes(p.id);
  return h('article', { class: 'pcard', style: catStyle(p), 'data-id': p.id, 'data-href': projectHref(p) },
    h('div', { class: 'top' }, catBadge(p), statusTag(p.status),
      h('button', {
        class: `compare-btn${on ? ' on' : ''}`, type: 'button', 'data-compare': p.id,
        'aria-pressed': String(on), title: on ? '比較から外す' : '比較に追加',
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleCompare(p.id); },
      }, on ? '比較中' : '＋比較')),
    h('h3', { class: 'title' }, h('a', { href: projectHref(p) }, p.name)),
    h('div', { class: 'full' }, p.full_name),
    h('p', { class: 'summary' }, p.summary),
    h('div', { class: 'chips' }, p.uses.map((u, i) => h('a', { class: 'chip', href: `#/browse?use=${encodeURIComponent(u)}` }, p.use_labels[i]))),
    h('div', { class: 'badges' }, allVBadges(p)),
    h('div', { class: 'meta' },
      h('span', { class: 'star' }, starText(p.stars)),
      h('span', null, ago(p.pushed) + '更新'),
      h('span', { class: 'sep', 'aria-hidden': 'true' }),
      h('span', null, p.papers_count ? `論文 ${p.papers_count} 本` : '論文リンクなし')),
  );
}
function row(p, i) {
  return h('a', { class: 'row', href: projectHref(p), style: catStyle(p), 'data-id': p.id, 'data-href': projectHref(p) },
    h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
    h('span', { class: 'main' },
      h('span', { class: 'name' }, p.name, h('span', null, p.full_name)),
      h('span', { class: 'desc' }, p.summary)),
    h('span', { class: 'cat' }, p.category_label),
    h('span', { class: 'star' }, '★ ' + starText(p.stars), h('small', null, '  ' + ago(p.pushed))),
  );
}
function sectionHead(title, sub, href, linkLabel) {
  return h('div', { class: 'section-head' },
    h('div', null, h('h2', null, title), sub ? h('p', { class: 'sub' }, sub) : null),
    href ? h('a', { href }, linkLabel || 'すべて見る →') : null);
}
function statBox(k, v, s) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null);
}

// ---------- home ----------
function hero() {
  return h('section', { class: 'hero' },
    h('div', null,
      h('p', { class: 'eyebrow' }, 'Technical catalog for physical AI'),
      h('h1', null, 'Physical AI の、', h('br'), h('span', { class: 'grad' }, '次の一手'), 'を探す。'),
      h('p', { class: 'lede' }, '論文、実装、動作条件を横断できる技術カタログ。',
        h('b', null, '「何ができるか」'), 'と', h('b', null, '「動かすには何が必要か」'), 'を、公式情報と',
        h('b', null, '「未確認」'), 'の区別つきで整理しています。'),
      h('div', { class: 'hero-links' },
        h('a', { class: 'quick', href: '#/browse?cat=robot-learning' }, h('b', null, 'VLA'), 'を探す'),
        h('a', { class: 'quick', href: '#/browse?cat=simulation' }, 'シミュレータ'),
        h('a', { class: 'quick', href: '#/browse?check=vendor' }, '実機評価あり'),
        h('a', { class: 'quick', href: '#/paths' }, '学習パス'),
        h('span', { class: 'hint' }, '検索は / キー')),
    ),
    h('div', { class: 'radar-wrap' },
      h('div', { class: 'radar', role: 'img', 'aria-label': 'Physical AI の技術カテゴリを示すレーダー' },
        h('div', { class: 'sweep' }),
        h('span', { class: 'blip b1' }, h('i'), h('em', null, 'VLA')),
        h('span', { class: 'blip b2' }, h('i'), h('em', null, 'Sim')),
        h('span', { class: 'blip b3' }, h('i'), h('em', null, 'Data')),
        h('span', { class: 'blip b4' }, h('i'), h('em', null, 'Edge')),
        h('span', { class: 'blip b5' }, h('i'), h('em', null, 'Perception')),
        h('div', { class: 'core' }),
        h('span', { class: 'caption' }, 'SCAN / 5 CATEGORIES'))),
  );
}
function home() {
  const featured = DATA.projects.filter((p) => p.featured);
  const vendor = DATA.projects.filter((p) => p.flags.real_vendor).sort((a, b) => starOrder(b) - starOrder(a)).slice(0, 6);
  const recent = DATA.projects.slice().sort((a, b) => (b.pushed || '').localeCompare(a.pushed || '')).slice(0, 8);
  const total = DATA.projects.length;
  return [
    hero(),
    h('div', { class: 'stats' },
      statBox('掲載技術', num(STATS.projects), `5 分類 / ${num(STATS.uses)} 用途`),
      statBox('実機評価の記載', num(STATS.with_real_vendor), `Sim 評価 ${num(STATS.with_sim)} 件`),
      statBox('論文リンク', num(STATS.papers), `${num(STATS.with_papers)} 件が論文付き`),
      statBox('最終データ取得', fmtDate(STATS.last_success_at || STATS.stars_fetched_at), `スナップショット ${fmtDate(STATS.snapshot)}`)),
    sectionHead('技術カテゴリ', 'Physical AI の開発工程を 5 つに分け、用途タグで横断できます。', '#/browse', 'カタログを開く →'),
    h('div', { class: 'cat-grid' }, DATA.categories.map((c) => {
      const n = STATS.by_category[c.id] || 0;
      const max = Math.max(...Object.values(STATS.by_category), 1);
      return h('a', { class: 'cat-card', href: `#/browse?cat=${encodeURIComponent(c.id)}`, style: { '--cat': c.color } },
        h('div', { class: 'top' }, h('span', { class: 'label' }, c.label), h('span', { class: 'n' }, n)),
        h('div', { class: 'en' }, c.en),
        h('div', { class: 'desc' }, c.description),
        h('div', { class: 'meter' }, h('i', { style: { width: `${(100 * n) / max}%` } })));
    })),
    sectionHead('注目の実装', '初版の編集チームが、入口として読む価値が高いと判断したものです。', '#/browse', '全件見る →'),
    h('div', { class: 'cards' }, featured.slice(0, 6).map(projectCard)),
    sectionHead('実機でどこまで確認されているか', '「動く」の一言で括らず、シミュレーション・開発元の実機・再現手順を分けて表示します。'),
    h('div', { class: 'home-split' },
      h('div', { class: 'panel' },
        h('h2', null, '開発元が実機評価を報告'),
        h('div', { class: 'rows' }, vendor.map((p, i) => row(p, i))),
        h('p', { class: 'small', style: { 'margin-top': '10px' } }, '実機評価の記載がある技術だけを抽出。スター数や Sim 評価の有無とは別の軸です。'),
        h('a', { class: 'btn sm', href: '#/browse?check=vendor', style: { 'margin-top': '10px' } }, '実機評価ありを一覧する →')),
      h('div', { class: 'panel' },
        h('h2', null, '検証の 3 層'),
        h('div', { class: 'layer' }, h('b', null, '01 / Sim'), h('p', null, '論文・公式コードがシミュレーションで評価したか。')),
        h('div', { class: 'layer' }, h('b', null, '02 / Real'), h('p', null, '開発元・第三者・コミュニティが実機で確認したか。')),
        h('div', { class: 'layer' }, h('b', null, '03 / Repro'), h('p', null, '第三者が再現できるコード・手順・重みがあるか。')),
        h('p', { class: 'small' }, '不明な項目は「未確認」と表示します。AI が補完した数値は載せません。'),
        h('a', { class: 'btn sm', href: '#/about', style: { 'margin-top': '10px' } }, '掲載基準と検証の定義 →'))),
    sectionHead('最近更新された実装', 'GitHub の最終 push が新しい順。活発さの目安です。', '#/browse?sort=updated', '更新順で見る →'),
    h('div', { class: 'rows' }, recent.map((p, i) => row(p, i))),
    sectionHead('学習パス', '「何から読むか」「どの順で試すか」を、プロジェクトと論文でつなぎます。', '#/paths', 'すべてのパス →'),
    h('div', { class: 'path-grid' }, DATA.paths.slice(0, 4).map(pathCard)),
    h('div', { class: 'how-grid' },
      howStep('01', '探す', '日本語・英語の名称、概要、タグを横断検索。カテゴリと用途で絞り込めます。'),
      howStep('02', '条件を見る', 'OS・GPU・VRAM・対応ロボット・シミュレータを、公式確認 / 未確認の区別つきで確認。'),
      howStep('03', '比較する', '最大 4 件を並べ、検証状況とライセンスの違いを同じ表で見比べます。')),
    h('p', { class: 'home-note' }, `掲載 ${total} 件。スター数は掲載条件ではなく、並び替えと参考指標です。`,
      h('a', { href: '#/about' }, ' 掲載基準を読む →')),
  ];
}
function howStep(n, title, text) {
  return h('div', { class: 'how-step' }, h('span', { class: 'n' }, n), h('h3', null, title), h('p', null, text));
}
function pathCard(p) {
  return h('a', { class: 'path-card', href: `#/paths/${encodeURIComponent(p.id)}` },
    h('div', { class: 'meta' }, h('span', { class: 'tag' }, p.level), h('span', null, p.time), h('span', null, `${p.steps.length} steps`)),
    h('h3', null, p.title),
    h('p', null, p.subtitle),
    h('div', { class: 'steps' }, p.steps.map(() => h('span', { class: 'on' }))));
}

// ---------- browse ----------
function drawFilters() {
  if (!browseRefs) return;
  const counts = { cat: {}, use: {}, check: {} };
  for (const p of DATA.projects) {
    counts.cat[p.category] = (counts.cat[p.category] || 0) + 1;
    for (const u of p.uses) counts.use[u] = (counts.use[u] || 0) + 1;
    for (const c of CHECKS) if (c.test(p)) counts.check[c.id] = (counts.check[c.id] || 0) + 1;
  }
  const catChips = [
    h('button', { class: `chip-btn${S.cat ? '' : ' on'}`, type: 'button', onclick: () => apply({ cat: '' }) }, 'すべて', h('span', { class: 'n' }, DATA.projects.length)),
    ...DATA.categories.map((c) => h('button', {
      class: `chip-btn${S.cat === c.id ? ' on' : ''}`, type: 'button',
      onclick: () => apply({ cat: S.cat === c.id ? '' : c.id }),
    }, c.label, h('span', { class: 'n' }, counts.cat[c.id] || 0))),
  ];
  const useChips = DATA.uses.map((u) => h('button', {
    class: `chip-btn${S.uses.includes(u.id) ? ' on' : ''}`, type: 'button',
    onclick: () => apply({ uses: toggle(S.uses, u.id) }),
  }, u.label, h('span', { class: 'n' }, counts.use[u.id] || 0)));
  const checkChips = CHECKS.map((c) => h('button', {
    class: `chip-btn${S.checks.includes(c.id) ? ' on' : ''}`, type: 'button',
    onclick: () => apply({ checks: toggle(S.checks, c.id) }),
  }, c.label, h('span', { class: 'n' }, counts.check[c.id] || 0)));
  const reset = (S.q || S.cat || S.uses.length || S.checks.length || S.sort !== (S.q ? 'relevance' : 'stars'))
    ? h('button', { class: 'chip-btn reset', type: 'button', onclick: () => { $('q').value = ''; apply({ q: '', cat: '', uses: [], checks: [], sort: 'stars' }); } }, 'リセット')
    : null;
  const sort = h('select', { 'aria-label': '並び替え', onchange: (e) => apply({ sort: e.target.value }, false) },
    ...SORT_KEYS.filter((k) => k !== 'relevance' || S.q).map((k) => h('option', { value: k, selected: S.sort === k }, SORTS[k].label)));
  browseRefs.filters.replaceChildren(
    h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, 'カテゴリ'), h('div', { class: 'chips' }, catChips), reset),
    h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, '用途'), h('div', { class: 'chips' }, useChips)),
    h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, '条件'), h('div', { class: 'chips' }, checkChips),
      h('span', { class: 'sort-wrap' }, h('span', { class: 'filter-label' }, '並び'), sort)),
  );
}
function apply(patch, resetLimit = true) {
  Object.assign(S, patch);
  if (resetLimit) S.limit = PAGE;
  syncUrl();
  drawFilters();
  drawList();
}
function drawList() {
  if (!browseRefs) return;
  const rows = sorted(filtered());
  const q = S.q.trim();
  browseRefs.meta.replaceChildren(
    h('span', null, h('strong', null, `${num(rows.length)} 件`), q ? ` / 「${q}」の検索結果` : '', S.cat ? ` / ${CAT_BY_ID[S.cat].label}` : ''),
    h('span', { class: 'sortnote' }, SORTS[S.sort].note));
  if (!rows.length) {
    browseRefs.list.replaceChildren(h('div', { class: 'empty' },
      h('h2', null, '条件に合う技術がありません'),
      h('p', null, '検索語を短くするか、カテゴリ・用途・条件を減らしてみてください。'),
      h('button', { class: 'btn', type: 'button', onclick: () => { $('q').value = ''; apply({ q: '', cat: '', uses: [], checks: [], sort: 'stars' }); } }, '条件をリセット')));
    return;
  }
  const shown = rows.slice(0, S.limit);
  SEL = -1;
  browseRefs.list.replaceChildren(
    ...[h('div', { class: 'cards' }, shown.map(projectCard)),
      rows.length > S.limit ? h('button', { class: 'more', type: 'button', onclick: () => { S.limit += PAGE; drawList(); } },
        `さらに表示（残り ${num(rows.length - S.limit)} 件）`) : null].filter(Boolean),
  );
}
function browse() {
  const wrap = h('div');
  browseRefs = {
    filters: h('div', { class: 'filters' }),
    meta: h('div', { class: 'result-meta' }),
    list: h('div'),
  };
  wrap.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'kicker' }, 'Catalog'),
      h('h1', null, 'Physical AI の技術カタログ'),
      h('p', { class: 'lede' }, '論文・実装・動作条件を、カテゴリと用途で絞り込みます。検索は日本語・英語の名称、概要、タグ、分類ラベルを横断します。')),
    h('div', { class: 'facts' },
      h('span', null, `${num(DATA.projects.length)} 技術`), h('span', { class: 'dotsep' }),
      h('span', null, `${num(DATA.categories.length)} カテゴリ`), h('span', { class: 'dotsep' }),
      h('span', null, `${num(DATA.uses.length)} 用途`), h('span', { class: 'dotsep' }),
      h('span', null, `データ取得 ${fmtDate(STATS.last_success_at || STATS.stars_fetched_at)}`)),
    browseRefs.filters, browseRefs.meta, browseRefs.list);
  drawFilters();
  drawList();
  return wrap;
}

// ---------- detail ----------
function reqValue(d, key) {
  const x = (d.requirements || {})[key] || { value: '未確認', status: 'unknown' };
  return x;
}
function reqRow(d, key) {
  const x = reqValue(d, key);
  const val = x.value === '未確認' ? h('span', { class: 'muted' }, '未確認') : h('span', { class: 'val' }, x.value);
  const showStatus = !(x.status === 'unknown' && x.value === '未確認');
  return h('tr', null, h('th', null, REQ_LABELS[key]), h('td', null, val,
    showStatus ? h('span', { class: `req-status ${x.status}` }, REQ_STATUS[x.status] || x.status) : null));
}
function verCard(label, value, cls, desc) {
  return h('div', { class: 'ver-card' }, h('div', { class: 'k' }, label), h('div', { class: 'v ' + cls }, value), h('div', { class: 'd' }, desc));
}
function licenseRow(d, key, label) {
  const x = ((d.licenses || {})[key]) || { value: '未確認', status: 'unknown' };
  const showStatus = !((x.status === 'unknown' && x.value === '未確認') || (x.status === 'na' && x.value.startsWith('n/a')));
  return h('tr', null, h('th', null, label),
    h('td', null, h('span', { class: x.value === '未確認' ? 'muted' : '' }, x.value),
      showStatus ? h('span', { class: 'req-status ' + (x.status === 'official' ? 'official' : x.status === 'varies' ? 'community' : '') }, LIC_STATUS[x.status] || '未確認') : null));
}
function actionLinks(d, primary = false) {
  const out = [];
  for (const [k, label] of Object.entries(LINK_LABELS)) {
    const u = httpUrl(d.links && d.links[k]);
    if (!u) continue;
    out.push(h('a', { class: `btn${primary && k === 'github' ? ' primary' : ''}${primary ? '' : ' sm'}`, href: u, ...ext }, label, ' ↗'));
  }
  return out;
}
function starHistory(hist) {
  if (!hist || hist.length < 2) {
    return h('section', { class: 'panel' },
      h('h2', null, 'スター履歴'),
      h('p', { class: 'small' }, hist && hist[0] ? `初回スナップショット ${fmtDate(hist[0][0])}。次回の週次更新から増加数を表示します。` : '履歴はまだありません。'),
      h('p', { class: 'small' }, 'スター数は掲載条件ではなく、参考指標です。'));
  }
  const W = 260, H = 84, pad = 6;
  const vals = hist.map((x) => x[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const pts = hist.map((x, i) => [pad + (i * (W - pad * 2)) / (hist.length - 1), pad + ((hi - x[1]) * (H - pad * 2)) / span]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return h('section', { class: 'panel' },
    h('h2', null, 'スター履歴'),
    h('div', { class: 'sparkline' }, svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '週次のスター数' },
      svgEl('path', { d: `${d} L${pts[pts.length - 1][0]} ${H - pad} L${pts[0][0]} ${H - pad} Z`, fill: 'var(--accent)', opacity: '.12' }),
      svgEl('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }),
      svgEl('circle', { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: '3', fill: 'var(--accent)' }))),
    h('p', { class: 'small', style: { 'margin-top': '6px' } }, `${fmtDate(hist[0][0])} – ${fmtDate(hist[hist.length - 1][0])} / ${hist.length} 回分。`));
}
function detail(d) {
  const head = h('div', { class: 'detail-head' },
    h('div', { class: 'top' }, catBadge(d), statusTag(d.status),
      h('button', {
        class: `compare-btn${CMP.includes(d.id) ? ' on' : ''}`, type: 'button', 'data-compare': d.id,
        onclick: () => toggleCompare(d.id),
      }, CMP.includes(d.id) ? '比較中' : '＋比較に追加')),
    h('h1', null, d.name),
    h('div', { class: 'full' }, d.full_name),
    h('p', { class: 'lede' }, d.summary),
    h('div', { class: 'detail-actions' }, actionLinks(d, true),
      h('a', { class: 'btn ghost', href: '#/browse' }, 'カタログに戻る')));
  const main = h('div', { class: 'detail-main' },
    h('section', { class: 'panel' },
      h('h2', null, 'できること'),
      h('p', null, d.body),
      h('div', { class: 'fit-box' },
        h('div', null, h('div', { class: 'k' }, '向く用途'), h('p', null, d.fit)),
        h('div', { class: 'warn' }, h('div', { class: 'k' }, '導入前の注意'), h('p', null, d.caveat))),
      d.why ? h('p', { class: 'small', style: { 'margin-top': '10px' } }, '掲載理由: ' + d.why) : null),
    h('section', { class: 'panel' },
      h('h2', null, '動作条件'),
      h('table', { class: 'req-table' }, h('tbody', null, ['os', 'gpu', 'vram', 'robot', 'sim', 'runtime'].map((k) => reqRow(d, k)))),
      h('p', { class: 'req-source' }, '出典: ', extLink(d.requirements_source, '公式ドキュメント / リポジトリ', ''), '。表示は公式情報で確認できた範囲です。')),
    h('section', { class: 'panel' },
      h('h2', null, '検証状況'),
      h('div', { class: 'ver-grid' },
        verCard('Simulation', d.verification_labels.sim, SIM[d.verification.sim]?.[1] || 'unknown', 'シミュレーション評価の記載'),
        verCard('Real robot', d.verification_labels.real, REAL[d.verification.real]?.[1] || 'unknown', '実機評価の主体'),
        verCard('Reproduction', d.verification_labels.repro, REPRO[d.verification.repro]?.[1] || 'unknown', 'コード・手順・重みの公開状況')),
      d.verification.note ? h('p', { class: 'small', style: { 'margin-top': '10px' } }, d.verification.note) : null,
      h('ul', { class: 'evidence' }, (d.verification.evidence || []).map((e) => h('li', null, '出典: ', extLink(e.url, e.label, ''))))),
    h('section', { class: 'panel' },
      h('h2', null, '公開条件'),
      h('table', { class: 'license-table' }, h('tbody', null,
        licenseRow(d, 'code', 'コード'), licenseRow(d, 'weights', '重み'), licenseRow(d, 'data', 'データ'))),
      d.licenses && d.licenses.note ? h('p', { class: 'small', style: { 'margin-top': '9px' } }, d.licenses.note) : null,
      h('p', { class: 'small' }, '出典: ', extLink(d.license_source, 'リポジトリ / ライセンス', ''), '。コード・重み・データは別ライセンスのことがあります。')),
    (d.papers && d.papers.length) ? h('section', { class: 'panel' },
      h('h2', null, '論文'),
      h('ul', { class: 'paper-list' }, d.papers.map((p) => h('li', null,
        extLink(p.url, p.title, ''),
        h('div', { class: 'meta' }, [p.year, p.arxiv ? `arXiv:${p.arxiv}` : ''].filter(Boolean).join(' · ')),
        p.note ? h('div', { class: 'note' }, p.note) : null)))) : null,
    h('section', { class: 'panel' },
      h('h2', null, '出典・確認情報'),
      h('div', { class: 'link-list' },
        h('a', { class: 'link-pill', href: d.links.github, ...ext }, 'GitHub ↗'),
        d.links.docs ? h('a', { class: 'link-pill', href: d.links.docs, ...ext }, '公式ドキュメント ↗') : null,
        h('a', { class: 'link-pill', href: `https://github.com/${d.full_name}`, ...ext }, 'リポジトリ ↗')),
      h('p', { class: 'small', style: { 'margin-top': '9px' } }, `サイト側の確認日: ${fmtDate(d.checked_at)}。GitHub メタデータの取得日: ${fmtDate(STATS.stars_fetched_at)}。`,
        ' 不明な項目は「未確認」と表示し、推測値は掲載していません。'))
  );
  const side = h('aside', { class: 'detail-side' },
    h('section', { class: 'panel' },
      h('h2', null, 'リンク'),
      h('div', { class: 'side-actions' }, actionLinks(d, false)),
      h('button', {
        class: `btn${CMP.includes(d.id) ? ' primary' : ''}`, type: 'button', id: 'detail-compare-btn', 'data-id': d.id,
        style: { 'margin-top': '8px', width: '100%' }, onclick: () => toggleCompare(d.id),
      }, CMP.includes(d.id) ? '比較から外す' : '比較に追加')),
    h('section', { class: 'panel' },
      h('h2', null, '数値'),
      h('div', { class: 'facts-grid' },
        h('div', { class: 'fact' }, h('span', { class: 'k' }, 'Stars'), h('span', { class: 'v gold' }, '★ ' + starText(d.stars))),
        h('div', { class: 'fact' }, h('span', { class: 'k' }, 'Forks'), h('span', { class: 'v' }, d.forks == null ? '未取得' : num(d.forks))),
        h('div', { class: 'fact' }, h('span', { class: 'k' }, '最終 push'), h('span', { class: 'v' }, fmtDate(d.pushed))),
        h('div', { class: 'fact' }, h('span', { class: 'k' }, '週次増加'), h('span', { class: 'v' }, d.gain == null ? '計測中' : `${d.gain > 0 ? '+' : ''}${num(d.gain)}`)),
        h('div', { class: 'fact' }, h('span', { class: 'k' }, '確認日'), h('span', { class: 'v' }, fmtDate(d.checked_at))),
        h('div', { class: 'fact' }, h('span', { class: 'k' }, '掲載順位'), h('span', { class: 'v' }, `#${d.rank}`)))),
    starHistory(d.history),
    (d.related && d.related.length) ? h('section', { class: 'panel' },
      h('h2', null, '関連する技術'),
      h('div', { class: 'side-mini' }, d.related.map((id) => {
        const p = P_BY_ID[id];
        return h('a', { href: projectHref(p) }, h('div', { class: 'n' }, p.name), h('div', { class: 's' }, p.summary), h('div', { class: 'c' }, p.category_label));
      }))) : null,
    (d.paths && d.paths.length) ? h('section', { class: 'panel' },
      h('h2', null, 'この技術が出てくる学習パス'),
      h('div', { class: 'side-mini' }, d.paths.map((id) => {
        const p = PATH_BY_ID[id];
        return h('a', { href: `#/paths/${encodeURIComponent(id)}` }, h('div', { class: 'n' }, p.title), h('div', { class: 's' }, p.subtitle));
      }))) : null
  );
  return h('div', null,
    h('nav', { class: 'crumbs', 'aria-label': 'パンくず' }, h('a', { href: '#/' }, 'ホーム'), h('span', { class: 'sep' }, '/'),
      h('a', { href: `#/browse?cat=${encodeURIComponent(d.category)}` }, d.category_label), h('span', { class: 'sep' }, '/'), h('span', null, d.name)),
    head, h('div', { class: 'detail-grid' }, main, side));
}
function detailView(id) {
  if (!P_BY_ID[id]) return notFound(`「${id}」は掲載されていません。`);
  const wrap = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'プロジェクトを読み込み中…'));
  loadDetail(id).then((d) => {
    if (!document.body.contains(wrap)) return;
    document.title = `${d.name} — Physical AI Radar`;
    wrap.replaceChildren(detail(d));
  }).catch((e) => {
    delete DETAIL_CACHE[id];
    wrap.replaceChildren(notFound(`詳細データを読み込めませんでした（${e.message}）。`));
  });
  return wrap;
}

// ---------- compare ----------
function toggleCompare(id) {
  if (!P_BY_ID[id]) return;
  const i = CMP.indexOf(id);
  if (i >= 0) { CMP.splice(i, 1); toast('比較から外しました'); }
  else {
    if (CMP.length >= MAX_COMPARE) { toast(`比較できるのは最大 ${MAX_COMPARE} 件です`); return; }
    CMP.push(id); toast('比較に追加しました');
  }
  storeSet(COMPARE_KEY, JSON.stringify(CMP));
  updateCompareCount();
  refreshCompareButtons();
  if (S.view === 'compare') { S.ids = CMP.slice(); syncUrl(); render(); }
}
function refreshCompareButtons() {
  const side = document.getElementById('detail-compare-btn');
  if (side) {
    const on = CMP.includes(side.dataset.id);
    side.textContent = on ? '比較から外す' : '比較に追加';
    side.classList.toggle('primary', on);
  }
  document.querySelectorAll('[data-compare]').forEach((b) => {
    const on = CMP.includes(b.dataset.compare);
    b.classList.toggle('on', on);
    b.textContent = on ? '比較中' : '＋比較';
    b.setAttribute('aria-pressed', String(on));
  });
}
function removeCompare(id) { CMP = CMP.filter((x) => x !== id); storeSet(COMPARE_KEY, JSON.stringify(CMP)); S.ids = CMP.slice(); syncUrl(); updateCompareCount(); render(); }
function comparePicker(active, details) {
  const avail = DATA.projects.filter((p) => !active.includes(p.id));
  const sel = h('select', { 'aria-label': '比較に追加する技術' },
    h('option', { value: '' }, '技術を選択…'),
    ...avail.map((p) => h('option', { value: p.id }, `${p.name} — ${p.category_label}`)));
  const btn = h('button', { class: 'btn', type: 'button', onclick: () => {
    const id = sel.value;
    if (!id) return;
    if (CMP.length >= MAX_COMPARE) { toast(`比較できるのは最大 ${MAX_COMPARE} 件です`); return; }
    CMP.push(id); storeSet(COMPARE_KEY, JSON.stringify(CMP)); S.ids = CMP.slice(); syncUrl(); updateCompareCount(); render();
  } }, '追加');
  return h('div', { class: 'picker' }, sel, btn, h('span', { class: 'small', style: { color: 'var(--muted-2)' } }, `${active.length} / ${MAX_COMPARE} 件`));
}
function compareTable(ds) {
  const cell = (v, cls = '') => h('td', { class: cls }, v);
  const unknown = (v) => (v && v !== '未確認' ? v : h('span', { class: 'unknown' }, '未確認'));
  const rows = [
    ['カテゴリ', (d) => cell(h('span', { class: 'cat-badge', style: { '--cat': d.category_color } }, d.category_label))],
    ['用途', (d) => cell(h('div', { class: 'chips' }, d.uses.map((u, i) => h('span', { class: 'chip' }, d.use_labels[i]))))],
    ['Stars', (d) => cell(h('span', { class: 'good' }, '★ ' + starText(d.stars)))],
    ['最終 push', (d) => cell(fmtDate(d.pushed))],
    ['確認日', (d) => cell(fmtDate(d.checked_at))],
    ['状態', (d) => cell(STATUS_LABEL[d.status] || d.status)],
    ['要約', (d) => cell(h('span', { class: 'summary' }, d.summary))],
    ['OS', (d) => cell(unknown(reqValue(d, 'os').value))],
    ['GPU', (d) => cell(unknown(reqValue(d, 'gpu').value))],
    ['VRAM', (d) => cell(unknown(reqValue(d, 'vram').value))],
    ['対応ロボット', (d) => cell(unknown(reqValue(d, 'robot').value))],
    ['シミュレータ', (d) => cell(unknown(reqValue(d, 'sim').value))],
    ['Sim 評価', (d) => cell(SIM[d.verification.sim]?.[0] || '未確認', SIM[d.verification.sim]?.[1] === 'yes' ? 'good' : '')],
    ['実機評価', (d) => cell(REAL[d.verification.real]?.[0] || '未確認', ['yes', 'partial'].includes(REAL[d.verification.real]?.[1]) ? 'good' : '')],
    ['再現性', (d) => cell(REPRO[d.verification.repro]?.[0] || '未確認', REPRO[d.verification.repro]?.[1] === 'yes' ? 'good' : '')],
    ['コード', (d) => cell(unknown(d.licenses?.code?.value))],
    ['重み', (d) => cell(unknown(d.licenses?.weights?.value))],
    ['データ', (d) => cell(unknown(d.licenses?.data?.value))],
    ['リンク', (d) => cell(h('div', { class: 'link-list' },
      h('a', { class: 'link-pill', href: d.links.github, ...ext }, 'GitHub ↗'),
      d.links.paper ? h('a', { class: 'link-pill', href: d.links.paper, ...ext }, '論文 ↗') : null))],
  ];
  return h('div', { class: 'cmp-wrap' },
    h('table', { class: 'cmp-table' },
      h('thead', null, h('tr', null, h('th', null, '項目'), ds.map((d) => h('th', { class: 'cmp-head' },
        h('div', { class: 'c' }, h('div', null, h('div', { class: 'n' }, h('a', { href: projectHref(d) }, d.name)), h('div', { class: 'f' }, d.full_name)),
          h('button', { class: 'rm', type: 'button', title: '比較から外す', 'aria-label': `${d.name} を比較から外す`, onclick: () => removeCompare(d.id) }, '×')))))),
      h('tbody', null, rows.map(([label, fn]) => h('tr', null, h('th', null, label), ds.map(fn))))));
}
function compare() {
  let ids = S.ids.length ? S.ids : CMP.slice();
  ids = [...new Set(ids)].filter((id) => P_BY_ID[id]).slice(0, MAX_COMPARE);
  if (ids.length && JSON.stringify(CMP) !== JSON.stringify(ids)) {
    CMP = ids.slice();
    storeSet(COMPARE_KEY, JSON.stringify(CMP));
    updateCompareCount();
  }
  if (!S.ids.length && ids.length) { S.ids = ids; syncUrl(); }
  const wrap = h('div');
  wrap.append(h('div', { class: 'page-head' },
    h('p', { class: 'kicker' }, 'Compare'),
    h('h1', null, '技術を並べて比べる'),
    h('p', { class: 'lede' }, '最大 4 件まで。動作条件・検証状況・ライセンスを同じ表で見比べます。空欄や「未確認」は、そのまま判断材料にしてください。')));
  wrap.append(h('div', { class: 'facts' }, h('span', null, `${ids.length} 件を選択中`), h('span', { class: 'dotsep' }), h('span', null, '比較はブラウザに保存されます')));
  wrap.append(comparePicker(ids, null));
  if (!ids.length) {
    wrap.append(h('div', { class: 'empty' },
      h('h2', null, '比較する技術を選んでください'),
      h('p', null, '上の選択欄から追加するか、カタログの「＋比較」ボタンで追加できます。まずは注目の実装から。'),
      h('div', { class: 'cards', style: { 'text-align': 'left' } }, DATA.projects.filter((p) => p.featured).slice(0, 4).map(projectCard))));
    return wrap;
  }
  const host = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), '比較データを読み込み中…'));
  wrap.append(host);
  Promise.all(ids.map((id) => loadDetail(id).catch(() => null))).then((ds) => {
    if (!document.body.contains(host)) return;
    const ok = ds.filter(Boolean);
    if (!ok.length) { host.replaceChildren(h('div', { class: 'empty' }, '比較データを読み込めませんでした。')); return; }
    host.replaceChildren(compareTable(ok));
  });
  return wrap;
}

// ---------- paths ----------
function pathsView() {
  return h('div', null,
    h('div', { class: 'page-head' },
      h('p', { class: 'kicker' }, 'Learning paths'),
      h('h1', null, '何から読み、何から試すか'),
      h('p', { class: 'lede' }, 'プロジェクトと論文を、目的別の順番でつなぎました。すべてを一度に学ぶ必要はありません。自分の機体・予算・期限に近いパスから始めてください。')),
    h('div', { class: 'facts' }, h('span', null, `${DATA.paths.length} パス`), h('span', { class: 'dotsep' }), h('span', null, '各パスは 6 ステップ')),
    h('div', { class: 'path-grid' }, DATA.paths.map(pathCard)));
}
function pathDetail() {
  const p = PATH_BY_ID[S.path];
  if (!p) return notFound('学習パスが見つかりません。');
  return h('div', null,
    h('nav', { class: 'crumbs', 'aria-label': 'パンくず' }, h('a', { href: '#/' }, 'ホーム'), h('span', { class: 'sep' }, '/'),
      h('a', { href: '#/paths' }, '学習パス'), h('span', { class: 'sep' }, '/'), h('span', null, p.title)),
    h('div', { class: 'path-head' },
      h('p', { class: 'kicker' }, 'Learning path'),
      h('h1', null, p.title),
      h('p', { class: 'lede' }, p.subtitle),
      h('div', { class: 'path-meta' },
        h('span', { class: 'chip' }, p.level), h('span', { class: 'chip' }, p.time),
        ...p.uses.map((u) => h('span', { class: 'chip' }, USE_BY_ID[u]?.label || u))),
      h('p', { class: 'lede', style: { 'font-size': '13px' } }, h('b', null, '到達点: '), p.outcome)),
    h('div', { class: 'timeline' }, p.steps.map((s, i) => {
      const pr = P_BY_ID[s.project];
      return h('div', { class: 'step' },
        h('div', { class: 'num' }, String(i + 1).padStart(2, '0')),
        h('div', { class: 'body' },
          h('div', { class: 'top' }, h('span', { class: 'cat-badge', style: { '--cat': pr.category_color } }, pr.category_label),
            h('span', { class: 'small', style: { color: 'var(--muted-2)' } }, `★ ${starText(pr.stars)}`)),
          h('h3', null, h('a', { href: projectHref(pr), style: { color: 'var(--text)' } }, pr.name)),
          h('p', { class: 'why' }, s.why),
          h('div', { class: 'links' },
            h('a', { class: 'btn sm', href: projectHref(pr) }, '詳細を見る →'),
            pr.links?.github ? h('a', { class: 'btn sm ghost', href: pr.links.github, ...ext }, 'GitHub ↗') : null)));
    })),
    h('div', { class: 'path-papers' },
      h('div', { class: 'section-head' }, h('h2', null, 'このパスの論文'), h('a', { href: '#/paths' }, '他のパス →')),
      h('ul', { class: 'paper-list' }, p.papers.map((x) => h('li', null,
        extLink(x.url, x.title, ''), x.note ? h('div', { class: 'note' }, x.note) : null)))),
    h('div', { style: { 'margin-top': '20px' } }, h('a', { class: 'btn', href: '#/paths' }, '← 学習パス一覧')));
}

// ---------- about / 404 ----------
function about() {
  const s = STATS;
  const P = (text) => h('p', null, text);
  return h('article', { class: 'prose' },
    h('h1', null, 'Physical AI Radar について'),
    h('p', { class: 'lede' }, 'Physical AI の論文・実装・動作条件を探せる技術カタログです。',
      '「この技術は何ができるのか」「論文とコードはどこにあり、動かすには何が必要か」に答えることを目的にしています。'),
    h('h2', null, 'なぜ作ったか'),
    P('Physical AI の情報は、論文・GitHub・モデルカード・シミュレータのドキュメントに分散しています。スター数だけでは、自分の機体で動くか、どの GPU が必要か、実機で確認されているかは分かりません。'),
    P('このサイトでは、技術カテゴリと用途タグで横断し、動作条件と検証状況を同じ形式で並べます。',
      h('strong', null, '不明な項目は空欄にせず「未確認」と表示'), 'し、AI による推測値は掲載しません。'),
    h('h2', null, '掲載基準'),
    h('ul', null, (s.inclusion || []).map((x) => h('li', null, x))),
    P(`現在 ${s.projects} 件を掲載しています。これは調査済みの全件ではなく、初版としてキュレーションした範囲です。`),
    h('h2', null, '分類'),
    h('p', null, '技術カテゴリは 1 件につき 1 つ、用途タグは複数付きます。カテゴリは「何の技術か」、用途は「どの現場で使うか」を表します。'),
    h('table', null, h('thead', null, h('tr', null, h('th', null, 'カテゴリ'), h('th', null, '件数'), h('th', null, '意味'))),
      h('tbody', null, s.categories_meta.map((c) => h('tr', null, h('td', null, c.label), h('td', null, num(s.by_category[c.id] || 0)), h('td', null, c.description))))),
    h('h2', null, '検証状況の定義'),
    h('table', null, h('thead', null, h('tr', null, h('th', null, '項目'), h('th', null, '値'), h('th', null, '意味'))),
      h('tbody', null,
        h('tr', null, h('td', null, 'Simulation'), h('td', null, '評価あり / 記載なし / 未確認 / 該当なし'), h('td', null, '論文・公式コード・公式ドキュメントにシミュレーション評価の記載があるか。')),
        h('tr', null, h('td', null, 'Real robot'), h('td', null, '開発元 / 第三者 / コミュニティ / 記載なし / 未確認'), h('td', null, '誰が実機で確認したか。開発元の評価とコミュニティの事例を分けています。')),
        h('tr', null, h('td', null, 'Reproduction'), h('td', null, '公式手順あり / 第三者再現あり / 記載なし / 未確認'), h('td', null, '第三者がコード・手順・重みを使って再現できる状態か。')),
        h('tr', null, h('td', null, '動作条件'), h('td', null, '公式確認 / コミュニティ情報 / 未確認 / 該当なし'), h('td', null, 'OS・GPU・VRAM・対応ロボット・シミュレータ・ランタイムの情報源の確度。'))),
    h('p', null, '初版 47 件には公式コードまたは公式手順があります。今回追加した 64 件は GitHub リポジトリの存在を確認した段階で、動作条件・実機評価・ライセンスは「未確認」です。第三者が独立に再現したことを確認できたものはまだ限定的で、',
      h('strong', null, '「公式手順あり」と「第三者再現あり」を混同しない'), 'ようにしています。確認できたものから更新します。'),
    h('div', { class: 'callout' }, h('p', null, h('strong', null, '「未確認」は失敗ではありません。'), ' 推測で埋めるより、確認できていないことを明示する方が技術選定に使えます。')),
    h('h2', null, '更新と公開の分離'),
    P('データ更新は GitHub Actions が毎週月曜 03:30 UTC に実行します。GitHub API からスター数・最終 push・ライセンスなどを取得し、週次スナップショットを追記します。'),
    P('データ更新に失敗した場合でも、前回のデータでサイト公開は継続します。そのため、画面には「サイトを再公開した日時」ではなく、',
      h('strong', null, '「データを最後に正常取得した日時」'), 'を表示しています。'),
    h('table', null, h('tbody', null,
      h('tr', null, h('th', null, 'データ最終取得'), h('td', null, fmtDateTime(s.last_success_at))),
      h('tr', null, h('th', null, 'サイト生成'), h('td', null, fmtDateTime(s.generated_at))),
      h('tr', null, h('th', null, 'スナップショット'), h('td', null, `${fmtDate(s.snapshot)}（${s.snapshots} 回分）`)),
      h('tr', null, h('th', null, '週次増加'), h('td', null, s.gain_ready ? '表示中' : '初回スナップショットのため計測中')))),
    h('h2', null, 'スター数について'),
    P('スター数は掲載条件にしていません。新しく公開された研究実装や、スターは少ないが重要な基盤も扱えるようにするためです。',
      'スター数は並び替えと参考指標としてのみ使い、検証状況や動作条件とは独立に表示します。'),
    h('h2', null, '論文と学習パス'),
    P('各プロジェクトの代表論文を 1〜2 本掲載し、目的別の学習パスでプロジェクトと論文をつないでいます。',
      'HackerPapers のような大規模な論文データベースではなく、実装を起点にした最小限の論文導線です。'),
    h('h2', null, '外部ベンチマーク情報'),
    P('BenchLM の広い LLM ベンチマーク一覧から、Physical AI に直接関係する RoboDojo Sim を参考情報として掲載しています。BenchLM のページでは 5 件の結果がすべて提供元報告とされ、評価ハーネスは公開されていません。独立に再現できる公開ベンチマークとしては扱わず、',
      h('a', { href: 'https://benchlm.ai/benchmarks/robodojosim', ...ext }, 'BenchLM の RoboDojo Sim 記録'), 'を参照してください。'),
    h('h2', null, 'データとライセンス'),
    P('キュレーションしたカタログデータは CC0 1.0 で公開しています。',
      h('a', { href: 'download/physical-ai-radar-data.zip' }, '物理 AI Radar データ（CSV / JSON / 履歴）'), ' からダウンロードできます。',
      '各プロジェクトのコード・重み・データは、それぞれのライセンスに従います。'),
    P('サイトのコードは MIT。GitHub のメタデータ、論文タイトル、README 由来の情報は各著作者に帰属します。'),
    h('h2', null, '注意'),
    h('ul', null,
      h('li', null, '掲載は特定の製品・研究の安全性や性能を保証するものではありません。'),
      h('li', null, '動作条件は公式ドキュメントの記載を要約したものです。実際の環境では依存バージョン、ドライバ、機体差を確認してください。'),
      h('li', null, '自動運転・運転支援・ロボットの実機利用は、各国の法規、安全審査、現場のリスク評価に従ってください。'),
      h('li', null, '誤り・更新の提案は GitHub の Issue で受け付けます。')),
    h('div', { class: 'callout' }, h('p', null, '掲載技術の追加・修正は ', h('a', { href: REPO_URL + '/issues', ...ext }, 'GitHub Issues'), ' へ。',
      '一次情報の URL と確認日を添えてもらえると助かります。'))));
}
function notFound(msg) {
  return h('div', { class: 'empty', style: { 'margin-top': '40px' } },
    h('h1', null, 'ページが見つかりません'),
    h('p', null, msg || 'URL が変わったか、掲載が終了した可能性があります。'),
    h('a', { class: 'btn primary', href: '#/' }, 'ホームへ戻る'),
    h('a', { class: 'btn', href: '#/browse', style: { 'margin-left': '6px' } }, 'カタログを見る'));
}

// ---------- footer ----------
function footer() {
  $('foot').replaceChildren(h('div', { class: 'foot-in' },
    h('div', { class: 'left' },
      h('div', { class: 'brandline' }, 'Physical AI Radar'),
      h('div', null, h('span', { class: 'pulse' }), `データ最終取得 ${fmtDateTime(STATS.last_success_at)} / サイト生成 ${fmtDateTime(STATS.generated_at)}`),
      h('div', null, `スナップショット ${fmtDate(STATS.snapshot)}（${STATS.snapshots} 回分）・掲載 ${num(STATS.projects)} 件`),
      h('div', null, 'データ更新とサイト公開は別です。更新に失敗しても、前回のデータで公開を継続します。'),
      h('div', { style: { 'margin-top': '6px' } },
        h('a', { href: '#/about' }, '掲載基準'), ' · ',
        h('a', { href: 'feed.xml' }, 'RSS'), ' · ',
        h('a', { href: 'download/physical-ai-radar-data.zip' }, 'オープンデータ (CC0)'), ' · ',
        h('a', { href: REPO_URL, ...ext }, 'ソース'), ' · ',
        h('a', { href: REPO_URL + '/issues', ...ext }, '修正を提案'))),
    h('div', { class: 'right' }, h('span', null, 'Built with Python + static JSON + GitHub Pages'), h('span', null, '© 2026'))));
}

// ---------- routing / render ----------
function render() {
  if (!DATA) return;
  nav();
  updateCompareCount();
  let node;
  switch (S.view) {
    case 'home': node = home(); document.title = 'Physical AI Radar — 論文・実装・動作条件を、ひとつの地図に。'; break;
    case 'browse':
      node = browse();
      document.title = (S.cat ? CAT_BY_ID[S.cat].label + ' — ' : '') + 'カタログ — Physical AI Radar';
      break;
    case 'detail':
      node = detailView(S.id);
      document.title = '読み込み中 — Physical AI Radar';
      break;
    case 'compare': node = compare(); document.title = '比較 — Physical AI Radar'; break;
    case 'paths': node = pathsView(); document.title = '学習パス — Physical AI Radar'; break;
    case 'path': node = pathDetail(); document.title = (PATH_BY_ID[S.path]?.title || '学習パス') + ' — Physical AI Radar'; break;
    case 'about': node = about(); document.title = 'このサイトについて — Physical AI Radar'; break;
    default: node = notFound(S.missing); document.title = '見つかりません — Physical AI Radar';
  }
  SEL = -1;
  $('app').replaceChildren(...[node].flat(Infinity).filter(Boolean));
  window.scrollTo(0, 0);
}
function route() {
  parseHash();
  if (document.activeElement !== $('q')) $('q').value = S.view === 'browse' ? S.q : '';
  render();
}
function activate(hash) { if (location.hash === hash) route(); else location.hash = hash; }

// ---------- header / keyboard ----------
function toggleTheme() {
  const root = document.documentElement;
  const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = t;
  storeSet(THEME_KEY, t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#060a0f' : '#f4f8fa');
}
function wireHeader() {
  let timer;
  $('q').addEventListener('input', (e) => {
    const val = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (S.view !== 'browse') {
        if (val.trim()) activate('#/browse?q=' + encodeURIComponent(val));
        return;
      }
      S.q = val; S.limit = PAGE;
      if (!val.trim() && S.sort === 'relevance') S.sort = 'stars';
      if (val.trim() && S.sort === 'stars') S.sort = 'relevance';
      syncUrl(); drawFilters(); drawList();
    }, 130);
  });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (S.view !== 'browse') { activate('#/browse?q=' + encodeURIComponent($('q').value)); return; }
      e.target.blur();
      setTimeout(() => selectCard(0), 100);
    }
  });
  $('theme').addEventListener('click', toggleTheme);
  $('keys-btn').addEventListener('click', () => $('keys').showModal());

  let g = false, gt;
  document.addEventListener('keydown', (e) => {
    if ($('keys')?.open) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Escape') {
      if (typing) { e.target.blur(); return; }
      if (S.view === 'detail' || S.view === 'path') { history.length > 1 ? history.back() : activate('#/'); return; }
      if (SEL >= 0) { document.querySelectorAll('.pcard.sel,.row.sel').forEach((x) => x.classList.remove('sel')); SEL = -1; }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (g) {
      g = false; clearTimeout(gt);
      if (e.key === 'h') { e.preventDefault(); activate('#/'); return; }
      if (e.key === 'b') { e.preventDefault(); activate('#/browse'); return; }
    }
    const cards = cardsOnPage();
    if (e.key === '/') { e.preventDefault(); $('q').focus(); $('q').select(); }
    else if (e.key === 'j') { e.preventDefault(); selectCard(SEL + 1); }
    else if (e.key === 'k') { e.preventDefault(); selectCard(SEL < 0 ? 0 : SEL - 1); }
    else if (e.key === 'Enter' && SEL >= 0 && cards[SEL]) { location.hash = cards[SEL].dataset.href || projectHref(P_BY_ID[cards[SEL].dataset.id]); }
    else if (e.key === 'o') {
      const p = SEL >= 0 && cards[SEL] ? P_BY_ID[cards[SEL].dataset.id] : (S.view === 'detail' ? P_BY_ID[S.id] : null);
      const url = p && httpUrl(p.links?.github);
      if (url) window.open(url, '_blank', 'noopener');
    }
    else if (e.key === 'c') {
      const p = SEL >= 0 && cards[SEL] ? P_BY_ID[cards[SEL].dataset.id] : (S.view === 'detail' ? P_BY_ID[S.id] : null);
      if (p) toggleCompare(p.id);
    }
    else if (e.key === 'g') { g = true; clearTimeout(gt); gt = setTimeout(() => { g = false; }, 900); }
    else if (e.key === 't') toggleTheme();
    else if (e.key === '?') { e.preventDefault(); $('keys').showModal(); }
  });
  window.addEventListener('hashchange', route);
}
function cardsOnPage() { return [...document.querySelectorAll('#app .pcard, #app .row')]; }
function selectCard(i) {
  const cards = cardsOnPage();
  if (!cards.length) return;
  SEL = Math.max(0, Math.min(cards.length - 1, i));
  cards.forEach((c, j) => c.classList.toggle('sel', j === SEL));
  cards[SEL].scrollIntoView({ block: 'nearest' });
}

// ---------- boot ----------
Promise.all([getJSON('data/index.json'), getJSON('data/stats.json'), getJSON('data/paths.json')])
  .then(([idx, stats, paths]) => {
    DATA = { projects: idx.projects, categories: idx.categories, uses: idx.uses, paths };
    STATS = stats;
    PATHS = paths;
    DATA.paths = paths;
    P_BY_ID = Object.fromEntries(DATA.projects.map((p) => [p.id, p]));
    PATH_BY_ID = Object.fromEntries(paths.map((p) => [p.id, p]));
    CAT_BY_ID = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));
    USE_BY_ID = Object.fromEntries(DATA.uses.map((u) => [u.id, u]));
    for (const p of DATA.projects) {
      p.haystack = [p.name, p.full_name, p.search_text || '', p.category_label, ...p.tags, ...p.use_labels, p.license_code]
        .join(' ').toLowerCase().replace(/0/g, 'o');
    }
    FUSE = new Fuse(DATA.projects, {
      keys: [{ name: 'name', weight: 4 }, { name: 'full_name', weight: 2 }, { name: 'summary', weight: 3 },
        { name: 'tags', weight: 2 }, { name: 'use_labels', weight: 1 }, { name: 'category_label', weight: 1 }],
      threshold: 0.34, ignoreLocation: true, minMatchCharLength: 1,
    });
    CMP = safeStoreList().filter((id) => P_BY_ID[id]).slice(0, MAX_COMPARE);
    footer();
    wireHeader();
    route();
  })
  .catch((e) => {
    console.error(e);
    $('app').replaceChildren(h('div', { class: 'empty', style: { 'margin-top': '40px' } },
      h('h1', null, 'データを読み込めませんでした'),
      h('p', null, `エラー: ${e.message}`),
      h('p', null, 'ローカルで確認する場合は python3 pipeline/build_site_data.py を実行し、site_dist/ を HTTP サーバーで配信してください。'),
      h('a', { class: 'btn', href: '#' }, '再読み込み')));
  });
