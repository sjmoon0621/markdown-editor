/* ────────────────────────────────────────────────────────────
   교재 편집기 — 메인 로직
   ──────────────────────────────────────────────────────────── */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const S = {
  gh: null,
  user: null,
  canWrite: false,
  tree: [],            // 저장소 전체 파일
  mdFiles: [],         // 마크다운만
  imgFiles: [],        // 이미지만
  attach: new Map(),   // 소문자 파일명 → 경로 (이미지 해석용)
  byPath: new Map(),   // 경로 → {sha,size}
  current: null,       // {path, sha, text}
  dirty: false,
  index: null,         // 경로 → 본문 (내용 검색 캐시)
  cm: null,
  pollTimer: null,
  remoteChanged: false,
  collapsed: new Set(),
};

/* ── 유틸 ───────────────────────────────────────────── */

function toast(msg, kind = 'info', ms = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function relTime(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 2592000) return `${Math.floor(s / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

/* 한글 파일명 정규화.
   macOS 는 파일명을 NFD(자모 분리)로 다루는데 원고의 ![[...]] 는 보통 NFC(조합형)이다.
   눈에는 같아 보여도 문자열로는 달라서 정규화하지 않으면 이미지를 못 찾는다. */
function nfc(s) { return String(s).normalize('NFC'); }

/* 자연 정렬 — 숫자를 자릿수가 아니라 값으로 비교한다.
   numeric 옵션이 없으면 "10번" 이 "2번" 보다 앞에 온다. */
const collator = new Intl.Collator('ko', { numeric: true });
const byNaturalPath = (a, b) => collator.compare(nfc(a.path), nfc(b.path));

function baseName(p) { return p.split('/').pop(); }
function dirName(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function stripExt(p) { return baseName(p).replace(/\.[^.]+$/, ''); }

/* 모달 */
function modal({ title, bodyHTML, actions }) {
  return new Promise(resolve => {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHTML || '';
    const wrap = $('#modal-actions');
    wrap.innerHTML = '';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = `btn ${a.kind || 'ghost'}`;
      b.textContent = a.label;
      b.onclick = () => { close(); resolve(a.value); };
      wrap.appendChild(b);
    });
    const m = $('#modal');
    m.classList.remove('hidden');
    const onKey = e => { if (e.key === 'Escape') { close(); resolve(null); } };
    const onBg = e => { if (e.target === m) { close(); resolve(null); } };
    document.addEventListener('keydown', onKey);
    m.addEventListener('click', onBg);
    function close() {
      m.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      m.removeEventListener('click', onBg);
    }
    const inp = $('#modal-body input');
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

/* ── 로그인 ─────────────────────────────────────────── */

function initLogin() {
  $('#repo-input').value   = localStorage.getItem(LS.repo)   || CONFIG.DEFAULT_REPO;
  $('#branch-input').value = localStorage.getItem(LS.branch) || CONFIG.DEFAULT_BRANCH;
  $('#token-input').value  = localStorage.getItem(LS.token)  || '';

  $('#login-btn').onclick = doLogin;
  $('#token-input').onkeydown = e => { if (e.key === 'Enter') doLogin(); };

  applyTheme(localStorage.getItem(LS.theme) || 'light');

  if (localStorage.getItem(LS.token) && localStorage.getItem(LS.repo)) doLogin(true);
}

async function doLogin(silent = false) {
  const repo   = $('#repo-input').value.trim();
  const branch = $('#branch-input').value.trim() || 'main';
  const token  = $('#token-input').value.trim();
  const msg    = $('#login-msg');

  msg.textContent = '';
  msg.className = 'login-msg';

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    msg.textContent = '저장소는 "사용자명/저장소명" 형식으로 입력하세요.';
    msg.classList.add('err');
    return;
  }
  if (!token) {
    msg.textContent = '액세스 토큰을 입력하세요.';
    msg.classList.add('err');
    return;
  }

  $('#login-btn').disabled = true;
  $('#login-btn').textContent = '확인 중…';

  const gh = new GitHubRepo(token, repo, branch);
  try {
    const info = await gh.verify();
    S.gh = gh;
    S.user = info.user;
    S.canWrite = info.canWrite;

    localStorage.setItem(LS.token, token);
    localStorage.setItem(LS.repo, repo);
    localStorage.setItem(LS.branch, branch);

    $('#login').classList.add('hidden');
    $('#main').classList.remove('hidden');
    await startApp(info);
  } catch (e) {
    let text = e.message;
    if (e.status === 401) text = '토큰이 유효하지 않거나 만료되었습니다.';
    if (e.status === 404) text = '저장소를 찾을 수 없습니다. 이름이 맞는지, 토큰에 이 저장소 접근 권한이 있는지 확인하세요.';
    msg.textContent = text;
    msg.classList.add('err');
    if (silent) localStorage.removeItem(LS.token);
  } finally {
    $('#login-btn').disabled = false;
    $('#login-btn').textContent = '접속';
  }
}

function logout() {
  localStorage.removeItem(LS.token);
  location.reload();
}

/* ── 앱 시작 ────────────────────────────────────────── */

async function startApp(info) {
  $('#repo-label').textContent = S.gh.fullName + (info.isPrivate ? ' 🔒' : '');
  $('#user-avatar').src = S.user.avatar_url + '&s=44';
  $('#user-name').textContent = S.user.name || S.user.login;

  const badge = $('#perm-badge');
  badge.textContent = S.canWrite ? '편집 가능' : '읽기 전용';
  badge.className = 'badge ' + (S.canWrite ? 'ok' : 'warn');

  if (!S.canWrite) {
    toast('이 저장소의 편집 권한이 없습니다. 읽기 전용으로 엽니다.', 'warn', 6000);
  }

  initEditor();
  bindUI();
  await loadTree();

  const last = localStorage.getItem(LS.last);
  if (last && S.byPath.has(last)) openFile(last);
}

/* ── 파일 목록 ──────────────────────────────────────── */

async function loadTree() {
  setStatus('목록 불러오는 중…');
  try {
    S.tree = await S.gh.listTree();
  } catch (e) {
    setStatus('목록 실패', 'err');
    toast('파일 목록을 불러오지 못했습니다: ' + e.message, 'err', 6000);
    return;
  }

  S.byPath = new Map(S.tree.map(f => [f.path, f]));
  S.mdFiles = S.tree
    .filter(f => CONFIG.MD_EXT.some(e => f.path.toLowerCase().endsWith(e)))
    .sort(byNaturalPath);

  S.attach.clear();
  S.imgFiles = S.tree
    .filter(f => CONFIG.IMG_EXT.some(e => f.path.toLowerCase().endsWith(e)))
    .sort(byNaturalPath);
  S.imgFiles.forEach(f => {
    const k = nfc(baseName(f.path)).toLowerCase();
    if (!S.attach.has(k)) S.attach.set(k, f.path);
  });

  S.index = null;   // 검색 캐시 무효화
  renderTree();
  setStatus(`문서 ${S.mdFiles.length}개 · 이미지 ${S.imgFiles.length}개`);
}

function renderTree(filterFn = null, hits = null) {
  const box = $('#file-tree');
  box.innerHTML = '';

  const list = filterFn ? S.mdFiles.filter(f => filterFn(f)) : S.mdFiles;
  const imgs = filterFn ? S.imgFiles.filter(f => filterFn(f)) : S.imgFiles;

  if (!list.length && !imgs.length) {
    box.innerHTML = '<div class="tree-empty">일치하는 파일이 없습니다</div>';
    return;
  }

  // 폴더별 그룹
  const groups = new Map();
  list.forEach(f => {
    const d = dirName(f.path) || '(루트)';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(f);
  });

  for (const [dir, files] of groups) {
    const g = document.createElement('div');
    g.className = 'tree-group';

    const head = document.createElement('div');
    head.className = 'tree-dir';
    const isCollapsed = S.collapsed.has(dir);
    head.innerHTML = `<span class="caret">${isCollapsed ? '▸' : '▾'}</span>` +
                     `<span class="dir-name">${dir}</span><span class="dir-count">${files.length}</span>`;
    head.onclick = () => {
      S.collapsed.has(dir) ? S.collapsed.delete(dir) : S.collapsed.add(dir);
      renderTree(filterFn, hits);
    };
    g.appendChild(head);

    if (!isCollapsed) {
      files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'tree-file' + (S.current && S.current.path === f.path ? ' active' : '');
        item.dataset.path = f.path;
        item.innerHTML = `<span class="fname">${stripExt(f.path)}</span>`;
        if (hits && hits.has(f.path)) {
          const snip = document.createElement('div');
          snip.className = 'hit';
          snip.textContent = hits.get(f.path);
          item.appendChild(snip);
        }
        item.onclick = () => openFile(f.path);
        item.oncontextmenu = e => { e.preventDefault(); fileMenu(f.path, e); };
        g.appendChild(item);
      });
    }
    box.appendChild(g);
  }

  renderImageSection(box, imgs, filterFn);
}

/* ── 이미지 목록 ────────────────────────────────────── */

/** 이미지 섹션. 항목을 누르면 커서 위치에 ![[파일명]] 이 들어간다. */
function renderImageSection(box, imgs, filterFn) {
  if (!imgs.length) return;

  const KEY = '__images__';
  const open = !S.collapsed.has(KEY);

  const sec = document.createElement('div');
  sec.className = 'tree-group img-group';

  const head = document.createElement('div');
  head.className = 'tree-dir img-head';
  head.innerHTML = `<span class="caret">${open ? '▾' : '▸'}</span>` +
                   `<span class="dir-name">🖼 이미지</span><span class="dir-count">${imgs.length}</span>`;
  head.onclick = () => {
    S.collapsed.has(KEY) ? S.collapsed.delete(KEY) : S.collapsed.add(KEY);
    renderTree(filterFn, null);
  };
  sec.appendChild(head);

  if (open) {
    // 하위 폴더별로 다시 묶는다
    const byDir = new Map();
    imgs.forEach(f => {
      const d = dirName(f.path) || '(루트)';
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(f);
    });

    for (const [dir, files] of byDir) {
      if (byDir.size > 1) {
        const sub = document.createElement('div');
        sub.className = 'img-subdir';
        sub.textContent = dir.replace(/^attachments\/?/, '') || 'attachments';
        sec.appendChild(sub);
      }
      files.forEach(f => sec.appendChild(imageItem(f)));
    }
  }

  box.appendChild(sec);
}

function imageItem(f) {
  const name = baseName(f.path);
  const item = document.createElement('div');
  item.className = 'tree-img';
  item.title = `${f.path}\n클릭하면 문서에 ![[${name}]] 삽입`;

  const thumb = document.createElement('span');
  thumb.className = 'thumb';
  const label = document.createElement('span');
  label.className = 'iname';
  label.textContent = name;
  item.append(thumb, label);

  item.onclick = () => insertEmbed(name);
  item.oncontextmenu = e => { e.preventDefault(); imageMenu(f, e); };

  imgObserver.observe(item);
  item._imgPath = f.path;
  item._thumb = thumb;
  return item;
}

/* 보이는 것만 미리보기를 받아온다 (48개를 한꺼번에 받지 않도록) */
const imgObserver = new IntersectionObserver(entries => {
  entries.forEach(async en => {
    if (!en.isIntersecting) return;
    const el = en.target;
    imgObserver.unobserve(el);
    try {
      const url = await S.gh.getBlobURL(el._imgPath, (S.byPath.get(el._imgPath) || {}).sha);
      el._thumb.style.backgroundImage = `url("${url}")`;
      el._thumb.classList.add('loaded');
    } catch { el._thumb.classList.add('failed'); }
  });
}, { root: null, rootMargin: '150px' });

function insertEmbed(name) {
  if (!S.current) { toast('먼저 문서를 여세요.', 'warn'); return; }
  if (!S.canWrite) { toast('편집 권한이 없습니다.', 'warn'); return; }
  S.cm.replaceSelection(`![[${name}]]\n`);
  S.cm.focus();
  toast(`![[${name}]] 삽입`, 'ok', 1800);
}

function imageMenu(f, ev) {
  const name = baseName(f.path);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = ev.clientX + 'px';
  menu.style.top = ev.clientY + 'px';

  const items = [
    { label: '문서에 삽입', fn: () => insertEmbed(name) },
    { label: '파일명 복사', fn: () => {
        navigator.clipboard.writeText(name).then(
          () => toast('복사했습니다: ' + name, 'ok'),
          () => toast('복사에 실패했습니다.', 'err'));
      } },
    { label: '크게 보기', fn: () => previewImage(f) },
    { label: '삭제', fn: () => deleteImage(f), need: true, danger: true },
  ];

  items.forEach(it => {
    if (it.need && !S.canWrite) return;
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.className = 'danger';
    b.onclick = () => { menu.remove(); it.fn(); };
    menu.appendChild(b);
  });

  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function previewImage(f) {
  let url;
  try { url = await S.gh.getBlobURL(f.path, (S.byPath.get(f.path) || {}).sha); }
  catch (e) { toast('불러오지 못했습니다: ' + e.message, 'err'); return; }
  const kb = Math.round((S.byPath.get(f.path) || {}).size / 1024) || '?';
  await modal({
    title: baseName(f.path),
    bodyHTML: `<img class="img-preview" src="${url}" alt="">
               <p class="hint">${f.path} · ${kb} KB</p>`,
    actions: [
      { label: '문서에 삽입', value: 'insert', kind: 'primary' },
      { label: '닫기', value: null },
    ],
  }).then(r => { if (r === 'insert') insertEmbed(baseName(f.path)); });
}

async function deleteImage(f) {
  const r = await modal({
    title: '이미지 삭제',
    bodyHTML: `<p><b>${baseName(f.path)}</b> 를 저장소에서 삭제합니다.</p>
               <p class="hint">이 이미지를 쓰는 문서가 있으면 "이미지 없음"으로 바뀝니다.
               저장소 이력에는 남아 복구할 수 있습니다.</p>`,
    actions: [{ label: '삭제', value: 'ok', kind: 'danger' }, { label: '취소', value: null }],
  });
  if (r !== 'ok') return;
  try {
    await S.gh.deleteFile(f.path, f.sha, `이미지 삭제: ${baseName(f.path)} (${S.user.login})`);
    S.gh._blobCache.delete(f.path);
    await loadTree();
    schedulePreview();
    toast('삭제했습니다.', 'ok');
  } catch (e) { toast('삭제 실패: ' + e.message, 'err', 6000); }
}

/* ── 검색 ───────────────────────────────────────────── */

let searchTimer = null;
async function onSearch(q) {
  q = q.trim();
  if (!q) { renderTree(); return; }

  const lower = nfc(q).toLowerCase();
  const nameMatch = f => nfc(baseName(f.path)).toLowerCase().includes(lower);

  // 1차: 파일명
  renderTree(nameMatch);

  // 2차: 본문 (인덱스 구축 후)
  if (q.length < 2) return;
  if (!S.index) {
    setStatus('본문 검색 준비 중…');
    S.index = new Map();
    await Promise.all(S.mdFiles.map(async f => {
      try { S.index.set(f.path, (await S.gh.getFile(f.path)).text); } catch {}
    }));
    setStatus(`문서 ${S.mdFiles.length}개 · 이미지 ${S.imgFiles.length}개`);
    if ($('#file-search').value.trim() !== q) return;   // 그 사이 입력이 바뀜
  }

  const hits = new Map();
  S.mdFiles.forEach(f => {
    const text = S.index.get(f.path) || '';
    const i = text.toLowerCase().indexOf(lower);
    if (i >= 0) {
      hits.set(f.path, '…' + text.slice(Math.max(0, i - 30), i + q.length + 40).replace(/\n/g, ' ') + '…');
    }
  });

  renderTree(f => nameMatch(f) || hits.has(f.path), hits);
  const docHits = new Set([...hits.keys(), ...S.mdFiles.filter(nameMatch).map(f => f.path)]).size;
  const imgHits = S.imgFiles.filter(nameMatch).length;
  setStatus(`검색 결과 문서 ${docHits}건` + (imgHits ? ` · 이미지 ${imgHits}건` : ''));
}

/* ── 에디터 ─────────────────────────────────────────── */

function initEditor() {
  S.cm = CodeMirror.fromTextArea($('#editor'), {
    mode: { name: 'markdown', highlightFormatting: true },
    lineWrapping: true,
    lineNumbers: false,
    theme: 'default',
    placeholder: '왼쪽에서 문서를 선택하거나 ＋ 로 새 문서를 만드세요.',
    extraKeys: {
      'Enter': 'newlineAndIndentContinueMarkdownList',
      'Cmd-S': () => save(),
      'Ctrl-S': () => save(),
      'Cmd-B': () => wrapSel('**'),
      'Ctrl-B': () => wrapSel('**'),
      'Cmd-I': () => wrapSel('*'),
      'Ctrl-I': () => wrapSel('*'),
      'Cmd-K': () => wrapSel('[[', ']]'),
      'Ctrl-K': () => wrapSel('[[', ']]'),
      'Cmd-Shift-H': () => wrapSel('=='),
      'Ctrl-Shift-H': () => wrapSel('=='),
    },
  });

  S.cm.on('change', () => {
    if (!S.current) return;
    S.dirty = S.cm.getValue() !== S.current.text;
    updateSaveState();
    schedulePreview();
    scheduleDraft();
  });

  S.cm.on('scroll', syncScroll);

  // 이미지 붙여넣기
  S.cm.getWrapperElement().addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])];
    const files = items.filter(i => i.kind === 'file' && i.type.startsWith('image/'))
                       .map(i => i.getAsFile());
    if (files.length) { e.preventDefault(); uploadImages(files); }
  });
}

function wrapSel(open, close) {
  close = close || open;
  const cm = S.cm;
  const sel = cm.getSelection();
  if (sel) cm.replaceSelection(open + sel + close);
  else {
    const c = cm.getCursor();
    cm.replaceRange(open + close, c);
    cm.setCursor({ line: c.line, ch: c.ch + open.length });
  }
  cm.focus();
}

/* ── 문서 열기 / 저장 ───────────────────────────────── */

async function openFile(path, force = false) {
  if (!force && S.dirty) {
    const r = await modal({
      title: '저장하지 않은 변경이 있습니다',
      bodyHTML: `<p><b>${baseName(S.current.path)}</b> 의 변경 내용을 어떻게 할까요?</p>`,
      actions: [
        { label: '저장하고 이동', value: 'save', kind: 'primary' },
        { label: '버리고 이동', value: 'discard' },
        { label: '취소', value: null },
      ],
    });
    if (!r) return;
    if (r === 'save') { const ok = await save(); if (!ok) return; }
    else clearDraft();
  }

  setStatus('불러오는 중…');
  try {
    const f = await S.gh.getFile(path);
    S.current = { path, sha: f.sha, text: f.text };
    S.dirty = false;
    S.remoteChanged = false;

    // 로컬 임시저장본 확인
    const draft = localStorage.getItem(LS.draft(S.gh.fullName, path));
    let value = f.text;
    if (draft && draft !== f.text) {
      const r = await modal({
        title: '임시 저장된 내용이 있습니다',
        bodyHTML: '<p>이전에 저장하지 않고 닫은 내용이 브라우저에 남아 있습니다.</p>',
        actions: [
          { label: '임시 저장본 사용', value: 'draft', kind: 'primary' },
          { label: '서버 최신본 사용', value: 'remote' },
        ],
      });
      if (r === 'draft') value = draft;
      else clearDraft(path);
    }

    S.cm.setValue(value);
    S.cm.clearHistory();
    S.cm.refresh();
    S.dirty = value !== f.text;

    $('#crumb').textContent = path;
    document.title = stripExt(path) + ' — 교재 편집기';
    localStorage.setItem(LS.last, path);

    renderTree();
    await CMT.load(path);
    renderPreview();
    updateSaveState();
    setStatus('');
    startPolling();
    S.cm.focus();
  } catch (e) {
    setStatus('열기 실패', 'err');
    toast('문서를 열지 못했습니다: ' + e.message, 'err', 6000);
  }
}

function updateSaveState() {
  const btn = $('#save-btn');
  btn.disabled = !S.canWrite || !S.current || !S.dirty;
  btn.textContent = S.dirty ? '저장 •' : '저장';
  if (S.remoteChanged) setStatus('다른 편집자가 이 문서를 수정했습니다', 'warn');
}

async function save() {
  if (!S.current || !S.canWrite) return false;
  const text = S.cm.getValue();
  const path = S.current.path;

  setStatus('저장 중…');
  $('#save-btn').disabled = true;

  const msg = `편집: ${baseName(path)} (${S.user.login})`;

  try {
    const res = await S.gh.putText(path, text, msg, S.current.sha);
    S.current.sha = res.content.sha;
    S.current.text = text;
    S.dirty = false;
    S.remoteChanged = false;
    clearDraft(path);
    if (S.index) S.index.set(path, text);
    setStatus('저장됨 · ' + new Date().toLocaleTimeString('ko-KR'), 'ok');
    updateSaveState();
    return true;
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      $('#save-btn').disabled = false;
      return await resolveConflict(text);
    }
    setStatus('저장 실패', 'err');
    toast('저장하지 못했습니다: ' + e.message, 'err', 7000);
    updateSaveState();
    return false;
  }
}

async function resolveConflict(myText) {
  const path = S.current.path;
  let remote;
  try { remote = await S.gh.getFile(path); }
  catch { toast('충돌 확인에 실패했습니다.', 'err'); return false; }

  const r = await modal({
    title: '편집 충돌',
    bodyHTML:
      `<p>내가 문서를 여는 사이에 다른 편집자가 <b>${baseName(path)}</b> 를 저장했습니다.</p>
       <ul class="conflict-list">
         <li><b>내 것으로 덮어쓰기</b> — 상대방의 변경이 사라집니다 (이력에는 남습니다)</li>
         <li><b>사본으로 저장</b> — 내 내용을 새 파일로 저장하고 원본은 그대로 둡니다</li>
         <li><b>내 변경 버리기</b> — 서버 최신본을 불러옵니다</li>
       </ul>`,
    actions: [
      { label: '사본으로 저장', value: 'copy', kind: 'primary' },
      { label: '내 것으로 덮어쓰기', value: 'force' },
      { label: '내 변경 버리기', value: 'reload' },
      { label: '취소', value: null },
    ],
  });

  if (r === 'force') {
    try {
      const res = await S.gh.putText(path, myText, `충돌 해결 덮어쓰기: ${baseName(path)} (${S.user.login})`, remote.sha);
      S.current.sha = res.content.sha;
      S.current.text = myText;
      S.dirty = false; S.remoteChanged = false;
      clearDraft(path);
      setStatus('덮어쓰기 저장됨', 'ok');
      updateSaveState();
      return true;
    } catch (e) { toast('덮어쓰기 실패: ' + e.message, 'err'); return false; }
  }

  if (r === 'copy') {
    const copyPath = path.replace(/\.md$/i, '') + `_${S.user.login}_${stamp()}.md`;
    try {
      await S.gh.putText(copyPath, myText, `충돌 사본: ${baseName(copyPath)}`, null);
      toast('사본으로 저장했습니다: ' + baseName(copyPath), 'ok', 6000);
      await loadTree();
      await openFile(copyPath, true);
      return true;
    } catch (e) { toast('사본 저장 실패: ' + e.message, 'err'); return false; }
  }

  if (r === 'reload') { clearDraft(path); S.dirty = false; await openFile(path, true); return true; }

  return false;
}

/* ── 임시저장 (브라우저) ────────────────────────────── */

let draftTimer = null;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (S.current && S.dirty) {
      try { localStorage.setItem(LS.draft(S.gh.fullName, S.current.path), S.cm.getValue()); } catch {}
    }
  }, CONFIG.DRAFT_INTERVAL);
}
function clearDraft(path) {
  const p = path || (S.current && S.current.path);
  if (p) localStorage.removeItem(LS.draft(S.gh.fullName, p));
}

/* ── 원격 변경 감지 ─────────────────────────────────── */

function startPolling() {
  clearInterval(S.pollTimer);
  if (!CONFIG.POLL_INTERVAL) return;
  S.pollTimer = setInterval(async () => {
    if (!S.current || document.hidden) return;
    try {
      const f = await S.gh.getFile(S.current.path);
      if (f.sha === S.current.sha) return;

      if (!S.dirty) {
        S.current.sha = f.sha;
        S.current.text = f.text;
        const pos = S.cm.getScrollInfo().top;
        S.cm.setValue(f.text);
        S.cm.scrollTo(null, pos);
        renderPreview();
        toast('다른 편집자의 변경 내용을 불러왔습니다.', 'info', 4000);
      } else {
        S.remoteChanged = true;
        updateSaveState();
      }
    } catch {}
  }, CONFIG.POLL_INTERVAL);
}

/* ── 미리보기 ───────────────────────────────────────── */

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 220);
}

async function renderPreview() {
  const el = $('#preview');
  el.innerHTML = MD.render(S.cm.getValue());
  MD.typesetMath(el);

  el.querySelectorAll('a.wikilink').forEach(a => {
    a.onclick = e => { e.preventDefault(); gotoWikilink(a.dataset.wikilink, a.dataset.anchor); };
  });

  await MD.resolveEmbeds(el, resolveImage);
  CMT.applyToPreview();
}

/* ![[이름]] → 저장소 경로 → blob URL */
async function resolveImage(name) {
  name = nfc(name);
  let path = null;
  if (S.byPath.has(name)) path = name;
  if (!path && S.current) {
    const rel = (dirName(S.current.path) ? dirName(S.current.path) + '/' : '') + name;
    if (S.byPath.has(rel)) path = rel;
  }
  // 파일명만으로 저장소 전체에서 찾기 (하위 폴더에 있어도 됨) — 옵시디언과 같은 방식
  if (!path) path = S.attach.get(nfc(baseName(name)).toLowerCase()) || null;
  if (!path) return null;
  return S.gh.getBlobURL(path, (S.byPath.get(path) || {}).sha);
}

function gotoWikilink(target, anchor) {
  const t = target.toLowerCase();
  let hit = S.mdFiles.find(f => stripExt(f.path).toLowerCase() === t)
         || S.mdFiles.find(f => f.path.toLowerCase() === t || f.path.toLowerCase() === t + '.md')
         || S.mdFiles.find(f => stripExt(f.path).toLowerCase().includes(t));
  if (!hit) { toast(`"${target}" 문서를 찾을 수 없습니다.`, 'warn'); return; }

  openFile(hit.path).then(() => {
    if (!anchor) return;
    setTimeout(() => {
      const h = [...$('#preview').querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .find(x => x.textContent.replace(/#$/, '').trim() === anchor);
      if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
  });
}

/* 스크롤 동기화 */
let syncing = false;
function syncScroll() {
  if (syncing || !$('#panes').classList.contains('mode-split')) return;
  syncing = true;
  const info = S.cm.getScrollInfo();
  const denom = info.height - info.clientHeight;
  const ratio = denom > 0 ? info.top / denom : 0;
  const p = $('#pane-preview');
  p.scrollTop = ratio * (p.scrollHeight - p.clientHeight);
  requestAnimationFrame(() => { syncing = false; });
}

/* ── 이미지 업로드 ──────────────────────────────────── */

async function uploadImages(files) {
  if (!S.canWrite) { toast('편집 권한이 없습니다.', 'warn'); return; }
  if (!S.current) { toast('먼저 문서를 여세요.', 'warn'); return; }

  for (const file of files) {
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
    // Finder 에서 끌어다 놓으면 파일명이 NFD 로 들어오므로 NFC 로 맞춘다
    let name = file.name && !/^image\.\w+$/i.test(file.name)
      ? nfc(file.name).replace(/[/\\?%*:|"<>]/g, '-')
      : `Pasted image ${stamp()}${ext}`;

    // 이름 충돌 회피
    while (S.attach.has(nfc(name).toLowerCase())) {
      name = name.replace(/(\.\w+)$/, `_${Math.random().toString(36).slice(2, 6)}$1`);
    }

    const path = `${CONFIG.ATTACHMENT_DIR}/${name}`;
    setStatus(`이미지 업로드 중… ${name}`);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await S.gh.putBinary(path, bytes, `이미지 추가: ${name} (${S.user.login})`);

      S.attach.set(nfc(name).toLowerCase(), path);
      S.byPath.set(path, { path, sha: res.content.sha, size: file.size });
      S.gh._blobCache.set(path, URL.createObjectURL(file));

      S.imgFiles.push({ path, sha: res.content.sha, size: file.size });
      S.imgFiles.sort(byNaturalPath);
      renderTree();
      S.cm.replaceSelection(`![[${name}]]\n`);
      setStatus('이미지 업로드 완료', 'ok');
      schedulePreview();
    } catch (e) {
      setStatus('업로드 실패', 'err');
      toast(`이미지 업로드 실패 (${name}): ${e.message}`, 'err', 7000);
    }
  }
}

/* ── 파일 조작 ──────────────────────────────────────── */

function fileMenu(path, ev) {
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = ev.clientX + 'px';
  menu.style.top = ev.clientY + 'px';

  const items = [
    { label: '열기', fn: () => openFile(path) },
    { label: '이름 변경', fn: () => renameFile(path), need: true },
    { label: '복제', fn: () => duplicateFile(path), need: true },
    { label: '삭제', fn: () => deleteFile(path), need: true, danger: true },
  ];

  items.forEach(it => {
    if (it.need && !S.canWrite) return;
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.className = 'danger';
    b.onclick = () => { menu.remove(); it.fn(); };
    menu.appendChild(b);
  });

  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function renameFile(path) {
  const nv = await promptModal('이름 변경', '새 경로', path);
  if (!nv || nv === path) return;
  try {
    setStatus('이름 변경 중…');
    const f = await S.gh.getFile(path);
    await S.gh.putText(nv, f.text, `이름 변경: ${baseName(path)} → ${baseName(nv)}`, null);
    await S.gh.deleteFile(path, f.sha, `이름 변경 정리: ${baseName(path)}`);
    await loadTree();
    if (S.current && S.current.path === path) await openFile(nv, true);
    setStatus('이름 변경 완료', 'ok');
  } catch (e) { toast('이름 변경 실패: ' + e.message, 'err', 6000); setStatus(''); }
}

async function duplicateFile(path) {
  const nv = await promptModal('복제', '새 경로', path.replace(/\.md$/i, '_사본.md'));
  if (!nv) return;
  try {
    const f = await S.gh.getFile(path);
    await S.gh.putText(nv, f.text, `복제: ${baseName(path)} → ${baseName(nv)}`, null);
    await loadTree();
    await openFile(nv, true);
  } catch (e) { toast('복제 실패: ' + e.message, 'err', 6000); }
}

async function deleteFile(path) {
  const r = await modal({
    title: '문서 삭제',
    bodyHTML: `<p><b>${baseName(path)}</b> 를 삭제합니다.</p>
               <p class="hint">저장소 이력에는 남으므로 나중에 복구할 수 있습니다.</p>`,
    actions: [{ label: '삭제', value: 'ok', kind: 'danger' }, { label: '취소', value: null }],
  });
  if (r !== 'ok') return;
  try {
    const f = S.byPath.get(path);
    await S.gh.deleteFile(path, f.sha, `삭제: ${baseName(path)} (${S.user.login})`);
    if (S.current && S.current.path === path) {
      S.current = null; S.dirty = false; S.cm.setValue('');
      $('#crumb').textContent = '문서를 선택하세요';
      renderPreview();
    }
    await loadTree();
    toast('삭제했습니다.', 'ok');
  } catch (e) { toast('삭제 실패: ' + e.message, 'err', 6000); }
}

/* 입력 하나짜리 모달 */
function promptModal(title, label, value) {
  return new Promise(async resolve => {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML =
      `<label class="field"><span>${label}</span>
         <input id="prompt-input" type="text" spellcheck="false"></label>`;
    const inp = $('#prompt-input');
    inp.value = value || '';

    const wrap = $('#modal-actions');
    wrap.innerHTML = '';
    const ok = document.createElement('button');
    ok.className = 'btn primary'; ok.textContent = '확인';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost'; cancel.textContent = '취소';
    wrap.append(ok, cancel);

    const m = $('#modal');
    m.classList.remove('hidden');
    setTimeout(() => { inp.focus(); const d = inp.value.lastIndexOf('/') + 1; inp.setSelectionRange(d, inp.value.replace(/\.md$/i, '').length); }, 30);

    const done = v => { m.classList.add('hidden'); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') done(null); if (e.key === 'Enter') done(inp.value.trim()); };
    document.addEventListener('keydown', key);
    ok.onclick = () => done(inp.value.trim());
    cancel.onclick = () => done(null);
  });
}

/* ── 이력 ───────────────────────────────────────────── */

async function showHistory() {
  if (!S.current) { toast('먼저 문서를 여세요.', 'warn'); return; }
  const path = S.current.path;
  setStatus('이력 불러오는 중…');
  let commits;
  try { commits = await S.gh.history(path, 30); }
  catch (e) { toast('이력을 불러오지 못했습니다: ' + e.message, 'err'); setStatus(''); return; }
  setStatus('');

  if (!commits.length) { toast('이력이 없습니다.', 'info'); return; }

  const rows = commits.map(c => {
    const who = (c.author && c.author.login) || c.commit.author.name;
    const when = relTime(c.commit.author.date);
    return `<li data-sha="${c.sha}">
      <div class="hmsg">${MD_esc(c.commit.message.split('\n')[0])}</div>
      <div class="hmeta">${MD_esc(who)} · ${when}
        <button class="link-btn" data-view="${c.sha}">이 시점 내용 보기</button>
        <a href="${c.html_url}" target="_blank" rel="noopener">GitHub</a></div></li>`;
  }).join('');

  $('#modal-title').textContent = `변경 이력 — ${baseName(path)}`;
  $('#modal-body').innerHTML = `<ul class="history">${rows}</ul>`;
  $('#modal-actions').innerHTML = '';
  const close = document.createElement('button');
  close.className = 'btn ghost'; close.textContent = '닫기';
  close.onclick = () => $('#modal').classList.add('hidden');
  $('#modal-actions').appendChild(close);
  $('#modal').classList.remove('hidden');

  $('#modal-body').querySelectorAll('[data-view]').forEach(b => {
    b.onclick = async () => {
      try {
        const old = await S.gh.fileAtCommit(path, b.dataset.view);
        $('#modal').classList.add('hidden');
        const r = await modal({
          title: '이 시점의 내용',
          bodyHTML: `<pre class="old-src">${MD_esc(old)}</pre>`,
          actions: [
            { label: '이 내용으로 되돌리기', value: 'restore', kind: 'primary' },
            { label: '닫기', value: null },
          ],
        });
        if (r === 'restore') {
          S.cm.setValue(old);
          S.dirty = true;
          updateSaveState();
          schedulePreview();
          toast('편집창에 불러왔습니다. 저장해야 반영됩니다.', 'info', 5000);
        }
      } catch (e) { toast('불러오기 실패: ' + e.message, 'err'); }
    };
  });
}

function MD_esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── 테마 / 보기 모드 ───────────────────────────────── */

function applyTheme(t) {
  document.body.dataset.theme = t;
  localStorage.setItem(LS.theme, t);
}

function setViewMode(mode) {
  const panes = $('#panes');
  panes.className = 'panes mode-' + mode;
  $$('.seg').forEach(b => b.classList.remove('active'));
  $('#view-' + mode).classList.add('active');
  setTimeout(() => S.cm && S.cm.refresh(), 50);
}

/* ── 이벤트 바인딩 ──────────────────────────────────── */

function bindUI() {
  $('#refresh-btn').onclick = () => loadTree();
  $('#logout-btn').onclick = logout;
  $('#theme-btn').onclick = () =>
    applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#save-btn').onclick = () => save();
  $('#history-btn').onclick = showHistory;
  PDF.bind();
  CMT.bind();
  $('#sidebar-toggle').onclick = () => $('#sidebar').classList.toggle('hidden-side');

  $('#view-split').onclick = () => setViewMode('split');
  $('#view-edit').onclick  = () => setViewMode('edit');
  $('#view-read').onclick  = () => setViewMode('read');
  setViewMode('split');

  $('#file-search').oninput = e => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => onSearch(v), 250);
  };

  $('#new-file-btn').onclick = async () => {
    if (!S.canWrite) { toast('편집 권한이 없습니다.', 'warn'); return; }
    const dirs = [...new Set(S.mdFiles.map(f => dirName(f.path)).filter(Boolean))];
    const path = await promptModal('새 문서', '파일 경로', (dirs[0] ? dirs[0] + '/' : '') + '새 문서.md');
    if (!path) return;
    const full = /\.(md|markdown)$/i.test(path) ? path : path + '.md';
    if (S.byPath.has(full)) { toast('같은 이름의 문서가 이미 있습니다.', 'warn'); return; }
    try {
      await S.gh.putText(full, `# ${stripExt(full)}\n\n`, `새 문서: ${baseName(full)} (${S.user.login})`, null);
      await loadTree();
      await openFile(full, true);
    } catch (e) { toast('생성 실패: ' + e.message, 'err', 6000); }
  };

  // 드래그 앤 드롭 업로드
  const ws = document.querySelector('.workspace');
  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  ws.addEventListener('dragenter', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); dragDepth++; overlay.classList.remove('hidden');
  });
  ws.addEventListener('dragover', e => e.preventDefault());
  ws.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.add('hidden'); } });
  ws.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; overlay.classList.add('hidden');
    const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) uploadImages(files);
    else toast('이미지 파일만 업로드할 수 있습니다.', 'warn');
  });

  // 분할선 드래그
  const splitter = $('#splitter');
  splitter.addEventListener('mousedown', e => {
    e.preventDefault();
    const panes = $('#panes');
    const move = ev => {
      const r = panes.getBoundingClientRect();
      const pct = Math.min(85, Math.max(15, ((ev.clientX - r.left) / r.width) * 100));
      panes.style.setProperty('--split', pct + '%');
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging');
      S.cm.refresh();
    };
    document.body.classList.add('dragging');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // 전역 단축키
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); $('#file-search').focus(); }
  });

  window.addEventListener('beforeunload', e => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ── 시작 ───────────────────────────────────────────── */
initLogin();
