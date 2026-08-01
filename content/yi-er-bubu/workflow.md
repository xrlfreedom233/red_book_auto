# 单篇工作流

## 文本模型与密钥准备（未来篇目）

故事到质检阶段默认使用 Doubao Seed 2.1 Pro（模型 ID
`doubao-seed-2-1-pro-260628`）；无字画面继续使用 Doubao Seedream 5.0 lite；中文、
气泡和画格继续由本地 SVG 与 `render-page.sh` 完成。三个职责不能互相替代。

先在火山方舟控制台撤销任何曾粘贴到聊天、工单或截图中的 Key。只把轮换后的 Key
写入当前进程环境，或写入仅本机可读且被 Git 忽略的 `.env.local`：

```bash
(umask 077; read -rsp 'ARK_API_KEY: ' key; printf 'ARK_API_KEY=%s\n' "$key" > content/yi-er-bubu/.env.local; unset key); echo
```

`ark-chat.sh` 接受 system/user 两个 UTF-8 提示文件，将 assistant 文本原子写入指定
文件，默认拒绝覆盖。它固定使用 HTTPS 方舟地址，验证 Key 与模型 ID，通过私有 curl
配置传递 Authorization，并设置连接超时、总超时和有限重试。模型可用
`--model <模型 ID>` 或临时环境变量 `ARK_CHAT_MODEL` 覆盖；不要把模型配置加入
`.env.local`。

为新篇建立 `ai/` 工作目录，复制阶段提示并填入相应的已审核输入。每一步的输出必须
先人工审核，审核通过后才粘贴到下一步提示中：

```bash
episode=content/yi-er-bubu/episodes/002-new-story
mkdir -p "$episode/ai"
cp content/yi-er-bubu/templates/ai-prompts/*.md "$episode/ai/"

content/yi-er-bubu/tools/ark-chat.sh \
  content/yi-er-bubu/templates/ai-prompts/system.md \
  "$episode/ai/story.md" "$episode/ai/story-output.md"

content/yi-er-bubu/tools/ark-chat.sh \
  content/yi-er-bubu/templates/ai-prompts/system.md \
  "$episode/ai/script.md" "$episode/script-candidate.md"

content/yi-er-bubu/tools/ark-chat.sh \
  content/yi-er-bubu/templates/ai-prompts/system.md \
  "$episode/ai/storyboard.md" "$episode/storyboard-candidate.md"

content/yi-er-bubu/tools/ark-chat.sh \
  content/yi-er-bubu/templates/ai-prompts/system.md \
  "$episode/ai/image-prompt.md" "$episode/image-prompts-candidate.md"

content/yi-er-bubu/tools/ark-chat.sh \
  content/yi-er-bubu/templates/ai-prompts/system.md \
  "$episode/ai/publish-copy.md" "$episode/publish-candidate.md"

content/yi-er-bubu/tools/ark-chat.sh \
  content/yi-er-bubu/templates/ai-prompts/system.md \
  "$episode/ai/text-qa.md" "$episode/ai/text-qa-report.md"
```

上述 `002-new-story` 仅为路径示例。不要直接运行未填完占位符的模板，也不要用
`--force` 跳过候选文件的人工比较。文本质检只提供第二双眼睛，不能替代 SVG 实际渲染、
逐字人工核对和最终发布审核。

## 1. 主题简报

输入：栏目方向与读者情绪。输出：`brief.md`。人工门：确认原创、可代入、页数与权利边界。

## 2. 故事脚本

输入：已通过的简报。输出：`script.md`。人工门：前两页有钩子，中段有推进，末页有治愈或轻笑点。

## 3. 逐页双格分镜

输入：脚本与角色基准。输出：`storyboard.md`。后续每个 1080×1440 页面拆成上下两个横向画格：上格铺垫，下格回应或推进。每格锁定场景、动作、表情、角色位置、气泡安全区及连续性。

分镜必须对每句对白记录“说话角色 + 角色位置 + 气泡尾尖坐标”。角色名仅作内部配对，不进入成图；台词本身不得进入图像生成提示词。

## 4. 无字插画

输入：角色参考图、角色基准、单页双格分镜、`templates/image-prompt.md`。输出：`raw/<页名>.png`。底图是一张完整 1080×1440 双格页，上下格分别生成连续动作，并预留对白气泡与尾巴的空间。AI 不生成对白气泡、画格边框或任何文字，这些由 SVG 统一叠加。逐页生成、逐页审核；失败只替换同名底图。

需要对已有底图做局部返工并明确选择 Doubao Seedream 5.0 lite 时，使用前述已轮换的
API Key，把编辑指令单独保存为 UTF-8 文本，并非破坏性地产生候选图：

