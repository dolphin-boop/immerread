# 译读隐私说明 / Yidu Privacy Notice

生效日期：2026-09-17

译读是一个从 GitHub 本地安装、由用户自带 API Key 的 Chrome 扩展。它没有译读账号、开发者运营的后端、广告、分析统计或行为追踪。

## 处理的数据

根据你使用的功能，译读会处理：

- 当前网页的标题、规范 URL 和可提取英文正文；
- 你主动选择的英文文本；
- 你保存的固定译法；
- 你配置的 API Key、模型和 API Base；
- 翻译与导读缓存。

图片、视频、Canvas 和无法安全线性化的交互内容不会被 OCR 或复制到侧栏。

## 数据发送到哪里

### DeepSeek 或自定义兼容服务

请求从扩展直接发送到 `https://api.deepseek.com`，或你在选项页自行填写的 OpenAI 兼容 API Base：

- 段落翻译发送文章标题、当前小批量段落，以及与这些段落相关的固定译法；
- 章节导读发送文章标题、当前章节标题与正文，不发送网页 URL 或固定译法库；
- 划词翻译和解释只发送你主动选择的英文，不发送文章标题或附近段落；
- API Key 会作为请求凭据发送到对应服务商。

这些服务会按照各自的条款、隐私政策、数据保留方式和账号设置处理数据。不要翻译其条款不允许发送的机密、个人、受监管或第三方数据。

## 本地存储与保留

译读使用 Chrome 本地扩展存储：

- API Key、API Base、模型和固定译法保存在当前浏览器配置中；
- 翻译和导读最多缓存 20 篇文章；
- 超过 30 天的缓存会在使用过程中清理；
- 网页 URL 仅在本地用于缓存键；
- 可在扩展选项页清除全部缓存；移除扩展或清除扩展数据可删除其余本地数据。

清除本地数据不会删除服务商已经处理或保留的数据。请使用对应服务商的控制台管理其数据和撤销 Key。

Chrome 扩展存储不是加密密码保险箱。任何能充分访问你的设备或浏览器配置的人，都可能恢复本地保存的 Key 或内容。建议使用独立 Key、设置消费限额，并在设备或浏览器配置泄露后立即轮换或撤销 Key。

## 权限说明

- `sidePanel`：在网页旁显示译读界面。
- `storage`：保存设置、固定译法和缓存。
- `tabs`：识别当前窗口中的文章页面并进行同步。
- `scripting`：扩展重新加载后为当前页面恢复内容脚本。
- `http://*/*`、`https://*/*`：读取用户打开的普通网页正文，并允许访问用户配置的兼容 API 服务。

译读不使用这些权限建立浏览历史、广告画像或分析统计。

## 变更与联系

影响隐私的数据流变化会记录在本文件和 Git 历史中。安全漏洞或意外密钥泄露请按 [SECURITY.md](SECURITY.md) 私下报告。

---

## English summary

Yidu is a GitHub-only, bring-your-own-key Chrome extension with no Yidu account, developer-operated backend, analytics, advertising, or telemetry. Article translation, section-guide, and selected-text requests go directly from the extension to DeepSeek or the OpenAI-compatible endpoint configured by the user. Keys, settings, glossary entries, URLs used as cache keys, and recent results are stored in Chrome local extension storage. Chrome extension storage is not an encrypted vault. Use a dedicated key, apply spending limits, and revoke the key if the device or browser profile is compromised.
