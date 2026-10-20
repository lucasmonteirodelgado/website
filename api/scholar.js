// Vercel serverless function: GET /api/scholar
// Reads the Google Scholar profile through SerpApi and returns the "Cited by" numbers.
// The SerpApi key lives in the Vercel environment variable SERPAPI_KEY (never in the page).
// The CDN caches the answer for 24 h, so SerpApi is called about once a day.

const AUTHOR_ID = "StCPz7sAAAAJ";

module.exports = async (req, res) => {
  const key = process.env.SERPAPI_KEY;
  if (!key) return res.status(500).json({ error: "SERPAPI_KEY is not set" });

  const url = "https://serpapi.com/search.json?engine=google_scholar_author&hl=en&num=1"
            + "&author_id=" + AUTHOR_ID + "&api_key=" + encodeURIComponent(key);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("SerpApi HTTP " + r.status);
    const j = await r.json();
    const table = (j.cited_by && j.cited_by.table) || [];
    // Each row looks like { citations: { all: 255, since_2021: 255 } }
    const pick = (i) => {
      const row = table[i] ? Object.values(table[i])[0] : {};
      const sinceKey = Object.keys(row).find(k => k !== "all");
      return { all: row.all, since: sinceKey ? row[sinceKey] : undefined, sinceKey };
    };
    const c = pick(0), h = pick(1), i10 = pick(2);
    const years = {};
    ((j.cited_by && j.cited_by.graph) || []).forEach(g => { years[g.year] = Number(g.citations) || 0; });
    const m = /(\d{4})/.exec(c.sinceKey || "");
    if (typeof c.all !== "number") throw new Error("unexpected response");

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      cites_all: c.all, cites_since: c.since,
      h_all: h.all, h_since: h.since,
      i10_all: i10.all, i10_since: i10.since,
      since_year: m ? Number(m[1]) : null,
      years,
      updated: new Date().toISOString()
    });
  } catch (e) {
    res.setHeader("Cache-Control", "public, s-maxage=600");
    return res.status(502).json({ error: String(e.message || e) });
  }
};