```bash
content/yi-er-bubu/tools/seedream-image-edit.sh \
  content/yi-er-bubu/episodes/001-sleepless-night/raw/05.png \
  content/yi-er-bubu/episodes/001-sleepless-night/05-seedream-edit.txt \
  content/yi-er-bubu/episodes/001-sleepless-night/raw/05-seedream-candidate.png
```

工具使用 `doubao-seedream-5-0-260128` 和火山方舟图片生成接口，将输入图以内嵌 data URL 传入 `image` 字段；API Key 不进入命令参数、请求日志或版本库。默认关闭模型水印，并拒绝覆盖已有候选图。必须先人工确认人物、肢体、留白和连续性，才能用候选图替换 `raw/05.png` 并重新渲染；不要直接把候选图发布。

## 5. 中文排版

输入：已通过底图与分镜台词。输出：`overlays/<页名>.svg`。复制 `templates/text-overlay.svg`，保留白色外画布、上下双横格和粗深色圆角边框。对白使用白色椭圆/圆角漫画气泡、粗深色轮廓及与气泡轮廓连成一体的尾巴；尾尖指向分镜中的说话角色，不能指向另一个角色或空处。气泡内仅放居中黑色中文，不放说话人姓名。使用 Noto Sans CJK SC，正文不小于 38 px；逐字核对。

页面固定坐标为：上格 `x=64..1016, y=72..654`，下格 `x=64..1016, y=726..1308`，中间 72 px 保持纯白。格内主要角色和气泡建议再内缩至少 36 px。旁白可使用无尾卡片，但不得用无尾卡片代替角色对白。

## 6. 合成导出

```bash
content/yi-er-bubu/tools/render-page.sh \
  content/yi-er-bubu/episodes/001-sleepless-night/raw/01.png \
  content/yi-er-bubu/episodes/001-sleepless-night/overlays/01.svg \
  content/yi-er-bubu/episodes/001-sleepless-night/output/01.png
```

渲染器会把底图覆盖裁切到 1080×1440，渲染透明 SVG，再合成 PNG；SVG 的遮罩会强制将画格外及中间分隔覆盖为白色。输入缺失、依赖缺失、成品扩展名不是 PNG，或合成后格式/尺寸不符合约定时失败退出。

## 7. 质量门与发布

按 `quality-checklist.md` 检查角色、中文、节奏和权利边界；使用 `publish.md` 手工发布。发布后按 `content-strategy.md` 记录 24 小时与 7 天指标。

## 单页返工

画面失败先生成新的 `raw/<页名>-candidate.png` 并人工验收，通过后才替换 `raw/<页名>.png`；文字、气泡位置或尾巴指向失败时只修改 `overlays/<页名>.svg`；再次运行该页渲染命令，不改动其他页。

> 版式迁移边界：上述双格规则用于后续新篇；`episodes/001-sleepless-night/` 保持现有成品、底图和 SVG，不回溯修改。

## 每日自动流水线

服务器流程由 `automation/src/cli.js` 编排，仍复用本文件定义的内容契约和 `tools/render-page.sh`，不改变第 001 话或现有手工流程。阶段顺序为：

```text
topic → episode → images → overlays → renders → quality → xhsDraft → notification
```

每阶段在边界验证 JSON，记录输入摘要、尝试次数、原始响应、规范化结果、输出路径与错误类别。`daily/runs/YYYY-MM-DD/state.json` 使用临时文件加 rename 原子更新；日期锁拒绝并发触发。已通过且输入摘要未变的阶段跳过，失败阶段需显式 `--resume`，`--rerun <stage>` 只使该阶段及下游失效。文本与图片调用分别受每日上限约束；仅超时、429 和有限 5xx 可有限重试。

图片模型只生成无字双格底图；中文、边框和一体式气泡尾巴由本地 SVG 生成。真实模式要求只读参考目录内存在 `character-sheet.png`（或由 `CHARACTER_SHEET_NAME` 指定的同目录 PNG 文件）：必须是非符号链接、100 bytes–15 MiB、宽高各 512–4096 px 且对运行用户不可写。流水线会在任何模型预算计数前预检，并将参考图在内存中编码到每页 Seedream 请求唯一的 `image` 字段。磁盘输入记录只写文件名、尺寸、字节数和 SHA-256 摘要，不记录 data URL；摘要也参与图片阶段输入摘要，换图会使图片及下游失效。

自动质量门检查数量、PNG 尺寸、顺序、对白落入 SVG 和禁用表述；角色、肢体、尾尖指向、语义与连续性始终进入人工待审清单。

运行模式必须显式指定 `--mock` 或 `--live`。开发、测试、故障注入一律使用 `--mock`；真实模式的密钥只从环境或 Docker secret 文件读取。小红书阶段可整体关闭，且只允许浏览器页面中的保存草稿动作；任何验证、风控或页面不明确立即停止。钉钉通知是独立阶段，失败不回写生成结果。
