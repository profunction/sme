# 0.9.3 简化助理 / Simplified assistant

This update preserves the existing tools and adds a conversational entry. It does not turn a text model into unrestricted computer control or certify every website/application.

## 普通用户怎样用

1. 打开桌面应用后进入“AI 助理”。右上角随时选择“中文 / English”；切换不会发送消息、清空草稿或执行任务。
2. 选“问问题”或“帮我写回复”，直接贴客户消息与已确认事实，不必先填写长提示词表。AI/隐私设置收在折叠选项里；本地预览仍只使用本机 Ollama。
3. 回复可以编辑、复制。点“下一步：帮我填写”会把草稿带入填写向导；这个按钮不会立即操作软件。
4. 选择网页或已允许的软件/准确窗口，申请并批准读取字段。仅列出能识别的普通字段，不读取密码。
5. 粘贴 `字段名称：内容`，只按完全一致的标签匹配；未匹配项不会猜。也可选一个正文框，放入整段回复。核对目标和内容后，申请并批准填写。
6. 任务卡可停止尚未结束的任务；已经输入的内容无法自动撤销。发送、下单、付款不是自动填写功能的动作。

Excel 模板在“文档与 Excel”里：上传 XLSX → 读取 → 指定单元格和值 → 查看修改前后 → 批准 → 下载新文件。原文件保留。高级路径、Bundle ID、手工步骤仍可由技术人员首次配置，不要求每次填写都编辑 JSON。

语言开关立即改变新版助理、填写向导及主要导航；下一次模型回复会收到对应语言的系统要求。已有消息和用户草稿不会自动翻译。旧的部分高级设置界面仍保留原有中英文字。

## Implemented scope and boundaries

| Area | Working implementation | Boundary |
| --- | --- | --- |
| Browser | Approved inspect, stable metadata/value hashes, exact-label mapping, verified filling, screenshot and optional bounded visible window | Separate fresh session; does not inherit the user's signed-in browser. Login/iframes/password/payment/custom controls are not generally supported. Chrome/Edge must exist locally; no automatic browser download. |
| Browser network | Writes blocked by default; autosave/write requests need both saved host policy and this exact approved task's opt-in | No automatic Send/submit click or Enter action. Target websites can have their own behavior; vendor workflows require testing. The managed window closes after its approved 0–120 second review period; headless mode produces a preview only. |
| Windows | Inspected UIA Edit fields, exact executable/window/process identity, original-value hashes, writable/password checks and post-fill verification | Requires interactive Windows and a compatible standard Value-pattern field. A dedicated native fixture runs only on Windows; no universal vendor/app claim. |
| Mac | Static bundled JXA/System Events adapter with explicit application bundle/window, secure-field rejection, original-value hashes, per-field stale checks and verification | **Experimental and not native-interaction verified in this Linux session.** User must grant macOS Accessibility/Automation permissions. Only identifiable AXTextField/AXTextArea controls; no arbitrary keys/clicks/menus/sending. Compilation on macOS is separate from real TCC-granted operation. |
| Excel | Deterministic uploaded template preview/fill creates another XLSX with exact source/review hashes | Does not operate the Excel GUI or evaluate formulas. Complex active/external content, protected/hidden/merged/formula/data-validation destinations are rejected. Fidelity of arbitrary workbooks is not promised. |

All computer inspection/fill tasks and Excel writes go through the existing backend approval queue. Selected employee identities are forwarded and backend tool/connector permissions rechecked; this does not add corporate human-user RBAC. Browser/app content remains untrusted data. No AI-generated shell, AppleScript or JavaScript is executed; the Mac bridge is fixed source receiving bounded JSON. Original native field values are used only transiently and exposed as hashes. New values and approved task payloads remain in the local plaintext workspace under the existing data policy.

## Verification

Executed local Linux checks: **320 Python tests passed,14 skipped** (9 opt-in PostgreSQL cases and5 platform/permission-dependent cases); TypeScript/Vite build;15 desktop process/policy/dependency tests;10 Chromium UI tests, including actual inspected form filling with attempted POSTs blocked, draft transfer, exact-label mismatch handling and repeated language switching without dispatch. The reply UI uses a mocked non-billable model response; browser form tests drive a real local fixture. A fresh native Linux 0.9.3 backend build also passed the packaged startup/local Ollama HTTP fixture/document/cloud-restriction probe; it is not a Windows or Mac native acceptance result.

The complete backend/deploy result and native CI status are reported with the release. PostgreSQL opt-in tests and real Windows/Mac tests are explicitly skipped where those environments/permissions are absent. No real email, customer form, payment, cloud model call or production deployment was made. Existing commercial readiness gates remain open.
