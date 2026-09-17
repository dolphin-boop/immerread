# 译读 Yidu

**中文** | [English](#english)

[![CI](https://github.com/dolphin-boop/yidu/actions/workflows/ci.yml/badge.svg)](https://github.com/dolphin-boop/yidu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-a94f32.svg)](LICENSE)
[![Chrome 114+](https://img.shields.io/badge/Chrome-114%2B-4285F4.svg)](https://www.google.com/chrome/)

demo/article-translator/20260917-155819.jpg

> 把英文技术文章变成一份安静、可跟随阅读的中文侧栏，不重建原网页，也不打断阅读位置。
>
> Turn English technical articles into a calm, synchronized Chinese reading companion without rebuilding the source page.

译读是一款本地安装的 Chrome Side Panel 扩展。它在右侧渐进翻译英文文章，提供章节导读、划词翻译与解释、固定译法库，并把密钥和缓存保存在当前浏览器中。

**已验证（2026-09-17）：** `npm test` 32/32 通过，`npm run check` 通过。项目使用原生 HTML、CSS 和 JavaScript，无构建步骤。

## 为什么做译读

阅读长篇英文技术文章时，整页替换会丢失原站上下文，复制到聊天工具又会打断阅读。译读保留原网页，让中文译文在 Chrome 右侧随阅读位置同步出现：原文负责图片、图表、视频和交互，侧栏负责清晰、连续的中文阅读。

## 核心能力

| 能力 | 你会得到什么 |
| --- | --- |
| 渐进翻译 | 优先翻译当前阅读范围，标题、正文、列表和引用按原顺序呈现 |
| 原文同步 | 滚动英文原文时，右侧译文自动定位到对应段落 |
| 章节导读 | 按原文章节生成中文标题和最多三句、150 字的概述 |
| 划词工具 | 在原网页选中英文后，可翻译、解释或保存固定译法 |
| 固定译法库 | 自定义术语跨文章复用，只重翻受影响的段落 |
| 复杂内容保护 | 图片、图表、视频和交互模块留在原网页；可识别的表格叶子单元格在原位显示小号译文 |
| 本地缓存 | 译文和导读最多缓存 20 篇文章、保留 30 天，可随时清除 |
| 一致排版 | 右侧译文统一为纯文本，避免链接、粗体等原文样式被模型随机继承 |

## 让编程 Agent 帮你安装

把下面这段话发给你的编程 Agent：

> 请把 https://github.com/dolphin-boop/yidu 克隆或下载到我选择的长期保留文件夹，告诉我准确完整路径，并指导我在 Chrome 的“加载已解压的扩展程序”中选择这个包含 manifest.json 的文件夹。然后打开扩展选项页，告诉我在哪里填写 DeepSeek API Key；不要查看、复制或要求我把 Key 发到聊天里。最后打开一篇公开英文技术文章，确认侧栏翻译可以使用。

不要把 API Key 发到 AI 对话、源代码、截图、Issue 或公开消息中。请只在译读的扩展选项页中自行填写。

## 手动安装

1. 下载本仓库 ZIP，解压到一个长期保留的文件夹；也可以运行 `git clone https://github.com/dolphin-boop/yidu.git`。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 启用右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择包含 `manifest.json` 的项目根目录。
6. 打开译读的扩展详情或选项页，填写 DeepSeek API Key。
7. 打开一篇英文文章，点击工具栏中的译读图标。

这是一个本地加载的扩展，不会自动更新。拉取新版本后，请在 `chrome://extensions` 中点击译读卡片上的“重新加载”，并刷新已打开的文章页面。移动或删除项目文件夹后，需要从新位置重新加载扩展。

## 配置 DeepSeek

默认配置为：

```text
API Base: https://api.deepseek.com
Model: deepseek-flash
```

译读也允许填写 OpenAI 兼容的 API Base 和模型名。使用自定义服务时，文章内容会被发送到你配置的服务地址，请先确认该服务的隐私政策、数据保留方式和计费规则。

API Key、模型和接口地址保存在 Chrome 本地扩展存储中。Chrome 扩展存储不是加密密码保险箱；建议使用独立 Key、设置消费限额，并在设备或浏览器配置泄露后立即轮换或撤销 Key。

## 使用方式

1. 打开包含英文正文的普通网页。
2. 点击译读图标，Chrome 会在右侧打开侧栏。
3. 在“中文翻译”中阅读随原文滚动的译文。
4. 打开“导读”，查看按原文章节组织的中文概述。
5. 在原网页选中英文，使用“翻译 / 解释 / 固定译法”。
6. 在“固定译法”页签中添加、编辑或删除自己的术语。

## 隐私与数据流向

译读没有账号系统、开发者运营的后端、广告、分析统计或行为追踪。请求从扩展直接发往 DeepSeek 或你自行配置的兼容服务。

| 场景 | 发送内容 |
| --- | --- |
| 段落翻译 | 文章标题、当前小批量段落、与这些段落相关的固定译法 |
| 章节导读 | 文章标题、当前章节标题与正文；不发送网页 URL 和固定译法库 |
| 划词翻译 / 解释 | 你主动选中的英文；不发送文章标题或附近段落 |
| 本地缓存 | URL 只在浏览器本地作为缓存键，不随导读请求发送 |

完整说明见 [PRIVACY.md](PRIVACY.md)。

## 当前支持与限制

- 支持 Google Chrome 114 或更高版本；其他 Chromium 浏览器未验证。
- 适合有清晰正文结构的公开英文文章页面。
- 不做 OCR，不翻译图片、视频、Canvas 或交互组件内部内容。
- 复杂多列布局、轮播和无法安全线性化的模块不会拆进右侧译文。
- 右侧译文使用纯文本，不复制原文链接、粗体、下划线或行内代码样式。
- 翻译和导读会消耗你自己的模型额度；译读不赠送额度，也不代收费用。
- 当前通过 GitHub 本地安装，尚未发布到 Chrome Web Store。

## 验证

```bash
npm test
npm run check
```

自动化测试覆盖文章提取、翻译提示、缓存、固定译法、导读和扩展结构。真实网页结构和模型服务会变化，发布前仍应在 Chrome 中重新加载扩展，并用公开英文文章做一次手动检查。

## 项目结构

```text
background.js              后台请求、缓存与消息路由
content.js / content.css   原网页提取、同步与划词界面
sidepanel.*                右侧翻译、导读和固定译法库
options.*                  API、模型与缓存设置
lib/                       翻译、导读、缓存、术语核心逻辑
tests/                     Node 测试与浏览器端到端脚本
demo/article-translator/   可复现的界面演示与截图
```

## 项目定位与反馈

这是一个可自行下载、Fork 和改造的个人开源项目，目前不承诺公开 Issue、Pull Request 的响应时效，也没有 Bug Bounty。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告；普通使用问题可以先查看本 README、仓库历史和浏览器控制台。

## 开源许可

[MIT License](LICENSE)

---

<a name="english"></a>

# English

Yidu is a locally installed Chrome Side Panel extension for reading English technical articles in Chinese without replacing the source page. It progressively translates the current reading area, follows source-page scrolling, generates section-based reading guides, explains selected text, and maintains a user-controlled glossary.

## What you get

- Progressive Chinese translation for headings, paragraphs, lists, and quotes.
- Scroll synchronization between the source article and the side panel.
- Section-based Chinese guides, limited to three sentences and 150 Chinese characters.
- Selected-text translation, explanation, and user-confirmed terminology.
- Local translation and guide caches with a 20-article / 30-day limit.
- Plain-text translation rendering for consistent and safe typography.
- No Yidu account, developer-operated backend, analytics, advertising, or telemetry.

## Quick start

1. Download or clone `https://github.com/dolphin-boop/yidu` into a permanent folder.
2. Open `chrome://extensions` in Chrome 114 or newer.
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Open the extension options and enter your own DeepSeek API key. Never paste the key into chat, source files, screenshots, or public issues.
5. Open a public English article and click the Yidu toolbar icon.

The default API base is `https://api.deepseek.com`, and the default model identifier is `deepseek-flash`. You may configure another OpenAI-compatible endpoint and model, but article content will then be sent to that provider under its own terms and retention policy.

## Privacy and limits

Keys, settings, glossary entries, and recent caches stay in Chrome local extension storage. Translation and guide requests go directly from the extension to DeepSeek or the compatible endpoint you configure. Yidu does not provide API credits and is not currently distributed through the Chrome Web Store.

Yidu does not OCR images or translate video, canvas, or interactive content. Complex layouts that cannot be safely linearized stay on the source page. The translation panel intentionally renders plain text instead of copying links or inline typography from the source.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the complete data and reporting boundaries.

## Verification

```bash
npm test
npm run check
```

Verified on 2026-09-17: 32 tests passed and syntax checks passed. The project uses plain HTML, CSS, and JavaScript with no build step.

## License

[MIT License](LICENSE)
