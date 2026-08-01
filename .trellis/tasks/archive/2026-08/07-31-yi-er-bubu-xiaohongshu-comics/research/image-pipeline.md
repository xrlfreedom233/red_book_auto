# 本地图片流程调研

## 参考素材

- 用户提供 12 张 PNG：`research/references/bubu-01.png` 至 `bubu-05.png`，以及 `yier-01.png` 至 `yier-07.png`。
- 原图尺寸较小，范围约 101–239 像素；适合作为造型参考，不适合直接放大后发布。
- 代表性全身与动作图足以区分两名角色，但生成时仍需逐页检查耳朵、斑块、腮红和身体比例。

## 可用本地工具

- `/usr/bin/magick` 与 `/usr/bin/convert`：可缩放、裁切、合成和检查 PNG。
- `/usr/bin/rsvg-convert`：可把带中文文字的 SVG 渲染为透明 PNG。
- `/usr/bin/ffmpeg`：当前静态图片 MVP 不依赖，后续视频化可用。
- Python Pillow 未安装，MVP 不应依赖它或新增安装步骤。
- 本机已安装 Noto Sans CJK、Sarasa Gothic 和文泉驿等中文字体。

## 结论

使用 AI 生成无字底图、SVG 表达准确中文、`rsvg-convert` 与 ImageMagick 合成最终 PNG 的方案可以在当前环境直接执行，不需要下载新依赖。
