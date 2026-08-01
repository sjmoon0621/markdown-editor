/* ────────────────────────────────────────────────────────────
   옵시디언 문법 마크다운 렌더러
     ![[image.png]]  ![[image.png|400]]  ![[image.png|400x300]]
     [[문서]]  [[문서|별칭]]  [[문서#소제목]]
     ==하이라이트==   %%주석%%
     > [!note] 콜아웃
     $인라인 수식$   $$블록 수식$$
     GFM 표 · 체크박스 · 각주
   ──────────────────────────────────────────────────────────── */

const MD = (() => {

  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

  /* ── 콜아웃 종류 ─────────────────────────────────── */
  const CALLOUT = {
    note:     ['✎', '노트'],
    abstract: ['≡', '요약'], summary: ['≡', '요약'], tldr: ['≡', '요약'],
    info:     ['ⓘ', '정보'],
    todo:     ['☑', '할 일'],
    tip:      ['★', '팁'],   hint: ['★', '팁'], important: ['★', '중요'],
    success:  ['✔', '완료'], check: ['✔', '완료'], done: ['✔', '완료'],
    question: ['?', '질문'], help: ['?', '질문'], faq: ['?', '질문'],
    warning:  ['⚠', '주의'], caution: ['⚠', '주의'], attention: ['⚠', '주의'],
    failure:  ['✘', '실패'], fail: ['✘', '실패'], missing: ['✘', '실패'],
    danger:   ['⚡', '위험'], error: ['⚡', '위험'],
    bug:      ['🐞', '버그'],
    example:  ['❖', '예시'],
    quote:    ['❝', '인용'], cite: ['❝', '인용'],
  };

  /* ── marked 확장 ────────────────────────────────── */

  const mathBlock = {
    name: 'mathBlock', level: 'block',
    start(src) { const i = src.indexOf('$$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
      if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    },
    renderer(t) { return `<div class="math-block" data-tex="${esc(t.text)}"></div>`; },
  };

  const mathInline = {
    name: 'mathInline', level: 'inline',
    start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      // $$ 는 블록 담당, 통화 표기($5, 10$)는 제외
      const m = /^\$(?![\s$])((?:\\.|[^$\\])+?)\$(?!\d)/.exec(src);
      if (m && !/^\s|\s$/.test(m[1])) {
        return { type: 'mathInline', raw: m[0], text: m[1] };
      }
    },
    renderer(t) { return `<span class="math-inline" data-tex="${esc(t.text)}"></span>`; },
  };

  const embed = {
    name: 'embed', level: 'inline',
    start(src) { const i = src.indexOf('![['); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^!\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|([^\]]*?))?\]\]/.exec(src);
      if (m) return {
        type: 'embed', raw: m[0],
        target: m[1].trim(), anchor: (m[2] || '').trim(), opt: (m[3] || '').trim(),
      };
    },
    renderer(t) {
      if (IMG_RE.test(t.target)) {
        let attrs = '';
        const dim = /^(\d+)(?:x(\d+))?$/.exec(t.opt);
        if (dim) {
          attrs += ` width="${dim[1]}"`;
          if (dim[2]) attrs += ` height="${dim[2]}"`;
        }
        const cap = dim ? '' : t.opt;
        const img = `<img class="md-embed" data-embed="${esc(t.target)}" alt="${esc(cap || t.target)}"${attrs} loading="lazy">`;
        return cap
          ? `<figure class="md-figure">${img}<figcaption>${esc(cap)}</figcaption></figure>`
          : img;
      }
      // 노트 임베드는 링크로 대체
      return `<a href="#" class="wikilink embed-note" data-wikilink="${esc(t.target)}"` +
             ` data-anchor="${esc(t.anchor)}">📄 ${esc(t.opt || t.target)}</a>`;
    },
  };

  const wikilink = {
    name: 'wikilink', level: 'inline',
    start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|([^\]]*?))?\]\]/.exec(src);
      if (m) return {
        type: 'wikilink', raw: m[0],
        target: m[1].trim(), anchor: (m[2] || '').trim(), label: (m[3] || '').trim(),
      };
    },
    renderer(t) {
      const label = t.label || (t.anchor ? `${t.target} › ${t.anchor}` : t.target);
      return `<a href="#" class="wikilink" data-wikilink="${esc(t.target)}"` +
             ` data-anchor="${esc(t.anchor)}">${esc(label)}</a>`;
    },
  };

  const highlight = {
    name: 'highlight', level: 'inline',
    start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
    tokenizer(src, tokens) {
      const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
      if (m) {
        return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      }
    },
    renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
  };

  const comment = {
    name: 'obsComment', level: 'inline',
    start(src) { const i = src.indexOf('%%'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^%%[\s\S]*?%%/.exec(src);
      if (m) return { type: 'obsComment', raw: m[0] };
    },
    renderer() { return ''; },
  };

  /* ── 렌더러 오버라이드 ──────────────────────────── */

  const slugCount = {};
  function slug(text) {
    let s = String(text).toLowerCase().trim()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
    if (!s) s = 'h';
    slugCount[s] = (slugCount[s] || 0) + 1;
    return slugCount[s] > 1 ? `${s}-${slugCount[s]}` : s;
  }

  const renderer = {
    heading(text, level) {
      const id = slug(text.replace(/<[^>]*>/g, ''));
      return `<h${level} id="${id}" data-line-anchor="1">${text}` +
             `<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${level}>\n`;
    },

    blockquote(quote) {
      // 제목은 첫 줄(<br> 또는 </p> 앞)까지만 — breaks:true 라 본문이 같은 <p> 안에 들어온다
      const m = /^\s*<p>\s*\[!([\w-]+)\]([+-]?)[ \t]*(.*?)\s*(<br\s*\/?>|<\/p>)/i.exec(quote);
      if (!m) return `<blockquote>${quote}</blockquote>\n`;
      const kind = m[1].toLowerCase();
      const [icon, defTitle] = CALLOUT[kind] || ['✎', m[1]];
      const title = m[3].trim() || defTitle;
      // <br> 로 끊겼으면 남은 본문은 아직 같은 문단 안 → <p> 를 다시 열어준다
      let rest = quote.slice(m[0].length);
      if (/^<br/i.test(m[4]) && rest.trim()) rest = '<p>' + rest;
      const fold = m[2];
      const open = fold === '-' ? '' : ' open';
      const body = rest.trim() ? `<div class="callout-body">${rest}</div>` : '';
      if (fold) {
        return `<details class="callout callout-${kind}"${open}>` +
               `<summary class="callout-title"><span class="callout-icon">${icon}</span>${title}</summary>` +
               `${body}</details>\n`;
      }
      return `<div class="callout callout-${kind}">` +
             `<div class="callout-title"><span class="callout-icon">${icon}</span>${title}</div>` +
             `${body}</div>\n`;
    },

    link(href, title, text) {
      const ext = /^https?:\/\//i.test(href || '');
      const t = title ? ` title="${esc(title)}"` : '';
      const rel = ext ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(href)}"${t}${rel}>${text}</a>`;
    },

    image(href, title, text) {
      // 일반 마크다운 이미지도 저장소 상대경로면 지연 해석
      if (/^https?:\/\/|^data:/i.test(href || '')) {
        return `<img src="${esc(href)}" alt="${esc(text || '')}" loading="lazy">`;
      }
      return `<img class="md-embed" data-embed="${esc(href)}" alt="${esc(text || '')}" loading="lazy">`;
    },

    table(header, body) {
      return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;
    },
  };

  marked.use({
    gfm: true,
    breaks: true,          // 옵시디언 기본값과 동일하게 줄바꿈 유지
    extensions: [embed, wikilink, mathBlock, mathInline, highlight, comment],
    renderer,
  });

  /* ── 공개 API ───────────────────────────────────── */

  /** 마크다운 → 안전한 HTML 문자열 */
  function render(src) {
    for (const k in slugCount) delete slugCount[k];
    let body = String(src ?? '');
    let front = '';

    // YAML 프론트매터
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
    if (fm) {
      body = body.slice(fm[0].length);
      front = `<div class="frontmatter"><pre>${esc(fm[1])}</pre></div>`;
    }

    const html = marked.parse(body);
    return front + DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'loading', 'data-embed', 'data-wikilink', 'data-anchor', 'data-tex', 'open'],
      ADD_TAGS: ['details', 'summary', 'figure', 'figcaption', 'mark'],
    });
  }

  /** 삽입된 DOM 안의 수식을 KaTeX 로 렌더 */
  function typesetMath(root) {
    root.querySelectorAll('.math-inline[data-tex], .math-block[data-tex]').forEach(el => {
      if (el.dataset.done) return;
      try {
        katex.render(el.dataset.tex, el, {
          displayMode: el.classList.contains('math-block'),
          throwOnError: false,
          output: 'html',
          strict: false,
        });
      } catch (e) {
        el.textContent = el.dataset.tex;
        el.classList.add('math-error');
      }
      el.dataset.done = '1';
    });
  }

  /**
   * 삽입된 DOM 안의 ![[이미지]] 를 실제 이미지로 교체
   * @param resolve  (name) => Promise<string|null>  이미지 URL 을 돌려주는 함수
   */
  async function resolveEmbeds(root, resolve) {
    const imgs = [...root.querySelectorAll('img.md-embed[data-embed]')];
    await Promise.all(imgs.map(async img => {
      const name = img.dataset.embed;
      try {
        const url = await resolve(name);
        if (url) { img.src = url; img.removeAttribute('data-embed'); }
        else missing(img, name);
      } catch { missing(img, name); }
    }));

    function missing(img, name) {
      const span = document.createElement('span');
      span.className = 'embed-missing';
      span.textContent = `🖼 이미지 없음: ${name}`;
      span.title = `${name} 파일이 저장소에 없습니다`;
      img.replaceWith(span);
    }
  }

  /** 문서의 제목 목록 (목차용) */
  function outline(root) {
    return [...root.querySelectorAll('h1,h2,h3,h4')].map(h => ({
      level: +h.tagName[1],
      text: h.textContent.replace(/#$/, '').trim(),
      id: h.id,
    }));
  }

  return { render, typesetMath, resolveEmbeds, outline, IMG_RE };
})();
