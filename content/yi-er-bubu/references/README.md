# 角色参考资产挂载目录

真实 Seedream 每页生成需要一个统一角色设定表，默认文件名为
`character-sheet.png`。实际图片被 Git 和 Docker build context 忽略，必须由服务器以
只读卷挂载；不要把参考图复制进镜像或发布包。

文件契约：

- 常规 PNG 文件，不允许符号链接；
- 宽高各为 512–4096 px，文件为 100 bytes–15 MiB；
- 对运行用户只读，例如 `chmod 444 character-sheet.png`；
- 若使用其他明确文件名，通过 `CHARACTER_SHEET_NAME` 配置，仍必须是当前目录下的
  `.png` 文件名，不能包含路径。

自动化只在内存中编码 data URL，并把它放入 Seedream 已支持的单个 `image` 请求字段。
输入记录只保存文件名、尺寸、字节数和 SHA-256 摘要，不保存图片内容或 data URL。
