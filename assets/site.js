/* Shared behaviour for every page. Each block runs only if its target elements exist on the page. */
(function(){
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- Configuration ---------- */
const CONFIG = {
  // Google Apps Script web-app URL that emails the PDF with a thank-you note.
  // Leave empty and the site falls back to a pre-filled email to OWNER_EMAIL.
  REQUEST_ENDPOINT: "",
  OWNER_EMAIL: "ldelgado@ufmg.br",
};

/* ---------- Sticky offsets: the section menu sits right under the header, whatever its height ---------- */
(function(){
  const h = document.querySelector("header.top"); if (!h) return;
  const set = () => document.documentElement.style.setProperty("--hdr", h.offsetHeight + "px");
  set(); addEventListener("resize", set); if (document.fonts) document.fonts.ready.then(set);
})();

/* ---------- Section menu: highlight the section being read ---------- */
(function(){
  const links = [...document.querySelectorAll(".subnav a[href^='#']")]; if (!links.length) return;
  const secs = links.map(a => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
  const hdr = () => (document.querySelector("header.top")?.offsetHeight || 72) + (document.querySelector(".subnav")?.offsetHeight || 50) + 24;
  function update(){
    const y = hdr(); let cur = secs[0];
    for (const s of secs) if (s.getBoundingClientRect().top - y <= 0) cur = s;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) cur = secs[secs.length - 1];
    links.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + cur.id));
  }
  addEventListener("scroll", update, {passive: true}); addEventListener("resize", update); update();
})();

/* ---------- Overlay markup, injected once ---------- */
document.body.insertAdjacentHTML("beforeend", `
<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Enlarged image"><button type="button" id="lb-close">Close</button><img id="lb-img" alt=""></div>
<div class="deck" id="deck" hidden role="dialog" aria-modal="true" aria-labelledby="deck-t">
  <button type="button" class="x" id="deck-x">Close</button>
  <figure><img id="deck-img" alt=""><figcaption><b id="deck-t"></b><span class="ctrls"><button type="button" id="deck-prev">Previous</button><span class="count" id="deck-c"></span><button type="button" id="deck-next">Next</button></span></figcaption></figure>
</div>
<div class="overlay" id="ov" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
    <div id="dlg-form">
      <h3 id="dlg-t">Request the full text</h3>
      <p class="paper" id="dlg-paper"></p>
      <form id="reqform" novalidate>
        <div class="field"><label for="r-name">Your name</label><input id="r-name" autocomplete="name" required></div>
        <div class="field"><label for="r-email">Email</label><input id="r-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="r-inst">Institution (optional)</label><input id="r-inst" autocomplete="organization"></div>
        <div class="field"><label for="r-msg">Message (optional)</label><textarea id="r-msg" rows="3"></textarea></div>
        <div class="err" id="r-err"></div>
        <div class="row"><button type="button" class="btn ghost" id="r-cancel">Cancel</button><button type="submit" class="btn" id="r-send">Send request</button></div>
      </form>
    </div>
    <div id="dlg-done" hidden>
      <h3 id="done-t">Request sent</h3>
      <p id="done-p"></p>
      <div id="done-fallback" hidden>
        <div class="copybox" id="fb-text"></div>
        <div class="row"><button type="button" class="btn ghost" id="fb-copy">Copy request</button><a class="btn" id="fb-mail" href="#">Open in email</a></div>
      </div>
      <div class="row"><button type="button" class="btn ghost" id="d-close">Close</button></div>
    </div>
  </div>
</div>`);

/* ---------- Lightbox: journal cover, award photos, posters; data-gallery="a.jpg|b.jpg" adds paging ---------- */
(function(){
  const lb = $("lightbox"), img = $("lb-img"); let last = null, set = [], k = 0, alts = [];
  lb.insertAdjacentHTML("beforeend", '<div class="lb-pager" hidden><button type="button" id="lb-prev">Previous</button><span id="lb-cap"></span><button type="button" id="lb-next">Next</button></div>');
  const pager = lb.querySelector(".lb-pager");
  function show(){ img.src = set[k]; img.alt = alts[k] || ""; pager.hidden = set.length < 2; $("lb-cap").textContent = alts[k] ? alts[k] : `${k + 1} / ${set.length}`; }
  function open(list, altList){ last = document.activeElement; set = list; alts = altList; k = 0; show(); lb.hidden = false; $("lb-close").focus(); }
  function close(){ lb.hidden = true; img.removeAttribute("src"); if (last) last.focus(); }
  const step = d => { if (set.length > 1){ k = (k + d + set.length) % set.length; show(); } };
  document.addEventListener("click", e => {
    const z = e.target.closest(".zoomable");
    if (z){ const i = z.querySelector("img");
      if (z.dataset.gallery) open(z.dataset.gallery.split("|"), (z.dataset.alts || "").split("|"));
      else open([z.dataset.full || i.src], [z.dataset.alt || (i && i.alt) || ""]);
      return; }
    const p = e.target.closest(".photo img"); if (p) open([p.src], [p.alt]);
  });
  lb.addEventListener("click", e => {
    if (e.target.id === "lb-prev"){ e.stopPropagation(); step(-1); return; }
    if (e.target.id === "lb-next"){ e.stopPropagation(); step(1); return; }
    if (e.target.closest(".lb-pager")) { e.stopPropagation(); return; }
    close();
  });
  document.addEventListener("keydown", e => { if (lb.hidden) return;
    if (e.key === "Escape") close(); else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); });
})();

