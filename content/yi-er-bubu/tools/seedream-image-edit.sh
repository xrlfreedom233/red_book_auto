#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
用法: seedream-image-edit.sh [--force] <输入图片> <提示词.txt> <输出图片>

使用 Doubao Seedream 5.0 lite 对现有图片做单图编辑。默认拒绝覆盖输出；
确认要替换已有文件时显式传入 --force。
EOF
}

force=false
if [[ ${1:-} == "--force" ]]; then
  force=true
  shift
fi
if [[ $# -ne 3 ]]; then
  usage
  exit 64
fi

input_image=$1
prompt_file=$2
output_image=$3
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
content_dir=$(cd -- "$script_dir/.." && pwd)
env_file="$content_dir/.env.local"

# xtrace would print expanded authorization data while the request is prepared.
if [[ $- == *x* ]]; then
  echo "为避免泄露 API Key，请勿使用 bash -x 运行此脚本。" >&2
  exit 77
fi

if [[ -z ${ARK_API_KEY:-} && -f $env_file ]]; then
  if mode=$(stat -c '%a' "$env_file" 2>/dev/null); then
    :
  elif mode=$(stat -f '%Lp' "$env_file" 2>/dev/null); then
    :
  else
    echo "无法检查密钥文件权限: $env_file" >&2
    exit 77
  fi
  if (( 10#$mode % 100 != 0 )); then
    echo "密钥文件权限过宽（当前 $mode）；请执行: chmod 600 '$env_file'" >&2
    exit 77
  fi
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    case "$line" in
      ARK_API_KEY=*) ARK_API_KEY=${line#ARK_API_KEY=} ;;
      ''|'#'*) ;;
      *)
        echo "密钥文件只允许空行、注释和 ARK_API_KEY=..." >&2
        exit 65
        ;;
    esac
  done < "$env_file"
fi

if [[ -z ${ARK_API_KEY:-} || $ARK_API_KEY == replace-with-* ]]; then
  echo "缺少 ARK_API_KEY；请先把已轮换的 Key 写入 $env_file 并设为 600 权限。" >&2
  exit 78
fi
if [[ ! $ARK_API_KEY =~ ^ark-[[:alnum:]-]+$ ]]; then
  echo "ARK_API_KEY 格式无效；拒绝构造可能泄露或注入配置的请求。" >&2
  exit 65
fi
if [[ ! -f $input_image ]]; then
  echo "输入图片不存在: $input_image" >&2
  exit 66
fi
if [[ ! -s $prompt_file ]]; then
  echo "提示词文件不存在或为空: $prompt_file" >&2
  exit 66
fi
case "$output_image" in
  *.png|*.PNG) ;;
  *)
    echo "输出图片必须使用 .png 扩展名: $output_image" >&2
    exit 65
    ;;
esac
if [[ -e $output_image && $force != true ]]; then
  echo "输出已存在，未覆盖: $output_image（确认后使用 --force）" >&2
  exit 73
fi

for dependency in curl jq base64 magick file; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "缺少依赖: $dependency" >&2
    exit 69
  fi
done

mime_type=$(file --brief --mime-type "$input_image")
case "$mime_type" in
  image/png|image/jpeg|image/webp) ;;
  *)
    echo "不支持的输入图片类型: $mime_type" >&2
    exit 65
    ;;
esac

work_dir=$(mktemp -d)
final_image=
cleanup() {
  rm -rf -- "$work_dir"
  if [[ -n $final_image ]]; then
    rm -f -- "$final_image"
  fi
}
trap cleanup EXIT
chmod 700 "$work_dir"

{
  printf 'data:%s;base64,' "$mime_type"
  base64 < "$input_image" | tr -d '\r\n'
} > "$work_dir/image.data"

jq -n \
  --arg model "${SEEDREAM_MODEL:-doubao-seedream-5-0-260128}" \
  --rawfile prompt "$prompt_file" \
  --rawfile image "$work_dir/image.data" \
  --arg size "${SEEDREAM_SIZE:-2K}" \
  '{
    model: $model,
    prompt: ($prompt | sub("[\\r\\n]+$"; "")),
    image: $image,
    sequential_image_generation: "disabled",
    response_format: "url",
    size: $size,
    stream: false,
    watermark: false
  }' > "$work_dir/request.json"

# Put the bearer token in a mode-600 curl config instead of process arguments.
umask 077
{
  printf '%s\n' 'silent' 'show-error' 'request = "POST"'
  printf '%s\n' 'url = "https://ark.cn-beijing.volces.com/api/v3/images/generations"'
  printf '%s\n' 'header = "Content-Type: application/json"'
  printf 'header = "Authorization: Bearer %s"\n' "$ARK_API_KEY"
  printf 'data-binary = "@%s"\n' "$work_dir/request.json"
  printf 'output = "%s"\n' "$work_dir/response.json"
} > "$work_dir/curl.conf"

if ! http_code=$(curl --config "$work_dir/curl.conf" --write-out '%{http_code}'); then
  echo "Seedream 请求未完成；请检查网络、接口地址和本机证书配置。" >&2
  exit 70
fi
if [[ $http_code != 2?? ]]; then
  error_message=$(jq -r '.error.message // .message // "未返回错误详情"' "$work_dir/response.json" 2>/dev/null || true)
  echo "Seedream 请求失败（HTTP $http_code）：$error_message" >&2
  exit 70
fi

image_url=$(jq -er '.data[0].url | select(type == "string" and startswith("https://"))' "$work_dir/response.json") || {
  echo "Seedream 响应中没有有效的 HTTPS data[0].url。" >&2
  exit 70
}
if ! curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' \
  --output "$work_dir/result" -- "$image_url"; then
  echo "Seedream 结果图片下载失败。" >&2
  exit 70
fi

result_format=$(magick identify -format '%m' "$work_dir/result" 2>/dev/null || true)
case "$result_format" in
  PNG|JPEG|WEBP) ;;
  *)
    echo "下载结果不是支持的图片格式: ${result_format:-unknown}" >&2
    exit 65
    ;;
esac

output_dir=$(dirname -- "$output_image")
mkdir -p -- "$output_dir"
final_image=$(mktemp "$output_dir/.seedream-final.XXXXXX")
magick "$work_dir/result" -auto-orient -strip "png:$final_image"
if [[ $force == true ]]; then
  mv -f -- "$final_image" "$output_image"
else
  if ! ln -- "$final_image" "$output_image"; then
    echo "输出已存在，未覆盖: $output_image（确认后使用 --force）" >&2
    exit 73
  fi
fi
rm -f -- "$final_image"
final_image=

dimensions=$(magick identify -format '%wx%h' "$output_image")
echo "已保存 Seedream 编辑结果: $output_image ($dimensions)"
