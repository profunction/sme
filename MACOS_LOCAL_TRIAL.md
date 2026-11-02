# Mac 本地试用版 / Local preview

你的 M5 Mac 应下载 **NightBrew-macOS-arm64-LOCAL-PREVIEW**。M1–M5 等 Apple Silicon 均选择 arm64；这是 macOS15 及以后系统的测试版。不要下载 x64、Windows EXE 或需要商业激活的 DEV-UNSIGNED 包来代替本地版。

## 下载和使用

1. 登录 GitHub，打开 [Mac 构建列表](https://github.com/profunction/sme/actions/workflows/macos.yml)，选择最新成功的构建。
2. 在 Artifacts 下载 **NightBrew-macOS-arm64-LOCAL-PREVIEW** 并解压。里面的 DMG 和 ZIP 是同一个应用的两种安装方式，任选一种即可；SHA256SUMS-LOCAL-PREVIEW.txt 提供文件校验值。
3. 打开 DMG，把 NightBrew AI Employee 拖到 Applications；或解开里面的应用 ZIP，把 `.app` 移到 Applications。退出旧版应用后，从 Applications 启动新版。
4. 打开“Business tools”，即可上传文件、分析 Excel、生成文档、检查采购单并审批导出。不需要 Node、Python、云端 API key 或商业激活账号。
5. 聊天需要在这台 Mac 单独安装并启动 Ollama，再在模型设置选择本机已安装的模型。Windows 上的 Ollama 和模型不会自动出现在 Mac。应用不会擅自下载大模型。

16GB 统一内存可以先对较小的量化模型做实际测试；系统占用、模型大小和任务长度都会影响速度。设置里的实测结果只说明当前机器/模型的表现，不保证任意任务质量或速度。模型权重的许可证需单独确认，本安装包不含模型。

## 版本边界

这是开发测试包。本地聊天、文件工具、采购单审批可用；共享云端 AI、付款和商业授权服务在本地预览模式下关闭。Windows 软件自动化只能在 Windows 使用，Mac 不具备此功能。浏览器自动化仍需安装兼容浏览器并配置允许的网站。

本地版使用单独的 `local-preview` 数据目录；旧版工作区不会自动导入，也不会被删除。

## macOS 打开提示

本地版使用 ad-hoc 签名检查应用完整性，**没有 Apple Developer 身份签名，也没有 Apple 公证**。即使构建机启动测试通过，下载到你的 Mac 后仍可能被 Gatekeeper 拦截。核对下载来源后，可按 macOS 提示在“系统设置 → 隐私与安全性”检查是否提供“仍要打开”。不要关闭系统整体的 Gatekeeper。公司管理的 Mac 可能需要管理员处理。

如果仍提示“已损坏”，保留提示文字以便判断是下载完整性、系统策略还是应用启动问题；重复下载或更换架构并不一定能解决。正式面向客户的无拦截分发仍需要 Apple 签名、公证和实际下载验收，不能用本地签名替代。

## 开发打包

在 Apple Silicon Mac 上激活项目的 Python 环境后运行 `npm run package:mac:local`。CI 检查 native arm64 架构、嵌入的预览策略、代码签名完整性、Electron/后端启动，以及本地 Ollama HTTP 测试接口、文档执行和云端禁止规则。测试接口不证明真实模型效果，也不证明下载后的 Gatekeeper 验收。
