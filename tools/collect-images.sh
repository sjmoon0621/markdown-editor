#!/usr/bin/env bash
# 원고가 참조하는 이미지를 옵시디언 볼트에서 찾아 content/attachments/ 로 복사한다.
#
#   ./tools/collect-images.sh <옵시디언_볼트_경로>
#
# 원고의 ![[파일명]] 을 모두 모아, 볼트 안에서 같은 이름의 파일을 찾아 복사한다.

set -uo pipefail

# 원고 폴더 위치. 다른 곳에 있으면 CONTENT_DIR 로 지정한다.
#   CONTENT_DIR=~/어딘가/content ./collect-images.sh <볼트경로>
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENT="${CONTENT_DIR:-$(cd "$HERE/../.." && pwd)/content}"
DEST="$CONTENT/attachments"

if [[ ! -d "$CONTENT" ]]; then
  echo "원고 폴더를 찾을 수 없습니다: $CONTENT" >&2
  echo "CONTENT_DIR 환경변수로 지정하세요." >&2
  exit 1
fi

VAULT="${1:-}"
if [[ -z "$VAULT" ]]; then
  echo "사용법: $0 <옵시디언_볼트_경로>" >&2
  echo "예:    $0 ~/Documents/Obsidian/과학탐구" >&2
  exit 1
fi
VAULT="${VAULT/#\~/$HOME}"
if [[ ! -d "$VAULT" ]]; then
  echo "볼트 폴더를 찾을 수 없습니다: $VAULT" >&2
  exit 1
fi

mkdir -p "$DEST"

# 1) 원고에서 임베드된 파일명 수집 (![[이름]] / ![[이름|크기]])
names="$(
  grep -roh '!\[\[[^]]*\]\]' "$CONTENT" --include='*.md' 2>/dev/null \
  | sed -E 's/^!\[\[//; s/\]\]$//; s/\|.*$//; s/#.*$//' \
  | sed -E 's/[[:space:]]+$//' \
  | sort -u
)"

if [[ -z "$names" ]]; then
  echo "원고에서 이미지 임베드를 찾지 못했습니다."
  exit 0
fi

total=0; copied=0; already=0; missing=0
missing_list=()

while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  # 이미지 확장자만 대상으로
  lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.svg|*.bmp|*.avif) ;;
    *) continue ;;
  esac
  total=$((total+1))

  if [[ -f "$DEST/$name" ]]; then
    already=$((already+1))
    continue
  fi

  # 볼트 안에서 같은 이름 찾기 (첫 번째 결과 사용)
  src="$(find "$VAULT" -type f -name "$name" -not -path '*/.git/*' -print -quit 2>/dev/null)"

  if [[ -n "$src" ]]; then
    cp "$src" "$DEST/$name"
    copied=$((copied+1))
    echo "  ✔ $name"
  else
    missing=$((missing+1))
    missing_list+=("$name")
  fi
done <<< "$names"

echo
echo "─────────────────────────────────────"
echo "참조된 이미지 ${total}개"
echo "  복사됨      $copied"
echo "  이미 있음   $already"
echo "  못 찾음     $missing"

if (( missing > 0 )); then
  echo
  echo "볼트에서 찾지 못한 파일:"
  printf '  %s\n' "${missing_list[@]}"
  echo
  echo "→ 파일명이 바뀌었거나 다른 볼트에 있을 수 있습니다."
  echo "  직접 $DEST 에 넣거나, 편집기에서 해당 위치에 이미지를 드래그해 올리세요."
fi

if (( copied > 0 )); then
  echo
  echo "다음 단계:"
  echo "  cd \"$CONTENT\" && git add attachments && git commit -m '이미지 추가' && git push"
fi
