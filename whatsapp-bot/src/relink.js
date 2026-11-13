// Forget the saved WhatsApp login for one account so the next start pairs again.
// Pairing is the moment WhatsApp hands over the list of existing chats, so this is
// how an already-linked account gets its individual chats into the back office.
//   npm run relink            default account
//   npm run relink -- second  the account set up as profile "second"
import fs from "node:fs";
import { profilePaths } from "./config.js";

const paths = profilePaths(process.cwd(), process.argv[2]);
if (!fs.existsSync(paths.auth)) {
  console.log(`没有找到已保存的登录 / No saved login at ${paths.auth}`);
} else {
  fs.rmSync(paths.auth, { recursive: true, force: true });
  console.log(`已清除登录 / Removed the saved login: ${paths.auth}`);
}
const suffix = paths.profile ? ` -- ${paths.profile}` : "";
console.log(`对话记录和客户等级都还在。现在运行 npm start${suffix} 重新配对。`);
console.log(`Chat history and tiers are kept. Run "npm start${suffix}" and pair again.`);
