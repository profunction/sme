// Local-only back office with four pages: Chats (a phone view of the selected
// conversation plus individual and group lists), Broadcast, Customers and Knowledge base.
import http from "node:http";
import { decide, findCustomer, normalize, tierOf } from "./engine.js";

const PAGE = String.raw`<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bot</title>
<style>
  :root{--page:#eef0f2;--card:#fff;--text:#111b21;--muted:#667781;--line:#e2e6ea;--accent:#008069;--accent-2:#00a884;
    --chat:#efeae2;--in:#fff;--out:#d9fdd3;--bar:#008069;--bar-text:#fff;--warn:#b45309;--warn-bg:#fff4e0;--bad:#b91c1c;--ok:#15803d;--vip:#7c3aed;--vip-bg:#f1eaff;--sel:#e7f6f2}
  @media (prefers-color-scheme:dark){:root{--page:#0b141a;--card:#111b21;--text:#e9edef;--muted:#8696a0;--line:#222d34;--accent:#00a884;--accent-2:#00a884;
    --chat:#0b141a;--in:#202c33;--out:#005c4b;--bar:#202c33;--bar-text:#e9edef;--warn:#fbbf24;--warn-bg:#3a2e12;--bad:#f87171;--ok:#4ade80;--vip:#c4b5fd;--vip-bg:#2e2350;--sel:#12322c}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--text);font:14.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC","Microsoft YaHei",sans-serif}
  .top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line)}
  .top-in{max-width:1280px;margin:0 auto;padding:8px 16px;display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap}
  .brand{font-weight:700;white-space:nowrap}
  nav{display:flex;gap:4px;flex-wrap:wrap}
  nav a{padding:6px 12px;border-radius:8px;color:var(--muted);text-decoration:none;font-weight:600;white-space:nowrap}
  nav a:hover{background:var(--page)}nav a[aria-current="page"]{background:var(--sel);color:var(--accent)}
  .top .status{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:13px}
  main{max-width:1280px;margin:0 auto;padding:16px}
  .page[hidden]{display:none}
  .wrap{display:grid;grid-template-columns:400px minmax(0,1fr);gap:20px;align-items:start}
  @media (max-width:900px){.wrap{grid-template-columns:1fr}}
  .phone{position:sticky;top:72px;height:calc(100vh - 92px);max-height:800px;min-height:500px;background:var(--chat);border:8px solid #1c1f22;border-radius:34px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,.18)}
  @media (max-width:900px){.phone{position:static;height:620px}}
  .pbar{background:var(--bar);color:var(--bar-text);padding:10px 14px;display:flex;gap:10px;align-items:center;min-height:58px}
  .avatar{width:38px;height:38px;border-radius:50%;background:#cfd8dc;color:#455a64;display:grid;place-items:center;font-weight:700;flex:none}
  .pbar .who{min-width:0;flex:1}.pbar b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pbar small{opacity:.85;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chat{flex:1;overflow-y:auto;padding:12px 12px 16px;display:flex;flex-direction:column;gap:4px}
  .day{align-self:center;background:var(--card);color:var(--muted);font-size:12px;padding:3px 10px;border-radius:8px;margin:6px 0}
  .msg{max-width:84%;padding:6px 9px 4px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 1px .5px rgba(0,0,0,.13);font-size:14.2px}
  .msg.in{align-self:flex-start;background:var(--in);border-top-left-radius:0}
  .msg.out{align-self:flex-end;background:var(--out);border-top-right-radius:0}
  .msg .meta{display:flex;justify-content:flex-end;gap:6px;font-size:11px;color:var(--muted);margin-top:2px}
  .msg .tag{font-weight:600}.msg.human .tag{color:var(--accent)}
  .sender{font-weight:600;font-size:12.5px;color:var(--accent);margin-bottom:1px}
  .opts{display:grid;gap:4px;margin:6px 0 2px}
  .opt{font:inherit;font-size:13.5px;text-align:left;padding:6px 10px;border-radius:8px;border:1px solid rgba(0,0,0,.14);background:rgba(255,255,255,.55);color:inherit}
  @media (prefers-color-scheme:dark){.opt{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.08)}}
  button.opt{cursor:pointer}button.opt:hover{background:rgba(255,255,255,.9)}
  @media (prefers-color-scheme:dark){button.opt:hover{background:rgba(255,255,255,.18)}}
  .empty{margin:auto;text-align:center;color:var(--muted);padding:24px;white-space:pre-line}
  .compose{display:flex;gap:8px;padding:8px;background:var(--card);border-top:1px solid var(--line)}
  .compose input{flex:1;min-width:0;border-radius:20px;padding:9px 14px}
  .compose button{border:0;border-radius:50%;width:40px;height:40px;background:var(--accent-2);color:#fff;font-size:16px;cursor:pointer;flex:none}
  .side{display:grid;gap:14px;min-width:0}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
  h2{font-size:13px;margin:0 0 10px;color:var(--muted);font-weight:600;letter-spacing:.03em;text-transform:uppercase}
  h3{font-size:15px;margin:0 0 8px}
  .count{font-weight:400;text-transform:none;letter-spacing:0}
  .muted{color:var(--muted)}
  .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line);white-space:nowrap}
  .pill.ok{color:var(--ok);border-color:currentColor}.pill.bad{color:var(--bad);border-color:currentColor}
  .pill.warn{color:var(--warn);background:var(--warn-bg);border-color:transparent}
  .pill.vip{color:var(--vip);background:var(--vip-bg);border-color:transparent;font-weight:600}
  .banner{background:var(--warn-bg);color:var(--text);border-radius:12px;padding:12px 16px;margin-bottom:14px}
  .code{font:700 26px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;margin:6px 0}
  .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  @media (max-width:520px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .stat span{display:block;font-size:12px;color:var(--muted)}.stat b{font-size:22px;font-variant-numeric:tabular-nums}
  .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
  @media (max-width:1100px){.two{grid-template-columns:1fr}}
  .list{display:grid;gap:2px;max-height:44vh;overflow-y:auto;margin:0 -8px}
  .row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:8px;border-radius:8px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}
  .row:hover{background:var(--page)}.row.sel{background:var(--sel)}
  .row .name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row .last{grid-column:1;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
  .row .time{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
  .row .pills{grid-column:2;display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
  .tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  input[type=text],input[type=search],textarea,select{font:inherit;color:var(--text);background:var(--page);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
  textarea{width:100%;min-height:150px;resize:vertical}
  .btn{font:inherit;color:var(--text);background:var(--page);border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer}
  .btn.primary{background:var(--accent-2);border-color:var(--accent-2);color:#fff;font-weight:600}
  .btn.small{padding:3px 8px;font-size:12.5px}.btn:disabled{opacity:.5;cursor:not-allowed}
  .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;flex:none}
  .seg button{font:inherit;border:0;background:none;color:var(--muted);padding:5px 12px;cursor:pointer}
  .seg button[aria-pressed="true"]{background:var(--accent-2);color:#fff}
  .hint{font-size:12.5px;color:var(--muted);margin:8px 0 0}
  .picks{display:grid;gap:1px;max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:4px}
  .pick{display:flex;gap:8px;align-items:center;padding:5px 6px;border-radius:6px;cursor:pointer;min-width:0}
  .pick:hover{background:var(--page)}.pick input{flex:none;width:16px;height:16px}
  .pick .n{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pick .d{color:var(--muted);font-size:12.5px;white-space:nowrap}
  .pick.off{opacity:.55;cursor:not-allowed}
  .bc{border-top:1px solid var(--line);padding:10px 0}.bc:first-child{border-top:0;padding-top:0}
  .bc .t{white-space:pre-wrap;overflow-wrap:anywhere;max-height:4.4em;overflow:hidden}
  .bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:6px 0}.bar i{display:block;height:100%;background:var(--accent-2)}
  .tablewrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-top:1px solid var(--line);text-align:left;vertical-align:middle;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:12.5px;border-top:0}td.wide{white-space:normal;min-width:160px}
  .kb{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:14px;align-items:start}
  @media (max-width:900px){.kb{grid-template-columns:1fr}}
  .kb .list{max-height:70vh;margin:8px -8px 0}
  .answer{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--page);border-radius:8px;padding:10px 12px;margin:6px 0 12px}
</style></head><body>
<header class="top"><div class="top-in">
  <span class="brand" data-t="brand"></span>
  <nav><a href="#chats" data-t="navChats"></a><a href="#broadcast" data-t="navBroadcast"></a><a href="#customers" data-t="navCustomers"></a><a href="#knowledge" data-t="navKnowledge"></a></nav>
  <div class="status"><span id="status"></span><div class="seg" role="group" aria-label="Language"><button type="button" data-lang="zh">中文</button><button type="button" data-lang="en">English</button></div></div>
</div></header>
<main>
<div class="banner" id="pairing" hidden></div>

<section class="page" id="page-chats"><div class="wrap">
  <section class="phone" aria-label="conversation">
    <div class="pbar"><div class="avatar" id="p-avatar">?</div><div class="who"><b id="p-name"></b><small id="p-sub"></small></div><span id="p-tier"></span></div>
    <div class="chat" id="chat"></div>
    <form class="compose" id="compose" hidden><input type="text" id="text" autocomplete="off"><button type="submit" aria-label="send">➤</button></form>
  </section>
  <div class="side">
    <section class="card" id="demo-card" hidden><h2 data-t="demoTitle"></h2>
      <div class="tools"><button class="btn primary" id="new-customer" type="button" data-t="newCustomer"></button><button class="btn" id="owner-reply" type="button" data-t="simulateHuman"></button><button class="btn" id="group-msg" type="button" data-t="simulateGroup"></button></div>
      <p class="hint" data-t="demoHint"></p></section>
    <section class="card"><h2 data-t="last24"></h2><div class="stats" id="stats"></div></section>
    <section class="card"><h2 data-t="selectedCustomer"></h2>
      <div class="tools"><span id="sel-name" class="muted"></span><label><span data-t="tier"></span> <select id="tier" disabled></select></label></div>
      <p class="hint" data-t="tierHint"></p></section>
    <div class="two">
      <section class="card"><h2><span data-t="individuals"></span> <span class="count" id="count-people"></span></h2><div class="list" id="list-people"></div></section>
      <section class="card"><h2><span data-t="groups"></span> <span class="count" id="count-groups"></span></h2><div class="list" id="list-groups"></div><p class="hint" data-t="groupHint"></p></section>
    </div>
  </div>
</div></section>

<section class="page" id="page-broadcast" hidden><div class="two">
  <div class="side">
    <section class="card"><h2 data-t="bcWrite"></h2>
      <textarea id="bc-text" maxlength="2000"></textarea>
      <p class="hint"><span id="bc-chars"></span> · <span data-t="bcFooterNote"></span></p></section>
    <section class="card"><h2 data-t="bcWho"></h2>
      <div class="tools"><input type="search" id="bc-search"><button class="btn small" type="button" id="bc-all-groups" data-t="bcAllGroups"></button><button class="btn small" type="button" id="bc-all-people" data-t="bcAllPeople"></button><button class="btn small" type="button" id="bc-vip" data-t="bcVip"></button><button class="btn small" type="button" id="bc-clear" data-t="bcClear"></button></div>
      <h3 style="margin-top:12px"><span data-t="groups"></span> <span class="muted count" id="bc-count-groups"></span></h3><div class="picks" id="bc-groups"></div>
      <h3 style="margin-top:12px"><span data-t="individuals"></span> <span class="muted count" id="bc-count-people"></span></h3><div class="picks" id="bc-people"></div>
      <p class="hint" data-t="bcWhoHint"></p></section>
    <section class="card"><div class="tools"><button class="btn primary" type="button" id="bc-send" data-t="bcSend"></button><span id="bc-summary" class="muted"></span></div>
      <p class="hint" data-t="bcRisk"></p></section>
  </div>
  <section class="card"><h2><span data-t="bcHistory"></span> <span class="count" id="bc-today"></span></h2><div id="bc-list"></div></section>
</div></section>

<section class="page" id="page-customers" hidden>
  <section class="card"><div class="tools" style="margin-bottom:10px"><input type="search" id="cu-search"><span class="muted" id="cu-count"></span></div>
    <div class="tablewrap"><table><thead><tr><th data-t="colName"></th><th data-t="colNumber"></th><th data-t="colTier"></th><th data-t="colUpdates"></th><th data-t="colLast"></th><th></th></tr></thead><tbody id="cu-body"></tbody></table></div>
    <p class="hint" data-t="cuHint"></p></section>
</section>

<section class="page" id="page-knowledge" hidden><div class="kb">
  <section class="card"><h2><span data-t="navKnowledge"></span> <span class="count" id="kb-count"></span></h2>
    <input type="search" id="kb-search" style="width:100%"><div class="list" id="kb-list"></div></section>
  <div class="side">
    <section class="card"><h2 data-t="kbTry"></h2>
      <form class="tools" id="kb-try"><input type="text" id="kb-q" style="flex:1;min-width:180px"><select id="kb-mode"></select><button class="btn primary" type="submit" data-t="kbAsk"></button></form>
      <div id="kb-result"></div></section>
    <section class="card" id="kb-detail"><p class="muted" data-t="kbPick"></p></section>
  </div>
</div></section>
</main>
<script>
const L={
 zh:{brand:"WhatsApp 后台",navChats:"对话",navBroadcast:"群发",navCustomers:"客户",navKnowledge:"知识库",
  loading:"加载中…",pick:"选择右边的对话",noConvPhone:"还没有对话。\n客人发来消息后会显示在这里。",noConv:"还没有对话",noMsg:"还没有消息",
  typeAs:"以客人身份输入",typeAsMember:"以群成员身份输入",demoTitle:"演示模式",newCustomer:"新客人",simulateHuman:"模拟我们人工回复",simulateGroup:"模拟群消息",
  demoHint:"没有连接 WhatsApp，不会发出任何消息。在左边手机下方以客人身份打字，机器人按真实规则回答。",
  last24:"最近 24 小时",inbound:"收到",botReplies:"机器人回复",humanReplies:"人工回复",contacts:"联系人",
  selectedCustomer:"当前客户",none:"未选择",tier:"等级",tierHint:"给重要客户设等级：专属问候、后台置顶，或只由人工回复。",tierGroup:"等级只用于个人客户",
  tierDefault:"默认（按配置）",tierStandard:"普通客户",individuals:"个人客户",groups:"群组",countText:(n,w)=>"· "+n+" 个"+(w?"，"+w+" 个等人工":""),waiting:"等人工",
  groupHint:"机器人不会在群里自动回复，只帮你记录。群里的问题由你们人工回复；群发通知可以发到群里。",noGroups:"还没有群",groupSub:"群组 · 机器人不在群里自动回复",
  number:"号码",aiOff:"AI 关闭",kb:"知识库",connected:"已连接",disconnected:"已断开",connecting:"连接中",demo:"演示",starting:"启动中",
  pairIntro:"在手机 WhatsApp 输入配对码（1 分钟内）：",pairPath:"已连接的设备 → 连接设备 → 改用电话号码连接",
  bot:"机器人",human:"人工",paused:"机器人暂停中",newCustomerName:"新客人",typeBelow:"以客人身份在下面打字",ownerText:"好的，我们的技术员马上联系您。",
  reason:{rule:"知识库",option_chosen:"知识库",menu:"菜单",menu_choice:"菜单",category:"选问题",solved:"已解决",suggest:"推荐相关问题",describe:"请客人描述",ai:"AI",fallback:"兜底回复",handoff_requested:"转人工",urgent:"紧急",visit_details:"上门登记",other_prompt:"其他问题",other_report:"其他问题已通知",prompt_fallback:"改用数字",broadcast:"群发通知",opt_out:"退订",opt_in:"订阅"},
  mode:{fix:"自己解决",explain:"了解原因",visit:"要上门",other:"其他问题"},
  bcWrite:"写最新消息或优惠",bcPlaceholder:"例如：本月会议室 AV 保养优惠，预约即送一次免费检查……",bcChars:n=>n+" / 2000 字",bcFooterNote:"发给个人时会自动加上退订提示；发到群里不加。",
  bcWho:"发给谁",bcSearch:"搜索名字或号码",bcAllGroups:"全选群组",bcAllPeople:"全选个人",bcVip:"只选重点客户",bcClear:"清空",
  bcWhoHint:"这里列出的是你 WhatsApp 里已有的对话和群。发到群里一条就能通知全群，最安全。已退订的客户不能选。",
  bcSend:"发送",bcSummary:(p,g,m)=>"已选 "+p+" 位个人、"+g+" 个群"+(p?"，个人部分约 "+m+" 分钟发完":""),bcNothing:"先写消息并选择收件人",
  bcConfirm:(p,g)=>"确定发送给 "+p+" 位个人和 "+g+" 个群吗？发出后无法撤回。",
  bcRisk:"提醒：这是非官方接口，短时间给很多个人发消息是被 WhatsApp 封号最常见的原因。系统会自动排队慢慢发，并限制每天数量。能发群就发群。",
  bcHistory:"发送记录",bcToday:(n,c)=>"· 24 小时内已发 "+n+" / 上限 "+c,bcNone:"还没有发送记录",bcProgress:(s,t)=>"已发 "+s+" / "+t,bcFailed:n=>n+" 个失败",bcSkipped:n=>n+" 个跳过",
  bcStatus:{sending:"发送中",paused:"已暂停",done:"已完成",cancelled:"已取消"},bcPause:"暂停",bcResume:"继续",bcCancel:"取消",bcCapNote:"今天的上限到了，剩下的明天自动继续。",bcOffline:"WhatsApp 未连接，连上后自动继续。",
  colName:"名字",colNumber:"号码",colTier:"等级",colUpdates:"接收通知",colLast:"最后活动",cuSearch:"搜索名字或号码",cuCount:n=>n+" 位客户",cuHint:"这里是你 WhatsApp 里已有的个人对话。群组在「群发」页面选择。",
  subscribed:"接收",unsubscribed:"已退订",openChat:"看对话",noActivity:"—",
  kbCount:n=>"· "+n+" 条",kbSearch:"搜索问题，例如：没声音、projector",kbPick:"在左边选一条，查看机器人会怎么回答。",kbQuick:"快速解决（客人选 1）",kbExplain:"原因说明（客人选 2）",kbPhrases:"会触发这条的说法",
  kbTry:"试问机器人",kbQ:"输入客人可能问的话",kbAsk:"试试",kbWould:"机器人会这样回：",kbSilent:"机器人不会回复（"},
 en:{brand:"WhatsApp back office",navChats:"Chats",navBroadcast:"Broadcast",navCustomers:"Customers",navKnowledge:"Knowledge base",
  loading:"Loading…",pick:"Pick a conversation on the right",noConvPhone:"No conversations yet.\nMessages from customers will show here.",noConv:"No conversations yet",noMsg:"No messages yet",
  typeAs:"Type as the customer",typeAsMember:"Type as a group member",demoTitle:"Demo mode",newCustomer:"New customer",simulateHuman:"Simulate our human reply",simulateGroup:"Simulate a group message",
  demoHint:"Not connected to WhatsApp; nothing is sent. Type as the customer under the phone and the real engine answers.",
  last24:"Last 24 hours",inbound:"Inbound",botReplies:"Bot replies",humanReplies:"Human replies",contacts:"Contacts",
  selectedCustomer:"Selected customer",none:"None selected",tier:"Tier",tierHint:"Give key customers a tier: their own greeting, pinned on top, or handled by people only.",tierGroup:"Tiers apply to individual customers",
  tierDefault:"Default (from config)",tierStandard:"Standard customer",individuals:"Individual customers",groups:"Groups",countText:(n,w)=>"· "+n+(w?", "+w+" waiting":""),waiting:"Waiting",
  groupHint:"The bot never auto-replies in groups; it only records them here. Your team answers group questions; broadcasts can be posted to groups.",noGroups:"No groups yet",groupSub:"Group · the bot does not auto-reply here",
  number:"Number",aiOff:"AI off",kb:"Knowledge base",connected:"Connected",disconnected:"Disconnected",connecting:"Connecting",demo:"Demo",starting:"Starting",
  pairIntro:"Enter this pairing code in WhatsApp on your phone within a minute:",pairPath:"Linked devices → Link a device → Link with phone number instead",
  bot:"Bot",human:"Human",paused:"Bot paused",newCustomerName:"New customer",typeBelow:"Type below as this customer",ownerText:"OK, our technician will contact you right away.",
  reason:{rule:"knowledge base",option_chosen:"knowledge base",menu:"menu",menu_choice:"menu",category:"pick a problem",solved:"solved",suggest:"related topics",describe:"asked to describe",ai:"AI",fallback:"fallback",handoff_requested:"handoff",urgent:"urgent",visit_details:"visit request",other_prompt:"other issue",other_report:"other issue, team alerted",prompt_fallback:"asked for a number",broadcast:"broadcast",opt_out:"unsubscribe",opt_in:"subscribe"},
  mode:{fix:"Fix myself",explain:"Explain",visit:"Wants visit",other:"Other issue"},
  bcWrite:"Write your news or offer",bcPlaceholder:"For example: meeting room AV servicing offer this month, book now for a free check-up…",bcChars:n=>n+" / 2000 characters",bcFooterNote:"An unsubscribe line is added for individuals; nothing is added in groups.",
  bcWho:"Recipients",bcSearch:"Search name or number",bcAllGroups:"All groups",bcAllPeople:"All individuals",bcVip:"Priority customers only",bcClear:"Clear",
  bcWhoHint:"These are the chats and groups already in your WhatsApp. One post in a group reaches everyone in it and is the safest route. Unsubscribed customers cannot be selected.",
  bcSend:"Send",bcSummary:(p,g,m)=>p+" individuals and "+g+" groups selected"+(p?"; individuals take about "+m+" min":""),bcNothing:"Write a message and pick recipients first",
  bcConfirm:(p,g)=>"Send to "+p+" individuals and "+g+" groups? This cannot be undone.",
  bcRisk:"Reminder: this is an unofficial connection, and messaging many individuals in a short time is the most common reason WhatsApp bans a number. Messages are queued and sent slowly with a daily limit. Prefer groups when you can.",
  bcHistory:"Sent broadcasts",bcToday:(n,c)=>"· "+n+" sent in the last 24 h, limit "+c,bcNone:"No broadcasts yet",bcProgress:(s,t)=>s+" / "+t+" sent",bcFailed:n=>n+" failed",bcSkipped:n=>n+" skipped",
  bcStatus:{sending:"Sending",paused:"Paused",done:"Done",cancelled:"Cancelled"},bcPause:"Pause",bcResume:"Resume",bcCancel:"Cancel",bcCapNote:"Daily limit reached; the rest continues automatically tomorrow.",bcOffline:"WhatsApp is not connected; sending resumes when it is.",
  colName:"Name",colNumber:"Number",colTier:"Tier",colUpdates:"Updates",colLast:"Last activity",cuSearch:"Search name or number",cuCount:n=>n+" customers",cuHint:"These are the individual chats already in your WhatsApp. Groups are picked on the Broadcast page.",
  subscribed:"Subscribed",unsubscribed:"Unsubscribed",openChat:"Open chat",noActivity:"—",
  kbCount:n=>"· "+n+" entries",kbSearch:"Search, e.g. no sound, projector",kbPick:"Pick an entry on the left to see how the bot answers.",kbQuick:"Quick fix (customer chose 1)",kbExplain:"Explanation (customer chose 2)",kbPhrases:"Phrases that trigger this entry",
  kbTry:"Ask the bot",kbQ:"Type what a customer might ask",kbAsk:"Try",kbWould:"The bot would reply:",kbSilent:"The bot would stay silent ("}
};
let lang=(navigator.language||"").toLowerCase().startsWith("zh")?"zh":"en";
try{const saved=localStorage.getItem("bot-lang");if(saved==="zh"||saved==="en")lang=saved;}catch{}
const T=k=>L[lang][k]??L.en[k]??k;
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
let state=null,audience=null,broadcasts=null,kbIndex=null,kbOpen=null,kbAnswer=null,selected=null,chatKey="",listKey="",draft=false,page="chats";
const chosen=new Set();
const locale=()=>lang==="zh"?"zh-CN":"en-GB";
const hhmm=t=>t?new Date(t).toLocaleTimeString(locale(),{hour:"2-digit",minute:"2-digit"}):"";
const dayOf=t=>new Date(t).toLocaleDateString(locale(),{year:"numeric",month:"short",day:"numeric"});
const when=t=>t?dayOf(t)+" "+hhmm(t):T("noActivity");
const label=c=>c.name||c.display;
const pickText=o=>o?(o[lang]||o.en||o.zh||Object.values(o)[0]||""):"";
function tierLabel(id){const t=state?.tiers.find(x=>x.id===id);return t?pickText(t.label)||t.id:id;}
async function get(url){const r=await fetch(url);return r.json();}
async function post(url,body){const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return r.json();}
const matches=(c,q)=>!q||(label(c)+" "+c.display).toLowerCase().includes(q);

function applyLang(){
  document.documentElement.lang=lang;
  document.querySelectorAll("[data-t]").forEach(n=>{n.textContent=T(n.dataset.t);});
  document.querySelectorAll("[data-lang]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.lang===lang)));
  $("text").placeholder=T("typeAs");$("bc-text").placeholder=T("bcPlaceholder");$("bc-search").placeholder=T("bcSearch");$("cu-search").placeholder=T("cuSearch");$("kb-search").placeholder=T("kbSearch");$("kb-q").placeholder=T("kbQ");
  const km=$("kb-mode"),keep=km.value;km.textContent="";for(const m of ["fix","explain"]){const o=el("option","",T("mode")[m]);o.value=m;km.append(o);}if(keep)km.value=keep;
  chatKey="";listKey="";$("tier").dataset.for="";
  if(state)renderAll();else{$("status").textContent=T("loading");showEmptyPhone();}
}
function showPage(){
  const want=(location.hash||"#chats").slice(1);page=["chats","broadcast","customers","knowledge"].includes(want)?want:"chats";
  document.querySelectorAll(".page").forEach(p=>{p.hidden=p.id!=="page-"+page;});
  document.querySelectorAll("nav a").forEach(a=>{if(a.getAttribute("href")==="#"+page)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
  if(page==="broadcast"||page==="customers")loadAudience();
  if(page==="broadcast")loadBroadcasts();
  if(page==="knowledge")loadKnowledge();
}
function showEmptyPhone(){$("p-name").textContent=T("pick");$("p-sub").textContent="";$("p-avatar").textContent="?";$("p-tier").textContent="";const c=$("chat");c.textContent="";c.append(el("div","empty",T("noConvPhone")));}
function renderStatus(){
  const s=state.status,box=$("status");box.textContent="";
  const cls=s.connection==="open"?"ok":s.connection==="close"?"bad":"warn";
  const text={open:T("connected"),close:T("disconnected"),connecting:T("connecting"),demo:T("demo"),starting:T("starting")}[s.connection]||s.connection;
  box.append(el("span","pill "+cls,text)," ",el("b","",s.phone?"+"+s.phone:"—"),s.profile?" · "+s.profile:"",s.aiEnabled?" · AI: "+s.aiProvider:" · "+T("aiOff")," · "+T("kb")+" "+state.knowledgeCount);
  const p=$("pairing");p.textContent="";p.hidden=!s.pairingCode;
  if(s.pairingCode)p.append(el("div","",T("pairIntro")),el("div","code",s.pairingCode),el("div","muted",T("pairPath")));
  $("demo-card").hidden=!state.demo;$("compose").hidden=!state.demo;
  const st=$("stats");st.textContent="";
  for(const [k,v] of [[T("inbound"),state.stats.inbound24h],[T("botReplies"),state.stats.botReplies24h],[T("humanReplies"),state.stats.humanReplies24h],[T("contacts"),state.stats.contacts]]){const d=el("div","stat");d.append(el("span","",k),el("b","",String(v)));st.append(d);}
}
function renderList(){
  const key=JSON.stringify([state.conversations,selected,lang]);if(key===listKey)return;listKey=key;
  for(const [group,listId,countId,emptyKey] of [[false,"list-people","count-people","noConv"],[true,"list-groups","count-groups","noGroups"]]){
    const items=state.conversations.filter(c=>!!c.group===group),list=$(listId);list.textContent="";
    $(countId).textContent=items.length?T("countText")(items.length,items.filter(c=>c.waiting).length):"";
    if(!items.length){const d=el("div","muted",T(emptyKey));d.style.padding="8px";list.append(d);continue;}
    for(const c of items){
      const row=el("button","row"+(c.jid===selected?" sel":""));row.type="button";
      const last=(group&&c.last_sender?c.last_sender+": ":"")+(c.last_text||"");
      row.append(el("span","name",label(c)+(!group&&c.name&&c.display!==c.name?"  ·  "+c.display:"")),el("span","time",hhmm(c.last_at)),el("span","last",last));
      const pills=el("span","pills");
      if(c.tier)pills.append(el("span","pill vip",tierLabel(c.tier)));
      if(c.mode&&T("mode")[c.mode])pills.append(el("span","pill",T("mode")[c.mode]));
      if(c.waiting)pills.append(el("span","pill warn",T("waiting")));
      row.append(pills);row.addEventListener("click",()=>select(c.jid));list.append(row);
    }
  }
}
function fillTierSelect(sel,c){
  const want=c.storedTier||"",sig=c.jid+"|"+want+"|"+lang+"|"+state.tiers.length;
  if(sel.dataset.for===sig)return;sel.textContent="";
  const add=(v,t)=>{const o=el("option","",t);o.value=v;sel.append(o);};
  add("",T("tierDefault")+(c.tier&&!want?" → "+tierLabel(c.tier):""));add("none",T("tierStandard"));for(const t of state.tiers)add(t.id,tierLabel(t.id));
  sel.value=want;sel.dataset.for=sig;
}
function renderSelected(){
  const c=state.conversations.find(x=>x.jid===selected),tier=$("tier");
  if(!c){$("sel-name").textContent=T("none");tier.disabled=true;tier.textContent="";tier.dataset.for="";if(!draft)showEmptyPhone();return;}
  draft=false;
  $("p-name").textContent=label(c);$("p-sub").textContent=c.group?T("groupSub"):[c.display!==label(c)?c.display:"",c.mode&&T("mode")[c.mode]?T("mode")[c.mode]:"",c.muted?T("paused"):""].filter(Boolean).join(" · ");
  $("text").placeholder=T(c.group?"typeAsMember":"typeAs");
  $("p-avatar").textContent=(label(c)||"?").trim().slice(0,1).toUpperCase();
  const pt=$("p-tier");pt.textContent="";if(c.tier)pt.append(el("span","pill vip",tierLabel(c.tier)));
  $("sel-name").textContent=label(c)+(!c.group&&c.display!==label(c)?" · "+c.display:"");
  if(c.group){tier.textContent="";tier.append(el("option","",T("tierGroup")));tier.disabled=true;tier.dataset.for="";return;}
  fillTierSelect(tier,c);tier.disabled=false;
}
async function renderChat(){
  if(!selected||draft||page!=="chats")return;
  const data=await get("/api/messages?jid="+encodeURIComponent(selected));
  const key=selected+":"+data.messages.length+":"+(data.messages.at(-1)?.id||0)+":"+lang;if(key===chatKey)return;chatKey=key;
  const chat=$("chat");chat.textContent="";
  if(!data.messages.length){chat.append(el("div","empty",T("noMsg")));return;}
  let day="";
  for(const m of data.messages){
    const d=dayOf(m.created_at);if(d!==day){day=d;chat.append(el("div","day",d));}
    const b=el("div","msg "+(m.direction==="in"?"in":"out")+(m.direction==="human"?" human":""));
    if(m.sender&&m.direction==="in")b.append(el("div","sender",m.sender));
    b.append(document.createTextNode(m.text));
    if(m.options){const box=el("div","opts"),live=state.demo&&m.id===data.messages.at(-1).id;
      m.options.forEach((text,i)=>{const o=el(live?"button":"div","opt",(i+1)+"  "+text);if(live){o.type="button";o.addEventListener("click",async()=>{await post("/demo/send",{jid:selected,option:i});chatKey="";refresh();});}box.append(o);});b.append(box);}
    const meta=el("div","meta");
    if(m.direction==="bot")meta.append(el("span","tag",m.reason==="broadcast"?T("reason").broadcast:T("bot")+" · "+(T("reason")[m.reason]||m.reason||"")));
    if(m.direction==="human")meta.append(el("span","tag",T("human")));
    meta.append(el("span","",hhmm(m.created_at)));b.append(meta);chat.append(b);
  }
  chat.scrollTop=chat.scrollHeight;
}
function select(jid){selected=jid;draft=false;chatKey="";renderList();renderSelected();renderChat();}

// ---- broadcast page ----
async function loadAudience(){audience=await get("/api/audience");renderAudience();renderCustomers();}
async function loadBroadcasts(){broadcasts=await get("/api/broadcasts");renderBroadcasts();}
function renderAudience(){
  if(!audience)return;
  const q=$("bc-search").value.trim().toLowerCase();
  for(const [group,boxId,countId,emptyKey] of [[true,"bc-groups","bc-count-groups","noGroups"],[false,"bc-people","bc-count-people","noConv"]]){
    const all=audience.contacts.filter(c=>!!c.group===group),items=all.filter(c=>matches(c,q)),box=$(boxId);box.textContent="";
    $(countId).textContent=all.filter(c=>chosen.has(c.jid)).length+" / "+all.length;
    if(!items.length){const d=el("div","muted",T(emptyKey));d.style.padding="6px";box.append(d);continue;}
    for(const c of items){
      const row=el("label","pick"+(c.optedOut?" off":"")),cb=el("input");cb.type="checkbox";cb.checked=chosen.has(c.jid);cb.disabled=!!c.optedOut;
      cb.addEventListener("change",()=>{if(cb.checked)chosen.add(c.jid);else chosen.delete(c.jid);renderAudience();});
      row.append(cb,el("span","n",label(c)));
      if(c.tier)row.append(el("span","pill vip",tierLabel(c.tier)));
      if(c.optedOut)row.append(el("span","pill",T("unsubscribed")));
      if(!group&&c.display!==label(c))row.append(el("span","d",c.display));
      box.append(row);
    }
  }
  updateSummary();
}
function selection(){const list=(audience?.contacts||[]).filter(c=>chosen.has(c.jid)&&!c.optedOut);return {list,people:list.filter(c=>!c.group).length,groups:list.filter(c=>c.group).length};}
function updateSummary(){
  const text=$("bc-text").value.trim(),{people,groups}=selection();
  $("bc-chars").textContent=T("bcChars")($("bc-text").value.length);
  const avg=audience?(audience.delay.min+audience.delay.max)/2:30;
  $("bc-summary").textContent=people+groups?T("bcSummary")(people,groups,Math.max(1,Math.ceil(people*avg/60))):T("bcNothing");
  $("bc-send").disabled=!text||!(people+groups);
}
function bulk(filter){if(!audience)return;const q=$("bc-search").value.trim().toLowerCase();for(const c of audience.contacts)if(!c.optedOut&&matches(c,q)&&filter(c))chosen.add(c.jid);renderAudience();}
function renderBroadcasts(){
  if(!broadcasts)return;const box=$("bc-list");box.textContent="";
  $("bc-today").textContent=T("bcToday")(broadcasts.sentToday,broadcasts.cap);
  if(broadcasts.blocked==="daily_cap")box.append(el("p","pill warn",T("bcCapNote")));
  if(broadcasts.blocked==="offline")box.append(el("p","pill warn",T("bcOffline")));
  if(!broadcasts.broadcasts.length){box.append(el("div","muted",T("bcNone")));return;}
  for(const b of broadcasts.broadcasts){
    const item=el("div","bc"),head=el("div","tools");
    head.append(el("span","pill "+(b.status==="done"?"ok":b.status==="cancelled"?"":"warn"),T("bcStatus")[b.status]||b.status),el("span","muted",when(b.created_at)),el("span","",T("bcProgress")(b.sent,b.total)));
    if(b.failed)head.append(el("span","pill bad",T("bcFailed")(b.failed)));
    if(b.skipped)head.append(el("span","pill",T("bcSkipped")(b.skipped)));
    const act=(key,status)=>{const btn=el("button","btn small",T(key));btn.type="button";btn.addEventListener("click",async()=>{await post("/api/broadcast/status",{id:b.id,status});loadBroadcasts();});head.append(btn);};
    if(b.status==="sending")act("bcPause","paused");
    if(b.status==="paused")act("bcResume","sending");
    if(b.status==="sending"||b.status==="paused")act("bcCancel","cancelled");
    const bar=el("div","bar"),fill=el("i");fill.style.width=(b.total?Math.round(100*b.sent/b.total):0)+"%";bar.append(fill);
    item.append(head,bar,el("div","t",b.text));box.append(item);
  }
}
// ---- customers page ----
function renderCustomers(){
  if(!audience||!state)return;const q=$("cu-search").value.trim().toLowerCase(),body=$("cu-body");body.textContent="";
  const all=audience.contacts.filter(c=>!c.group),items=all.filter(c=>matches(c,q));
  $("cu-count").textContent=T("cuCount")(all.length);
  for(const c of items){
    const tr=el("tr"),name=el("td","wide");name.append(el("b","",label(c)));if(c.waiting)name.append(" ",el("span","pill warn",T("waiting")));
    const tierTd=el("td"),sel=el("select");fillTierSelect(sel,c);sel.addEventListener("change",async()=>{await post("/api/contact",{jid:c.jid,tier:sel.value||null});loadAudience();refresh();});tierTd.append(sel);
    const sub=el("td"),btn=el("button","btn small",T(c.optedOut?"unsubscribed":"subscribed"));btn.type="button";btn.addEventListener("click",async()=>{await post("/api/contact",{jid:c.jid,optedOut:!c.optedOut});if(!c.optedOut)chosen.delete(c.jid);loadAudience();});sub.append(btn);
    const open=el("td");if(c.last_at){const o=el("button","btn small",T("openChat"));o.type="button";o.addEventListener("click",()=>{selected=c.jid;draft=false;chatKey="";listKey="";location.hash="#chats";});open.append(o);}
    tr.append(name,el("td","",c.display),tierTd,sub,el("td","muted",when(c.last_at||c.chat_at)),open);body.append(tr);
  }
}
// ---- knowledge page ----
async function loadKnowledge(){if(!kbIndex)kbIndex=await get("/api/knowledge");renderKnowledge();}
function renderKnowledge(){
  if(!kbIndex)return;const q=$("kb-search").value.trim().toLowerCase(),list=$("kb-list");list.textContent="";
  $("kb-count").textContent=T("kbCount")(kbIndex.entries.length);
  for(const e of kbIndex.entries){
    if(q&&!e.search.includes(q))continue;
    const row=el("button","row"+(kbOpen?.id===e.id?" sel":""));row.type="button";row.append(el("span","name",pickText(e.title)));
    row.addEventListener("click",async()=>{kbOpen=await get("/api/knowledge/entry?id="+encodeURIComponent(e.id));renderKnowledge();});list.append(row);
  }
  const box=$("kb-detail");box.textContent="";
  if(!kbOpen){box.append(el("p","muted",T("kbPick")));}
  else{box.append(el("h3","",pickText(kbOpen.title)),el("h2","",T("kbQuick")),el("div","answer",pickText(kbOpen.reply)),el("h2","",T("kbExplain")),el("div","answer",pickText(kbOpen.explain)),el("h2","",T("kbPhrases")),el("p","muted",(kbOpen.match||[]).join(" · ")));}
  const res=$("kb-result");res.textContent="";
  if(kbAnswer){if(kbAnswer.reply)res.append(el("p","hint",T("kbWould")+"  ["+(T("reason")[kbAnswer.reason]||kbAnswer.reason)+"]"),el("div","answer",kbAnswer.reply));else res.append(el("p","hint",T("kbSilent")+kbAnswer.reason+")"));}
}
function renderAll(){renderStatus();renderList();renderSelected();renderChat();if(page==="broadcast"){renderAudience();renderBroadcasts();}if(page==="customers")renderCustomers();if(page==="knowledge")renderKnowledge();}
let ticks=0;
async function refresh(){
  try{state=await get("/api/state");}catch{return;}
  if(!selected&&state.conversations.length)selected=state.conversations[0].jid;
  renderStatus();renderList();renderSelected();renderChat();
  if(page==="broadcast")loadBroadcasts();
  if((page==="broadcast"||page==="customers")&&(++ticks%4===0||!audience)){const typing=document.activeElement&&["bc-search","cu-search"].includes(document.activeElement.id);if(!typing)loadAudience();}
}
document.querySelectorAll("[data-lang]").forEach(b=>b.addEventListener("click",()=>{lang=b.dataset.lang;try{localStorage.setItem("bot-lang",lang);}catch{}applyLang();}));
window.addEventListener("hashchange",()=>{showPage();chatKey="";if(state)renderAll();});
$("tier").addEventListener("change",async e=>{if(!selected)return;await post("/api/contact",{jid:selected,tier:e.target.value||null});listKey="";$("tier").dataset.for="";refresh();});
$("compose").addEventListener("submit",async e=>{e.preventDefault();const input=$("text"),text=input.value.trim();if(!text)return;input.value="";
  if(!selected)selected="659"+String(Math.floor(1e6+Math.random()*9e6))+"@s.whatsapp.net";
  draft=false;if(selected.endsWith("@g.us"))await post("/demo/group",{jid:selected,text,sender:"Sarah"});else await post("/demo/send",{jid:selected,text});chatKey="";refresh();});
$("new-customer").addEventListener("click",()=>{selected="659"+String(Math.floor(1e6+Math.random()*9e6))+"@s.whatsapp.net";draft=true;chatKey="";listKey="";renderList();
  $("p-name").textContent=T("newCustomerName");$("p-sub").textContent="+"+selected.split("@")[0];$("p-avatar").textContent="?";$("p-tier").textContent="";$("text").placeholder=T("typeAs");const c=$("chat");c.textContent="";c.append(el("div","empty",T("typeBelow")));$("text").focus();});
$("owner-reply").addEventListener("click",async()=>{if(!selected||draft)return;if(selected.endsWith("@g.us"))await post("/demo/group",{jid:selected,text:T("ownerText"),fromMe:true});else await post("/demo/owner",{jid:selected,text:T("ownerText")});chatKey="";refresh();});
const GROUP_SAMPLES=[["Sarah","Hi team, the boardroom LED wall has one block dark again."],["Kumar","Level 5 meeting room projector is blinking orange."],["陈先生","三楼培训室麦克风一直啸叫，下午两点有活动。"]];
let groupSample=0;
$("group-msg").addEventListener("click",async()=>{const [sender,text]=GROUP_SAMPLES[groupSample++%GROUP_SAMPLES.length];const jid="120363000000000001@g.us";await post("/demo/group",{jid,name:"ABC Pte Ltd × AV Support",sender,text});selected=jid;draft=false;chatKey="";listKey="";refresh();});
$("bc-text").addEventListener("input",updateSummary);$("bc-search").addEventListener("input",renderAudience);$("cu-search").addEventListener("input",renderCustomers);$("kb-search").addEventListener("input",renderKnowledge);
$("bc-all-groups").addEventListener("click",()=>bulk(c=>c.group));$("bc-all-people").addEventListener("click",()=>bulk(c=>!c.group));
$("bc-vip").addEventListener("click",()=>{const pr=new Set(state.tiers.filter(t=>t.priority).map(t=>t.id));bulk(c=>!c.group&&pr.has(c.tier));});
$("bc-clear").addEventListener("click",()=>{chosen.clear();renderAudience();});
$("bc-send").addEventListener("click",async()=>{const text=$("bc-text").value.trim(),{list,people,groups}=selection();if(!text||!list.length)return;if(!confirm(T("bcConfirm")(people,groups)))return;
  $("bc-send").disabled=true;const r=await post("/api/broadcast",{text,jids:list.map(c=>c.jid)});if(r.ok){$("bc-text").value="";chosen.clear();renderAudience();}else alert(r.error||"error");loadBroadcasts();});
$("kb-try").addEventListener("submit",async e=>{e.preventDefault();const text=$("kb-q").value.trim();if(!text)return;kbAnswer=await post("/api/try",{text,mode:$("kb-mode").value});if(kbAnswer.entry)kbOpen=await get("/api/knowledge/entry?id="+encodeURIComponent(kbAnswer.entry));renderKnowledge();});
applyLang();showPage();refresh();setInterval(refresh,2500);
</script></body></html>`;

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// The page is same-origin only: refuse writes that come from another site's script.
function trustedWrite(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  } catch {
    return false;
  }
}

