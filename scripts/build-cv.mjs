// Builds the CV from the site's data: Delgado_CV.pdf, plus the page images and page count on cv.html.
// Run by .github/workflows/cv-build.yml whenever pubs.js, assets/site.js (reviewed journals) or scripts/cv/ change.
//
//   node scripts/build-cv.mjs              PDF + page images + cv.html
//   node scripts/build-cv.mjs --html-only  just scripts/cv/out/*.html (to inspect the layout)
//
// Needs Playwright's Chromium and poppler-utils (pdftoppm, pdftotext). The PDF keeps every line; the page images
// on cv.html come from a second render that leaves out lines marked "site": false (USMLE Step 2).

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CV_DIR = path.join(ROOT, "scripts/cv");
const OUT = path.join(CV_DIR, "out");
const data = JSON.parse(fs.readFileSync(path.join(CV_DIR, "cv-data.json"), "utf8"));

// ---------- data from the site ----------
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "pubs.js"), "utf8"), ctx);
const PUBS = ctx.window.PUBS;
const published = PUBS.filter(p => !p.st || p.st === "pub");
const accepted = PUBS.filter(p => p.st === "acc");
const REV = JSON.parse(/REV = (\[.*?\]);/s.exec(fs.readFileSync(path.join(ROOT, "assets/site.js"), "utf8"))[1])
  .sort((a, b) => a[0].localeCompare(b[0], "en", { sensitivity: "base" }));

// ---------- HTML ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const boldRe = new RegExp(`(${data.boldAuthor.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\*|,|$)`, "g");
const authors = a => esc(a).replace(boldRe, "<b>$1</b>");

function citation(p){
  const t = p.t.trim();
  let s = `${authors(p.a)}. ${esc(t)}${/[.?!]$/.test(t) ? "" : "."} ${esc(p.cj || p.j)}.`;
  if (p.doi) s += ` doi: ${esc(p.doi)}.`;
  if (p.pmid) s += ` PMID: ${p.pmid}${p.pmc ? `; PMCID: ${p.pmc}` : ""}.`;
  return s;
}

const row = (left, right, cls = "") =>
  `<div class="row ${cls}"><span>${left}</span>${right ? `<span class="r">${esc(right)}</span>` : ""}</div>`;

function section(s, forSite){
  let body = "";
  if (s.items) body = s.items.map(it => `<div class="item">`
    + (it.head ? row(`<b>${esc(it.head)}</b>`, it.right) : "")
    + (it.sub ? row(`<i>${esc(it.sub)}</i>`, it.subRight) : "")
    + (it.body ? `<p>${esc(it.body)}</p>` : "") + `</div>`).join("");
  if (s.lines) body = `<div class="lines">` + s.lines.filter(l => !(forSite && l.site === false))
    .map(l => row(esc(l.text), l.right)).join("") + `</div>`;
  if (s.reviewer) body = `<div class="lines">${row(`<i>${esc(s.reviewer)}</i>`)}`
    + REV.map(([j, y]) => row(esc(j), `${y} – Present`)).join("") + `</div>`;
  if (s.selected) body = `<ul class="pubs">` + s.selected.map(n => {
    const p = PUBS.find(x => x.n === n);
    if (!p) throw new Error(`Selected publication ${n} is not in pubs.js`);
    return `<li>${citation(p)}</li>`;
  }).join("") + `</ul>`;
  if (s.publications){
    const list = s.publications === "accepted" ? accepted : published;
    body = (s.note ? `<p class="note">${esc(s.note)}</p>` : "")
      + `<ol class="pubs">` + list.map((p, i) => `<li><span class="num">${i + 1}.</span>${citation(p)}</li>`).join("") + `</ol>`;
  }
  return `<section><h2>${esc(s.title)}</h2>${body}</section>`;
}