/* ---------- Slide viewer: decks are pre-rendered images in slides/<id>/NN.jpg ---------- */
(function(){
  const box = $("deck"), img = $("deck-img"), c = $("deck-c"), t = $("deck-t"), prev = $("deck-prev"), next = $("deck-next");
  let id = null, n = 0, i = 1, last = null, x0 = null;
  const pad = k => String(k).padStart(2, "0");
  function show(){
    img.src = `slides/${id}/${pad(i)}.jpg`; img.alt = `Slide ${i} of ${n}`; c.textContent = `${i} / ${n}`;
    prev.disabled = i <= 1; next.disabled = i >= n;
    if (i < n){ const pre = new Image(); pre.src = `slides/${id}/${pad(i + 1)}.jpg`; }
  }
  function open(b){
    last = b; id = b.dataset.deck; n = +b.dataset.n; i = 1;
    const li = b.closest("li,article"); const tt = li && li.querySelector(".pt,h3"); t.textContent = b.dataset.title || (tt ? tt.textContent : "Slides");
    box.hidden = false; show(); next.focus();
  }
  function close(){ box.hidden = true; img.removeAttribute("src"); if (last) last.focus(); }
  document.addEventListener("click", e => { const b = e.target.closest(".deck-btn"); if (b){ e.preventDefault(); open(b); } });
  prev.addEventListener("click", () => { if (i > 1){ i--; show(); } });
  next.addEventListener("click", () => { if (i < n){ i++; show(); } });
  $("deck-x").addEventListener("click", close);
  box.addEventListener("click", e => { if (e.target === box) close(); });
  document.addEventListener("keydown", e => {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" && i < n){ i++; show(); }
    else if (e.key === "ArrowLeft" && i > 1){ i--; show(); }
  });
  img.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, {passive: true});
  img.addEventListener("touchend", e => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -40 && i < n){ i++; show(); } else if (dx > 40 && i > 1){ i--; show(); }
  });
})();

/* ---------- Publications ---------- */
const PUBS = window.PUBS || [];
const published = PUBS.filter(p => p.st !== "acc" && p.st !== "pre");
const LABEL = new Map();   // display numbers follow list order (newest first)
published.forEach((p, i) => LABEL.set(p, String(i + 1).padStart(2, "0")));
PUBS.filter(p => p.st === "acc").forEach((p, i) => LABEL.set(p, "A" + (i + 1)));
PUBS.filter(p => p.st === "pre").forEach((p, i) => LABEL.set(p, "P" + (i + 1)));
const hiAuthors = a => esc(a).replace(/(Monteiro Delgado L|Delgado LM)(\*?)/g, "<strong>$1$2</strong>");

// Research-group counts: papers co-authored with each group's mentors (published only; first author over all)
document.querySelectorAll("[data-grp],[data-grp-f]").forEach(el => {
  const re = new RegExp(el.dataset.grp || el.dataset.grpF, "i");
  const n = el.dataset.grp ? published.filter(p => re.test(p.a)).length : PUBS.filter(p => p.f && re.test(p.a)).length;
  if (PUBS.length) el.textContent = n;
});
document.querySelectorAll("[data-count]").forEach(el => {
  const k = el.dataset.count;
  // Counts are original articles; letters, replies and visual abstracts (tag "letter") are counted apart
  const isArt = p => !p.tags.includes("letter");
  // "pub" counts everything published (articles, letters and the visual abstract), as in the CV
  const n = { pub: published.length, acc: PUBS.filter(p => p.st === "acc").length, pre: PUBS.filter(p => p.st === "pre").length,
              letters: PUBS.filter(p => !isArt(p)).length, first: PUBS.filter(p => p.f).length,
              all: PUBS.filter(isArt).length }[k];
  if (n !== undefined) el.textContent = n;
});

