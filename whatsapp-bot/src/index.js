import { load, profilePaths } from "./config.js";
import { Store } from "./store.js";
import { connect } from "./whatsapp.js";
import { startDashboard } from "./dashboard.js";
import { createGroupRecorder, createHandler } from "./handler.js";
import { createBroadcaster } from "./broadcast.js";

const log = (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`);

// `npm start` runs the default account; `npm start -- second` runs the account
// set up as profile "second" with its own login, database and dashboard.
async function main() {
  const paths = profilePaths(process.cwd(), process.argv[2]);
  const config = load(paths.config);
  const store = new Store(paths.db);
  const status = {
    connection: "starting",
    profile: paths.profile,
    phone: config.phone_number,
    pairingCode: null,
    connectedAt: null,
    lastError: null,
    aiEnabled: config.ai.enabled,
    aiProvider: config.ai.provider,
  };
  let link;
  const broadcaster = createBroadcaster({ config, store, log, send: (jid, text) => link.sendText(jid, text, { delayMs: 1500 }) });
  startDashboard({ port: config.dashboard_port, status, store, config, log, broadcaster });

  const onMessage = createHandler({
    config,
    store,
    log,
    send: (jid, text, options) => link.sendText(jid, text, options),
    sendPoll: (jid, question, labels, options) => link.sendPoll(jid, question, labels, options),
  });
  const onGroupMessage = config.groups === "observe" ? createGroupRecorder({ store, log }) : null;
  const onDirectory = (entries) => store.importDirectory(entries);
  link = await connect({
    config,
    authDir: paths.auth,
    status,
    onMessage,
    onGroupMessage,
    onDirectory,
    onPollVote: (vote) => onMessage.select(vote),
    getPoll: (id) => store.poll(id),
    log,
  });
  broadcaster.start();
  log(`已启动${paths.profile ? `（${paths.profile}）` : ""}，号码 ${config.phone_number}，知识库 ${config.faq.length} 条。AI: ${config.ai.enabled ? config.ai.provider : "关闭 / off"}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
