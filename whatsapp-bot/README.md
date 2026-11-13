# WhatsApp 自动回复机器人和后台（零成本，配对码连接）

把你自己的 WhatsApp 号码变成自动技术支持，并配一个本地后台。程序跑在你自己的电脑上，不需要服务器、不需要 Meta Business 账号、不需要付任何费用。

## 它做什么

**自动回复**

- 用 8 位配对码连接你的号码（和 WhatsApp 网页版同一个机制），之后自动重连。
- **像技术员一样一步一步带着做**：客人点设备 → 点具体情况 → 机器人一次只给一步，问"试了之后怎么样"。好了就结束；还不行给下一步；想知道原因可以点"为什么会这样"；随时可以点"请技术员联系我"。
- **全部试过还不行**：机器人会说明这不是操作问题，把客人试过的步骤一起转给你，客人不用重复说明。
- **不乱猜**：客人只说"麦克风有问题"，就列出麦克风常见的几种情况让他点；说的事情跟 AV 无关，就老实说"我先转给同事"，并通知你，不会丢一堆不相干的选项。
- **其他事情**：客人可以直接描述情况（文字、照片、语音），内容会转到你指定的 WhatsApp 号码。
- AV 故障知识库：`knowledge/av/` 里有 170 条投影、显示屏、LED、音响、麦克风、视频会议、信号、中控、网络、活动现场的故障，每条都有"快速解决"和"原因说明"两个版本，中英文。
- 按关键词稀有度打分，越具体的描述越优先；匹配不到时列出最相关的几条让客人回复 A / B / C。
- 每个答案后面自动加一句：如果还是不行，欢迎 email 我们，或在群组里留言。
- 你在手机上回了某个客人，机器人对他暂停 60 分钟。客人回复 0 也会转人工。
- 群里机器人不自动回复，只记录，方便你们人工回。

**后台（浏览器里看，中文 / English 可切换）**

| 页面 | 内容 |
|---|---|
| 对话 | 左边手机画面显示选中的对话，右边分开列出**个人客户**和**群组**，标出谁在等人工 |
| 群发 | 写最新消息或优惠，逐个勾选要发给哪些群和个人，一键排队发送，可暂停和取消 |
| 客户 | 你 WhatsApp 里已有的个人对话，设等级（VIP、只由人工回复），开关通知订阅 |
| 知识库 | 搜索和查看全部故障条目，"试问机器人"看它会怎么回 |

**其他**

- 客户等级：VIP 有专属问候、不显示非营业时间提示、后台置顶；也可以把某个客户设成只由人工回复。
- 多个号码：每个 WhatsApp 号码一份独立配置、登录和后台，同时运行。
- 可选 AI：本地 Ollama（免费）、DeepSeek 或 Claude，只根据检索到的知识库条目回答。默认关闭。

所有数据存在你电脑的 `data/` 文件夹，不会上传到任何地方。

## 可以点的选项是怎么做的

WhatsApp 真正的"按钮"只开放给官方 Business API。在这种非官方连接上，按钮消息发不出去或对方看不到。所以这里用 WhatsApp 的**投票消息**来做：客人看到一个问题和几个选项，点一下就选好了。

- 客人也可以直接回复选项的数字，或者干脆打字描述问题，三种方式都有效。
- 如果程序读不到客人点了哪个（WhatsApp 对投票加密，个别情况会解不开），它会自动把同样的选项用数字列表再发一次。
- 想完全不用投票，把 `config.json` 里的 `menu_style` 改成 `"text"`，所有选项都变成"请回复数字"的列表。
- 主菜单在 `main_menu`，设备类别和每类列出的问题在 `categories`，每类最多 10 个问题。类别里的 `keywords` 是客人提到这个设备时会用的词。
- `guided_steps` 设为 `false` 就回到一次发完全部步骤的方式。知识库条目里写 `"guided": false` 的（例如安全提示、检查清单）总是整段发出。
- `notify.numbers` 填你或同事的 WhatsApp 号码（不能是机器人自己的号码）。客人选"其他"并描述情况、要求上门、标记紧急或要求人工时，机器人会把内容发到这些号码。

投票点选的读取在真实 WhatsApp 上还没有验证过，第一次使用请用另一部手机完整点一遍。

## 必须先知道的风险

这不是 WhatsApp 官方接口。它模拟的是"已连接的设备"，**违反 WhatsApp 使用条款**：

- 号码可能被封。只回复主动找你的客人时风险较低，但**没有任何保证**。
- **群发是封号最常见的原因。** 程序做了限制（见下面"群发"一节），但不能消除风险。能发到群里就发群，一条消息通知全群。
- WhatsApp 更新协议后程序可能失效几天，要等开源库 Baileys 更新。
- 建议用专门的业务号码，不要用私人主号。

要稳定、合规、可以放心卖给客户的版本，应该走 Meta 官方 WhatsApp Cloud API。这个项目的回复引擎、知识库和后台可以复用。

知识库里的排查步骤只包含普通办公室人员可以安全操作的内容，涉及拆机、电线、爬高的一律写明需要技术员。这些内容是通用的行业经验，上线前请让技术员过一遍，按你们实际的设备和做法修改。

