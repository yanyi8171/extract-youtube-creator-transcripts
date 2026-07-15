#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SKILL_ROOT=$(dirname "$SCRIPT_DIR")
APP_ROOT="${HOME}/Library/Application Support/YouTubeCreatorTranscripts"
RUNTIME_ROOT="$APP_ROOT/runtime"
export DENO_DIR="$RUNTIME_ROOT/deno-cache"
DOWNLOADS="$APP_ROOT/downloads"

DENO_VERSION="2.9.2"
YTDLP_VERSION="2026.07.04"
POT_VERSION="1.3.1"
POT_COMMIT="7608dd51ee813b48cf9a6d68c6e42cb197ce10e0"

ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64)
    DENO_URL="https://github.com/denoland/deno/releases/download/v2.9.2/deno-aarch64-apple-darwin.zip"
    DENO_SHA="687ae485168ba73a4f1ee3a954eb4f077eca82f2fefd236a6a83a3889287876c"
    ;;
  x86_64|amd64)
    DENO_URL="https://github.com/denoland/deno/releases/download/v2.9.2/deno-x86_64-apple-darwin.zip"
    DENO_SHA="c953379e5a85a0a30e99aa51b807633e380e809a1181f53e4904d5fa73785bff"
    ;;
  *) echo "不支持的 macOS 架构：$ARCH" >&2; exit 30 ;;
esac

YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp_macos"
YTDLP_SHA="498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
POT_PLUGIN_URL="https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/1.3.1/bgutil-ytdlp-pot-provider.zip"
POT_PLUGIN_SHA="b8ceec7f76143da172aaf5ebeec0c2d218e5680c063b931586bca48567069b38"
POT_SOURCE_URL="https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/zip/$POT_COMMIT"
POT_SOURCE_SHA="255d9acbbb7540cb5e1ee8be82bc9a8655f1537b6974f3a5213d9398012afbb2"

DENO_ROOT="$RUNTIME_ROOT/deno-$DENO_VERSION"
DENO_EXE="$DENO_ROOT/deno"
YT_ROOT="$RUNTIME_ROOT/yt-dlp-$YTDLP_VERSION"
YT_EXE="$YT_ROOT/yt-dlp_macos"
POT_ROOT="$RUNTIME_ROOT/pot-provider-$POT_VERSION"
POT_PLUGIN="$POT_ROOT/plugin"
POT_MARKER="$POT_ROOT/.installed.json"