function pubItem(p, num, why){
  const links = [];
  // Free full text: hosted PDF (open-access licence) > PMC > publisher page
  if (p.pdf) links.push(`<a class="ft" href="${p.pdf}" target="_blank" rel="noopener">Full text PDF</a>`);
  else if (p.oa && p.pmc) links.push(`<a class="ft" href="https://pmc.ncbi.nlm.nih.gov/articles/${p.pmc}/" target="_blank" rel="noopener">Free full text</a>`);
  else if (p.oa && p.doi) links.push(`<a class="ft" href="https://doi.org/${p.doi}" target="_blank" rel="noopener">Free full text</a>`);
  if (p.doi) links.push(`<a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">DOI</a>`);
  if (p.pmid) links.push(`<a href="https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/" target="_blank" rel="noopener">PubMed</a>`);
  if (!p.oa) links.push(`<button type="button" class="req" data-n="${esc(p.n)}">Request full text</button>`);
  // Embargoed papers (e.g. PMC release after 12 months): say when the free version arrives
  if (p.emb) links.push(`<span class="tagemb">Free on PMC from ${esc(p.emb)}</span>`);
  const badges = (p.f ? `<span class="tagfirst">${/\*/.test(p.a.split(",").slice(0, 2).join(",")) ? "Co-first author" : "First author"}</span>` : "")
    + (p.award ? `<span class="tagaward">${esc(p.award)}</span>` : "")
    + (p.st === "acc" ? `<span class="tagaward">Accepted</span>` : "")
    + (p.st === "pre" ? `<span class="tagaward" title="Not yet peer reviewed">Preprint</span>` : "");
  return `<li class="pub"><span class="num">${num}</span><div class="body">
    <p class="ttl">${esc(p.t)}</p><p class="au">${hiAuthors(p.a)}</p><p class="jr">${esc(p.j)}</p>
    ${why ? `<p class="why">${esc(why)}</p>` : ""}<div class="acts">${badges}${links.join("")}</div></div></li>`;
}

const selEl = $("pubs-sel");
if (selEl){
  const picks = JSON.parse(selEl.dataset.picks);   // [[n, why], ...]
  let k = 0;   // entries ["h", label] are group headings; numbering runs across groups
  selEl.innerHTML = picks.map(([n, why]) => {
    if (n === "h") return `<li class="sel-h">${esc(why)}</li>`;
    const p = PUBS.find(x => x.n === n); return p ? pubItem(p, String(++k).padStart(2, "0"), why) : "";
  }).join("");
}

const listEl = $("pubs");
if (listEl){
  const ADV = ["bayes", "tsa", "ipd", "dose", "single"];
  let filter = "all", query = "";
  const match = p => {
    if (filter === "first" && !p.f) return false;
    if (filter === "acc" && p.st !== "acc") return false;
    if (filter === "pre" && p.st !== "pre") return false;
    if (filter === "robotic" && !p.tags.includes("robotic")) return false;
    if (filter === "plastic" && !p.tags.includes("plastic")) return false;
    if (filter === "adv" && !p.tags.some(t => ADV.includes(t))) return false;
    if (filter === "oa" && !p.oa) return false;
    if (query){ const hay = (p.t + " " + p.j + " " + p.a).toLowerCase(); if (!query.split(/\s+/).every(w => hay.includes(w))) return false; }
    return true;
  };
  const render = () => {
    const list = PUBS.filter(match);
    listEl.innerHTML = list.length ? list.map(p => pubItem(p, LABEL.get(p))).join("") : `<li class="empty">No publications match. Try a broader search or another filter.</li>`;
    $("count").textContent = `${list.length} of ${PUBS.length}`;
  };
  document.querySelectorAll(".filt").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.f;
    document.querySelectorAll(".filt").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    render();
  }));
  $("q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
  render();
}

