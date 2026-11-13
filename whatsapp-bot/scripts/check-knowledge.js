// Checks every knowledge file: schema, lengths, duplicate ids, and whether each
// entry is actually reachable through its own match phrases. Run: npm run check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledge } from "../src/config.js";
import { matchRule } from "../src/engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function checkKnowledge(dir = path.join(ROOT, "knowledge")) {
  const problems = [];
  const warnings = [];
  const folders = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory());
  let total = 0;
  for (const folder of folders) {
    const entries = loadKnowledge([path.join(dir, folder)], [ROOT]);
    total += entries.length;
    const ids = new Set();
    for (const entry of entries) {
      const where = `${folder}/${entry.id || "(no id)"}`;
      if (!/^[a-z0-9-]+$/.test(entry.id || "")) problems.push(`${where}: id must be lowercase kebab-case`);
      if (ids.has(entry.id)) problems.push(`${where}: duplicate id`);
      ids.add(entry.id);
      for (const field of ["title", "reply", "explain"]) {
        for (const lang of ["zh", "en"]) {
          const text = entry[field]?.[lang];
          if (typeof text !== "string" || !text.trim()) problems.push(`${where}: missing ${field}.${lang}`);
          else if (field !== "title" && text.length > (lang === "zh" ? 520 : 1000)) problems.push(`${where}: ${field}.${lang} too long (${text.length})`);
          else if (field !== "title" && /[*_#`]{2,}|^\s*#/m.test(text)) warnings.push(`${where}: ${field}.${lang} looks like markdown`);
        }
      }
      if (!Array.isArray(entry.match) || entry.match.length < 4) problems.push(`${where}: needs at least 4 match phrases`);
      for (const phrase of entry.match || []) {
        if (typeof phrase !== "string" || phrase.trim().length < 2) problems.push(`${where}: bad match phrase ${JSON.stringify(phrase)}`);
      }
    }
    // Reachability: typing an entry's own phrases should land on that entry most of the time.
    for (const entry of entries) {
      const phrases = entry.match || [];
      const lost = phrases.filter((phrase) => matchRule(entries, phrase)?.id !== entry.id);
      if (phrases.length && lost.length === phrases.length) problems.push(`${folder}/${entry.id}: unreachable, every phrase is claimed by another entry`);
      else if (lost.length > phrases.length / 2) warnings.push(`${folder}/${entry.id}: ${lost.length}/${phrases.length} phrases go to other entries (${lost.slice(0, 3).join(", ")})`);
    }
  }
  return { total, problems, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { total, problems, warnings } = checkKnowledge();
  for (const warning of warnings) console.log(`warn  ${warning}`);
  for (const problem of problems) console.log(`ERROR ${problem}`);
  console.log(`${total} entries, ${problems.length} problems, ${warnings.length} warnings`);
  process.exit(problems.length ? 1 : 0);
}