// One row per chat. `all` adds chats imported from WhatsApp that have no messages yet.
export function listContacts({ store, config, all = false }) {
  const priority = new Set(Object.entries(config.tiers || {}).filter(([, tier]) => tier.priority).map(([id]) => id));
  const now = Date.now();
  const contacts = store
    .recentConversations(all ? 5000 : 400)
    .filter((row) => all || row.last_at)
    .map((row) => {
      const customer = findCustomer(config, row.phone, row.jid);
      const tier = tierOf(config, { tier: row.tier, phone: row.phone, jid: row.jid }, row.phone);
      const id = row.jid.split("@")[0];
      const group = row.jid.endsWith("@g.us");
      return {
        jid: row.jid,
        group,
        name: group ? row.name || "Group" : customer?.name || row.name || "",
        display: group ? "" : row.phone ? `+${row.phone}` : row.jid.endsWith("@lid") ? `ID ${id}` : `+${id}`,
        last_sender: group ? row.last_sender || "" : "",
        tier: group ? null : tier,
        storedTier: row.tier || "",
        mode: row.mode,
        optedOut: !!row.opted_out,
        muted: !!(row.muted_until && row.muted_until > now),
        last_text: (row.last_text || "").replace(/\s+/g, " ").slice(0, 120),
        last_at: row.last_at,
        chat_at: row.chat_at,
        waiting: !!row.last_inbound_at && (!row.last_human_outbound_at || row.last_human_outbound_at < row.last_inbound_at),
      };
    });
  const rank = (c) => (c.waiting && priority.has(c.tier) ? 0 : c.waiting ? 1 : 2);
  contacts.sort((a, b) => rank(a) - rank(b) || (b.last_at || b.chat_at || 0) - (a.last_at || a.chat_at || 0));
  return contacts;
}

