#!/usr/bin/env bash
# One-time per-machine setup for headless-Chromium driving of the game.
# No sudo/apt needed. Nothing is added to the repo's package.json/lockfile:
# Playwright is installed into the cache dir (default ~/.cache/openfront-run,
# override with OPENFRONT_RUN_CACHE), never with `npm -g`.
# Run with Node 24:  export PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH
set -uo pipefail

CACHE="${OPENFRONT_RUN_CACHE:-$HOME/.cache/openfront-run}"
mkdir -p "$CACHE/fonts" "$CACHE/fc-cache"

# 1. Playwright into the cache dir (outside the repo).
if [ ! -d "$CACHE/node_modules/playwright" ]; then
    [ -f "$CACHE/package.json" ] || echo '{"name":"openfront-run-cache","private":true}' > "$CACHE/package.json"
    (cd "$CACHE" && npm install --no-audit --no-fund playwright) || {
        echo "playwright install failed"
        exit 1
    }
fi

# 2. Chromium headless shell. Playwright may refuse unknown distros; the
#    ubuntu24.04 build is ABI-compatible, so override the host platform.
(cd "$CACHE" && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium-headless-shell) \
    || echo "WARNING: chromium download failed"

# 3. Detect missing shared libs (no apt here: just report them).
SHELL_BIN="$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2> /dev/null | tail -1)"
if [ -n "$SHELL_BIN" ]; then
    MISSING="$(LD_LIBRARY_PATH="$CACHE/extracted/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}" ldd "$SHELL_BIN" 2> /dev/null | grep 'not found' || true)"
    if [ -n "$MISSING" ]; then
        echo "MISSING system libraries (install them, or extract .debs into $CACHE/extracted):"
        echo "$MISSING"
    fi
fi

# 4. Fonts: Skia FATALs without a fontconfig. Only needed if /etc/fonts is absent.
if [ ! -d /etc/fonts ]; then
    FONT="$(ls /usr/share/fonts/truetype/*/*.ttf 2> /dev/null | head -1 || true)"
    if [ -n "$FONT" ]; then
        cp /usr/share/fonts/truetype/*/*.ttf "$CACHE/fonts/" 2> /dev/null || true
    else
        echo "WARNING: no /etc/fonts and no system TTF found; put a .ttf in $CACHE/fonts"
    fi
    cat > "$CACHE/fonts.conf" << CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$CACHE/fonts</dir>
  <cachedir>$CACHE/fc-cache</cachedir>
</fontconfig>
CONF
fi

echo "setup complete: $CACHE"