/* ---------- Peer review list ---------- */
const revEl = $("reviews");
if (revEl){
  const REV = [["BMC Anesthesiology",2026],["BMC Cancer",2026],["BMC Digital Health",2026],["BMC Gastroenterology",2024],["BMC Medical Education",2026],["BMC Musculoskeletal Disorders",2026],["BMC Pharmacology and Toxicology",2026],["BMC Surgery",2024],["Colorectal Disease",2026],["Digestive Diseases and Sciences",2025],["Egyptian Liver Journal",2026],["Health Science Reports",2026],["Hepatobiliary Surgery and Nutrition",2026],["International Journal of Medical Robotics and Computer Assisted Surgery",2026],["International Journal of Colorectal Disease",2025],["Journal of Gastrointestinal Cancer",2025],["Journal of Obesity",2026],["Journal of Robotic Surgery",2024],["Journal of Thoracic Disease",2026],["Langenbeck's Archives of Surgery",2025],["Neurosurgical Review",2025],["Obesity Surgery",2025],["Perioperative Medicine",2025],["SN Comprehensive Clinical Medicine",2026],["Scientific Reports",2026],["Systematic Reviews",2026],["Arab Journal of Gastroenterology",2026],["Techniques in Coloproctology",2026],["Tropical Medicine and Health",2026],["World Journal of Surgery",2025],["World Journal of Surgical Oncology",2025]];
  // Impact factor (Clarivate JCR) per journal; fill in as numbers, the list sorts by it. Missing = no IF shown.
  const IF = {"BMC Anesthesiology": 3.2, "BMC Cancer": 4.1, "BMC Gastroenterology": 3.2, "BMC Medical Education": 4.2, "BMC Musculoskeletal Disorders": 2.8, "BMC Pharmacology and Toxicology": 3.5, "BMC Surgery": 2.4, "Colorectal Disease": 2.3, "Digestive Diseases and Sciences": 2.8, "Egyptian Liver Journal": 1.4, "Health Science Reports": 2.9, "Hepatobiliary Surgery and Nutrition": 8.1, "International Journal of Colorectal Disease": 2.9, "Journal of Gastrointestinal Cancer": 2.2, "Journal of Obesity": 4.1, "Journal of Robotic Surgery": 4.2, "Journal of Thoracic Disease": 2.3, "Langenbeck's Archives of Surgery": 2.2, "Neurosurgical Review": 2.8, "Obesity Surgery": 3.4, "Perioperative Medicine": 2.5, "Systematic Reviews": 5.7, "Techniques in Coloproctology": 2.6, "World Journal of Surgery": 2.2, "World Journal of Surgical Oncology": 2.8, "Scientific Reports": 4.9, "Tropical Medicine and Health": 3.9, "International Journal of Medical Robotics and Computer Assisted Surgery": 2.4, "Arab Journal of Gastroenterology": 1.3, "BMC Digital Health": 3.2};   // 2025 JIF (JCR 2026), supplied by L.M.D.; journals without a JIF are omitted
  // Reviewer certificates (Springer Nature, AME; AME manuscript IDs greyed out), one image per certificate: n = manuscripts reviewed that year
  const CERTS = {"BMC Gastroenterology": [{"n": 11, "yr": 2025, "img": "img/certs/bmc-gastroenterology-2025-september.jpg"}, {"n": 5, "yr": 2026, "img": "img/certs/bmc-gastroenterology-2026-august.jpg"}], "Scientific Reports": [{"n": 1, "yr": 2026, "img": "img/certs/scientific-reports-2026-september.jpg"}], "Techniques in Coloproctology": [{"n": 3, "yr": 2026, "img": "img/certs/techniques-in-coloproctology-2026-august.jpg"}], "Obesity Surgery": [{"n": 1, "yr": 2025, "img": "img/certs/obesity-surgery-2025-may.jpg"}, {"n": 2, "yr": 2026, "img": "img/certs/obesity-surgery-2026-september.jpg"}], "BMC Anesthesiology": [{"n": 1, "yr": 2026, "img": "img/certs/bmc-anesthesiology-2026-july.jpg"}], "Digestive Diseases and Sciences": [{"n": 3, "yr": 2025, "img": "img/certs/digestive-diseases-and-sciences-2025-september.jpg"}, {"n": 1, "yr": 2026, "img": "img/certs/digestive-diseases-and-sciences-2026-april.jpg"}], "Journal of Robotic Surgery": [{"n": 4, "yr": 2025, "img": "img/certs/journal-of-robotic-surgery-2025-march.jpg"}, {"n": 2, "yr": 2026, "img": "img/certs/journal-of-robotic-surgery-2026-april.jpg"}], "Perioperative Medicine": [{"n": 1, "yr": 2025, "img": "img/certs/perioperative-medicine-2025-march.jpg"}], "BMC Digital Health": [{"n": 1, "yr": 2026, "img": "img/certs/bmc-digital-health-2026-may.jpg"}], "BMC Surgery": [{"n": 7, "yr": 2025, "img": "img/certs/bmc-surgery-2025-december.jpg"}, {"n": 11, "yr": 2026, "img": "img/certs/bmc-surgery-2026-september.jpg"}], "Systematic Reviews": [{"n": 1, "yr": 2026, "img": "img/certs/systematic-reviews-2026-march.jpg"}], "BMC Musculoskeletal Disorders": [{"n": 1, "yr": 2026, "img": "img/certs/bmc-musculoskeletal-disorders-2026-august.jpg"}], "BMC Pharmacology and Toxicology": [{"n": 1, "yr": 2026, "img": "img/certs/bmc-pharmacology-and-toxicology-2026-july.jpg"}], "World Journal of Surgical Oncology": [{"n": 1, "yr": 2025, "img": "img/certs/world-journal-of-surgical-oncology-2025-april.jpg"}, {"n": 3, "yr": 2026, "img": "img/certs/world-journal-of-surgical-oncology-2026-july.jpg"}], "International Journal of Colorectal Disease": [{"n": 3, "yr": 2025, "img": "img/certs/international-journal-of-colorectal-disease-2025-june.jpg"}, {"n": 2, "yr": 2026, "img": "img/certs/international-journal-of-colorectal-disease-2026-september.jpg"}], "BMC Medical Education": [{"n": 1, "yr": 2026, "img": "img/certs/bmc-medical-education-2026-august.jpg"}], "BMC Cancer": [{"n": 1, "yr": 2026, "img": "img/certs/bmc-cancer-2026-april.jpg"}], "Langenbeck's Archives of Surgery": [{"n": 2, "yr": 2025, "img": "img/certs/langenbeck-s-archives-of-surgery-2025-april.jpg"}, {"n": 2, "yr": 2026, "img": "img/certs/langenbeck-s-archives-of-surgery-2026-august.jpg"}], "Journal of Gastrointestinal Cancer": [{"n": 3, "yr": 2025, "img": "img/certs/journal-of-gastrointestinal-cancer-2025-september.jpg"}], "SN Comprehensive Clinical Medicine": [{"n": 1, "yr": 2026, "img": "img/certs/sn-comprehensive-clinical-medicine-2026-october.jpg"}], "Tropical Medicine and Health": [{"n": 1, "yr": 2026, "img": "img/certs/tropical-medicine-and-health-2026-september.jpg"}], "Egyptian Liver Journal": [{"n": 1, "yr": 2026, "img": "img/certs/egyptian-liver-journal-2026-august.jpg"}], "Neurosurgical Review": [{"n": 1, "yr": 2025, "img": "img/certs/neurosurgical-review-2025-april.jpg"}], "Hepatobiliary Surgery and Nutrition": [{"n": 1, "yr": 2026, "img": "img/certs/hepatobiliary-surgery-and-nutrition-2026-august.jpg"}], "Journal of Thoracic Disease": [{"n": 1, "yr": 2026, "img": "img/certs/journal-of-thoracic-disease-2026-june.jpg"}, {"n": 1, "yr": 2026, "img": "img/certs/journal-of-thoracic-disease-2026-september.jpg"}]};
  // Wiley journals issue no certificate: counts come from the reviewer dashboard (Wiley Research Exchange Review).
  // Only the number of manuscripts is shown; titles, authors and IDs stay confidential.
  const WILEY = {"World Journal of Surgery":3,"Journal of Obesity":2,"Health Science Reports":1,"Colorectal Disease":1,"International Journal of Medical Robotics and Computer Assisted Surgery":1,"Arab Journal of Gastroenterology":1};
  const PLATFORM = {"Arab Journal of Gastroenterology":"Editorial Manager"};   // default: Wiley Research Exchange
  // "since" = earliest year with a record (certificate, or 2026 for the Wiley dashboard), so it never predates the evidence
  const firstYear = (j, y) => { const ys = (CERTS[j] || []).map(c => c.yr).concat(WILEY[j] ? [2026] : []); return ys.length ? Math.min(...ys) : y; };
  const rows = REV.map(([j, y]) => ({ j, y: firstYear(j, y), f: IF[j], c: CERTS[j] || [], w: WILEY[j] || 0 })).sort((a, b) => (b.f ?? -1) - (a.f ?? -1) || a.j.localeCompare(b.j));
  revEl.innerHTML = `<li class="rh"><span></span><span>Journal</span><span class="rf"><a href="https://jcr.clarivate.com/jcr/home" target="_blank" rel="noopener" title="Search journals in Clarivate Journal Citation Reports"><span class="lg">Impact factor <span class="nw">(JCR)&nbsp;↗</span></span><span class="sm">IF ↗</span></a></span><span class="rm"><span class="lg">Manuscripts reviewed</span><span class="sm">Ms</span></span><span class="rc">Reviewer certificate</span></li>` + rows.map((r, i) => {
    const total = r.c.reduce((s, c) => s + c.n, 0) + r.w;
    const pf = PLATFORM[r.j] || "Wiley";
    const wiley = r.w ? `<span class="rec" title="${pf === "Wiley" ? "Reviewer record in the Wiley Research Exchange dashboard; Wiley journals do not issue certificates" : "Completed review listed in the journal's " + pf + " reviewer account; no certificate issued"}">${pf === "Wiley" ? "Wiley" : "EM"} record</span>` : "";
    // one button per year; several certificates in the same year open as a gallery, each captioned with its month
    const years = [...new Set(r.c.map(c => c.yr))];
    const mon = c => { const m = (c.img.match(/-(\w+)(?:-\d)?\.jpg$/) || ["", ""])[1]; return m.charAt(0).toUpperCase() + m.slice(1); };
    const cert = wiley + years.map(yr => {
      const cs = r.c.filter(c => c.yr === yr), n = cs.reduce((s, c) => s + c.n, 0);
      const alts = cs.map((c, i) => `${esc(r.j)} · ${mon(c)} ${yr} · ${c.n} manuscript${c.n > 1 ? "s" : ""}${cs.length > 1 ? ` · certificate ${i + 1} of ${cs.length}` : ""}`);
      return `<button type="button" class="cert zoomable" data-gallery="${cs.map(c => c.img).join("|")}" data-alts="${alts.join("|")}" aria-label="View ${yr} reviewer certificate${cs.length > 1 ? "s" : ""} for ${esc(r.j)}"><svg viewBox="0 0 12 14" aria-hidden="true"><path d="M1 1h7l3 3v9H1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 7h6M3 9.5h6" stroke="currentColor" stroke-width="1.1"/></svg>${yr}${cs.length > 1 ? ` ×${cs.length}` : ""}</button>`;
    }).join("");
    return `<li><span class="rn">${String(i + 1).padStart(2, "0")}</span><span class="rj">${esc(r.j)}</span>`
      + `<span class="rf">${r.f != null ? `<b>${r.f.toFixed(1)}</b>` : `<i>–</i>`}</span><span class="rm">${total || "–"}</span><span class="rc">${cert}</span></li>`;
  }).join("");
  const rc = $("n-rev"); if (rc) rc.textContent = REV.length;
}