export function buildState({ status, store, config }) {
  const tiers = Object.entries(config.tiers || {}).map(([id, tier]) => ({
    id,
    label: tier.label || { en: id },
    priority: !!tier.priority,
    bot: tier.bot || "on",
  }));
  return {
    status,
    demo: status.connection === "demo",
    stats: store.stats(),
    tiers,
    knowledgeCount: config.faq.filter((entry) => entry.id).length,
    conversations: listContacts({ store, config }),
  };
}

const DAY = 24 * 3600 * 1000;

export function startDashboard({ port, status, store, config, log, extraRoutes = null, broadcaster = null }) {
  const knowledge = config.faq.filter((entry) => entry.id && entry.title);
  const knowledgeIndex = knowledge.map((entry) => ({
    id: entry.id,
    title: entry.title,
    search: normalize([...Object.values(entry.title), ...(entry.match || [])].join(" ")),
  }));

  const routes = {
    "GET /api/state": () => buildState({ status, store, config }),
    "GET /api/messages": (url) => ({ messages: store.messages(String(url.searchParams.get("jid") || "")) }),
    "GET /api/audience": () => ({ contacts: listContacts({ store, config, all: true }), delay: config.broadcast.delay_seconds }),
    "GET /api/broadcasts": () => ({
      broadcasts: store.broadcasts(),
      sentToday: store.broadcastsSentSince(Date.now() - DAY),
      cap: config.broadcast.max_per_day,
      blocked: status.connection === "demo" ? null : status.connection !== "open" && store.nextBroadcastRecipient() ? "offline" : broadcaster?.state.blocked || null,
    }),
    "GET /api/knowledge": () => ({ entries: knowledgeIndex }),
    "GET /api/knowledge/entry": (url) => {
      const entry = knowledge.find((item) => item.id === url.searchParams.get("id"));
      return entry ? { id: entry.id, title: entry.title, match: entry.match, reply: entry.reply, explain: entry.explain } : { error: "not found" };
    },
    "POST /api/contact": (url, body) => {
      const jid = String(body.jid || "");
      if (!jid) return { status: 400, error: "bad request" };
      if ("tier" in body) {
        const tier = body.tier === null || body.tier === "" ? null : String(body.tier);
        if (tier && tier !== "none" && !config.tiers?.[tier]) return { status: 400, error: "unknown tier" };
        store.setTier(jid, tier);
      }
      if (typeof body.optedOut === "boolean") store.setOptOut(jid, body.optedOut);
      return { ok: true };
    },
    // Recipients must already be chats in this account; opted-out customers are dropped.
    "POST /api/broadcast": (url, body) => {
      const text = String(body.text || "").trim();
      if (!text || text.length > 2000) return { status: 400, error: "message must be 1 to 2000 characters" };
      const jids = [...new Set(Array.isArray(body.jids) ? body.jids.map(String) : [])].filter((jid) => store.hasContact(jid) && !store.contact(jid).optedOut);
      if (!jids.length) return { status: 400, error: "no valid recipients" };
      if (jids.length > 2000) return { status: 400, error: "too many recipients" };
      const id = store.createBroadcast(text, jids);
      log(`群发已排队 / broadcast #${id} queued for ${jids.length} recipients`);
      return { ok: true, id, recipients: jids.length };
    },
    "POST /api/broadcast/status": (url, body) => (store.setBroadcastStatus(Number(body.id), String(body.status)) ? { ok: true } : { status: 400, error: "not allowed" }),
    // What the bot would answer a customer who had already picked a menu mode. Nothing is sent or stored.
    "POST /api/try": (url, body) => {
      const text = String(body.text || "").slice(0, 2000);
      if (!text) return { status: 400, error: "empty" };
      const mode = ["fix", "explain", "visit"].includes(body.mode) ? body.mode : "fix";
      const decision = decide({ ...config, ai: { ...config.ai, enabled: false } }, { text, contact: { lastInboundAt: Date.now() - 1000, mode }, now: Date.now() });
      return { reply: decision.text || null, reason: decision.reason, entry: decision.entry || null, language: decision.language };
    },
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST" && !trustedWrite(req)) return json(res, 403, { error: "forbidden" });
      if (extraRoutes && (await extraRoutes(req, res, url))) return;
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/demo" || url.pathname === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(PAGE);
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) {
        res.writeHead(404);
        return res.end();
      }
      const result = route(url, req.method === "POST" ? await readBody(req) : null);
      // Handlers signal a failure with a numeric `status`; /api/state legitimately returns a status object.
      if (typeof result.status === "number") {
        const { status: code, ...body } = result;
        return json(res, code, body);
      }
      return json(res, 200, result);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
  let attempts = 0;
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 10) {
      attempts += 1;
      log(`端口 ${port} 被占用（另一个窗口还在运行？），改用 ${port + 1} / Port ${port} busy (another window still running?), trying ${port + 1}`);
      port += 1;
      setTimeout(() => server.listen(port, "127.0.0.1"), 200);
      return;
    }
    log(`后台启动失败 / Dashboard failed: ${error.message}`);
  });
  server.on("listening", () => {
    status.dashboardPort = port;
    log(`后台 / Dashboard: http://127.0.0.1:${port}`);
  });
  server.listen(port, "127.0.0.1");
  return server;
}
