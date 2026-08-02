/* ────────────────────────────────────────────────────────────
   피드백 댓글
   원고는 건드리지 않고 .comments/<문서경로>.json 에 따로 저장한다.

   위치 고정 방식:
   렌더된 본문 텍스트에서 [선택한 문장 + 앞뒤 문맥] 을 함께 저장해 두고,
   다시 열 때 그 문맥으로 위치를 찾는다. 원고가 수정돼 위치가 밀려도
   문장이 남아 있으면 따라간다. 문장 자체가 사라지면 "위치 없음" 으로 표시한다.
   ──────────────────────────────────────────────────────────── */

const CMT = (() => {

  const CTX = 48;                 // 앞뒤 문맥 길이
  let data = { version: 1, comments: [] };
  let fileSha = null;
  let docPath = null;
  let index = null;               // { text, nodes }
  let showResolved = false;
  let pending = null;             // 선택 영역 임시 보관

  const q = s => document.querySelector(s);
  const path = doc => `.comments/${doc}.json`;
  const now = () => new Date().toISOString();
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ── 표시 이름 ──────────────────────────────────── */

  function displayName() {
    return localStorage.getItem('tbe.displayName')
        || (S.user && (S.user.name || S.user.login))
        || '익명';
  }

  async function askName() {
    const v = await promptModal('댓글에 표시할 이름', '이름', displayName());
    if (v) { localStorage.setItem('tbe.displayName', v); renderPanel(); }
  }

  /* ── 저장소 입출력 ──────────────────────────────── */

  async function load(doc) {
    docPath = doc;
    data = { version: 1, comments: [] };
    fileSha = null;
    try {
      const f = await S.gh.getFile(path(doc));
      fileSha = f.sha;
      const parsed = JSON.parse(f.text);
      if (parsed && Array.isArray(parsed.comments)) data = parsed;
    } catch (e) {
      if (e.status !== 404) console.warn('댓글을 불러오지 못했습니다', e);
    }
  }

  /* 같은 문서에 두 사람이 댓글을 달면 목록을 합친다 (덮어쓰지 않는다) */
  function merge(mine, theirs) {
    const byId = new Map();
    [...theirs, ...mine].forEach(c => {
      const prev = byId.get(c.id);
      if (!prev) { byId.set(c.id, c); return; }
      const keep = (c.updatedAt || c.createdAt) > (prev.updatedAt || prev.createdAt) ? c : prev;
      const rep = new Map();
      [...(prev.replies || []), ...(c.replies || [])]
        .forEach(r => rep.set(r.createdAt + '|' + r.author, r));
      keep.replies = [...rep.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      byId.set(c.id, keep);
    });
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function save() {
    if (!S.canWrite) { toast('편집 권한이 없습니다.', 'warn'); return false; }
    const body = JSON.stringify(data, null, 2);
    const msg = `댓글: ${baseName(docPath)} (${displayName()})`;
    try {
      const res = await S.gh.putText(path(docPath), body, msg, fileSha);
      fileSha = res.content.sha;
      return true;
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        try {
          const f = await S.gh.getFile(path(docPath));
          const remote = JSON.parse(f.text);
          data.comments = merge(data.comments, remote.comments || []);
          const res = await S.gh.putText(path(docPath), JSON.stringify(data, null, 2), msg, f.sha);
          fileSha = res.content.sha;
          toast('다른 사람의 댓글과 합쳤습니다.', 'info');
          return true;
        } catch (e2) { toast('댓글 저장 실패: ' + e2.message, 'err', 6000); return false; }
      }
      toast('댓글 저장 실패: ' + e.message, 'err', 6000);
      return false;
    }
  }

  /* ── 본문 텍스트 색인 ───────────────────────────── */

  function buildIndex(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        // 수식 내부는 글자가 잘게 쪼개져 있어 문맥 매칭에 방해가 된다
        if (n.parentElement.closest('.katex, .frontmatter')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let text = '', n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length, end: text.length + n.nodeValue.length });
      text += n.nodeValue;
    }
    return { text, nodes };
  }

  function offsetOf(node, off) {
    if (!index) return -1;
    const e = index.nodes.find(x => x.node === node);
    return e ? e.start + off : -1;
  }

  /* 저장된 문맥으로 위치를 다시 찾는다. 못 찾으면 -1 */
  function relocate(c) {
    const t = index.text;
    const tries = [
      (c.prefix || '') + c.quote + (c.suffix || ''),
      c.quote + (c.suffix || ''),
      (c.prefix || '') + c.quote,
      c.quote,
    ];
    for (let i = 0; i < tries.length; i++) {
      const probe = tries[i];
      if (!probe) continue;
      const at = t.indexOf(probe);
      if (at < 0) continue;
      // 앞 문맥을 포함해 찾았으면 그만큼 뒤로 밀어 실제 문장 시작점을 잡는다
      const lead = (i === 0 || i === 2) ? (c.prefix || '').length : 0;
      return at + lead;
    }
    return -1;
  }

  /* ── 하이라이트 ─────────────────────────────────── */

  function paint(start, end, c) {
    const marks = [];
    index.nodes.forEach(e => {
      if (e.end <= start || e.start >= end) return;
      const from = Math.max(start, e.start) - e.start;
      const to   = Math.min(end, e.end) - e.start;
      const node = e.node;
      if (from >= to) return;

      const mid = node.splitText(from);
      if (to - from < mid.nodeValue.length) mid.splitText(to - from);

      const mark = document.createElement('mark');
      mark.className = 'cmt-mark' + (c.resolved ? ' resolved' : '');
      mark.dataset.cid = c.id;
      mark.title = `${c.author}: ${c.body}`;
      mid.parentNode.replaceChild(mark, mid);
      mark.appendChild(mid);
      marks.push(mark);
    });
    marks.forEach(m => {
      m.onclick = ev => { ev.stopPropagation(); focusComment(c.id); };
    });
    return marks.length > 0;
  }

  /** 미리보기가 다시 그려질 때마다 호출된다 */
  function applyToPreview() {
    const root = q('#preview');
    if (!root || !docPath) return;
    index = buildIndex(root);

    data.comments.forEach(c => {
      c._found = false;
      if (c.resolved && !showResolved) return;
      const at = relocate(c);
      if (at < 0) return;
      // 위치를 칠하면 텍스트 노드가 쪼개지므로 색인을 다시 만든다
      if (paint(at, at + c.quote.length, c)) c._found = true;
      index = buildIndex(root);
    });

    renderPanel();
  }

  /* ── 패널 ───────────────────────────────────────── */

  function open()  { q('#cmt-panel').classList.remove('hidden'); q('#panes').classList.add('with-cmt'); renderPanel(); S.cm && S.cm.refresh(); }
  function close() { q('#cmt-panel').classList.add('hidden'); q('#panes').classList.remove('with-cmt'); S.cm && S.cm.refresh(); }
  function toggle(){ q('#cmt-panel').classList.contains('hidden') ? open() : close(); }

  function updateBadge() {
    const n = data.comments.filter(c => !c.resolved).length;
    const btn = q('#cmt-btn');
    if (btn) btn.textContent = n ? `댓글 ${n}` : '댓글';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderPanel() {
    updateBadge();
    const list = q('#cmt-list');
    if (!list) return;
    q('#cmt-name').textContent = displayName();

    const items = data.comments.filter(c => showResolved || !c.resolved);
    if (!items.length) {
      list.innerHTML = `<div class="cmt-empty">아직 댓글이 없습니다.<br>
        오른쪽 미리보기에서 문장을 드래그하면 댓글을 달 수 있습니다.</div>`;
      return;
    }

    list.innerHTML = items.map(c => `
      <div class="cmt-card${c.resolved ? ' resolved' : ''}${c._found === false ? ' orphan' : ''}" data-cid="${c.id}">
        <div class="cmt-quote">${esc(c.quote)}</div>
        ${c._found === false ? '<div class="cmt-orphan-note">본문에서 이 문장을 찾을 수 없습니다 (수정된 듯)</div>' : ''}
        <div class="cmt-body">${esc(c.body)}</div>
        <div class="cmt-meta">${esc(c.author)} · ${relTime(c.createdAt)}</div>
        ${(c.replies || []).map(r => `
          <div class="cmt-reply">
            <div class="cmt-body">${esc(r.body)}</div>
            <div class="cmt-meta">${esc(r.author)} · ${relTime(r.createdAt)}</div>
          </div>`).join('')}
        <div class="cmt-actions">
          <button class="link-btn" data-act="reply">답글</button>
          <button class="link-btn" data-act="resolve">${c.resolved ? '다시 열기' : '해결'}</button>
          <button class="link-btn danger" data-act="delete">삭제</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.cmt-card').forEach(card => {
      const id = card.dataset.cid;
      card.onclick = e => { if (e.target.tagName !== 'BUTTON') scrollToMark(id); };
      card.querySelectorAll('button[data-act]').forEach(b => {
        b.onclick = e => { e.stopPropagation(); act(b.dataset.act, id); };
      });
    });
  }

  function scrollToMark(id) {
    const m = document.querySelector(`.cmt-mark[data-cid="${id}"]`);
    if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusComment(id, false);
  }

  function focusComment(id, scroll = true) {
    document.querySelectorAll('.cmt-card').forEach(c => c.classList.toggle('active', c.dataset.cid === id));
    document.querySelectorAll('.cmt-mark').forEach(m => m.classList.toggle('active', m.dataset.cid === id));
    if (scroll) {
      open();
      const card = document.querySelector(`.cmt-card[data-cid="${id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function act(kind, id) {
    const c = data.comments.find(x => x.id === id);
    if (!c) return;

    if (kind === 'reply') {
      const v = await promptModal('답글', '내용', '');
      if (!v) return;
      c.replies = c.replies || [];
      c.replies.push({ author: displayName(), body: v, createdAt: now() });
      c.updatedAt = now();
    } else if (kind === 'resolve') {
      c.resolved = !c.resolved;
      c.updatedAt = now();
    } else if (kind === 'delete') {
      const r = await modal({
        title: '댓글 삭제',
        bodyHTML: `<p>이 댓글과 답글을 지웁니다.</p><p class="hint">"${esc(c.body.slice(0, 60))}"</p>`,
        actions: [{ label: '삭제', value: 'ok', kind: 'danger' }, { label: '취소', value: null }],
      });
      if (r !== 'ok') return;
      data.comments = data.comments.filter(x => x.id !== id);
    }

    if (await save()) { schedulePreview(); toast('저장했습니다.', 'ok', 1500); }
  }

  /* ── 선택 → 새 댓글 ─────────────────────────────── */

  function onSelection() {
    const btn = q('#cmt-add');
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !docPath) { btn.classList.add('hidden'); pending = null; return; }

    const r = sel.getRangeAt(0);
    if (!q('#preview').contains(r.commonAncestorContainer)) { btn.classList.add('hidden'); return; }

    const start = offsetOf(r.startContainer, r.startOffset);
    const end   = offsetOf(r.endContainer, r.endOffset);
    const quote = sel.toString().trim();
    if (start < 0 || end < 0 || !quote || quote.length < 2) { btn.classList.add('hidden'); return; }

    const t = index.text;
    pending = {
      quote,
      prefix: t.slice(Math.max(0, start - CTX), start),
      suffix: t.slice(end, end + CTX),
    };

    const box = r.getBoundingClientRect();
    btn.style.left = Math.min(window.innerWidth - 110, box.left + box.width / 2 - 45) + 'px';
    btn.style.top  = Math.max(8, box.top - 40) + 'px';
    btn.classList.remove('hidden');
  }

  async function addComment() {
    // 모달이 열리면 선택이 풀리면서 pending 이 지워지므로 먼저 붙잡아 둔다
    const sel = pending;
    pending = null;
    if (!sel) return;

    q('#cmt-add').classList.add('hidden');
    if (!S.canWrite) { toast('편집 권한이 없습니다.', 'warn'); return; }
    if (S.dirty) { toast('먼저 문서를 저장한 뒤 댓글을 달아주세요.', 'warn', 5000); return; }

    const label = sel.quote.slice(0, 30) + (sel.quote.length > 30 ? '…' : '');
    const body = await promptModal(`댓글 — "${label}"`, '내용', '');
    if (!body) return;

    data.comments.push({
      id: uid(), quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix,
      body, author: displayName(), createdAt: now(), resolved: false, replies: [],
    });
    window.getSelection().removeAllRanges();

    if (await save()) { open(); schedulePreview(); toast('댓글을 달았습니다.', 'ok'); }
  }

  /* ── 초기화 ─────────────────────────────────────── */

  function bind() {
    q('#cmt-btn').onclick = toggle;
    q('#cmt-close').onclick = close;
    q('#cmt-add').onclick = addComment;
    q('#cmt-name-btn').onclick = askName;
    q('#cmt-show-resolved').onchange = e => { showResolved = e.target.checked; schedulePreview(); };
    document.addEventListener('selectionchange', () => setTimeout(onSelection, 10));
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('#cmt-add')) q('#cmt-add').classList.add('hidden');
    });
  }

  return { load, applyToPreview, bind, open, close, renderPanel,
           get count() { return data.comments.filter(c => !c.resolved).length; } };
})();