function html(forSite){
  const font = (w, st, f) => `@font-face{font-family:Carlito;font-weight:${w};font-style:${st};src:url("${path.join(CV_DIR, "fonts", f)}")}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(data.name)} CV</title><style>
${font(400, "normal", "Carlito-Regular.ttf")}${font(700, "normal", "Carlito-Bold.ttf")}${font(400, "italic", "Carlito-Italic.ttf")}${font(700, "italic", "Carlito-BoldItalic.ttf")}
@page{size:Letter;margin:0.75in}
*{box-sizing:border-box}
body{margin:0;font-family:Carlito;font-size:9.49pt;line-height:1.265;color:#000}
header{text-align:center;margin-bottom:3.8pt}
h1{font-size:15pt;letter-spacing:.06em;margin:0 0 2pt;font-weight:700}
header div{line-height:1.36}
a{color:#1a4f8b}
h2{font-size:10.5pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:8.3pt 0 3pt;padding-bottom:2.5pt;border-bottom:1px solid #000;break-after:avoid}
section:first-of-type h2{margin-top:0}
.row{display:flex;justify-content:space-between;gap:12pt;line-height:1.338}
.row .r{white-space:nowrap}
.item,.lines{padding-left:13pt}
.item{margin-bottom:3.7pt;break-inside:avoid}
.item p{margin:1pt 0 0;line-height:1.222;text-align:justify}
.note{font-style:italic;margin:0 0 4pt}
ol.pubs,ul.pubs{margin:0;padding:0;list-style:none}
.pubs li{position:relative;padding-left:31pt;margin-bottom:4.2pt;line-height:1.222;text-align:justify;break-inside:avoid}
.pubs .num{position:absolute;left:0}
ul.pubs li::before{content:"•";position:absolute;left:17pt}
</style></head><body>
<header><h1>${esc(data.name.toUpperCase())}</h1>
<div>${data.contact.map(esc).join(" &nbsp;•&nbsp; ")}</div>
<div>${data.links.map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(" &nbsp;•&nbsp; ")}</div></header>
${data.sections.map(s => section(s, forSite)).join("\n")}
</body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "cv.html"), html(false));
fs.writeFileSync(path.join(OUT, "cv-site.html"), html(true));
if (process.argv.includes("--html-only")) process.exit(0);

// ---------- PDF ----------
const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function pdf(file, out){
  await page.goto("file://" + path.join(OUT, file));
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, format: "Letter", preferCSSPageSize: true, printBackground: true });
}
const PDF = path.join(ROOT, "Delgado_CV.pdf"), SITE_PDF = path.join(OUT, "cv-site.pdf");
await pdf("cv.html", PDF);
await pdf("cv-site.html", SITE_PDF);
await browser.close();

// ---------- page images and cv.html ----------
const IMG = path.join(ROOT, "img/cv");
for (const f of fs.readdirSync(IMG)) if (/^p\d+\.jpg$/.test(f)) fs.rmSync(path.join(IMG, f));
execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-scale-to-x", "1445", "-scale-to-y", "1870", SITE_PDF, path.join(OUT, "pg")]);
const pages = fs.readdirSync(OUT).filter(f => /^pg-\d+\.jpg$/.test(f)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
pages.forEach((f, i) => fs.renameSync(path.join(OUT, f), path.join(IMG, `p${i + 1}.jpg`)));

// Clickable areas over the page images: the header links on page 1, located with pdftotext -bbox
const bbox = execFileSync("pdftotext", ["-f", "1", "-l", "1", "-bbox", SITE_PDF, "-"]).toString();
const [W, H] = /<page width="([\d.]+)" height="([\d.]+)"/.exec(bbox).slice(1).map(Number);
const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
  .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], w: m[5] }));
const pct = v => (v * 100).toFixed(2) + "%";
const overlays = data.links.map(l => {
  const parts = l.label.split(" "), i = words.findIndex((w, k) => parts.every((p, j) => words[k + j] && words[k + j].w === p));
  if (i < 0) return "";
  const ws = words.slice(i, i + parts.length), x0 = Math.min(...ws.map(w => w.x0)), x1 = Math.max(...ws.map(w => w.x1));
  const y0 = Math.min(...ws.map(w => w.y0)), y1 = Math.max(...ws.map(w => w.y1));
  return `<a class="cv-ln" href="${l.href}" target="_blank" rel="noopener" style="left:${pct(x0 / W)};top:${pct(y0 / H)};width:${pct((x1 - x0) / W)};height:${pct((y1 - y0) / H)}" aria-label="Open link"></a>`;
}).join("");
const n = pages.length;
const doc = `<section aria-label="CV pages" class="cv-doc">` + pages.map((_, i) =>
  `<div class="cv-pg"><img src="img/cv/p${i + 1}.jpg" width="1445" height="1870" alt="CV, page ${i + 1} of ${n}"${i ? ' loading="lazy"' : ""}>${i ? "" : overlays}</div>`).join("") + `</section>`;
const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
const cvPath = path.join(ROOT, "cv.html");
let cvHtml = fs.readFileSync(cvPath, "utf8")
  .replace(/<section aria-label="CV pages" class="cv-doc">.*?<\/section>/s, doc)
  .replace(/\d+ pages · updated [A-Za-z]+ \d{4}/, `${n} pages · updated ${month}`);
fs.writeFileSync(cvPath, cvHtml);
console.log(`CV: ${published.length} published, ${accepted.length} accepted, ${n} pages`);
