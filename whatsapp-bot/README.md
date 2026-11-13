# WhatsApp 自动回复机器人（零成本，配对码连接）

把你自己的 WhatsApp 号码变成自动客服。程序跑在你自己的电脑上，不需要服务器、不需要 Meta Business 账号、不需要新号码、不需要付任何费用。

它做什么：

- 用 8 位**配对码**连接你的号码（和 WhatsApp 网页版同一个机制），之后自动重连。
- 客人发消息过来，按**关键词菜单**和**常见问题**自动回复，中、英、巫三语自动识别。
- **营业时间**内外不同话术；第一次联系的客人收到问候语。
- **人工接管**：你在手机上自己回了某个客人，机器人就对那个客人闭嘴 30 分钟（可改）。客人回复"0"或"人工"也会转人工。
- **可选 AI 回复**：接本地 Ollama（免费）、DeepSeek 或 Claude。默认关闭，不开就一分钱不花。
- **本地后台**：浏览器打开 http://127.0.0.1:8787 看连接状态、配对码、最近对话和"还在等人工回复"的客人。
- **防封保护**：随机延迟、每分钟回复上限、同一客人回复间隔、绝不主动给没找过你的号码发消息、不碰群组。

所有数据存在你电脑的 `data/bot.sqlite3`，不会上传到任何地方。

## 必须先知道的风险

这不是 WhatsApp 官方接口。它模拟的是"已连接的设备"，**违反 WhatsApp 使用条款**：

- 号码可能被封。只回复主动找你的客人、不群发、不加陌生人，被封的概率低，但**没有任何保证**。
- WhatsApp 更新协议后程序可能失效几天，要等开源库 Baileys 更新。
- **先用备用号码（预付卡即可）跑，不要拿主号试。**

要稳定、合规、可以卖给客户的版本，应该走 Meta 官方 WhatsApp Cloud API。它需要免费的 Meta Business 账号和一台能被回调的小服务器，客人先发消息时回复免费，主动发的提醒每条约 RM0.06。这个项目的回复引擎可以原样复用。

## 安装

1. 安装 [Node.js](https://nodejs.org) 22.13 或更新版本（Windows 和 Mac 都可以）。
2. 下载这个文件夹，在里面打开终端（Windows 用 PowerShell），运行：

```bash
npm install
```

3. 复制配置文件并修改：

```bash
copy config.example.json config.json
```

Mac 用 `cp config.example.json config.json`。

4. 用记事本或任何编辑器打开 `config.json`，至少改这几项：
   - `phone_number`：你要当机器人的号码，只写数字，带国家代码，例如 `60123456789`。
   - `texts`：问候语、菜单、非营业时间提示。
   - `menu`：数字菜单和回复内容。`keys` 是客人可能打的词，`reply` 是三种语言的回答。
   - `faq`：`match` 里的词只要出现在客人消息里就会触发。
   - `hours`：营业时间，`days` 里 0 是周日，6 是周六。

## 启动和配对

```bash
npm start
```

终端会显示 8 位配对码，例如 `ABCD-1234`。在手机 WhatsApp 里：

**设置 → 已连接的设备 → 连接设备 → 改用电话号码连接**，输入配对码。

几秒后终端显示"已连接"。之后关掉再开不需要重新配对（登录信息在 `auth/` 文件夹里，不要分享给别人）。

打开浏览器 http://127.0.0.1:8787 看后台。

电脑关机机器人就停了。要全天运行，可以用一台旧电脑、迷你主机或 Raspberry Pi，或者以后再迁到便宜的 VPS。

## 开启 AI 回复（可选）

关键词菜单回答不了的问题，可以交给 AI。在 `config.json` 的 `ai` 部分：

**免费本地 Ollama**（需要一台有 8GB 以上内存的电脑）：

```json
"ai": { "enabled": true, "provider": "ollama", "model": "qwen2.5:7b", "base_url": "http://127.0.0.1:11434", "facts": "你的店名、价格、地址、规则……" }
```

先安装 [Ollama](https://ollama.com) 并执行 `ollama pull qwen2.5:7b`。中文回复 Qwen 比 Llama 好得多。

**DeepSeek**（便宜，按量付费）：

```json
"ai": { "enabled": true, "provider": "openai_compatible", "model": "deepseek-chat", "base_url": "https://api.deepseek.com/v1", "api_key_env": "DEEPSEEK_API_KEY" }
```

**Claude**（质量最好，按量付费，默认用 Sonnet 5.5）：

```json
"ai": { "enabled": true, "provider": "anthropic", "model": "claude-sonnet-5-5", "api_key_env": "ANTHROPIC_API_KEY" }
```

API key **不要写进 config.json**。启动前在终端设置环境变量：

```bash
set DEEPSEEK_API_KEY=你的key
npm start
```

Mac 用 `export DEEPSEEK_API_KEY=你的key`。

`facts` 里写清楚店的真实信息，AI 只允许根据这些事实回答，不知道就说"同事会跟进"。

## 常见问题

- **终端显示 408 一直重连**：电脑连不上 WhatsApp 服务器，检查网络或防火墙。
- **显示"已在手机上被登出"**：你在手机上移除了这台设备，程序会删除 `auth/` 并退出，重新 `npm start` 配对即可。
- **想重新配对另一个号码**：删掉 `auth/` 文件夹，改 `phone_number`，重新启动。
- **机器人抢了我的话**：你在手机上回复后它会闭嘴 `handoff_minutes` 分钟，可以改大。
- **某个客人我不想让机器人回**：在手机上回他一句话即可。

## 测试

```bash
npm test
```

回复引擎、本地数据库、配置校验、消息解析都有自动测试。真正连接 WhatsApp 需要你的手机配对，无法自动测试。

---

## English summary

Zero-cost WhatsApp auto-reply bot that links to your own number with an 8-digit pairing code (the same mechanism as WhatsApp Web, via the open-source Baileys library). Runs on your own Windows or Mac machine. Keyword menu and FAQ replies in Chinese, English and Malay with automatic language detection, business hours, greeting, human handoff (the bot goes quiet after you reply from your phone), optional AI replies (Ollama, DeepSeek or Claude), a local dashboard at http://127.0.0.1:8787 and anti-ban safeguards (random delays, rate limits, never messages first, ignores groups).

This is an unofficial client and violates WhatsApp's terms of service. Numbers can be banned and the library may break after WhatsApp updates. Use a spare number. For a product you sell to customers, move to the official WhatsApp Cloud API; the reply engine here is reusable.

Setup: Node.js 22.13+, `npm install`, copy `config.example.json` to `config.json`, set `phone_number` (digits with country code), `npm start`, then on the phone go to Linked devices → Link a device → Link with phone number instead and enter the code.
