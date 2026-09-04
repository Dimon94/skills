#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ROOT="${WORKFLOW_SKILL_SOURCE_ROOT:-$HOME/.local/share/dimon-agent-workflow}"
AGENTS_SKILLS_DIR="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
MATTPOCOCK_SKILLS_DIR="${MATTPOCOCK_SKILLS_DIR:-$SOURCE_ROOT/mattpocock-skills}"
BRAINSTORMING_SKILLS_DIR="${BRAINSTORMING_SKILLS_DIR:-$SOURCE_ROOT/brainstorming-only}"
DELIVERY_PIPELINE_DIR="${DELIVERY_PIPELINE_DIR:-$SOURCE_ROOT/delivery-pipeline}"
FIREWORKS_TECH_GRAPH_DIR="${FIREWORKS_TECH_GRAPH_DIR:-$SOURCE_ROOT/fireworks-tech-graph}"
OFFLINE=0
CHECK_ONLY=0

usage() {
  printf '%s\n' \
    'Usage: scripts/install-development-workflow.sh [--offline] [--check]' \
    '' \
    'Installs the complete development-workflow Skill bundle into:' \
    '  ~/.agents/skills' \
    '  ~/.claude/skills' \
    '' \
    '--offline  Use existing source checkouts without network access.' \
    '--check    Verify sources and symlinks without changing anything.'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --offline) OFFLINE=1 ;;
    --check) CHECK_ONLY=1; OFFLINE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v git >/dev/null 2>&1 || { printf '%s\n' 'error: git is required.' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'error: python3 is required.' >&2; exit 1; }

verify_origin() {
  local url="$1" path="$2" slug origin
  slug="${url#https://github.com/}"
  slug="${slug%.git}"
  origin="$(git -C "$path" remote get-url origin 2>/dev/null)" || {
    printf 'error: source has no origin remote: %s\n' "$path" >&2
    exit 1
  }
  case "$origin" in
    "https://github.com/$slug"|"https://github.com/$slug.git"|"git@github.com:$slug.git"|"ssh://git@github.com/$slug.git") ;;
    *) printf 'error: unexpected origin for %s: %s\n' "$path" "$origin" >&2; exit 1 ;;
  esac
}

sync_repo() {
  local url="$1" path="$2"

  if [ ! -e "$path" ]; then
    [ "$OFFLINE" -eq 0 ] || {
      printf 'error: offline source is missing: %s\n' "$path" >&2
      exit 1
    }
    mkdir -p "$(dirname "$path")"
    git clone --filter=blob:none "$url" "$path"
    return
  fi

  [ -d "$path/.git" ] || {
    printf 'error: source exists but is not a Git checkout: %s\n' "$path" >&2
    exit 1
  }
  verify_origin "$url" "$path"
  if [ "$OFFLINE" -eq 1 ]; then
    return 0
  fi

  if [ -n "$(git -C "$path" status --porcelain)" ]; then
    printf 'preserved dirty checkout without updating: %s\n' "$path"
    return
  fi
  git -C "$path" pull --ff-only
}

sync_repo 'https://github.com/mattpocock/skills.git' "$MATTPOCOCK_SKILLS_DIR"
sync_repo 'https://github.com/Dimon94/brainstorming-only.git' "$BRAINSTORMING_SKILLS_DIR"
sync_repo 'https://github.com/Dimon94/delivery-pipeline.git' "$DELIVERY_PIPELINE_DIR"
sync_repo 'https://github.com/yizhiyanhua-ai/fireworks-tech-graph.git' "$FIREWORKS_TECH_GRAPH_DIR"

verify_link() {
  local target="$1" source="$2"
  [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ] || {
    printf 'error: expected symlink %s -> %s\n' "$target" "$source" >&2
    exit 1
  }
}

link_skill() {
  local target="$1" source="$2"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    verify_link "$target" "$source"
    return
  fi
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    printf 'error: refusing to replace non-symlink: %s\n' "$target" >&2
    exit 1
  fi
  ln -sfn "$source" "$target"
  verify_link "$target" "$source"
}

for destination in "$AGENTS_SKILLS_DIR" "$CLAUDE_SKILLS_DIR"; do
  if [ "$CHECK_ONLY" -eq 0 ]; then
    mkdir -p "$destination"
  fi
done

skill_count=0
link_named_skill() {
  local name="$1" source="$2" destination
  [ -f "$source/SKILL.md" ] || {
    printf 'error: missing Skill source: %s\n' "$source/SKILL.md" >&2
    exit 1
  }
  for destination in "$AGENTS_SKILLS_DIR" "$CLAUDE_SKILLS_DIR"; do
    link_skill "$destination/$name" "$source"
  done
  skill_count=$((skill_count + 1))
}

for skill_md in "$ROOT"/skills/*/SKILL.md; do
  link_named_skill "$(basename "$(dirname "$skill_md")")" "$(dirname "$skill_md")"
done

for name in \
  wayfinder research grill-with-docs to-spec to-tickets diagnosing-bugs \
  domain-modeling prototype implement code-review resolving-merge-conflicts
do
  link_named_skill "$name" "$MATTPOCOCK_SKILLS_DIR/skills/engineering/$name"
done
link_named_skill grilling "$MATTPOCOCK_SKILLS_DIR/skills/productivity/grilling"

link_named_skill brainstorming-only "$BRAINSTORMING_SKILLS_DIR/brainstorming-only"
link_named_skill office-hours-only "$BRAINSTORMING_SKILLS_DIR/office-hours-only"

for name in delivery-pipeline delivery-pipeline-codex-app delivery-pipeline-setup ticket-sizing; do
  link_named_skill "$name" "$DELIVERY_PIPELINE_DIR/skills/$name"
done

link_named_skill fireworks-tech-graph \
  "$FIREWORKS_TECH_GRAPH_DIR/skills/fireworks-tech-graph"

printf 'verified %s Skills in %s and %s\n' \
  "$skill_count" "$AGENTS_SKILLS_DIR" "$CLAUDE_SKILLS_DIR"

for command_name in herdr codex claude pi; do
  if command -v "$command_name" >/dev/null 2>&1; then
    printf 'runtime: %-7s %s\n' "$command_name" "$(command -v "$command_name")"
  else
    printf 'runtime: %-7s MISSING (install only if this workflow uses it)\n' "$command_name"
  fi
done
