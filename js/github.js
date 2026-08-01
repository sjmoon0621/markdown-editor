/* ────────────────────────────────────────────────────────────
   GitHub REST API 클라이언트
   비공개 저장소도 토큰만 있으면 읽기/쓰기가 가능합니다.
   ──────────────────────────────────────────────────────────── */

/* UTF-8 안전 base64 (한글 본문·파일명 대응) */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64decodeToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64decodeToText(b64) {
  return new TextDecoder('utf-8').decode(b64decodeToBytes(b64));
}

function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* 경로의 각 구간만 인코딩 (슬래시는 유지) */
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

class GitHubRepo {
  constructor(token, fullName, branch) {
    this.token = token;
    const [owner, repo] = fullName.split('/');
    this.owner = owner;
    this.repo = repo;
    this.fullName = fullName;
    this.branch = branch || 'main';
    this.api = 'https://api.github.com';
    this._blobCache = new Map();   // path -> objectURL
  }

  async request(path, options = {}) {
    const res = await fetch(this.api + path, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    if (res.status === 204) return null;

    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }

    if (!res.ok) {
      const err = new Error((data && data.message) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        err.message = 'GitHub API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.';
      }
      throw err;
    }
    return data;
  }

  /* ── 인증 / 권한 ─────────────────────────────────── */

  async verify() {
    const user = await this.request('/user');
    const repo = await this.request(`/repos/${this.owner}/${this.repo}`);
    const perms = repo.permissions || {};
    return {
      user,
      repo,
      canWrite: !!(perms.push || perms.admin || perms.maintain),
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    };
  }

  /* ── 파일 목록 ───────────────────────────────────── */

  async listTree() {
    const data = await this.request(
      `/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`
    );
    const files = (data.tree || []).filter(n => n.type === 'blob');
    if (data.truncated) console.warn('저장소가 커서 파일 목록이 잘렸습니다.');
    return files.map(f => ({ path: f.path, sha: f.sha, size: f.size }));
  }

  /* ── 파일 읽기 ───────────────────────────────────── */

  async getFile(path) {
    const data = await this.request(
      `/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`
    );
    return { text: b64decodeToText(data.content), sha: data.sha, size: data.size, path };
  }

  /* 파일의 현재 sha 만 확인 (원격 변경 감지용) */
  async getSha(path) {
    try {
      const data = await this.request(
        `/repos/${this.owner}/${this.repo}/commits?path=${encodePath(path)}&sha=${encodeURIComponent(this.branch)}&per_page=1`
      );
      return data && data[0] ? data[0].sha : null;
    } catch { return null; }
  }

  /* 바이너리(이미지)를 blob URL 로 — 비공개 저장소 대응 */
  async getBlobURL(path, sha) {
    if (this._blobCache.has(path)) return this._blobCache.get(path);

    let bytes;
    // 1MB 이하는 contents API 로 바로
    try {
      const data = await this.request(
        `/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`
      );
      if (data.content) {
        bytes = b64decodeToBytes(data.content);
      } else if (data.sha) {
        sha = data.sha;
      }
    } catch (e) {
      if (!sha) throw e;
    }

    // 1MB 초과 → blobs API (최대 100MB)
    if (!bytes) {
      const blob = await this.request(`/repos/${this.owner}/${this.repo}/git/blobs/${sha}`);
      bytes = b64decodeToBytes(blob.content);
    }

    const ext = path.split('.').pop().toLowerCase();
    const mime = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
    }[ext] || 'application/octet-stream';

    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    this._blobCache.set(path, url);
    return url;
  }

  /* ── 파일 쓰기 ───────────────────────────────────── */

  async putText(path, text, message, sha) {
    const body = {
      message,
      content: b64encode(text),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    return this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async putBinary(path, bytes, message) {
    return this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: bytesToB64(bytes), branch: this.branch }),
    });
  }

  async deleteFile(path, sha, message) {
    return this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });
  }

  /* ── 이력 ───────────────────────────────────────── */

  async history(path, limit = 20) {
    return this.request(
      `/repos/${this.owner}/${this.repo}/commits?path=${encodePath(path)}` +
      `&sha=${encodeURIComponent(this.branch)}&per_page=${limit}`
    );
  }

  async fileAtCommit(path, commitSha) {
    const data = await this.request(
      `/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${commitSha}`
    );
    return b64decodeToText(data.content);
  }
}
