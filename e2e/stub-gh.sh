#!/usr/bin/env bash
# stub-gh.sh: a fake `gh` that records argv and returns canned responses.
# Used by night-shift.test.ts to avoid hitting real GitHub.

LOG="${GH_STUB_LOG:-/tmp/gh-stub-calls.log}"
echo "$@" >> "$LOG"

case "$1" in
  --version)
    echo "gh version 2.40.0 (stub)"
    exit 0
    ;;
  auth)
    if [[ "$2" == "status" ]]; then
      echo "Logged in to github.com as stub"
      exit 0
    fi
    ;;
  pr)
    case "$2" in
      list)
        # Idempotency probe — return empty.
        echo ""
        exit 0
        ;;
      create)
        # Always succeed with a canned URL.
        echo "https://github.com/stub/repo/pull/${GH_STUB_PR_NUMBER:-1}"
        exit 0
        ;;
    esac
    ;;
esac

echo "stub-gh: unhandled $@" >&2
exit 1
