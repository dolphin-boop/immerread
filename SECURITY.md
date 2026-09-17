# 安全政策 / Security Policy

## 支持范围

译读是一个小型 GitHub 本地安装项目。安全修复只面向 `main` 上的最新代码，以及未来可能发布的最新 GitHub Release；旧快照不提供支持。

## 私下报告漏洞

不要在公开 Issue、Pull Request、截图或日志中发布漏洞细节、API Key、访问令牌、私人 URL 或文章内容。

优先使用仓库 **Security** 页中的 GitHub Private Vulnerability Reporting。若没有显示私密报告入口，请通过仓库所有者的 GitHub 主页请求一个私密联系方式，但不要在公开消息中附带漏洞细节。

私密报告应包含：

- 受影响的版本或 commit；
- 最少复现步骤；
- 预期行为与实际行为；
- 安全或隐私影响；
- 可选的修复建议。

请用虚构或公开测试内容复现，并移除真实 Key、Token、私有网页、个人信息和受保护内容。本项目不提供 Bug Bounty，也不承诺固定响应时限。

## 优先关注的问题

- Key、Token 或私人内容进入源代码、缓存、日志、截图或发布包；
- 模型返回内容造成脚本或 HTML 注入；
- 请求被发送到用户未配置或文档未说明的网络地址；
- 读取或传输超出当前文章和已记录功能范围的数据；
- 缓存、固定译法或扩展数据无法按文档清除；
- 发布流程或依赖被篡改。

## 用户安全建议

- 只从你信任的 GitHub 仓库或 Release 安装。
- 不要复用生产系统 Key；尽量使用独立、可撤销的 Key。
- 为服务账号设置限额并查看用量。
- 设备、浏览器配置、截图或日志泄露后立即撤销相关 Key。
- Chrome 本地扩展存储不是加密密码保险箱。

---

## English summary

Security fixes target only the latest code on `main` and the latest release, if one exists. Do not disclose vulnerabilities, credentials, private URLs, or private article content in public issues or pull requests. Use GitHub Private Vulnerability Reporting when available, or ask the repository owner for a private channel without including vulnerability details in the public message. This project has no bug bounty or guaranteed response time.
