/* 抓取各党建、理论学习网站首页上的文章标题和链接，生成 feed.json。
   只收标题、链接、日期、来源，不收正文。某个网站这次没抓到，就保留它上次的条目。
   用法：node fetch.js   （Node 20 以上，不依赖第三方库） */
const fs = require("fs");

const SOURCES = [
  { id: "qstheory", name: "求是网", home: "https://www.qstheory.cn/", re: /qstheory\.cn\/(20\d{2})(\d{2})(\d{2})\/[0-9a-f]{20,}\/c\.html/ },
  { id: "12371", name: "共产党员网", home: "https://www.12371.cn/", re: /12371\.cn\/(20\d{2})\/(\d{2})\/(\d{2})\/ARTI\d+\.shtml/ },
  { id: "theory", name: "人民网·理论", home: "http://theory.people.com.cn/", re: /people\.com\.cn\/n1\/(20\d{2})\/(\d{2})(\d{2})\/c\d+-\d+\.html/ },
  { id: "dangjian", name: "人民网·党建", home: "http://dangjian.people.com.cn/", re: /people\.com\.cn\/n1\/(20\d{2})\/(\d{2})(\d{2})\/c\d+-\d+\.html/ },
  { id: "opinion", name: "人民网·观点", home: "http://opinion.people.com.cn/", re: /people\.com\.cn\/n1\/(20\d{2})\/(\d{2})(\d{2})\/c\d+-\d+\.html/ }
];
const KEEP_DAYS = 60, PER_SOURCE = 40, OUT = "feed.json";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const unescape = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
  .replace(/&middot;/g, "·").replace(/&mdash;/g, "—").replace(/&hellip;/g, "…").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const clean = s => unescape(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

async function getPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 3000).toString("latin1");
  const gb = /charset=["']?gb/i.test(head) || /charset=["']?gb/i.test(res.headers.get("content-type") || "");
  return new TextDecoder(gb ? "gb18030" : "utf-8").decode(buf);
}
function extract(src, html) {
  const byUrl = new Map();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (/href\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    if (!href) continue;
    let url;
    try { url = new URL(href, src.home).href; } catch (e) { continue; }
    const d = src.re.exec(url);
    if (!d) continue;
    const attr = clean((/title\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1]);
    let t = clean(m[2]);
    if (attr.length > t.length || /…$|\.\.\.$/.test(t)) t = attr || t;
    if (t.length < 8 || t.length > 90 || !/[一-龥]{4}/.test(t)) continue;
    const old = byUrl.get(url);
    if (!old || t.length > old.t.length) byUrl.set(url, { t, u: url, d: `${d[1]}-${d[2]}-${d[3]}`, s: src.id });
  }
  return [...byUrl.values()];
}

(async () => {
  let prev = { items: [] };
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);   // 北京时间的今天
  const items = [], sources = [];
  for (const src of SOURCES) {
    const old = (prev.items || []).filter(x => x.s === src.id);
    let got = [], err = "";
    try { got = extract(src, await getPage(src.home)); if (!got.length) err = "没有认出文章链接"; }
    catch (e) { err = String(e.message || e).slice(0, 120); }
    const byUrl = new Map(old.map(x => [x.u, x]));
    got.forEach(x => byUrl.set(x.u, x));
    const list = [...byUrl.values()].filter(x => x.d >= cutoff && x.d <= today).sort((a, b) => b.d.localeCompare(a.d)).slice(0, PER_SOURCE);
    items.push(...list);
    sources.push({ id: src.id, name: src.name, home: src.home, ok: !err, got: got.length, count: list.length, ...(err ? { err } : {}) });
    console.log(`${src.name}：本次 ${got.length} 条，保留 ${list.length} 条${err ? "（" + err + "）" : ""}`);
  }
  if (!items.length) { console.error("一条也没有抓到，不写文件"); process.exit(1); }
  const same = JSON.stringify(prev.items || []) === JSON.stringify(items);
  const out = { app: "dangjian-study-feed", ver: 1, updated: same && prev.updated ? prev.updated : new Date().toISOString(), checked: new Date().toISOString(), sources, items };
  if (same && sources.every(s => s.ok)) { console.log("没有新文章，文件不变"); return; }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(`已写入 ${OUT}：${items.length} 条`);
})();