## 安装（只做一次）

1. 安装 [Node.js](https://nodejs.org) 22.13 或更新版本。
2. 在这个文件夹打开 PowerShell，运行：

```bash
npm install
```

## 设置

```bash
npm run setup
```

按提示选模板（1 是 AV 技术支持）、输入机器人的 WhatsApp 号码（带国家代码，只要数字，例如 6591234567）、公司名、email、电话、地址。它会生成 `config.json`。

## 先在浏览器里试

```bash
npm run demo
```

打开窗口里显示的地址（通常是 http://127.0.0.1:8787 ）。这个模式不连接 WhatsApp，不会发出任何消息，里面有几个示例客户和群。可以点"新客人"以客人身份打字，也可以试群发，适合调话术和给客户演示。按 Ctrl+C 停止。

## 连接 WhatsApp

先在手机上打开 WhatsApp → 设置 → **已连接的设备** → **连接设备** → **改用电话号码连接**，停在输入代码的画面。然后：

```bash
npm start
```

窗口显示 8 位配对码，一分钟内在手机上输入。显示"已连接"后就开始工作了。过期了会自动给新的码。

- 窗口不能关，电脑不能睡眠。
- 以后重开只要 `npm start`，不用重新配对。
- 后台地址看窗口里的"后台 / Dashboard"那一行。

## 看到我 WhatsApp 里有谁

- **群**：每次连接后自动读取你在的所有群，马上出现在后台。
- **个人对话**：WhatsApp 只在**配对的那一刻**把现有对话列表交给新设备。如果你是在这个功能加入之前配对的，运行一次下面的命令重新配对，现有对话就会出现在"客户"和"群发"页面：

```bash
npm run relink
```

```bash
npm start
```

重新配对不会丢失后台里的对话记录和客户等级。之后任何人发消息过来也会自动加入名单。WhatsApp 交出多少历史对话由它决定，通常是最近的一批。

## 群发

在后台"群发"页面：写消息，勾选群和个人，点发送。

- 只能发给你 WhatsApp 里**已有的对话和群**，不能导入陌生号码。
- 发给个人时一条一条排队，每条间隔 20 到 45 秒，24 小时内最多 150 条，到上限后第二天自动继续。
- 每条个人消息后面自动加"回复退订可停止接收"。客人回复"退订"或 STOP 后不会再收到，回复"订阅"或 START 恢复。
- 发到群里不加退订提示。
- 排队保存在数据库里，可以暂停、继续、取消；程序重启后接着发。

间隔和上限在 `config.json` 的 `broadcast` 里改，间隔最短 5 秒。调快会明显增加封号风险。

## 第二个 WhatsApp 号码

```bash
npm run setup -- second
```

```bash
npm start -- second
```

`second` 可以换成任何名字（英文字母和数字）。它用自己的 `config.second.json`、自己的登录、自己的数据和自己的后台端口，和第一个号码互不影响。两个号码各开一个窗口同时运行。

## 改话术

用记事本打开 `config.json`：

| 位置 | 作用 |
|---|---|
| `business` | 公司名、email、电话、地址。文字里的 `{company}` `{email}` `{phone}` `{address}` 会自动替换 |
| `texts.greeting` | 问候语 |
| `menu_style` | `"poll"` 可点选的选项，`"text"` 数字列表 |
| `main_menu` / `categories` | 主菜单选项、设备类别和每类的常见问题 |
| `guided_steps` | 一步一步带着做（`true`）还是一次发完全部步骤（`false`） |
| `follow_up` | 整段发出的答案后面是否问"这样解决了吗？" |
| `notify.numbers` | 客人选"其他"、要上门、紧急时通知哪些 WhatsApp 号码 |
| `texts.menu` | 文字版主菜单 |
| `texts.escalate` | 每个答案后面加的那句话 |
| `texts.after_hours` | 非营业时间提示 |
| `hours` | 营业时间，`days` 里 0 是周日 |
| `handoff_minutes` | 人工回复后机器人暂停多久 |
| `tiers` / `customers` | 客户等级的定义和预先登记的重要客户 |
| `broadcast` | 群发的间隔、每日上限、退订提示 |
| `groups` | `"observe"` 记录群消息，`"ignore"` 完全不看群 |

改完保存，停掉程序再 `npm start`。

## 客户等级

最简单的方法：在后台"对话"或"客户"页面把某个客户的等级改成 VIP 或"只由人工回复"。

也可以在 `config.json` 里预先登记：

```json
"customers": [
  { "phones": ["6591234567"], "name": "陈先生", "tier": "vip" }
]
```

等级在 `tiers` 里定义，可以自己加：

- `priority`：在后台置顶，群发页面可以"只选重点客户"。
- `ignore_hours`：不显示非营业时间提示。
- `bot`：`"off"` 表示机器人完全不回这个客户，只在后台提醒人工。
- `texts`：这个等级专用的文字，可以覆盖 `greeting`、`escalate`、`menu` 等任何一项。`{name}` 是客户名字。

## 加自己的故障和答案

在 `knowledge/av/` 里新建一个 `.json` 文件，照下面的格式写，重启后自动载入：

```json
[
  {
    "id": "my-room-3-tv",
    "title": { "zh": "三号会议室电视开不了", "en": "Meeting room 3 TV will not start" },
    "match": ["三号会议室电视", "room 3 tv", "meeting room 3 tv"],
    "reply": { "zh": "1) ……\n2) ……", "en": "1) ...\n2) ..." },
    "explain": { "zh": "原因是……", "en": "The cause is ..." }
  }
]
```

- `match`：客人可能打的说法。越具体越好，中文按包含匹配，英文按完整词组匹配。
- `reply`：客人选 1 时的快速步骤。`explain`：客人选 2 时的原因说明。
- 写完运行检查，它会找出格式错误和永远匹配不到的条目：

```bash
npm run check
```

## 开启 AI（可选）

关键词匹配不到的问题可以交给 AI。AI 会拿到最相关的几条知识库内容，只根据这些回答。在 `config.json` 的 `ai` 里把 `enabled` 改成 `true`。

**免费本地 Ollama**（已装 Ollama 并有 qwen3 模型）：

```json
"ai": { "enabled": true, "provider": "ollama", "model": "qwen3:4b" }
```

`qwen3:4b` 快，普通电脑几秒出回复。`qwen3:14b` 更聪明但需要好显卡，否则客人要等很久。

**DeepSeek 或 Claude**（按量付费）：`provider` 分别写 `openai_compatible` 或 `anthropic`，`api_key_env` 写存放 key 的环境变量名。API key 不要写进 config.json。

## 常见问题

- **端口被占用**：另一个窗口还在跑。程序会自动换下一个端口，看窗口里显示的地址。
- **配对码过期**：等 10 秒会自动出新的。先把手机点到输入画面再看码。
- **后台显示的号码是 "ID 一串数字"**：这是 WhatsApp 的匿名 ID，WhatsApp 没有提供对方真实号码时会这样显示，回复不受影响。
- **群发卡住不动**：看"群发"页面的提示，通常是到了每日上限，或 WhatsApp 断线，恢复后会自动继续。
- **想让机器人对某个客人安静**：在手机上回他一句，或在后台把他设成"只由人工回复"。

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm run setup` | 设置向导，生成配置 |
| `npm run demo` | 演示模式，不连 WhatsApp |
| `npm start` | 连接 WhatsApp 开始工作 |
| `npm run relink` | 清除登录，下次启动重新配对 |
| `npm run check` | 检查知识库 |
| `npm test` | 自动测试 |

第二个号码在命令后面加 `-- 名字`，例如 `npm start -- second`。

回复引擎、知识库、群发队列、客户等级、设置向导、后台接口都有自动测试。真正连接 WhatsApp、读取群和现有对话、实际发出群发需要手机配对，无法自动测试，第一次使用请先小范围试。

---

## English summary

Zero-cost WhatsApp auto-reply bot with a local back office. It links to your own number with an 8-digit pairing code (WhatsApp Web multi-device protocol via the open-source Baileys library) and runs on your own Windows or Mac machine.

- Guided troubleshooting: the customer taps a device, then a problem, and is walked through one step at a time ("how did that go?") with "why does this happen?" and "have a technician contact me" always available. When every step has failed the bot hands over with the steps already tried. Vague messages bring up that device's common problems; unrelated ones are passed to a person instead of guessed at.
- Choices are sent as WhatsApp polls (real buttons need the official API). Typing a number or describing the problem also works, and an unreadable tap falls back to a numbered list. "Other" takes a free-text report and alerts the staff numbers in `notify.numbers`. Reading poll taps has not been verified against live WhatsApp.
- Menu: fix it myself now, explain what is going on, send a technician, other, or talk to a person. Each of the 170 AV troubleshooting entries under `knowledge/av/` has a quick-steps answer and an explanation, in Chinese and English.
- Rarity-weighted phrase matching, A/B/C suggestions when nothing matches exactly, and a configurable "email us or post in the group" footer on every answer.
- Back office in Chinese or English with four pages: Chats (phone view plus separate individual and group lists), Broadcast, Customers, Knowledge base.
- Broadcast: write news or an offer, tick the groups and individuals, send. Recipients are limited to chats and groups that already exist in the account; individual messages are queued 20 to 45 seconds apart with a daily cap and an unsubscribe line; STOP and START are honoured.
- Groups are recorded for the team to answer; the bot never auto-replies in groups.
- Customer tiers (VIP wording, pinned, or human-only), several WhatsApp numbers side by side, optional AI grounded in retrieved knowledge entries.

Commands: `npm install`, `npm run setup`, `npm run demo`, `npm start`, `npm run relink`, `npm run check`, `npm test`. Add `-- name` for a second account.

This is an unofficial client and violates WhatsApp's terms of service. Numbers can be banned, broadcasting to many individuals is the most common trigger, and the library may break after WhatsApp updates. For a product you sell to customers, move to the official WhatsApp Cloud API. Have a technician review the knowledge base before going live. Live linking, chat-list import and real broadcast delivery cannot be tested automatically.
