#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
用法: ark-chat.sh [--force] [--model <模型 ID>] <system.txt> <user.txt> <输出文件>

调用火山方舟 Chat Completions 接口。默认模型为
doubao-seed-2-1-pro-260628，默认拒绝覆盖已有输出。

密钥从 ARK_API_KEY 环境变量读取；若未设置，则读取内容包根目录下权限为
600 的 .env.local。不要使用 bash -x 运行本脚本。
EOF
}

force=false
model=${ARK_CHAT_MODEL:-doubao-seed-2-1-pro-260628}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      force=true
      shift
      ;;
    --model)
      if [[ $# -lt 2 ]]; then
        usage
        exit 64
      fi
      model=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "未知选项: $1" >&2
      usage
      exit 64
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -ne 3 ]]; then
  usage
  exit 64
fi

system_prompt=$1
user_prompt=$2
output_file=$3
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
content_dir=$(cd -- "$script_dir/.." && pwd)
env_file="$content_dir/.env.local"
endpoint=https://ark.cn-beijing.volces.com/api/v3/chat/completions

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
  echo "缺少 ARK_API_KEY；请使用环境变量，或把已轮换的 Key 写入 $env_file 并设为 600 权限。" >&2
  exit 78
fi
if [[ ! $ARK_API_KEY =~ ^ark-[[:alnum:]-]+$ ]]; then
  echo "ARK_API_KEY 格式无效；拒绝构造可能泄露或注入配置的请求。" >&2
  exit 65
fi
if [[ ! $model =~ ^[[:alnum:]][[:alnum:]._-]*$ ]]; then
  echo "模型 ID 格式无效: $model" >&2
  exit 65
fi
if [[ ! -s $system_prompt ]]; then
  echo "system 提示词文件不存在或为空: $system_prompt" >&2
  exit 66
fi
if [[ ! -s $user_prompt ]]; then
  echo "user 提示词文件不存在或为空: $user_prompt" >&2
  exit 66
fi
if [[ -d $output_file ]]; then
  echo "输出路径是目录: $output_file" >&2
  exit 65
fi
if [[ -e $output_file && $force != true ]]; then
  echo "输出已存在，未覆盖: $output_file（确认后使用 --force）" >&2
  exit 73
fi

for dependency in curl jq; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "缺少依赖: $dependency" >&2
    exit 69
  fi
done

# Keep curl-config paths under a fixed, trusted parent. A caller-controlled
# TMPDIR may legally contain quotes or newlines, which are meaningful in a
# curl config file even though the API key and model are validated separately.
work_dir=$(mktemp -d /tmp/ark-chat.XXXXXX)
final_output=
cleanup() {
  rm -rf -- "$work_dir"
  if [[ -n $final_output ]]; then
    rm -f -- "$final_output"
  fi
}
trap cleanup EXIT
chmod 700 "$work_dir"

jq -n \
  --arg model "$model" \
  --rawfile system "$system_prompt" \
  --rawfile user "$user_prompt" \
  '{
    model: $model,
    messages: [
      {role: "system", content: ($system | sub("[\\r\\n]+$"; ""))},
      {role: "user", content: ($user | sub("[\\r\\n]+$"; ""))}
    ],
    stream: false
  }' > "$work_dir/request.json"

# The token lives only in a private curl config, never in curl's argv.
umask 077
{
  printf '%s\n' 'silent' 'show-error' 'request = "POST"'
  printf 'url = "%s"\n' "$endpoint"
  printf '%s\n' 'proto = "=https"' 'connect-timeout = 10' 'max-time = 120'
  printf '%s\n' 'retry = 2' 'retry-delay = 1' 'retry-max-time = 120'
  printf '%s\n' 'header = "Content-Type: application/json"'
  printf 'header = "Authorization: Bearer %s"\n' "$ARK_API_KEY"
  printf 'data-binary = "@%s"\n' "$work_dir/request.json"
  printf 'output = "%s"\n' "$work_dir/response.json"
} > "$work_dir/curl.conf"

# --disable must be curl's first argument so a user-level .curlrc cannot
# override the fixed endpoint, output path, protocol, or other request options.
if ! http_code=$(curl --disable --config "$work_dir/curl.conf" --write-out '%{http_code}'); then
  echo "方舟文本请求未完成；请检查网络、接口地址和本机证书配置。" >&2
  exit 70
fi
if [[ $http_code != 2?? ]]; then
  error_message=$(jq -r '.error.message // .message // "未返回错误详情"' "$work_dir/response.json" 2>/dev/null || true)
  echo "方舟文本请求失败（HTTP $http_code）：$error_message" >&2
  exit 70
fi

output_dir=$(dirname -- "$output_file")
mkdir -p -- "$output_dir"
final_output=$(mktemp "$output_dir/.ark-chat.XXXXXX")
if ! jq -er '.choices[0].message.content | select(type == "string" and length > 0)' \
  "$work_dir/response.json" > "$final_output"; then
  echo "方舟文本响应中没有有效的 choices[0].message.content。" >&2
  exit 70
fi

if [[ $force == true ]]; then
  mv -f -- "$final_output" "$output_file"
else
  if ! ln -- "$final_output" "$output_file"; then
    echo "输出已存在，未覆盖: $output_file（确认后使用 --force）" >&2
    exit 73
  fi
fi
rm -f -- "$final_output"
final_output=

echo "已保存 Doubao Seed 2.1 Pro 文本结果: $output_file"
