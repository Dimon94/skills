#!/usr/bin/env bash
set -euo pipefail

# 把本仓库 skills/ 下的所有 skill 以 symlink 方式接入本地 agent 目录：
#   - ~/.claude/skills: Claude Code
#   - ~/.agents/skills: Codex / pi 等 Agent Skills 兼容运行时
# 每个条目都是指向本仓库的 symlink。普通目录可能含用户改造，拒绝覆盖。

REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_SKILLS_DIR="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DESTS=("$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR")

names=()
srcs=()
while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  names+=("$(basename "$src")")
  srcs+=("$src")
done < <(find "$REPO/skills" -name SKILL.md -not -path '*/node_modules/*' -print0)

for DEST in "${DESTS[@]}"; do
  # 若 $DEST 本身是指回本仓库的 symlink，继续写会污染工作区，直接报错退出
  if [ -L "$DEST" ]; then
    resolved="$(readlink -f "$DEST")"
    case "$resolved" in
    "$REPO" | "$REPO"/*)
      echo "error: $DEST is a symlink into this repo ($resolved)." >&2
      echo "Remove it (rm \"$DEST\") and re-run." >&2
      exit 1
      ;;
    esac
  fi

  mkdir -p "$DEST"

  for i in "${!names[@]}"; do
    name="${names[$i]}"
    src="${srcs[$i]}"
    target="$DEST/$name"

    if [ -e "$target" ] && [ ! -L "$target" ]; then
      echo "error: refusing to replace non-symlink: $target" >&2
      exit 1
    fi

    ln -sfn "$src" "$target"
    echo "linked $name -> $src ($DEST)"
  done
done
