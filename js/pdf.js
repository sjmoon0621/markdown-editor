/* ────────────────────────────────────────────────────────────
   PDF 내보내기
   Paged.js 로 A4 페이지를 조판한 뒤 브라우저 인쇄로 PDF 저장.
   페이지 번호는 print.css 의 @page { @bottom-center } 가 넣는다.
   ──────────────────────────────────────────────────────────── */

const PDF = (() => {

  const PAGED_SRC = 'https://cdn.jsdelivr.net/npm/pagedjs@0.4.3/dist/paged.js';

  function loadPaged() {
    if (window.Paged) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PAGED_SRC;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('조판 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
      document.head.appendChild(s);
    });
  }

  function progress(text) {
    const el = document.querySelector('#pdf-progress');
    if (el) el.textContent = text;
  }

  /* 문서 하나를 <section class="print-doc"> 으로 */
  function buildDoc(text, path, i) {
    const sec = document.createElement('section');
    sec.className = 'print-doc';
    sec.id = `pdoc-${i}`;
    sec.innerHTML = MD.render(text);

    // 문서마다 id 가 겹치므로 접두어를 붙인다
    sec.querySelectorAll('[id]').forEach(el => { el.id = `d${i}-${el.id}`; });
    sec.querySelectorAll('a[href^="#"]').forEach(a => { a.setAttribute('href', `#d${i}-${a.getAttribute('href').slice(1)}`); });

    const h1 = sec.querySelector('h1');
    const title = h1 ? h1.textContent.replace(/#$/, '').trim() : stripExt(path);
    return { sec, title };
  }

  /**
   * @param scope   'current' | 'all'
   * @param opts    { cover:boolean, toc:boolean, title:string }
   */
  async function build(scope, opts) {
    const root = document.createElement('div');
    root.className = 'print-root';

    const targets = scope === 'all'
      ? S.mdFiles.map(f => f.path)
      : [S.current.path];

    /* 1. 본문 수집 */
    const docs = [];
    for (let i = 0; i < targets.length; i++) {
      const path = targets[i];
      progress(`원고 불러오는 중… ${i + 1}/${targets.length}`);

      let text;
      if (S.current && path === S.current.path) text = S.cm.getValue();      // 편집 중인 내용 반영
      else if (S.index && S.index.has(path)) text = S.index.get(path);
      else {
        text = (await S.gh.getFile(path)).text;
        if (S.index) S.index.set(path, text);
      }
      docs.push(buildDoc(text, path, i));
    }

    /* 2. 표지 */
    if (opts.cover) {
      const cover = document.createElement('section');
      cover.className = 'print-cover';
      const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      cover.innerHTML =
        `<div class="cv-title">${escHTML(opts.title)}</div>
         <div class="cv-rule"></div>
         <div class="cv-meta">${docs.length}개 단원<br>${today}</div>`;
      root.appendChild(cover);
    }

    /* 3. 목차 */
    if (opts.toc && docs.length > 1) {
      const toc = document.createElement('nav');
      toc.className = 'print-toc';
      const items = docs.map((d, i) =>
        `<li><a href="#pdoc-${i}">` +
        `<span class="toc-num">${i + 1}</span>` +
        `<span class="toc-text">${escHTML(d.title)}</span>` +
        `<span class="toc-dots"></span></a></li>`
      ).join('');
      toc.innerHTML = `<h1>목차</h1><ol>${items}</ol>`;
      root.appendChild(toc);
    }

    docs.forEach(d => root.appendChild(d.sec));

    /* 4. 수식 */
    progress('수식 조판 중…');
    MD.typesetMath(root);

    /* 5. 이미지 — 페이지를 나누기 전에 실제 크기를 알아야 한다.
          화면에 붙지 않은 요소라 loading="lazy" 면 영영 로드되지 않으므로 먼저 해제한다. */
    root.querySelectorAll('img').forEach(im => im.setAttribute('loading', 'eager'));

    const embedCount = root.querySelectorAll('img.md-embed[data-embed]').length;
    if (embedCount) progress(`이미지 불러오는 중… (${embedCount}개)`);
    await MD.resolveEmbeds(root, resolveImage);

    const imgs = [...root.querySelectorAll('img')].filter(im => im.getAttribute('src'));
    if (imgs.length) {
      progress(`이미지 준비 중… (${imgs.length}개)`);
      await Promise.all(imgs.map(im => im.complete && im.naturalWidth
        ? Promise.resolve()
        : new Promise(res => {
            const done = () => { clearTimeout(t); res(); };
            const t = setTimeout(done, 15000);   // 한 장이 막혀도 전체가 멈추지 않게
            im.addEventListener('load', done, { once: true });
            im.addEventListener('error', done, { once: true });
          })));
    }

    return { root, count: docs.length };
  }

  function escHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── 내보내기 실행 ──────────────────────────────── */

  /* 이전 조판 정리.
     Paged.js 는 페이지마다 ResizeObserver 를 붙이는데, 그냥 innerHTML 을 비우면
     관찰자가 살아남아 사라진 노드를 건드리며 예외를 던진다. 반드시 먼저 destroy. */
  let previewer = null;
  function teardown() {
    if (previewer) {
      try { previewer.chunker.removePages(0); } catch (e) {}
      try { previewer.polisher.destroy(); } catch (e) {}
      previewer = null;
    }
    const pages = document.querySelector('#pdf-pages');
    if (pages) pages.innerHTML = '';
  }

  async function run(scope, opts) {
    const overlay = document.querySelector('#pdf-overlay');
    const pages = document.querySelector('#pdf-pages');

    overlay.classList.remove('hidden');
    teardown();
    document.querySelector('#pdf-info').textContent = '';
    document.querySelector('#pdf-print').disabled = true;
    progress('준비 중…');

    try {
      await loadPaged();
      const { root, count } = await build(scope, opts);

      progress('페이지 나누는 중… (문서가 많으면 시간이 걸립니다)');
      previewer = new Paged.Previewer();
      const flow = await previewer.preview(root, ['css/print.css'], pages);

      const total = flow.total || pages.querySelectorAll('.pagedjs_page').length;
      document.querySelector('#pdf-info').textContent =
        `${count}개 문서 · ${total}쪽`;
      progress('');
      document.querySelector('#pdf-print').disabled = false;
    } catch (e) {
      progress('');
      teardown();
      overlay.classList.add('hidden');
      toast('PDF 준비 실패: ' + e.message, 'err', 7000);
      console.error(e);
    }
  }

  /* ── 옵션 대화상자 ──────────────────────────────── */

  async function open() {
    if (!S.current && !S.mdFiles.length) { toast('먼저 문서를 여세요.', 'warn'); return; }

    const defTitle = (S.gh.fullName.split('/')[1] || '교재').replace(/[-_]/g, ' ');

    document.querySelector('#modal-title').textContent = 'PDF 내보내기';
    document.querySelector('#modal-body').innerHTML = `
      <div class="pdf-opts">
        <label class="radio"><input type="radio" name="pdfscope" value="all" checked>
          <span><b>전체 문서</b> — ${S.mdFiles.length}개를 한 파일로</span></label>
        <label class="radio"><input type="radio" name="pdfscope" value="current" ${S.current ? '' : 'disabled'}>
          <span><b>현재 문서만</b>${S.current ? ` — ${escHTML(baseName(S.current.path))}` : ''}</span></label>
        <hr>
        <label class="field"><span>표지 제목</span>
          <input id="pdf-title" type="text" value="${escHTML(defTitle)}"></label>
        <label class="check"><input type="checkbox" id="pdf-cover" checked> 표지 넣기</label>
        <label class="check"><input type="checkbox" id="pdf-toc" checked> 목차 넣기 (쪽 번호 포함)</label>
      </div>`;

    const wrap = document.querySelector('#modal-actions');
    wrap.innerHTML = '';
    const ok = document.createElement('button');
    ok.className = 'btn primary'; ok.textContent = '만들기';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost'; cancel.textContent = '취소';
    wrap.append(ok, cancel);

    const m = document.querySelector('#modal');
    m.classList.remove('hidden');

    const close = () => { m.classList.add('hidden'); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    cancel.onclick = close;

    ok.onclick = () => {
      const scope = document.querySelector('input[name="pdfscope"]:checked').value;
      const opts = {
        title: document.querySelector('#pdf-title').value.trim() || '교재',
        cover: document.querySelector('#pdf-cover').checked,
        toc: document.querySelector('#pdf-toc').checked,
      };
      close();
      run(scope, opts);
    };
  }

  function bind() {
    document.querySelector('#pdf-btn').onclick = open;
    document.querySelector('#pdf-close').onclick = () => {
      document.querySelector('#pdf-overlay').classList.add('hidden');
      teardown();
    };
    document.querySelector('#pdf-print').onclick = () => window.print();
  }

  return { open, bind, run };
})();
