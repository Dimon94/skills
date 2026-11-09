#!/usr/bin/env bash
# ==========================================================================
# L3
#   COORD: skills/git-worktree/scripts/worktree.sh
#   INPUT: 在目标仓库任一工作树内运行；git、find、lsof
#   OUTPUT: new 建树并打印路径；ls 打印在做清单（TSV）；gc 报告并按 --apply 回收
#   POS: 只管 WT_ROOT 下的树；不合入、不推送、不碰根目录外的树；prunable 元数据只报告不清理
#   TEST: node --test test/git-worktree.test.js
#   PROTOCOL: 改子命令或参数时同步 skills/git-worktree/SKILL.md
# L5
#   PARAM: WT_BASE 集成分支，默认 main
#   PARAM: WT_ROOT 树根目录，默认 <主工作树>.wt
#   PARAM: WT_MAX 根目录下同时存在的树上限，默认 4，整数 ≥ 1
#   PARAM: WT_SHARE 从主工作树软链复用的只读产物名，默认 "node_modules .env .venv"
#   FAIL: 名称不合法退出 2；达到上限退出 3；分支已存在退出 4
# L6
#   CHAIN: new 先跑 gc --apply 回收可证明安全的树，再查上限，再建树和软链
#   CHAIN: gc 只删同时满足 干净、有过提交、已并入 WT_BASE、无进程占用 的树；
#          其余保留并写明原因。永不 --force。
# ==========================================================================
set -euo pipefail

MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
BASE="${WT_BASE:-main}"
ROOT="${WT_ROOT:-$MAIN.wt}"
MAX="${WT_MAX:-4}"
SHARE="${WT_SHARE:-node_modules .env .venv}"

die() { echo "error: $2" >&2; exit "$1"; }

# 根目录下的树：每行 "<path>\t<branch>"
our_trees() {
  git -C "$MAIN" worktree list --porcelain | awk -v root="$ROOT/" '
    /^worktree / { path = substr($0, 10) }
    /^branch /   { if (index(path, root) == 1) print path "\t" substr($0, 19) }'
}

# 树内指向主工作树的软链（share_into 建的），每行一个相对路径
shared_links() {
  find "$1" -maxdepth 3 -type l -not -path "$1/.git/*" | while IFS= read -r link; do
    case "$(readlink "$link")" in "$MAIN"/*) echo "${link#"$1"/}" ;; esac
  done
}

# 改动数，不算复用软链
dirty_count() {
  git -C "$1" status --porcelain=v1 --untracked-files=all \
    | grep -vxF -f <(shared_links "$1" | sed 's/^/?? /') | wc -l | tr -d ' '
}

procs_in() {
  command -v lsof >/dev/null || { echo "?"; return; }
  lsof -a -d cwd -Fn 2>/dev/null | awk -v p="n$1" '$0 == p || index($0, p "/") == 1 { c++ } END { print c + 0 }'
}

# 分支 reflog 只有创建一条：从没提交过
never_committed() { [ "$(git -C "$MAIN" reflog show --format=%gs "refs/heads/$1" | wc -l)" -le 1 ]; }

merged() { git -C "$MAIN" merge-base --is-ancestor "refs/heads/$1" "$BASE"; }

keep_reason() {
  local path="$1" branch="$2" procs
  [ "$(dirty_count "$path")" -eq 0 ] || { echo "dirty"; return; }
  never_committed "$branch" && { echo "empty"; return; }
  merged "$branch" || { echo "unmerged"; return; }
  procs="$(procs_in "$path")"
  [ "$procs" = "0" ] || { echo "in-use:$procs"; return; }
}

cmd_gc() {
  local apply="${1:-}" path branch reason
  git -C "$MAIN" worktree prune --dry-run -v 2>&1 | sed 's/^/prunable\t/'
  while IFS=$'\t' read -r path branch; do
    reason="$(keep_reason "$path" "$branch")"
    if [ -n "$reason" ]; then printf 'keep\t%s\t%s\n' "$branch" "$reason"; continue; fi
    printf 'remove\t%s\t%s\n' "$branch" "$path"
    [ "$apply" = "--apply" ] || continue
    shared_links "$path" | while IFS= read -r rel; do rm "$path/$rel"; done
    git -C "$MAIN" worktree remove "$path" && git -C "$MAIN" branch -q -d "$branch"
  done < <(our_trees)
}

cmd_ls() {
  local path branch
  printf 'branch\tahead\tdirty\tprocs\tlast\tpath\n'
  while IFS=$'\t' read -r path branch; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$branch" \
      "$(git -C "$MAIN" rev-list --count "$BASE..refs/heads/$branch")" \
      "$(dirty_count "$path")" "$(procs_in "$path")" \
      "$(git -C "$MAIN" log -1 --format=%s "refs/heads/$branch")" "$path"
  done < <(our_trees)
}

# 主工作树里已生成的只读产物，按相对路径软链进新树
share_into() {
  local tree="$1" name rel
  for name in $SHARE; do
    while IFS= read -r rel; do
      rel="${rel#"$MAIN"/}"
      if [ -d "$tree/$(dirname "$rel")" ] && [ ! -e "$tree/$rel" ]; then ln -s "$MAIN/$rel" "$tree/$rel"; fi
    done < <(find "$MAIN" -maxdepth 3 -name "$name" -not -path "$MAIN/.git/*" -prune)
  done
}

cmd_new() {
  local branch="${1:-}" path
  [[ "$branch" =~ ^(fix|feat|research|chore|docs)/[a-z0-9][a-z0-9-]*$ ]] \
    || die 2 "branch must be <fix|feat|research|chore|docs>/<kebab-scope>"
  cmd_gc --apply >&2
  [ "$(our_trees | wc -l)" -lt "$MAX" ] || { cmd_ls >&2; die 3 "WT_MAX=$MAX trees active; finish or remove one"; }
  git -C "$MAIN" show-ref --quiet "refs/heads/$branch" && die 4 "branch exists: $branch"
  path="$ROOT/${branch//\//-}"
  mkdir -p "$ROOT"
  git -C "$MAIN" worktree add -q -b "$branch" "$path" "$BASE"
  share_into "$path"
  echo "$path"
}

case "${1:-}" in
  new) cmd_new "${2:-}" ;;
  ls) cmd_ls ;;
  gc) cmd_gc "${2:-}" ;;
  *) die 2 "usage: worktree.sh new <type>/<scope> | ls | gc [--apply]" ;;
esac
