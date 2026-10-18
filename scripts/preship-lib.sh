#!/usr/bin/env bash
# Hostile Takeover preship: pure helpers, sourced by preship.sh and scripts/preship-inner.sh.
#
# Everything here is side-effect free apart from ps_write_record, which writes one small
# untracked file inside the git dir ($(git rev-parse --git-dir)/ht-preship-last).
# Tested by tests/tools/Preship.test.ts. Docs: docs/Preship.md.

# ps_parse_args ARGS...: sets PS_MODE (quick|full|status|help) and PS_LOCAL (0|1).
# Returns 2 (message on stderr) for an unknown flag or two conflicting modes.
ps_parse_args() {
    PS_MODE=quick
    PS_LOCAL=0
    local mode_set=""
    local set_mode
    set_mode() {
        if [ -n "$mode_set" ] && [ "$mode_set" != "$1" ]; then
            echo "preship: --$mode_set and --$1 cannot be combined" >&2
            return 2
        fi
        mode_set=$1
        PS_MODE=$1
    }
    local a
    for a in "$@"; do
        case "$a" in
            --full) set_mode full || return 2 ;;
            --status) set_mode status || return 2 ;;
            --quick) set_mode quick || return 2 ;;
            --local) PS_LOCAL=1 ;;
            -h | --help) PS_MODE=help ;;
            *)
                echo "preship: unknown option: $a (try --help)" >&2
                return 2
                ;;
        esac
    done
    return 0
}

# ps_base_ref: the commit "changed" is measured from: merge-base with origin/main, else main, else HEAD.
ps_base_ref() {
    git merge-base HEAD origin/main 2> /dev/null \
        || git merge-base HEAD main 2> /dev/null \
        || git rev-parse HEAD
}

# ps_changed_files: existing files changed since the base (committed on the branch, staged,
# unstaged) plus untracked non-ignored ones. Sorted, unique, one per line. Deleted files are
# dropped, a rename shows only its new name, and the top-level .nodeterm/ is never listed.
ps_changed_files() {
    local base f
    base=$(ps_base_ref)
    {
        git -c core.quotepath=off diff --name-only --no-renames "$base"
        git -c core.quotepath=off ls-files --others --exclude-standard
    } | sort -u | while IFS= read -r f; do
        case "$f" in .nodeterm/*) continue ;; esac
        [ -f "$f" ] && printf '%s\n' "$f"
    done
    return 0
}

# ps_filter_kind lint|prettier|test: stdin file list -> only the files that step handles.
ps_filter_kind() {
    local code='ts|tsx|js|jsx|mjs|cjs|mts|cts'
    case "$1" in
        lint) grep -E "\\.($code)\$" || true ;;
        # prettier decides by itself (--ignore-unknown), and it formats .sh and more: pass everything
        prettier) cat ;;
        test) grep -E "^(src|packages|tests|resources)/.*\\.($code|json)\$" || true ;;
        *)
            echo "ps_filter_kind: unknown kind: ${1:-}" >&2
            return 2
            ;;
    esac
}

# ps_tree_fingerprint: sha256 over HEAD, the diff of tracked files against HEAD, and the
# contents of untracked non-ignored files (.nodeterm/ left out). Same tree, same value.
ps_tree_fingerprint() {
    {
        git rev-parse HEAD
        git diff HEAD --binary | sha256sum
        git -c core.quotepath=off ls-files -z --others --exclude-standard \
            | while IFS= read -r -d '' f; do
                case "$f" in .nodeterm/*) continue ;; esac
                printf '%s %s\n' "$f" "$(git hash-object -- "$f" 2> /dev/null || echo unreadable)"
            done | sort
    } | sha256sum | cut -d' ' -f1
}

ps_record_file() {
    printf '%s/ht-preship-last\n' "$(git rev-parse --absolute-git-dir)"
}

# ps_write_record MODE pass|fail SECONDS: replaces the line for MODE, keeps the other mode's line.
ps_write_record() {
    local mode=$1 result=$2 secs=$3 file tmp
    file=$(ps_record_file)
    tmp=$(mktemp "$file.XXXXXX")
    { [ -f "$file" ] && grep -v "^mode=$mode " "$file"; } > "$tmp" || true
    printf 'mode=%s result=%s seconds=%s head=%s fp=%s time=%s\n' \
        "$mode" "$result" "$secs" "$(git rev-parse HEAD)" "$(ps_tree_fingerprint)" "$(date +%s)" >> "$tmp"
    mv "$tmp" "$file"
}

# ps_record_field MODE FIELD: value from the stored line, empty when absent.
ps_record_field() {
    local file
    file=$(ps_record_file)
    [ -f "$file" ] || return 0
    { grep "^mode=$1 " "$file" || true; } | tail -1 | tr ' ' '\n' | sed -n "s/^$2=//p"
}

# ps_age EPOCH: "5m ago" style.
ps_age() {
    local d=$(($(date +%s) - $1))
    if [ "$d" -lt 90 ]; then
        echo "${d}s ago"
    elif [ "$d" -lt 5400 ]; then
        echo "$((d / 60))m ago"
    else
        echo "$((d / 3600))h ago"
    fi
}

# ps_status: prints where the current tree stands. Exit 0 only for a FULL pass on this exact tree.
ps_status() {
    local fp mode result secs rfp when head note
    fp=$(ps_tree_fingerprint)
    local rc=1
    for mode in full quick; do
        result=$(ps_record_field "$mode" result)
        if [ -z "$result" ]; then
            [ "$mode" = full ] && echo "no full pass recorded for this tree (run: bash preship.sh --full)"
            continue
        fi
        secs=$(ps_record_field "$mode" seconds)
        rfp=$(ps_record_field "$mode" fp)
        when=$(ps_age "$(ps_record_field "$mode" time)")
        head=$(ps_record_field "$mode" head)
        head=${head:0:7}
        if [ "$rfp" = "$fp" ]; then
            note="on the current tree"
        else
            note="but the tree changed since (was HEAD $head)"
        fi
        if [ "$mode" = full ]; then
            if [ "$result" = pass ] && [ "$rfp" = "$fp" ]; then
                echo "FULL pass for the current tree (${secs}s, $when, HEAD $head)"
                rc=0
            elif [ "$result" = pass ]; then
                echo "no full pass for the current tree: last full pass $when $note"
            elif [ "$rfp" = "$fp" ]; then
                echo "last full run FAILED on the current tree (${secs}s, $when)"
            else
                echo "no full pass for the current tree: last full run FAILED $when $note"
            fi
        else
            if [ "$result" = pass ]; then
                echo "last quick pass $note (${secs}s, $when); a quick pass does not count as a full pass"
            else
                echo "last quick run FAILED $note (${secs}s, $when)"
            fi
        fi
    done
    return $rc
}

# ps_only_inventory_failures VITEST_LOG: true (0) when the log has failed tests and every one
# is an InventoryModal test (the known flaky timeouts under load, see CLAUDE.md baseline).
ps_only_inventory_failures() {
    local clean total bad
    clean=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$1")
    if printf '%s\n' "$clean" | grep -q 'Unhandled Errors'; then return 1; fi
    total=$(printf '%s\n' "$clean" | grep -cE '^[[:space:]]*FAIL[[:space:]]' || true)
    bad=$(printf '%s\n' "$clean" | grep -E '^[[:space:]]*FAIL[[:space:]]' | grep -vc 'InventoryModal' || true)
    [ "${total:-0}" -gt 0 ] && [ "${bad:-0}" -eq 0 ]
}