/* ---------- Full-text request ---------- */
(function(){
  const ov = $("ov"); let current = null, lastFocus = null;
  function openReq(p){
    current = p; lastFocus = document.activeElement;
    $("dlg-paper").textContent = `${p.t}. ${p.j}.`;
    $("dlg-form").hidden = false; $("dlg-done").hidden = true; $("r-err").textContent = "";
    ov.hidden = false; $("r-name").focus();
  }
  function closeReq(){ ov.hidden = true; if (lastFocus) lastFocus.focus(); }
  document.addEventListener("click", e => {
    const b = e.target.closest(".req"); if (!b) return;
    const p = PUBS.find(x => String(x.n) === b.dataset.n); if (p) openReq(p);
  });
  $("r-cancel").addEventListener("click", closeReq);
  $("d-close").addEventListener("click", closeReq);
  ov.addEventListener("click", e => { if (e.target === ov) closeReq(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !ov.hidden) closeReq(); });

  const done = (t, p, fallback) => {
    $("dlg-form").hidden = true; $("dlg-done").hidden = false;
    $("done-t").textContent = t; $("done-p").textContent = p; $("done-fallback").hidden = !fallback; $("d-close").focus();
  };
  function showFallback(pl){
    const body = `Dear Dr. Delgado,\n\nI would like to request the full text of:\n"${pl.title}"\n${pl.journal}${pl.doi ? "\ndoi: " + pl.doi : ""}\n\n${pl.message ? pl.message + "\n\n" : ""}${pl.name}${pl.institution ? "\n" + pl.institution : ""}\n${pl.email}`;
    $("fb-text").textContent = `To: ${CONFIG.OWNER_EMAIL}\n\n${body}`;
    $("fb-mail").href = `mailto:${CONFIG.OWNER_EMAIL}?subject=${encodeURIComponent("Full-text request: " + pl.title.slice(0, 80))}&body=${encodeURIComponent(body)}`;
    done("Almost there", `Send this request to ${CONFIG.OWNER_EMAIL} and the PDF will come back to you, usually within a day.`, true);
  }
  $("reqform").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("r-name").value.trim(), email = $("r-email").value.trim(), inst = $("r-inst").value.trim(), msg = $("r-msg").value.trim(), err = $("r-err");
    if (!name){ err.textContent = "Please add your name."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent = "Please enter a valid email address so the paper can reach you."; return; }
    err.textContent = "";
    const payload = { name, email, institution: inst, message: msg, paperId: String(current.n), title: current.t, journal: current.j, doi: current.doi || "" };
    if (CONFIG.REQUEST_ENDPOINT){
      const btn = $("r-send"); btn.disabled = true; btn.textContent = "Sending...";
      try {
        await fetch(CONFIG.REQUEST_ENDPOINT, { method: "POST", mode: "no-cors", headers: {"Content-Type": "text/plain"}, body: JSON.stringify(payload) });
        done("Request received", `Thank you, ${name}. The full text will arrive at ${email} in a few minutes.`, false);
      } catch (_) { showFallback(payload); }
      finally { btn.disabled = false; btn.textContent = "Send request"; }
    } else showFallback(payload);
  });
  $("fb-copy").addEventListener("click", async () => {
    const t = $("fb-text"), b = $("fb-copy");
    try { await navigator.clipboard.writeText(t.textContent); b.textContent = "Copied"; }
    catch (_) { const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = "Selected, press Ctrl+C"; }
  });
})();

