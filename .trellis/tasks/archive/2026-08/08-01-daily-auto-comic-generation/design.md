# 技术设计

## 方案概览

在现有 `content/yi-er-bubu/` 内容包中增加一个 Node.js 驱动的可恢复流水线，复用已有方舟文本调用、SVG 排版规范和 ImageMagick 渲染逻辑，并补齐从零生图、结构化内容、运行状态、Docker、Playwright 草稿保存和钉钉通知。

```text
Docker/09:00 触发
  → 取得当日互斥锁与运行状态
  → 生成并去重主题
  → 生成结构化脚本/分镜/提示词/发布文案
  → Seedream 逐页生成无字双格底图
  → 本地生成 SVG 气泡与中文
  → 渲染 1080×1440 PNG
  → 自动质量检查 + 人工待审项
  → Playwright 上传并保存小红书草稿
  → 钉钉通知
```

## 目录与组件边界

计划新增：

```text
content/yi-er-bubu/
├── automation/
│   ├── package.json
│   ├── src/
│   │   ├── cli.js
│   │   ├── config.js
│   │   ├── contracts.js
│   │   ├── state.js
│   │   ├── pipeline.js
│   │   ├── topic-history.js
│   │   ├── ark.js
│   │   ├── seedream.js
│   │   ├── overlay.js
│   │   ├── quality.js
│   │   ├── xhs-draft.js
│   │   └── dingtalk.js
│   └── tests/
├── deploy/
│   ├── Dockerfile
│   ├── compose.yaml
│   ├── cron.example
│   └── server.env.example
└── daily/                         # 持久化卷，不提交生成内容
    ├── history/topics.jsonl
    ├── runs/YYYY-MM-DD/state.json
    └── episodes/YYYY-MM-DD-<slug>/
```

`automation/src` 只编排与验证，不复制现有内容规则。角色定义、栏目、模板、质量清单和 `render-page.sh` 继续由内容包原文件拥有。运行时角色参考图通过只读宿主卷挂载，不复制进镜像或发布包。

## 数据契约

### 结构化模型输出

每个文本阶段要求模型返回 JSON，并在边界处进行严格校验。核心契约包括：

- `topic`: 栏目、主题、情绪、场景、冲突、结尾、去重关键词。
- `episode`: 标题、简报、页面数组、发布文案。
- `page`: 页码、上下画格、角色位置、动作、表情、连续性、气泡和提示词。
- `bubble`: 文本、说话角色、画格、气泡框、尾尖坐标；角色名只用于内部配对。
- `quality`: 自动检查结果和必须人工确认的视觉检查项分开记录。

模型原始响应保存在 `ai/raw/`，校验后的规范化 JSON 保存在 `ai/normalized/`。无效 JSON 不进入下一阶段，也不会自动无限重试。

### 状态机与恢复

`state.json` 是单篇运行状态的唯一真源，使用原子临时文件加重命名更新。阶段状态为 `pending | running | passed | failed | skipped`，并记录尝试次数、输入摘要、输出路径、错误类别和时间戳。

状态按以下顺序推进：

```text
topic → episode → images.<page> → overlays.<page> → renders.<page>
      → quality → xhsDraft → notification
```

同日默认取得文件锁后读取状态：已通过且输入摘要未变化的阶段跳过；失败阶段可显式 `--resume`；`--rerun <stage>` 只使目标阶段及其下游失效。历史通过产物不被原地删除。

## 主题去重

每次生成前读取 `topics.jsonl`，先按规范化标题、栏目、场景、冲突和结尾指纹做确定性比较，再把最近历史摘要交给文本模型复核语义重复。被拒候选及原因写入当日运行记录。只有最终通过候选追加历史；追加使用锁和原子写，避免并发重复。

## 模型调用与成本控制

- 文本使用现有 `Doubao-Seed-2.1-pro`，图片使用 `Doubao-Seedream-5.0-lite`。
- 新增从零图片生成适配器；输入包含角色参考图、角色基准和单页双格提示词，输出先写候选路径。
- API Key 通过 Docker secret 或仅宿主可读环境文件注入；Authorization 不进入进程参数。
- 配置限制每日文本调用、图片调用和单阶段重试次数。网络超时、429、有限 5xx 可退避重试；鉴权、额度、校验和内容质量错误立即停止。
- 测试默认使用本地假服务，只有显式 `--live` 才允许消耗真实额度。

## SVG 与画面合成

底图由 Seedream 生成无字双格场景，本地 `overlay.js` 根据通过校验的气泡契约生成 SVG：固定双格坐标、字体、字号、安全区、白底深色粗描边气泡和一体式尾巴。随后调用现有 `render-page.sh` 合成 PNG。

自动质量检查覆盖页数、命名、PNG 格式、1080×1440、文字必填、禁用表述、气泡边界和页面顺序。角色身份、肢体、尾尖视觉指向及连续性列为人工待审项，不伪装成自动通过。

## Playwright 草稿保存

Playwright 使用独立持久化 Chromium profile。首次登录通过单独的 `login` 服务在受限 noVNC 会话中由用户完成；noVNC 只绑定 `127.0.0.1`，通过 SSH 隧道访问，正常每日任务不暴露远程桌面端口。

草稿步骤只允许：打开创作中心图文页面、选择已通过的 PNG、填入标题/正文/标签、执行页面上的保存草稿操作、验证草稿提示并截图。实现中不包含发布按钮选择器，不拦截或重放小红书 Cookie、签名、`/web_api/sns/v2/note` 发布接口。出现登录失效、验证码、风控或无法确认按钮语义时立即失败并保存脱敏截图。

首次实现以假页面测试所有浏览器路径；真实创作中心只进行用户在场的“保存草稿”验收，绝不进行真实发布测试。

## 钉钉通知

使用自定义机器人 Webhook，可选加签。签名通过 Node.js 标准库 HMAC-SHA256 生成，Webhook 和 secret 从 Docker secret 读取。通知只包含日期、运行 ID、阶段状态、草稿状态和安全的本地路径/操作建议，不附 Cookie、模型响应、图片数据或其他密钥。

通知阶段独立记录：通知失败不会把已成功生成或已保存草稿的任务改判为失败，但会在状态中标记 `notification=failed`，便于补发。

## Docker 与调度

镜像固定 Node.js、Playwright Chromium、Noto CJK、ImageMagick、librsvg、curl、jq 和 `file`。Compose 挂载：

- 内容包代码（镜像内只读）；
- `daily/` 运行与成品卷；
- 角色参考图只读卷；
- Chromium profile 独立卷；
- 方舟与钉钉 secrets。

宿主 cron 使用 `CRON_TZ=Asia/Shanghai` 在每天 09:00 执行一次 `docker compose run --rm daily`。手工命令接受 `--date YYYY-MM-DD` 和 `--resume`。容器重建不影响持久化卷。

## 兼容、风险与回滚

- 现有第 001 话和手工流程保持不变；自动化只创建新的日期目录。
- 小红书页面变化是最高外部风险；草稿失败不影响服务器待审核包，可由用户手工上传。
- 模型结构化输出和角色一致性是主要内容风险；严格边界校验、单页候选和人工终审降低影响。
- 发现额度异常时停止 cron，保留状态与产物；恢复后使用 `--resume`。
- Docker/Playwright 无法稳定运行时，可禁用 `xhsDraft` 阶段，仍保留完整生成和钉钉通知能力。

