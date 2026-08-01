#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tool=$(cd -- "$script_dir/.." && pwd)/ark-chat.sh
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT

mkdir -p "$test_dir/bin" "$test_dir/out"
printf '%s\n' 'system instructions' > "$test_dir/system.txt"
printf '%s\n' 'user request' > "$test_dir/user.txt"

cat > "$test_dir/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$@" > "$MOCK_ARGV_FILE"
[[ ${1:-} == --disable ]]
config=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config=$2; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n $config ]]
[[ $(stat -c '%a' "$config") == 600 ]]
grep -q '^url = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"$' "$config"
grep -q '^proto = "=https"$' "$config"
grep -q '^connect-timeout = 10$' "$config"
grep -q '^max-time = 120$' "$config"
grep -q '^retry = 2$' "$config"
grep -q '^retry-delay = 1$' "$config"
grep -q '^retry-max-time = 120$' "$config"
grep -q '^request = "POST"$' "$config"
grep -q '^header = "Content-Type: application/json"$' "$config"
grep -q '^header = "Authorization: Bearer ark-test-secret"$' "$config"
response_file=$(sed -n 's/^output = "\(.*\)"$/\1/p' "$config")
request_file=$(sed -n 's/^data-binary = "@\(.*\)"$/\1/p' "$config")
cp -- "$request_file" "$MOCK_REQUEST_FILE"
printf '%s' "$MOCK_RESPONSE" > "$response_file"
printf '%s' "${MOCK_HTTP_CODE:-200}"
MOCK
chmod 700 "$test_dir/bin/curl"

export PATH="$test_dir/bin:$PATH"
export ARK_API_KEY=ark-test-secret
export MOCK_ARGV_FILE="$test_dir/curl.argv"
export MOCK_REQUEST_FILE="$test_dir/request.json"
export MOCK_RESPONSE='{"choices":[{"message":{"content":"生成结果"}}]}'

# A hostile TMPDIR must not become part of curl's config-file paths, and curl
# must not load ambient ~/.curlrc settings before the private config.
mkdir -p "$test_dir/hostile-tmp"$'\nurl = "https://example.invalid"'
export TMPDIR="$test_dir/hostile-tmp"$'\nurl = "https://example.invalid"'

"$tool" "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/result.md"
[[ $(cat "$test_dir/out/result.md") == '生成结果' ]]
[[ $(jq -r '.model' "$test_dir/request.json") == 'doubao-seed-2-1-pro-260628' ]]
[[ $(jq -r '.messages[0].content' "$test_dir/request.json") == 'system instructions' ]]
[[ $(jq -r '.messages[1].content' "$test_dir/request.json") == 'user request' ]]
[[ $(jq -r '.messages[0].role' "$test_dir/request.json") == 'system' ]]
[[ $(jq -r '.messages[1].role' "$test_dir/request.json") == 'user' ]]
[[ $(jq -r '.stream' "$test_dir/request.json") == false ]]
if grep -q 'ark-test-secret' "$test_dir/curl.argv"; then
  echo 'API Key leaked into curl argv' >&2
  exit 1
fi
[[ $(sed -n '1p' "$test_dir/curl.argv") == --disable ]]
if grep -q "$test_dir/hostile-tmp" "$test_dir/curl.argv"; then
  echo 'caller-controlled TMPDIR reached curl config arguments' >&2
  exit 1
fi
unset TMPDIR

if "$tool" "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/result.md" 2>/dev/null; then
  echo 'existing output was overwritten without --force' >&2
  exit 1
fi
[[ $(cat "$test_dir/out/result.md") == '生成结果' ]]

"$tool" --model doubao-test-model "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/custom.md"
[[ $(jq -r '.model' "$test_dir/request.json") == 'doubao-test-model' ]]

# --force replaces only after a valid response has been parsed.
export MOCK_RESPONSE='{"choices":[{"message":{"content":"替换结果"}}]}'
"$tool" --force "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/result.md"
[[ $(cat "$test_dir/out/result.md") == '替换结果' ]]

export MOCK_HTTP_CODE=500
export MOCK_RESPONSE='{"error":{"message":"mock failure"}}'
if "$tool" "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/http-error.md" 2>/dev/null; then
  echo 'HTTP error was accepted' >&2
  exit 1
fi
[[ ! -e $test_dir/out/http-error.md ]]
if "$tool" --force "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/result.md" 2>/dev/null; then
  echo 'HTTP error replaced an existing output under --force' >&2
  exit 1
fi
[[ $(cat "$test_dir/out/result.md") == '替换结果' ]]
unset MOCK_HTTP_CODE

export MOCK_RESPONSE='{"choices":[]}'
if "$tool" "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/malformed.md" 2>/dev/null; then
  echo 'malformed response was accepted' >&2
  exit 1
fi
[[ ! -e $test_dir/out/malformed.md ]]

export ARK_API_KEY='invalid key'
if "$tool" "$test_dir/system.txt" "$test_dir/user.txt" "$test_dir/out/invalid-key.md" 2>/dev/null; then
  echo 'invalid key was accepted' >&2
  exit 1
fi
[[ ! -e $test_dir/out/invalid-key.md ]]

echo 'ark-chat mock tests passed'
