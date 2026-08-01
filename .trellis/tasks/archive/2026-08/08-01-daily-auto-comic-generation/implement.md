# 实施计划

## 1. 建立运行时与契约

- [ ] 创建 Node.js 自动化包、配置加载与 CLI，复用现有内容包路径和工具。
- [ ] 定义并验证主题、篇目、页面、气泡、质量与运行状态 JSON 契约。
- [ ] 实现原子状态存储、当日互斥锁、阶段输入摘要、幂等、恢复和定向重跑。
- [ ] 为状态迁移、并发触发、损坏状态和恢复路径编写测试。

## 2. 实现内容流水线

- [ ] 封装文本模型结构化调用，保存原始响应与规范化结果，并加入调用上限和错误分类。
- [ ] 实现主题历史、确定性指纹和语义去重，记录拒绝原因。
- [ ] 实现 Seedream 从零逐页生图，使用只读角色参考资产并非破坏性保存候选。
- [ ] 根据气泡契约生成双格 SVG，调用现有渲染器导出全部 PNG。
- [ ] 实现自动质量检查和独立的人工待审清单。
- [ ] 使用本地假 API 跑通封面加 4 页的最小整篇流水线，不消耗真实额度。

## 3. 实现小红书草稿保存

- [ ] 创建 Playwright 持久化 profile 与一次性交互登录入口。
- [ ] 在本地假创作中心页面实现上传、填文案、保存草稿、成功验证和截图。
- [ ] 添加硬性安全约束：代码和测试均不包含发布选择器、发布接口调用或凭证日志。
- [ ] 处理登录过期、验证码、风控、页面变化、上传失败和保存结果不明确等停止条件。
- [ ] 在用户在场时用真实创作中心完成一次“只保存草稿”验收；任何异常立即停止。

## 4. 实现钉钉与 Docker 部署

- [ ] 实现钉钉成功、部分失败、失败消息及 HMAC 加签，通知失败与主任务状态分离。
- [ ] 创建 Dockerfile、Compose、secrets/卷配置和服务健康检查。
- [ ] 创建只绑定本机的 noVNC 登录服务说明及 SSH 隧道操作说明。
- [ ] 提供 `CRON_TZ=Asia/Shanghai`、每天 09:00 的 cron 示例和手工补跑/恢复命令。
- [ ] 验证容器重建后历史、成品、状态和浏览器 profile 仍存在。

## 5. 端到端验证与文档

- [ ] 验证同日重复触发不重复调用模型，显式重跑只影响目标阶段及下游。
- [ ] 注入文本 API、图片 API、渲染、磁盘、Playwright 和钉钉故障，检查可恢复状态与有限重试。
- [ ] 扫描日志、进程参数、镜像层、测试夹具和 Git 差异，确认不含 API Key、Webhook、Cookie、token 或签名。
- [ ] 检查所有模拟成品为 1080×1440 PNG，页面顺序、气泡和中文契约正确。
- [ ] 更新内容包 README/workflow，记录部署、首次登录、日常运行、人工审核、故障恢复和停止调度方法。

## 验证命令（实施时按最终脚本名调整）

```bash
npm --prefix content/yi-er-bubu/automation test
npm --prefix content/yi-er-bubu/automation run lint
docker compose -f content/yi-er-bubu/deploy/compose.yaml build
docker compose -f content/yi-er-bubu/deploy/compose.yaml run --rm daily --date 2026-08-02 --mock
docker compose -f content/yi-er-bubu/deploy/compose.yaml run --rm daily --date 2026-08-02 --mock
find content/yi-er-bubu/daily -path '*/output/*.png' -print0 | xargs -0 identify
git grep -n -E 'ark-[[:alnum:]-]+|web_session=|access-token|x-s-common|DINGTALK_.*https://'
```

## 风险文件与回滚点

- `automation/src/state.js`：状态损坏会影响恢复；必须先通过原子写和故障注入测试。
- `automation/src/xhs-draft.js`：误操作风险最高；先用假页面测试，真实验收只保存草稿。
- `deploy/compose.yaml`：卷路径或权限错误可能丢失运行数据；上线前执行重建持久性测试。
- 模型调用适配器：任何重试策略变更都必须重新验证调用上限，避免额度循环。
- 回滚时先停用宿主 cron，再禁用 Playwright 阶段；已有日期目录和状态卷保持不动。

