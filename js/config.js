/* ────────────────────────────────────────────────────────────
   기본 설정
   콘텐츠 저장소를 만든 뒤 아래 DEFAULT_REPO 를 본인 것으로 바꾸세요.
   예) 'mongsil88/gyojae-content'
   로그인 화면에서 직접 입력해도 되며, 입력값이 우선합니다.
   ──────────────────────────────────────────────────────────── */
const CONFIG = {
  DEFAULT_REPO:   'sjmoon0621/integrated-science-content',
  DEFAULT_BRANCH: 'main',

  // 붙여넣기·드래그로 올린 이미지가 저장되는 폴더
  ATTACHMENT_DIR: 'attachments',

  // 사이드바에 표시할 확장자
  MD_EXT: ['.md', '.markdown'],

  // 이미지로 취급할 확장자
  IMG_EXT: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'],

  // 원격 변경 감지 주기 (ms). 0 이면 끔
  POLL_INTERVAL: 45000,

  // 로컬 임시저장 주기 (ms)
  DRAFT_INTERVAL: 3000,
};

const LS = {
  token:  'tbe.token',
  repo:   'tbe.repo',
  branch: 'tbe.branch',
  theme:  'tbe.theme',
  last:   'tbe.lastFile',
  draft:  (repo, path) => `tbe.draft.${repo}:${path}`,
};