download_verified() {
  url=$1
  expected=$2
  name=$3
  mkdir -p "$DOWNLOADS"
  target="$DOWNLOADS/$name.$$.$RANDOM.download"
  curl -fL --retry 3 --connect-timeout 20 -A 'YouTubeCreatorTranscripts/1.0' "$url" -o "$target"
  actual=$(shasum -a 256 "$target" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    rm -f "$target"
    echo "哈希校验失败：$name（预期 $expected，实际 $actual）" >&2
    exit 30
  fi
  printf '%s\n' "$target"
}

show_preflight() {
  missing=""
  [ -x "$DENO_EXE" ] || missing="${missing}Deno $DENO_VERSION（约 43 MB）; "
  [ -x "$YT_EXE" ] || missing="${missing}yt-dlp $YTDLP_VERSION（约 39 MB）; "
  if [ -z "$missing" ]; then ready=true; else ready=false; fi
  if [ -f "$POT_MARKER" ]; then pot=true; else pot=false; fi
  printf '{"ready":%s,"install_required":"%s","install_location":"%s","modifies_path":false,"needs_admin":false,"pot_provider_installed":%s}\n' "$ready" "$missing" "$RUNTIME_ROOT" "$pot"
}

install_core() {
  mkdir -p "$RUNTIME_ROOT"
  if [ ! -x "$DENO_EXE" ]; then
    archive=$(download_verified "$DENO_URL" "$DENO_SHA" 'deno.zip')
    stage="$RUNTIME_ROOT/.deno-stage-$$"
    rm -rf "$stage"
    mkdir -p "$stage" "$DENO_ROOT"
    ditto -x -k "$archive" "$stage"
    mv "$stage/deno" "$DENO_EXE"
    chmod 700 "$DENO_EXE"
    rm -rf "$stage" "$archive"
  fi
  if [ ! -x "$YT_EXE" ]; then
    download=$(download_verified "$YTDLP_URL" "$YTDLP_SHA" 'yt-dlp_macos')
    mkdir -p "$YT_ROOT"
    mv "$download" "$YT_EXE"
    chmod 700 "$YT_EXE"
  fi
  "$DENO_EXE" --version | head -n 1
  "$YT_EXE" --version
}

install_pot() {
  [ -x "$DENO_EXE" ] || { echo '请先运行 --install 安装核心工具。' >&2; exit 30; }
  [ ! -f "$POT_MARKER" ] || { echo "PO Token Provider 已安装：$POT_ROOT"; return; }
  case "$POT_ROOT" in "$RUNTIME_ROOT"/*) ;; *) echo "Provider 目标不安全：$POT_ROOT" >&2; exit 30 ;; esac
  [ ! -e "$POT_ROOT" ] || rm -rf -- "$POT_ROOT"
  plugin_zip=$(download_verified "$POT_PLUGIN_URL" "$POT_PLUGIN_SHA" 'pot-plugin.zip')
  source_zip=$(download_verified "$POT_SOURCE_URL" "$POT_SOURCE_SHA" 'pot-source.zip')
  stage="$RUNTIME_ROOT/.pot-stage-$$"
  cleanup_pot_install() {
    rm -rf -- "$stage" "$plugin_zip" "$source_zip"
    [ -f "$POT_MARKER" ] || rm -rf -- "$POT_ROOT"
  }
  trap cleanup_pot_install EXIT HUP INT TERM
  mkdir -p "$stage/source" "$stage/ready/plugin"
  ditto -x -k "$source_zip" "$stage/source"
  ditto -x -k "$plugin_zip" "$stage/ready/plugin"
  inner=$(find "$stage/source" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  [ -n "$inner" ] || { echo 'Provider 源码包结构异常。' >&2; exit 30; }
  cp -R "$inner"/. "$stage/ready"/
  [ ! -e "$POT_ROOT" ] || { echo "Provider 目标目录已存在但不完整：$POT_ROOT" >&2; exit 30; }
  mv "$stage/ready" "$POT_ROOT"
  (cd "$POT_ROOT/server" && "$DENO_EXE" install --allow-scripts=npm:canvas --frozen)
  printf '{"version":"%s","installed_at":"%s"}\n' "$POT_VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$POT_MARKER"
  cleanup_pot_install
  trap - EXIT HUP INT TERM
  echo "PO Token Provider 已安装：$POT_ROOT"
}

mode=run
case "${1:-}" in
  --preflight) mode=preflight; shift ;;
  --install) mode=install; shift ;;
  --install-pot) mode=install-pot; shift ;;
esac

case "$mode" in
  preflight) show_preflight; exit 0 ;;
  install) install_core; [ "$#" -gt 0 ] || { show_preflight; exit 0; } ;;
  install-pot) install_pot; [ "$#" -gt 0 ] || exit 0 ;;
esac

if [ ! -x "$DENO_EXE" ] || [ ! -x "$YT_EXE" ]; then
  show_preflight
  echo '私有工具尚未安装。确认后运行 --install。' >&2
  exit 20
fi

set -- --yt-dlp "$YT_EXE" "$@"
if [ -f "$POT_MARKER" ]; then
  set -- --pot-home "$POT_ROOT" --pot-plugin "$POT_PLUGIN" "$@"
fi

exec "$DENO_EXE" run --no-prompt --allow-read --allow-write --allow-run --allow-env --allow-sys --allow-net=127.0.0.1,localhost "$SCRIPT_DIR/main.ts" "$@"
