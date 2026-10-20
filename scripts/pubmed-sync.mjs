// Weekly PubMed check: finds papers matching the search in pubmed.config.json that are not in
// pubs.js yet, and writes them into pubs.js for review. Run by .github/workflows/pubmed-sync.yml,
// which opens a pull request; merging it publishes the papers (Vercel redeploys).
//
//   node scripts/pubmed-sync.mjs            query PubMed and update pubs.js
//   FIXTURE=file.json node ...              use a saved {esearch, esummary} response (tests)
//
// Accepted papers (st:"acc"), preprints (st:"pre") and in-press papers without a PMID are matched by DOI or title and
// updated in place instead of duplicated. Every PMID proposed once is stored in pubmed-seen.json,
// so a paper deleted from the pull request before merging is not proposed again.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBS_FILE = path.join(ROOT, "pubs.js");
const SEEN_FILE = path.join(ROOT, "scripts/pubmed-seen.json");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/pubmed.config.json"), "utf8"));
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";

// ---------- PubMed ----------
async function eutils(tool, params){
  const q = new URLSearchParams({ db: "pubmed", retmode: "json", tool: "portfolio-pubmed-sync", ...params });
  if (CONFIG.email) q.set("email", CONFIG.email);
  if (process.env.NCBI_API_KEY) q.set("api_key", process.env.NCBI_API_KEY);
  for (let attempt = 1; ; attempt++){
    const r = await fetch(EUTILS + tool + ".fcgi", { method: "POST", body: q });
    if (r.ok) return r.json();
    if (attempt === 4) throw new Error(`${tool}: HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 2000 * attempt));
  }
}

async function loadPubmed(){
  if (process.env.FIXTURE) return JSON.parse(fs.readFileSync(process.env.FIXTURE, "utf8"));
  const esearch = await eutils("esearch", { term: CONFIG.term, retmax: "2000", sort: "pub_date" });
  const ids = esearch.esearchresult.idlist;
  const esummary = { result: { uids: [] } };
  for (let i = 0; i < ids.length; i += 200){
    const part = await eutils("esummary", { id: ids.slice(i, i + 200).join(",") });
    for (const uid of part.result.uids){ esummary.result.uids.push(uid); esummary.result[uid] = part.result[uid]; }
    await new Promise(res => setTimeout(res, 400));   // stay under 3 requests/second without an API key
  }
  return { esearch, esummary };
}

// ---------- PubMed record -> pubs.js entry ----------
const decode = s => String(s || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Same keyword rules as the existing tags; guesses are listed in the pull request for checking
const TAG_RULES = [
  ["robotic", /robot/i],
  ["colorectal", /colorectal|colectomy|colon|rectal|rectum|crohn|haemorrhoid|hemorrhoid|anal fistula|pilonidal|ileocec|ileocolic|abdominoperineal|diverticul/i],
  ["hpb", /cholecyst|gallbladder|choledoch|biliary|pancrea|hepat|liver/i],
  ["vascular", /aneurysm|carotid|aort|vascular|limb-threatening|ischemi|venous|vena cava|endovascular/i],
  ["thoracic", /thorac|lung|pleura|mesothelioma|pectus|nuss|esophag|oesophag|mediastin/i],
  ["bariatric", /bariatric|gastric bypass|sleeve gastrectomy|obesity|roux-en-y/i],
  ["plastic", /plastic|aesthetic|breast reconstruction|flap|rhinoplasty|turbinate|microtia|facial/i],
  ["pediatric", /pediatric|paediatric|children|infant|neonat/i],
  ["tsa", /trial sequential/i],
  ["single", /single-arm|of proportions|proportional meta/i],
  ["bayes", /bayesian/i],
  ["ipd", /individual patient data|individual participant data|reconstructed (individual|patient)/i],
  ["dose", /dose-response/i],
];
const LETTER_TYPES = /letter|comment|editorial|reply|visual abstract/i;

function toEntry(rec){
  const ids = Object.fromEntries((rec.articleids || []).map(x => [x.idtype, x.value]));
  const authors = (rec.authors || []).filter(a => a.authtype === "Author").map(a => a.name);
  const title = decode(rec.title).replace(/\.$/, "");
  const year = Number((rec.sortpubdate || rec.pubdate || rec.epubdate || "").slice(0, 4)) || new Date().getFullYear();
  let j = `${decode(rec.source)}. ${year}`;
  if (rec.volume) j += `;${rec.volume}${rec.issue ? `(${rec.issue})` : ""}${rec.pages ? `:${rec.pages}` : ""}`;
  const isLetter = (rec.pubtype || []).some(t => LETTER_TYPES.test(t)) || /^(reply|response|comment on|asO visual abstract)/i.test(title);
  const tags = TAG_RULES.filter(([, re]) => re.test(title)).map(([t]) => t);
  if (isLetter) tags.push("letter");
  const e = {};
  if (/^(Monteiro Delgado L|Delgado L)/.test(authors[0] || "")) e.f = 1;
  Object.assign(e, { a: authors.join(", "), t: title, j, y: year });
  if (ids.doi) e.doi = ids.doi;
  e.pmid = String(rec.uid);
  if (ids.pmc) e.pmc = ids.pmc;
  e.tags = tags;
  return e;
}

// ---------- pubs.js ----------
const KEY_ORDER = ["n", "f", "st", "a", "t", "j", "y", "doi", "pmid", "pmc", "oa", "emb", "pdf", "tags", "award"];
function serialize(e){
  const keys = [...KEY_ORDER.filter(k => k in e), ...Object.keys(e).filter(k => !KEY_ORDER.includes(k))];
  return "{" + keys.map(k => `${k}:${JSON.stringify(e[k])}`).join(",") + "}";
}
const normTitle = t => String(t).toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function similar(a, b){
  const A = new Set(normTitle(a).split(" ")), B = new Set(normTitle(b).split(" "));
  const inter = [...A].filter(w => B.has(w)).length;
  return inter / new Set([...A, ...B]).size;
}

function main(pm){
  const src = fs.readFileSync(PUBS_FILE, "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  const pubs = ctx.window.PUBS;
  const lines = src.split("\n");
  const lineOf = n => lines.findIndex(l => l.startsWith(`{n:${JSON.stringify(n)},`));
  if (pubs.some(p => lineOf(p.n) < 0)) throw new Error("pubs.js: every entry must start a line with {n:...,");

  const seen = new Set(fs.existsSync(SEEN_FILE) ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")) : []);
  const excluded = new Set((process.env.EXCLUDE_PMIDS || "").split(/[,\s]+/).filter(Boolean));
  const known = new Set(pubs.map(p => p.pmid).filter(Boolean));
  const ids = pm.esearch.esearchresult.idlist.map(String);
  const fresh = ids.filter(id => !known.has(id) && !seen.has(id) && !excluded.has(id) && pm.esummary.result[id]);

  const added = [], updated = [];
  let nextN = Math.max(0, ...pubs.map(p => p.n).filter(n => typeof n === "number")) + 1;
  const top = [];   // new and newly published lines, placed at the top (newest first)
  for (const id of fresh){
    const e = toEntry(pm.esummary.result[id]);
    const match = pubs.find(p => !p.pmid && (
      (p.doi && e.doi && p.doi.toLowerCase() === e.doi.toLowerCase()) || similar(p.t, e.t) >= 0.85));
    if (match){
      // Keep the hand-written fields (authors with *, tags, PDF, award); take PubMed's citation and IDs
      const was = { acc: "Accepted → published", pre: "Preprint → published" }[match.st] || "PMID added";
      // A preprint's DOI is the preprint server's; the journal version replaces it (and its hosted PDF)
      if (match.st === "pre"){ delete match.doi; delete match.pdf; delete match.oa; }
      const u = { ...match, j: e.j, y: e.y, pmid: e.pmid, ...(e.doi && !match.doi && { doi: e.doi }), ...(e.pmc && !match.pmc && { pmc: e.pmc }) };
      delete u.st;
      const i = lineOf(match.n);
      if (match.st === "acc" || match.st === "pre"){ lines[i] = null; top.push(serialize(u)); }
      else lines[i] = serialize(u);
      match.pmid = e.pmid;
      updated.push({ ...u, was });
    } else {
      const entry = { n: nextN++, ...e };
      top.push(serialize(entry));
      added.push(entry);
    }
  }
  if (!added.length && !updated.length){ console.log("No new PubMed records."); return; }

  const start = lines.findIndex(l => l.startsWith("window.PUBS = ["));
  let out = [...lines.slice(0, start + 1), ...top, ...lines.slice(start + 1)].filter(l => l !== null);
  // One comma after every entry except the last
  const entryIdx = out.map((l, i) => l.startsWith("{n:") ? i : -1).filter(i => i >= 0);
  entryIdx.forEach((i, k) => { out[i] = out[i].replace(/,?\s*$/, k === entryIdx.length - 1 ? "" : ","); });
  fs.writeFileSync(PUBS_FILE, out.join("\n"));
  fresh.forEach(id => seen.add(id));
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen].sort(), null, 0).replace(/,/g, ",\n ") + "\n");

  // Pull request text
  const link = p => `[PubMed ${p.pmid}](https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/)` + (p.doi ? ` · [DOI](https://doi.org/${p.doi})` : "");
  const md = [`PubMed found ${fresh.length} new record${fresh.length > 1 ? "s" : ""} for your search. **Merge to publish them on the site.**`, ""];
  if (added.length){
    md.push("### New papers", "");
    added.forEach(p => md.push(`- [ ] **${p.t}**  `, `  ${p.a}  `, `  *${p.j}* · ${link(p)}  `,
      `  Tags (guessed): ${p.tags.length ? p.tags.map(t => "`" + t + "`").join(" ") : "none"}${p.f ? " · first author" : ""}`, ""));
  }
  if (updated.length){
    md.push("### Papers already on the site, now indexed", "");
    updated.forEach(p => md.push(`- [ ] **${p.t}** (${p.was})  `, `  *${p.j}* · ${link(p)}`, ""));
  }
  md.push("---", "**Not yours, or wrong?** In *Files changed*, edit `pubs.js` and delete that paper's line before merging; it will not be proposed again. Closing this pull request rejects all of them.",
    "Check before merging: co-first authors (add `*` after the names), tags, and `oa:1` for open-access papers.",
    "", `<!-- pmids: ${fresh.join(",")} -->`);
  if (process.env.SUMMARY_FILE) fs.writeFileSync(process.env.SUMMARY_FILE, md.join("\n") + "\n");
  console.log(`Added ${added.length}, updated ${updated.length}: ${fresh.join(", ")}`);
}

main(await loadPubmed());
