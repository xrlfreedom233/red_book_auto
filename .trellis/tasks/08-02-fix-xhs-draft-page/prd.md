# 修复小红书草稿页面适配

## Goal

让服务器上的 Playwright 在小红书创作页异步加载时可靠等待图片上传控件，并在只读 Docker 运行时中稳定启动 Chromium，最终只上传并保存草稿，仍由用户人工发布。

## Background

- 2026-08-02 服务器真实运行已成功生成漫画并完成小红书登录。
- 运行状态记录 `xhsDraft` 为可恢复的 `page_changed` 失败，错误是 `image upload control was not found`。
- 失败截图显示已登录的创作服务平台，主体仍是灰色骨架屏，说明 `domcontentloaded` 早于 SPA 上传控件挂载。
- Chromium 在只读容器中使用默认 HOME 时因 crashpad 退出；临时传入 `HOME=/tmp` 后交互式登录成功。

## Requirements

1. 真实草稿流程在导航到允许的创作页后，必须精确选择顶部“上传图文”内容类型，再等待明确接受图片的 `input[type=file]` 实际挂载；不得把默认“上传视频”的输入框用于图片。
2. 等待时间必须受现有 `REQUEST_TIMEOUT_MS` 约束；超时后截图并以可恢复的 `page_changed` 失败结束。
3. 登录/验证/风控页仍必须停止并返回 `human_verification`，不得尝试绕过。
4. 浏览器自动化只能点击两个精确操作：内容类型“上传图文”和最终“保存草稿”；不得点击“发布笔记”或任何发布操作，不得调用私有接口、提取 Cookie 或签名。
5. Compose 运行时必须为 Chromium 提供可写 HOME，且不降低 `read_only`、`no-new-privileges` 或本机 noVNC 端口绑定等安全约束。
6. 修复必须适用于交互式登录和日常无头草稿两条路径，服务器操作不再需要手工加 `-e HOME=/tmp`。

## Acceptance Criteria

- [ ] 单元测试证明：上传控件延迟挂载时会等待而非立即失败。
- [ ] 单元测试证明：精确选择“上传图文”，并忽略接受 `.mp4/.mov` 的视频输入框。
- [ ] 单元测试证明：等待超时仍返回可恢复的 `page_changed`。
- [ ] 安全测试证明点击白名单只包含“上传图文”和“保存草稿”，并且导航主机受限。
- [ ] Compose 配置校验通过，生成配置中所有运行服务都有可写 HOME，同时保留只读和安全选项。
- [ ] `npm test` 和 `npm run lint` 全部通过。
- [ ] 服务器重建后，不传入临时 HOME 覆盖即可启动登录 Chromium。
- [ ] 使用已有同日运行状态重做 `xhsDraft` 时，图片和文案仅保存为草稿，结果为 `success` 且仍标记 `pending_review`。

## Out of Scope

- 自动点击发布、定时发布或绕过验证码/风控。
- 直接调用或逆向小红书私有发布接口。
- 泛化支持任意创作平台布局。
- 删除或重生成已有漫画产物。

## Technical Notes

- 当前实现位于 `content/yi-er-bubu/automation/src/xhs-draft.js`，使用 `page.goto(..., { waitUntil: "domcontentloaded" })` 后立即检查上传控件。
- 共享容器运行配置位于 `content/yi-er-bubu/deploy/compose.yaml` 的 `x-runtime.environment`。
- 安全合同位于 `.trellis/spec/backend/automation-integration-contracts.md`。
