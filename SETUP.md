# 설치 가이드

교재 원고를 여러 명이 온라인에서 함께 편집하는 시스템입니다.
저장소 두 개로 나눠서 **원고는 비공개**, **편집기 사이트는 공개**로 운영합니다.

```
공개 저장소 (GitHub Pages)          비공개 저장소
┌──────────────────────┐          ┌──────────────────────┐
│ 편집기 앱 (HTML/JS)   │ ──API──▶ │ 최종안_1차/*.md      │
│ github.io 에서 열림   │  토큰    │ attachments/*.png    │
└──────────────────────┘          └──────────────────────┘
        ↑                                   ↑
   누구나 열 수 있음                 협업자만 읽기·쓰기 가능
   (열어도 원고는 안 보임)
```

원고 자체는 앱 안에 들어있지 않습니다. 사이트에 들어와도 **본인 토큰이 없으면 아무것도 못 봅니다.**

---

## 1단계 — 비공개 저장소(원고) 만들기

GitHub에서 새 저장소를 만듭니다. 이름은 예를 들어 `integrated-science-content`, **Private** 로 설정.

그다음 터미널에서:

```bash
cd ~/Desktop/Claude/online-markdown-editor/content

git init
git branch -M main
git add .
git commit -m "교재 원고 최초 업로드"
git remote add origin https://github.com/sjmoon0621/integrated-science-content.git
git push -u origin main
```

## 2단계 — 이미지 채워 넣기

지금 원고에는 `![[...]]` 형태의 이미지 임베드가 **25개** 있는데 실제 이미지 파일이 하나도 없습니다.
옵시디언 볼트의 첨부 폴더에서 가져와야 합니다.

```bash
cd ~/Desktop/Claude/online-markdown-editor
./app/tools/collect-images.sh "<옵시디언 볼트 경로>"
```

예:

```bash
./app/tools/collect-images.sh ~/Documents/Obsidian/과학탐구
```

원고에서 참조하는 이미지만 골라 `content/attachments/` 로 복사하고, 못 찾은 파일은 목록으로 알려줍니다.
복사가 끝나면:

```bash
cd content
git add attachments
git commit -m "이미지 추가"
git push
```

## 3단계 — 공개 저장소(편집기 앱) 만들기

GitHub에서 새 저장소를 **Public** 으로 만듭니다. 이름은 두 가지 중 선택:

- `sjmoon0621.github.io` → 주소가 `https://sjmoon0621.github.io` 가 됩니다
- 아무 이름 (예: `markdown-editor`) → 주소가 `https://sjmoon0621.github.io/markdown-editor/` 가 됩니다

**먼저** `app/js/config.js` 에서 첫 줄을 1단계에서 만든 저장소로 바꿉니다.

```js
DEFAULT_REPO: 'sjmoon0621/integrated-science-content',
```

그리고 push:

```bash
cd ~/Desktop/Claude/online-markdown-editor/app

git init
git branch -M main
git add .
git commit -m "편집기 앱"
git remote add origin https://github.com/sjmoon0621/markdown-editor.git
git push -u origin main
```

## 4단계 — GitHub Pages 켜기

공개 저장소 → **Settings** → 왼쪽 **Pages** →
Source 를 `Deploy from a branch`, Branch 를 `main` / `/ (root)` 로 두고 Save.

1~2분 뒤 주소가 뜹니다.

## 5단계 — 편집자 초대

**비공개** 저장소 → **Settings** → **Collaborators** → **Add people** →
편집자의 GitHub 아이디를 넣고 권한은 **Write**.

여기 초대된 사람만 편집할 수 있습니다. 초대 안 된 사람은 사이트에 들어와도 저장소를 못 읽습니다.
공개 저장소에는 아무도 초대할 필요 없습니다.

## 6단계 — 각 편집자가 할 일 (한 번만)

1. GitHub 로그인 → 초대 메일/알림에서 **Accept invitation**
2. 프로필 → **Settings** → 맨 아래 **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
4. 설정:
   - **Repository access**: `Only select repositories` → 원고 저장소 선택
   - **Permissions** → Repository permissions → **Contents: Read and write**
   - **Expiration**: 원하는 기간 (최대 1년)
5. **Generate token** 후 나오는 문자열을 복사
6. 편집기 사이트에 접속해서 저장소 이름과 토큰을 붙여넣고 **접속**

토큰은 그 사람의 브라우저에만 저장됩니다. 다음부터는 자동 로그인됩니다.

---

## 사용법