/* ---------- Forest plot (coding page). Data: need for transfusion, JAMA Surg 2026;161(2):179-187, rerun of the original R script ---------- */
(function(){
  const svg = $("hero-forest"); if (!svg) return;
  const rows = [["Babu 2021",.38,.19,.76,7.3],["Dalmau 2000",.75,.60,.93,18.4],["HeLiX",1.10,.85,1.44,17.1],["Kulkarni 2016",.81,.49,1.35,10.5],
    ["Luo 2025",.13,.02,.97,1.1],["NCT00827931",1.53,.39,6.04,2.4],["POISE-3",.79,.64,.98,18.7],["Sermet 2023",.25,.02,2.70,.9],
    ["Shaker 2023",.60,.36,1.00,10.4],["TAC-PD",1.04,.64,1.71,10.7],["Wu 2006",.03,.0017,.46,.6],["Yang 2023",.50,.11,2.33,1.9]];
  const NS = "http://www.w3.org/2000/svg", L = 96, R = 400, top = 14, rh = 21, lo = Math.log10(0.01), hi = Math.log10(10);
  const x = v => L + (Math.log10(Math.min(Math.max(v, 0.01), 10)) - lo) / (hi - lo) * (R - L);
  const el = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (p || svg).appendChild(e); return e; };
  const yEnd = top + rows.length * rh + 6;
  el("line", {class: "null", x1: x(1), x2: x(1), y1: top - 6, y2: yEnd + 26});
  el("line", {class: "pooledline", x1: x(.75), x2: x(.75), y1: top - 6, y2: yEnd + 26});
  rows.forEach((r, i) => {
    const y = top + i * rh + rh / 2, g = el("g", {});
    el("text", {class: "lbl", x: 0, y: y + 3.5}, g).textContent = r[0];
    el("line", {class: "ci", x1: x(r[2]), x2: x(r[3]), y1: y, y2: y}, g);
    const s = 4 + Math.sqrt(r[4]) * 2.6; el("rect", {class: "box", x: x(r[1]) - s / 2, y: y - s / 2, width: s, height: s}, g);
    el("text", {class: "est", x: 460, y: y + 3.5, "text-anchor": "end"}, g).textContent = r[1].toFixed(2);
  });
  const yd = yEnd + 12;
  el("text", {class: "lbl", x: 0, y: yd + 4, "font-weight": "600"}).textContent = "Pooled";
  el("polygon", {class: "dia", points: `${x(.60)},${yd} ${x(.75)},${yd - 7} ${x(.94)},${yd} ${x(.75)},${yd + 7}`});
  el("text", {class: "est", x: 460, y: yd + 4, "text-anchor": "end", "font-weight": "600"}).textContent = "0.75";
  const ya = yd + 20; el("line", {class: "axis", x1: L, x2: R, y1: ya, y2: ya});
  [0.01, 0.1, 1, 10].forEach(t => { el("line", {class: "axis", x1: x(t), x2: x(t), y1: ya, y2: ya + 4}); el("text", {x: x(t), y: ya + 16, "text-anchor": "middle"}).textContent = t; });
  el("text", {x: x(1) - 6, y: ya + 30, "text-anchor": "end"}).textContent = "Favors TXA";
  el("text", {x: x(1) + 6, y: ya + 30}).textContent = "Favors control";
})();
})();

