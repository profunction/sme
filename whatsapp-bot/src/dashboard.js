// Local-only web page: connection status, recent conversations, customers still waiting for a human.
import http from "node:http";

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bot</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--text:#1a1d21;--muted:#6b7280;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--line:#e5e7eb}
  @media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e7e9ee;--muted:#9aa3b2;--line:#2a2f3a}}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;padding:16px}
  main{max-width:960px;margin:0 auto;display:grid;gap:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
  .muted{color:var(--muted)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
  .code{font:700 28px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
  .stat b{display:block;font-size:24px}
  table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}
  th{color:var(--muted);font-weight:600;border-top:0}
  .text{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line)}
</style></head><body><main>
<section class="card"><h1>WhatsApp 自动回复 / Auto-reply bot</h1>
<div id="status" class="muted">加载中 / loading…</div><div id="pairing"></div></section>
<section class="card"><h2>最近 24 小时 / Last 24 hours</h2><div class="grid" id="stats"></div></section>
<section class="card"><h2 class="warn">等待人工回复 / Waiting for a human</h2><div id="waiting" class="muted">—</div></section>
<section class="card"><h2>最近对话 / Recent conversations</h2><div id="recent" class="muted">—</div></section>
</main>
<script>
const fmt=t=>t?new Date(t).toLocaleString():"—";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const phone=c=>esc(c.phone||(c.jid||"").split("@")[0]+((c.jid||"").endsWith("@lid")?" (LID)":""));
async function refresh(){
  const r=await fetch("/api/state");const s=await r.json();
  const st=document.getElementById("status");
  const cls=s.status.connection==="open"?"ok":s.status.connection==="close"?"bad":"warn";
  st.innerHTML='<span class="pill '+cls+'">'+esc(s.status.connection||"starting")+'</span> 号码 / number: <b>'+esc(s.status.phone)+'</b>'+(s.status.lastError?' <span class="bad">'+esc(s.status.lastError)+'</span>':'')+(s.status.aiEnabled?' · AI: '+esc(s.status.aiProvider):' · AI 关闭 / AI off');
  document.getElementById("pairing").innerHTML=s.status.pairingCode?'<p>在手机 WhatsApp 输入配对码 / Enter this pairing code on your phone:</p><div class="code">'+esc(s.status.pairingCode)+'</div><p class="muted">已连接的设备 → 连接设备 → 改用电话号码连接<br>Linked devices → Link a device → Link with phone number instead</p>':'';
  document.getElementById("stats").innerHTML=[["收到 / Inbound",s.stats.inbound24h],["机器人回复 / Bot replies",s.stats.botReplies24h],["人工回复 / Human replies",s.stats.humanReplies24h],["联系人 / Contacts",s.stats.contacts]].map(([k,v])=>'<div class="stat"><span class="muted">'+k+'</span><b>'+v+'</b></div>').join("");
  document.getElementById("waiting").innerHTML=s.waiting.length?'<table><tr><th>号码 / Number</th><th>名字 / Name</th><th>最后消息 / Last message</th></tr>'+s.waiting.map(w=>'<tr><td>'+phone(w)+'</td><td>'+esc(w.name)+'</td><td>'+fmt(w.last_inbound_at)+'</td></tr>').join("")+'</table>':'没有人在等 / Nobody waiting';
  document.getElementById("recent").innerHTML=s.conversations.length?'<table><tr><th>号码 / Number</th><th>名字 / Name</th><th>最后一条 / Last text</th><th>时间 / Time</th></tr>'+s.conversations.map(c=>'<tr><td>'+phone(c)+'</td><td>'+esc(c.name)+'</td><td class="text">'+esc(c.last_text)+'</td><td>'+fmt(c.last_inbound_at)+'</td></tr>').join("")+'</table>':'还没有对话 / No conversations yet';
}
refresh();setInterval(refresh,8000);
</script></body></html>`;

export function startDashboard({ port, status, store, log, extraRoutes = null }) {
  const server = http.createServer(async (req, res) => {
    if (extraRoutes) {
      try {
        if (await extraRoutes(req, res)) return;
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }
    if (req.url === "/api/state") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          status,
          stats: store.stats(),
          waiting: store.waitingForHuman(),
          conversations: store.recentConversations(),
        })
      );
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    res.writeHead(404);
    res.end();
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