| 기능 | 방법 |
|------|------|
| 저장 | `Cmd/Ctrl + S` 또는 저장 버튼 |
| 문서 검색 | `Cmd/Ctrl + P`, 파일명과 본문 모두 검색됨 |
| 이미지 넣기 | 편집창에 **붙여넣기** 또는 파일 **드래그 앤 드롭** → `![[파일명]]` 자동 삽입 |
| 굵게 / 기울임 | `Cmd+B` / `Cmd+I` |
| 위키링크 | `Cmd+K` → `[[문서 이름]]` |
| 하이라이트 | `Cmd+Shift+H` → `==강조==` |
| 문서 추가·이름변경·삭제 | 사이드바에서 **＋**, 또는 파일 **우클릭** |
| 변경 이력 / 되돌리기 | 상단 **이력** 버튼 |
| PDF 내보내기 | 상단 **PDF** 버튼 |
| 다크 모드 | 왼쪽 아래 ◐ |

### PDF로 저장

상단 **PDF** 버튼 → 범위(전체 / 현재 문서)와 표지·목차 여부를 고르면 A4로 조판된 미리보기가 뜹니다.
**PDF로 저장** 을 누르면 브라우저 인쇄창이 열립니다. 다음과 같이 설정하세요.

| 항목 | 값 |
|------|-----|
| 대상 | **PDF로 저장** |
| 용지 | **A4** |
| 여백 | **없음** — 여백은 이미 조판에 들어가 있습니다 |
| 배경 그래픽 | **켜기** — 표 머리행·콜아웃 음영이 나옵니다 |
| 머리글 및 바닥글 | **끄기** — 켜면 브라우저가 URL과 날짜를 덧붙입니다 |

- **쪽 번호는 매 페이지 맨 아래 가운데**에 들어갑니다. 표지에는 붙지 않습니다.
- 전체로 내보내면 단원마다 새 페이지에서 시작하고, 목차에는 각 단원의 실제 쪽 번호가 찍힙니다.
- 편집 중인 문서는 **저장하지 않은 내용까지 반영**되므로 미리 확인용으로 뽑아볼 수 있습니다.
- 그림·표·콜아웃·수식은 페이지 경계에서 잘리지 않게 처리됩니다.
- 문서 31개 기준 44쪽이 몇 초 안에 조판됩니다. 그림이 많으면 더 걸립니다.

### 지원하는 옵시디언 문법

- `![[그림.png]]`, `![[그림.png|400]]`, `![[그림.png|400x300]]`, `![[그림.png|그림 1. 설명]]`
- `[[문서]]`, `[[문서|별칭]]`, `[[문서#소제목]]` — 클릭하면 해당 문서로 이동
- `$수식$`, `$$블록 수식$$` (KaTeX)
- `==하이라이트==`, `%%주석%%` (주석은 미리보기에서 숨김)
- `> [!warning] 제목` 콜아웃 (`> [!tip]-` 하면 접힘)
- GFM 표, 체크박스, 각주, 코드블록

### 여러 명이 동시에 편집할 때

- 문서를 열어둔 상태에서 45초마다 서버를 확인합니다.
  - 내가 수정 중이 아니면 → 다른 사람의 변경을 자동으로 불러옵니다.
  - 내가 수정 중이면 → 상단에 "다른 편집자가 이 문서를 수정했습니다" 경고가 뜹니다.
- 그 상태로 저장하면 **충돌 창**이 뜨고 세 가지 중 고를 수 있습니다.
  - **사본으로 저장** (권장) — 내 내용을 새 파일로 저장, 원본은 그대로
  - **내 것으로 덮어쓰기** — 상대 변경이 최신본에서 사라짐 (이력에는 남음)
  - **내 변경 버리기** — 서버 최신본을 다시 불러옴
- 저장 안 한 내용은 3초마다 브라우저에 임시 저장됩니다. 실수로 창을 닫아도 다시 열면 복구를 물어봅니다.
- 실시간 공동 편집(구글 문서처럼 커서가 같이 보이는 것)은 서버가 필요해서 지원하지 않습니다.
  **문서(단원) 단위로 나눠 맡는 방식**을 권합니다.

---

## 자주 겪는 문제

**"저장소를 찾을 수 없습니다"**
→ 초대를 수락했는지, 토큰의 Repository access 에 그 저장소가 포함됐는지 확인하세요.

**"토큰이 유효하지 않거나 만료되었습니다"**
→ Fine-grained token 은 만료가 있습니다. 새로 발급받아 다시 붙여넣으세요.

**이미지가 "이미지 없음" 으로 뜸**
→ `content/attachments/` 에 그 파일이 없습니다. 2단계를 다시 하거나, 편집기에 이미지를 드래그해서 새로 올리세요.

**저장이 안 되고 "편집 권한이 없습니다"**
→ Collaborator 권한이 Read 로 되어 있거나, 토큰 Permissions 의 Contents 가 Read-only 입니다.

**옵시디언과 같이 쓰고 싶을 때**
→ 각자 로컬에서 원고 저장소를 `git clone` 한 뒤 그 폴더를 옵시디언 볼트로 열면 됩니다.
작업 전 `git pull`, 작업 후 `git add . && git commit && git push`.
웹 편집기와 옵시디언이 같은 저장소를 보므로 내용이 그대로 공유됩니다.