/* ---------- Photo carousel (About) ---------- */
document.querySelectorAll(".car").forEach(car => {
  const tr = car.querySelector(".car-track"), slides = [...tr.children], dots = car.querySelector(".car-dots");
  slides.forEach((_, i) => { const b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", `Photo ${i + 1}`); b.onclick = () => go(i); dots.appendChild(b); });
  const cur = () => Math.round(tr.scrollLeft / tr.clientWidth);
  const go = i => tr.scrollTo({ left: ((i + slides.length) % slides.length) * tr.clientWidth, behavior: "smooth" });
  const mark = () => [...dots.children].forEach((d, i) => d.classList.toggle("on", i === cur()));
  car.querySelector(".car-p").onclick = () => go(cur() - 1);
  car.querySelector(".car-n").onclick = () => go(cur() + 1);
  tr.addEventListener("scroll", () => requestAnimationFrame(mark)); mark();
});

/* ---------- Interactive template (toolkit) ---------- */
document.querySelectorAll(".ic").forEach(box => {
  const P = JSON.parse(box.querySelector(".ic-data").textContent);
  const panel = box.querySelector(".ic-panel");
  const esc = s => String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  function show(k){
    const p = P[k]; if (!p) return;
    box.querySelectorAll(".ic-a").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    const cur = box.querySelector(`.ic-v[data-k="${k}"]`);
    let h = `<div class="ic-k">${esc(k)}</div><h3>${esc(p.name)}</h3><p>${p.what}</p>`;
    if (p.values){
      h += `<div class="ic-vals">` + p.values.map(v => {
        const on = cur && cur.textContent.trim() === v.v;
        return `<button type="button" class="ic-opt${on ? " on" : ""}" data-v='${esc(v.v)}'><code>${esc(v.v)}</code>${v.d ? '<em>my default</em>' : ''}<span>${v.use}</span></button>`;
      }).join("") + `</div>`;
    } else if (p.minor) {
      h += `<p class="ic-note">Data or display argument: set it to your own columns and labels.</p>`;
    }
    panel.innerHTML = h;
    panel.querySelectorAll(".ic-opt").forEach(o => o.onclick = () => {
      box.querySelectorAll(`.ic-v[data-k="${k}"]`).forEach(v => { v.textContent = o.dataset.v; v.classList.add("chg"); setTimeout(() => v.classList.remove("chg"), 600); });
      show(k);
    });
  }
  box.querySelectorAll(".ic-a").forEach(b => b.addEventListener("click", () => show(b.dataset.k)));
  show(box.dataset.first);
});

/* ---------- "Upcoming" tags drop off on the congress's first day: <span class="tag up" data-start="YYYY-MM-DD"> ---------- */
document.querySelectorAll(".tag.up[data-start]").forEach(el => {
  if (new Date() >= new Date(el.dataset.start + "T00:00:00")) el.replaceWith(document.createElement("span"));
});

/* ---------- Google Scholar metrics, refreshed from /api/scholar (Vercel function + SerpApi) ----------
   The numbers written in the HTML are the fallback; if the API is unavailable nothing changes. */
(function(){
  if (!document.querySelector("[data-gs]")) return;
  if (!/^https?:$/.test(location.protocol)) return;
  fetch("/api/scholar", {headers: {Accept: "application/json"}})
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      if (!d || typeof d.cites_all !== "number") return;
      document.querySelectorAll("[data-gs]").forEach(el => {
        const k = el.dataset.gs;
        if (k === "since_label") { if (d.since_year) el.textContent = "Since " + d.since_year; return; }
        if (d[k] != null) el.textContent = d[k];
      });
      const chart = document.querySelector(".gs-chart");
      const ys = d.years || {};
      const last = Math.max(...Object.keys(ys).map(Number), 0);
      const keys = []; for (let y = 2023; y <= last; y++) { keys.push(y); if (ys[y] == null) ys[y] = 0; }
      if (chart && keys.length) {
        const mx = Math.max(...keys.map(y => ys[y]), 1);
        chart.classList.remove("empty");
        chart.innerHTML = keys.map(y => {
          const n = ys[y], h = n === 0 ? 0 : Math.max(2, Math.round(n / mx * 100));
          return `<div class="gs-bar"><span class="gs-n">${n}</span><i style="height:${h}%"></i><span class="gs-y">${y}</span></div>`;
        }).join("");
        chart.setAttribute("aria-label", "Citations per year: " + keys.map(y => `${y}: ${ys[y]}`).join(", "));
      }
    })
    .catch(() => {});
})();
