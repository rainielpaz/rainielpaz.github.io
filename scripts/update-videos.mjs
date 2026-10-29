// Rebuilds videos.js from the public Google Drive portfolio folder.
// Each subfolder of the portfolio folder becomes one rolling row on the site; videos in
// deeper subfolders join their top-level row. Runs on GitHub Actions (Node 20+, no packages).
import { readFile, writeFile } from "node:fs/promises";

const ROOT_FOLDER = "13KykBFoLidFApCm43zqoAMBP_JkL3Th4";
const OUTPUT = new URL("../videos.js", import.meta.url);
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

// Row names and order on the site. Folders not listed here are added after these,
// named after the Drive folder.
const ROWS = [
  { folder: "1kLxerK8a1P7329VpLXOTXn5NZB6O_dvd", name: "DTC Ads" },
  { folder: "1bGJ6pZsr8A6Tm2jJjC73i84m8u6o7WXE", name: "Animation Style Ads" },
  { folder: "1Pp_ugKD6WRusnIEmekrhqX47rU1G_w_-", name: "Talking Heads" },
  { folder: "1A0eE0JIob_zqK6aoSn3In_xLTM3sBhNZ", name: "AI Avatar Fitness" },
  { folder: "1QvEGFas6O8yQ28FpG0YhcLOoltveOpRo", name: "VSLs" },
];

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function list(folderId) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, {
    headers: { "User-Agent": "Mozilla/5.0 (portfolio video list updater)" },
  });
  if (!res.ok) throw new Error(`Drive folder ${folderId} returned HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes("flip-entries")) throw new Error(`Drive folder ${folderId} did not return a file list`);
  const entry = /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]*)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  const items = [];
  for (const m of html.matchAll(entry)) {
    items.push({ id: m[1], name: decode(m[3]), isFolder: m[2].includes("/drive/folders/") });
  }
  return items;
}

async function videosIn(folderId) {
  const items = await list(folderId);
  let videos = items.filter((i) => !i.isFolder && VIDEO_EXT.test(i.name));
  for (const sub of items.filter((i) => i.isFolder)) videos = videos.concat(await videosIn(sub.id));
  return videos;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const top = (await list(ROOT_FOLDER)).filter((i) => i.isFolder);
const known = new Map(ROWS.map((r, i) => [r.folder, { ...r, order: i }]));
const rows = [];
for (const f of top) {
  const videos = await videosIn(f.id);
  if (!videos.length) continue; // e.g. the Static Samples image folder
  const k = known.get(f.id);
  rows.push({ folder: f.id, name: k ? k.name : titleCase(f.name), order: k ? k.order : ROWS.length + rows.length, videos });
}
rows.sort((a, b) => a.order - b.order);

const total = rows.reduce((n, r) => n + r.videos.length, 0);
const previous = (await readFile(OUTPUT, "utf8").catch(() => "")).match(/^\S{20,} \| /gm)?.length ?? 0;
// Guard against a broken read from Drive wiping the site: refuse to drop more than half the videos.
if (total === 0 || (previous && total < previous / 2)) {
  throw new Error(`Found ${total} videos (previously ${previous}). Not updating videos.js.`);
}

const body = rows.map((r) => `  {
    name: ${JSON.stringify(r.name)},
    folder: ${JSON.stringify(r.folder)},
    videos: \`
${r.videos.map((v) => `${v.id} | ${v.name.replace(/[`\\]/g, "").replace(/\$\{/g, "$ {")}`).join("\n")}
\`
  }`).join(",\n");

const out = `// Portfolio videos, pulled from Google Drive.
// This file is rebuilt automatically from the Drive folder by scripts/update-videos.mjs
// (see .github/workflows/update-videos.yml), so edits made here by hand get replaced.
// To add a video, put it in one of the portfolio's Drive subfolders.
window.PORTFOLIO = [
${body}
];
`;

const current = await readFile(OUTPUT, "utf8").catch(() => "");
if (current.replace(/\r\n/g, "\n") === out) {
  console.log(`No changes. ${total} videos in ${rows.length} rows.`);
} else {
  await writeFile(OUTPUT, out);
  console.log(`Updated videos.js: ${total} videos in ${rows.length} rows (was ${previous}).`);
}
