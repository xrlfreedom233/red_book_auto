# 一二布布日常漫画生产包

本目录用于制作一二布布原创日常剧情漫画。角色参考图只用于内部造型校准，不复制到本目录，也不进入发布包。

## 快速开始

1. 从 `templates/` 复制主题简报、脚本、分镜、图像提示词和发布文案模板到新的 `episodes/<编号-主题>/`。后续新篇统一使用上下双横格版式；第 001 话保留已发布的原版式，不回溯改造。
2. 先完成简报与脚本审核，再逐页生成**无字**插画；失败页单独重做。
3. 为每页复制 `templates/text-overlay.svg`，只在 SVG 中录入准确中文。
4. 执行 `tools/render-page.sh <底图> <叠字.svg> <成品.png>`。
5. 按 `quality-checklist.md` 人工验收，再使用 `publish.md` 手工发布。

未来篇目的故事、脚本、分镜、画面提示词、发布文案和文字质检可使用
`tools/ark-chat.sh` 调用 Doubao Seed 2.1 Pro；各阶段提示模板在
`templates/ai-prompts/`。图像仍由 Doubao Seedream 5.0 lite 生成，气泡和准确中文仍由
本地 SVG 排版，不把整条流程交给文本模型自动发布。

局部图生图返工可使用 `tools/seedream-image-edit.sh`。两个方舟工具共用
`ARK_API_KEY` 安全约定：优先读取当前进程的环境变量，否则读取被忽略且权限为 600
的 `.env.local`。创建方式和人工审核门见 `workflow.md`；不要在聊天、截图、脚本参数或
提交中粘贴 API Key。任何曾粘贴到聊天中的 Key 都应先在控制台撤销并轮换，再用于本机。

## 内容契约

- 成品为 1080×1440 PNG；每篇 1 张封面和 4–6 张剧情页。后续新页均使用白色外画布、上下两个横向画格、72 px 白色分隔和粗深色圆角边框。
- AI 画面不得包含可读文字、签名、水印或多余角色。
- 对白、旁白和标题全部由 SVG 叠加。角色对白使用白色椭圆/圆角漫画气泡、粗深色轮廓和一体化尾巴；尾尖指向说话角色，气泡内只放居中黑色中文，不放说话人姓名。
- 每页的 `raw/`、`overlays/`、`output/` 文件一一对应，可独立替换。
- 公开内容不使用权利方口吻，不暗示合作或授权，不加入商品与付费引导。

第一篇完整样片见 `episodes/001-sleepless-night/`。用户提供的版式参考只用于抽象出上述规则，新作不复制其中的角色、文字、场景或具体镜头。

## 每日自动化（待审核包）

`automation/` 提供可恢复的 Node.js 流水线，默认必须显式选择模拟或真实模式。先用不访问任何外部服务的模拟运行验收：

```bash
npm --prefix content/yi-er-bubu/automation test
node content/yi-er-bubu/automation/src/cli.js run --mock --date 2026-08-02
```

结果保存在被 Git 忽略的 `daily/`：`runs/<日期>/state.json` 是状态唯一真源，`report.md` 是人读摘要，`episodes/<日期>-<slug>/` 保存结构化篇目、底图、SVG、PNG 与质检。相同日期默认幂等；失败后用 `--resume`，定向重做用 `--rerun topic|episode|images|overlays|renders|quality|xhsDraft|notification --resume`。显式重做产生带 attempt 后缀的候选，不删除既有通过文件。

自动检查通过后仍只标记为“待审核”。角色身份、肢体、气泡尾尖、中文语义和画面连续性必须人工确认；程序不会执行发布或定时发布。

## Docker 与服务器调度

在 `deploy/` 目录复制 `server.env.example` 为仅宿主可读的 `.env`，把已经轮换的方舟 Key、钉钉 Webhook 和可选加签 secret 分别写入 `.env` 指向的 mode-600 文件。不要把值写进 Compose、命令参数或仓库。

真实图片生成还必须在 `CHARACTER_REFERENCE_DIR` 下放置只读的
`character-sheet.png`：它必须是非符号链接 PNG，宽高各 512–4096 px，大小
100 bytes–15 MiB，并对运行用户不可写。建议执行
`chmod 444 /srv/yi-er-bubu/references/character-sheet.png`。需要使用其他明确文件名时，
通过 `CHARACTER_SHEET_NAME` 配置一个不含路径的 `.png` 文件名。参考图目录由 Compose
只读挂载，并被 Git 与 Docker build context 排除，不会进入镜像。

然后：

```bash
cd content/yi-er-bubu/deploy
docker compose --env-file .env build
docker compose --env-file .env run --rm daily --mock --date 2026-08-02
docker compose --env-file .env run --rm daily --live --date 2026-08-02
```

`daily/`、角色参考图和 Chromium profile 分卷挂载，重建镜像不会删除历史或登录态。真实运行会在任何模型调用计数前校验角色设定表；缺失、可写、格式或尺寸无效都会立即失败。通过后，参考图仅在内存中编码并放入每页 Seedream 请求的单个 `image` 字段；日志和输入记录只保留文件元数据与摘要。参考图摘要变化会使图片阶段及下游重新运行。模拟模式不读取参考图，也不访问外部服务。

上线前把 `cron.example` 中仓库路径改为服务器绝对路径，安装到宿主 crontab；它通过 `CRON_TZ=Asia/Shanghai` 每天 09:00 触发。暂停自动化时先注释或删除该 cron 行，不要删除 `daily/`。

首次需要小红书草稿功能时，只通过 SSH 隧道访问绑定在本机的 noVNC：

```bash
docker compose --env-file .env --profile login up login
ssh -N -L 6080:127.0.0.1:6080 user@server
```

浏览器访问 `http://127.0.0.1:6080/vnc.html`，由用户亲自登录并确认创作中心。之后设置 `ENABLE_XHS_DRAFT=true`；自动化只上传当天通过质检的图片、填写文案并点击页面明确标注的“保存草稿”。登录过期、验证码、风控或页面语义不明确都会停止并截图，改为人工上传。草稿保存成功也不等于审核或发布成功。

故障恢复时先查看 `daily/runs/<日期>/report.md` 与脱敏后的 `state.json`。额度或鉴权失败先停止 cron 并处理账户；临时网络失败可 `--resume`；页面变化可设置 `ENABLE_XHS_DRAFT=false` 保留生成与钉钉通知。通知失败独立记录，不改变漫画生成的真实结果。
