#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "用法: $0 <底图> <叠字.svg> <成品.png>" >&2
  exit 64
fi

raw_image=$1
overlay_svg=$2
output_png=$3

case "$output_png" in
  *.png|*.PNG) ;;
  *)
    echo "成品文件必须使用 .png 扩展名: $output_png" >&2
    exit 65
    ;;
esac

for dependency in magick rsvg-convert; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "缺少依赖: $dependency" >&2
    exit 69
  fi
done

if [[ ! -f "$raw_image" ]]; then
  echo "底图不存在: $raw_image" >&2
  exit 66
fi
if [[ ! -f "$overlay_svg" ]]; then
  echo "叠字文件不存在: $overlay_svg" >&2
  exit 66
fi

mkdir -p "$(dirname "$output_png")"
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT

magick "$raw_image" -auto-orient -resize '1080x1440^' -gravity center \
  -extent 1080x1440 -strip "$work_dir/base.png"
rsvg-convert --width 1080 --height 1440 --output "$work_dir/overlay.png" "$overlay_svg"
magick "$work_dir/base.png" "$work_dir/overlay.png" -alpha on -compose over \
  -composite -strip -define png:color-type=6 "$output_png"

dimensions=$(magick identify -format '%wx%h' "$output_png")
if [[ "$dimensions" != "1080x1440" ]]; then
  echo "成品尺寸错误: $dimensions" >&2
  exit 65
fi

format=$(magick identify -format '%m' "$output_png")
if [[ "$format" != "PNG" ]]; then
  echo "成品格式错误: $format" >&2
  exit 65
fi
