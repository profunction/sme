// Demo mode: no phone, no WhatsApp. A browser page plays the customer; the real reply
// engine answers. Use it to tune config.json or to show a shop owner how the bot behaves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, merge } from "./config.js";
import { Store } from "./store.js";
import { startDashboard } from "./dashboard.js";
import { createHandler } from "./handler.js";

const log = (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`);

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bot Demo</title>
<style>
  :root{--bg:#e5ddd5;--mine:#dcf8c6;--theirs:#fff;--text:#111;--muted:#667781;--bar:#075e54}
  @media (prefers-color-scheme:dark){:root{--bg:#0b141a;--mine:#005c4b;--theirs:#202c33;--text:#e9edef;--muted:#8696a0;--bar:#1f2c34}}
  *{box-sizing:border-box}body{margin:0;background:#111;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;color:var(--text);display:flex;justify-content:center;padding:16px}
  .wrap{width:100%;max-width:880px;display:grid;grid-template-columns:minmax(0,380px) 1fr;gap:16px}
  @media (max-width:760px){.wrap{grid-template-columns:1fr}}
  .phone{background:var(--bg);border-radius:24px;overflow:hidden;display:flex;flex-direction:column;height:680px;border:6px solid #222}
  .bar{background:var(--bar);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}
  .bar b{display:block}.bar small{opacity:.8}
  .avatar{width:36px;height:36px;border-radius:50%;background:#cfd8dc}
  .chat{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:6px}
  .msg{max-width:82%;padding:8px 10px;border-radius:8px;white-space:pre-wrap;box-shadow:0 1px 1px rgba(0,0,0,.1)}
  .msg.me{align-self:flex-end;background:var(--mine)}.msg.bot{align-self:flex-start;background:var(--theirs)}
  .meta{font-size:11px;color:var(--muted);margin-top:4px;text-align:right}
  .compose{display:flex;gap:8px;padding:10px;background:#f0f0f0}@media (prefers-color-scheme:dark){.compose{background:#1f2c34}}
  .compose input{flex:1;border:0;border-radius:20px;padding:10px 14px;font-size:15px}
  .compose button{border:0;border-radius:50%;width:42px;height:42px;background:#00a884;color:#fff;font-size:18px;cursor:pointer}
  .side{color:#ddd;display:flex;flex-direction:column;gap:12px}
  .side h1{font-size:20px;margin:0}.side p{margin:0;color:#aaa}
  .quick{display:flex;flex-wrap:wrap;gap:8px}.quick button{background:#2a3942;color:#e9edef;border:0;border-radius:16px;padding:6px 12px;cursor:pointer}
  .side a{color:#53bdeb}
  .row{display:flex;gap:8px;align-items:center;color:#aaa}.row input{width:170px;border-radius:6px;border:1px solid #444;background:#222;color:#eee;padding:6px 8px}
  .row button{background:#444;color:#eee;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
</style></head><body><div class="wrap">
<div class="phone">
  <div class="bar"><div class="avatar"></div><div><b id="shop">店家 / Business</b><small id="state">机器人在线 / bot online</small></div></div>
  <div class="chat" id="chat"></div>
  <form class="compose" id="form"><input id="text" placeholder="以客人身份输入消息 / Type as the customer" autocomplete="off"><button type="submit">➤</button></form>
</div>
<div class="side">
  <h1>演示模式 / Demo mode</h1>
  <p>左边是客人的手机。你打字，真实的回复引擎用 config 里的话术回答。没有连接 WhatsApp，也不会发出任何消息。</p>
  <p>Left is the customer's phone. The real reply engine answers from your config. Nothing is sent to WhatsApp.</p>
  <div class="quick">
    <button data-t="你好">你好</button><button data-t="hello">hello</button><button data-t="berapa harga?">berapa harga?</button>
    <button data-t="1">1</button><button data-t="2">2</button><button data-t="3">3</button>
    <button data-t="有没有网课？">有没有网课？</button><button data-t="0">0 人工</button>
  </div>
  <div class="row"><span>客人号码 / Customer:</span><input id="from" value="60121110001"><button type="button" id="newcust">换一个新客人 / New customer</button></div>
  <div class="row"><button type="button" id="owner">模拟老板在手机回复 / Simulate owner replying</button></div>
  <p>老板回复后机器人会对这位客人闭嘴一段时间，再发消息试试。</p>
  <p><a href="/" target="_blank">打开后台 / Open dashboard</a></p>
</div></div>
<script>
const chat=document.getElementById("chat"),form=document.getElementById("form"),input=document.getElementById("text"),from=document.getElementById("from");
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function bubble(cls,text,meta){const d=document.createElement("div");d.className="msg "+cls;d.innerHTML=esc(text)+(meta?'<div class="meta">'+esc(meta)+'</div>':"");chat.appendChild(d);chat.scrollTop=chat.scrollHeight;}
async function send(text){if(!text)return;bubble("me",text);input.value="";
  const r=await fetch("/demo/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from:from.value,text})});
  const d=await r.json();
  if(d.reply)bubble("bot",d.reply,d.decision.language+" · "+d.decision.reason);else bubble("bot","（机器人保持沉默 / bot stayed silent: "+d.decision.reason+"）","");}
form.addEventListener("submit",e=>{e.preventDefault();send(input.value.trim())});
document.querySelectorAll(".quick button").forEach(b=>b.addEventListener("click",()=>send(b.dataset.t)));
document.getElementById("newcust").addEventListener("click",()=>{from.value="6012"+String(Math.floor(Math.random()*1e7)).padStart(7,"0");chat.innerHTML="";});
document.getElementById("owner").addEventListener("click",async()=>{await fetch("/demo/owner",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from:from.value,text:"老板：好的，我稍后打给你。"})});bubble("bot","老板：好的，我稍后打给你。","human (owner) · 机器人闭嘴中 / bot muted");});
fetch("/demo/info").then(r=>r.json()).then(i=>{document.getElementById("shop").textContent=i.phone;});
</script></body></html>`;

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

export async function startDemo({ configFile, port, store = new Store(":memory:") } = {}) {
  const file = configFile ?? (fs.existsSync("config.json") ? "config.json" : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config.example.json"));
  // Demo replies are instant, so the per-contact spacing guard would hide quick follow-ups.
  const config = merge(merge(DEFAULTS, JSON.parse(fs.readFileSync(file, "utf8"))), { min_seconds_between_replies_per_contact: 1 });
  const status = { connection: "demo", phone: config.phone_number, pairingCode: null, lastError: null, aiEnabled: config.ai.enabled, aiProvider: config.ai.provider };
  let counter = 0;
  const handler = createHandler({ config, store, log, instant: true, send: async () => `demo-${++counter}` });
  const jidOf = (from) => `${String(from || "60120000000").replace(/\D/g, "")}@s.whatsapp.net`;

  const server = startDashboard({
    port: port ?? config.dashboard_port,
    status,
    store,
    log,
    extraRoutes: async (req, res) => {
      if (req.method === "GET" && req.url === "/demo") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return true;
      }
      if (req.method === "GET" && req.url === "/demo/info") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ phone: config.phone_number, configFile: path.basename(file) }));
        return true;
      }
      if (req.method === "POST" && req.url === "/demo/send") {
        const body = await readBody(req);
        const text = String(body.text || "").slice(0, 2000);
        const result = text ? await handler({ jid: jidOf(body.from), text, name: "Demo customer", id: `in-${++counter}`, fromMe: false }) : null;
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result ?? { reply: null, decision: { reason: "empty", language: config.default_language } }));
        return true;
      }
      if (req.method === "POST" && req.url === "/demo/owner") {
        const body = await readBody(req);
        await handler({ jid: jidOf(body.from), text: String(body.text || "ok"), id: `owner-${++counter}`, fromMe: true });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return true;
      }
      return false;
    },
  });
  log(`演示页面 / Demo page: http://127.0.0.1:${port ?? config.dashboard_port}/demo  (config: ${path.basename(file)})`);
  return { server, store, config, handler };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDemo({ port: Number(process.env.PORT) || undefined }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
