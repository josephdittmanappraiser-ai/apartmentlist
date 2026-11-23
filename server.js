// Houston Apartment Finder — self-hosted server (Railway / any Node 18+ host)
// Serves the page and one API route that reads properties + photos live from Airtable.
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const {
  AIRTABLE_TOKEN,                     // Airtable personal access token (data.records:read on this base)
  AIRTABLE_BASE_ID = "appbBEzby4dMTvMMl",
  AIRTABLE_TABLE_ID = "tbl3Bn3jnoZrXiOMu",
  SITE_USER = "team",
  SITE_PASSWORD,                      // required: the login for the site
  CACHE_MINUTES = "15",
  SHARE_SECRET,                       // optional: signs share links (defaults to SITE_PASSWORD)
  SHARE_DAYS = "30",                  // how long a share link works
  PUBLIC_URL,                         // optional: e.g. https://finder.yourdomain.com
  AGENT_NAME = "Joseph Dittman", AGENT_PHONE = "832-720-7978", AGENT_EMAIL = "", BRAND_NAME = "High Risers",
  REBATE = "$500",                    // shown as "up to $500 rebate"; set to "" to hide
  NOTIFY_EMAIL = "apartment@txhighrisers.com", // where tour requests are emailed
  RESEND_API_KEY,                     // email sending (resend.com); without it tour requests can't be emailed
  EMAIL_FROM = "High Risers Tours <tours@txhighrisers.com>", // sender for tour-request emails (must be on a Resend-verified domain)
  PORT = 3000,
} = process.env;

if (!AIRTABLE_TOKEN) { console.error("Missing AIRTABLE_TOKEN"); process.exit(1); }
if (!SITE_PASSWORD) { console.error("Missing SITE_PASSWORD (the site shows commission, so it must be protected)"); process.exit(1); }

// Airtable field IDs in the Properties table
const F = {
  name: "fldxFOqBCepYsEGZ8", send: "fldYvsVjfpAFa7JRU", escort: "fldqp7acreuD5MrBt", bonus: "fldIsYFZmL3yFivwt",
  submarket: "fldJLuDIiHWtHEWo1", address: "fldYNW6bQcxitHOxD", city: "fldXDw5Z5XpndmvSM", zip: "fldMbELr7jq381zN6",
  mgmt: "fldPvzQumgORwNuRc", cls: "fldJNiPbOItE7vlFd", built: "fld1irdI0gR3eepyh", reno: "fldLVWnkPweEjq2Hg",
  occ: "fldazHEFcLBbB8aqK", units: "fld8wMwlvAMe67wif", beds: "fldUwWjL1Te9Ugcj5",
  studio: "fldVNxRPq1fRPAjax", br1: "fldl63UzW95QBmiJP", br2: "flde6AaxrP6mIIwrT", br3: "fldno3hIZDrelVRoM", br4: "fldZGg3CzjMKbKMmZ",
  status: "fldDpDOkTA5nRVZLF", sources: "fld7yUkKJiPBsPIRV", special: "fldo77xReQSwCOGNH", site: "fldeiZW6IZqFgW7A9",
  notes: "fldriI8EJNrS8nX4D", type: "fldCEQUbgTjLVqIiS", photos: "fldh4c0qhPVS5LyX7",
};

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "20kb" }));

// --- Public client share pages (no login; never include commission or notes) ---
const SECRET = SHARE_SECRET || SITE_PASSWORD;
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (data) => b64u(crypto.createHmac("sha256", SECRET).update(data).digest().subarray(0, 18));
function makeToken(obj) { const data = b64u(JSON.stringify(obj)); return `${data}.${sign(data)}`; }
function readToken(tok) {
  const [data, sig] = String(tok || "").split(".");
  if (!data || !sig || !safeEq(sig, sign(data))) return null;
  try { const o = JSON.parse(Buffer.from(data, "base64url").toString()); return o.e && Date.now() > o.e ? { expired: true } : o; }
  catch { return null; }
}
const clientView = (p) => ({
  id: p.id, n: p.n, sm: p.sm, c: p.c, z: p.z, a: p.a, yb: p.yb, rn: p.rn, br: p.br, p: p.p,
  spc: p.spc, type: p.type, ph: p.ph,
});
// --- Tour requests from client pages -> email to the team ---
const hits = new Map(); // simple per-IP limit: 8 requests / hour
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 36e5);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 8;
}
const h = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BRS = ["Studio", "1 BR", "2 BR", "3 BR", "4 BR"];
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!RESEND_API_KEY) throw Object.assign(new Error("Email isn't set up (RESEND_API_KEY missing)"), { code: "no_email" });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) throw new Error(`Email failed ${r.status}: ${await r.text()}`);
}
app.post("/api/share/:token/tour", async (req, res) => {
  const t = readToken(req.params.token);
  if (!t) return res.status(404).json({ error: "This link isn't valid." });
  if (t.expired) return res.status(410).json({ error: "This link has expired." });
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields
  if (limited(req.ip)) return res.status(429).json({ error: "Too many requests. Please text us instead." });
  const pid = String(b.propertyId || "");
  if (!(t.i || []).includes(pid)) return res.status(400).json({ error: "That property isn't on this list." });
  const form = {
    name: String(b.name || "").trim().slice(0, 80), phone: String(b.phone || "").trim().slice(0, 30),
    email: String(b.email || "").trim().slice(0, 120), when: String(b.when || "").trim().slice(0, 120),
    message: String(b.message || "").trim().slice(0, 1000),
  };
  if (!form.phone && !form.email && !t.cp && !t.ce) return res.status(400).json({ error: "Add a phone number or email so we can reach you." });
  try {
    const { properties } = await getData();
    const p = properties.find((x) => x.id === pid);
    if (!p) return res.status(404).json({ error: "That property is no longer listed." });
    const others = (t.i || []).map((id) => properties.find((x) => x.id === id)).filter(Boolean).map((x) => x.n);
    const base = (PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const link = `${base}/s/${req.params.token}`;
    const prices = p.p.map((v, i) => (v == null ? null : `${BRS[i]} $${v.toLocaleString()}`)).filter(Boolean).join(" · ");
    const client = t.c || form.name || "Unknown client";
    const rows = [
      ["Client (from link)", t.c], ["Name they entered", form.name !== t.c ? form.name : ""],
      ["Phone", form.phone || t.cp], ["Email", form.email || t.ce],
      ...(form.phone && t.cp && form.phone !== t.cp ? [["Phone on file", t.cp]] : []),
      ...(form.email && t.ce && form.email.toLowerCase() !== t.ce.toLowerCase() ? [["Email on file", t.ce]] : []),
      ["Wants to tour", p.n], ["Preferred time", form.when], ["Message", form.message],
      ["Address", [p.a || p.c, p.z].filter(Boolean).join(", ")], ["Area", p.sm], ["Prices", prices], ["Special", p.spc],
      ["Commission", [p.sp != null ? `Send ${p.sp}%` : "", p.es != null && p.es !== p.sp ? `Escort ${p.es}%` : "", p.bo ? `Bonus ${p.bo}` : ""].filter(Boolean).join(" · ")],
      ["Management", p.mg], ["Website", p.url],
      ["Link sent", t.t ? new Date(t.t).toLocaleString("en-US", { timeZone: "America/Chicago" }) : ""],
      ["All properties on their link", others.join(", ")], ["Their link", link],
    ].filter(([, v]) => v);
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><h2 style="margin:0 0 6px">Tour request: ${h(client)} → ${h(p.n)}</h2>
      <p style="margin:0 0 12px;color:#555">Sent from a High Risers share link. Reply to this email to reach the client${form.email || t.ce ? "" : " (no email given — call or text)"}.</p>
      <table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top;white-space:nowrap">${h(k)}</td><td style="font-weight:600">${k === "Their link" || k === "Website" ? `<a href="${h(v)}">${h(v)}</a>` : h(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table></div>`;
    const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    await sendEmail({ to: NOTIFY_EMAIL, subject: `Tour request: ${client} → ${p.n}`, html, text, replyTo: form.email || t.ce || undefined });
    console.log(`Tour request emailed: ${client} -> ${p.n}`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(e.code === "no_email" ? 503 : 502).json({ error: "We couldn't send your request online. Please text us instead.", fallback: true });
  }
});

app.get("/s/:token", (req, res) => res.sendFile(path.join(__dirname, "public", "share.html")));
app.get("/api/share/:token", async (req, res) => {
  const t = readToken(req.params.token);
  if (!t) return res.status(404).json({ error: "This link isn't valid." });
  if (t.expired) return res.status(410).json({ error: "This link has expired. Ask your agent for a new one." });
  try {
    const { properties } = await getData();
    const byId = new Map(properties.map((p) => [p.id, p]));
    res.set("Cache-Control", "no-store").json({
      client: t.c || "", note: t.m || "", br: Number.isInteger(t.b) ? t.b : -1,
      tourForm: !!RESEND_API_KEY, hasContact: !!(t.cp || t.ce),
      agent: { name: AGENT_NAME, phone: AGENT_PHONE, email: AGENT_EMAIL, brand: BRAND_NAME, rebate: REBATE },
      properties: (t.i || []).map((id) => byId.get(id)).filter(Boolean).map(clientView),
    });
  } catch (e) { console.error(e); res.status(502).json({ error: "Couldn't load these apartments right now. Try again in a minute." }); }
});

// --- Basic-auth login for the whole site ---
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
app.use((req, res, next) => {
  if (req.path === "/healthz" || req.path.startsWith("/s/") || req.path.startsWith("/api/share/") || req.path === "/share.html") return next();
  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  if (scheme === "Basic" && encoded) {
    const raw = Buffer.from(encoded, "base64").toString();
    const i = raw.indexOf(":");
    if (i > -1 && safeEq(raw.slice(0, i), SITE_USER) && safeEq(raw.slice(i + 1), SITE_PASSWORD)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Houston Apartment Finder"').status(401).send("Login required");
});

// --- Airtable fetch with a short cache (photo links expire after a few hours) ---
let cache = { at: 0, data: null, pending: null };
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const sel = (v) => (v && typeof v === "object" ? v.name : v) || "";

async function fetchAllRecords() {
  const out = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("returnFieldsByFieldId", "true");
    for (const id of Object.values(F)) url.searchParams.append("fields[]", id);
    if (offset) url.searchParams.set("offset", offset);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 30000)); continue; } // Airtable rate limit
    if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...j.records);
    offset = j.offset;
    if (offset) await new Promise((s) => setTimeout(s, 220)); // stay under 5 requests/second
  } while (offset);
  return out;
}

function toProperty(rec) {
  const f = rec.fields || {};
  const photos = (f[F.photos] || []).map((a) => ({
    thumb: a.thumbnails?.large?.url || a.url,
    full: a.thumbnails?.full?.url || a.url,
  }));
  return {
    id: rec.id,
    n: (f[F.name] || "").trim(),
    sm: sel(f[F.submarket]) || "Other",
    c: sel(f[F.city]),
    z: f[F.zip] != null ? String(f[F.zip]) : "",
    a: f[F.address] || "",
    cl: sel(f[F.cls]),
    yb: num(f[F.built]), rn: num(f[F.reno]), oc: num(f[F.occ]), u: num(f[F.units]),
    mg: sel(f[F.mgmt]),
    sp: num(f[F.send]), es: num(f[F.escort]), bo: f[F.bonus] || "",
    br: sel(f[F.beds]),
    p: [num(f[F.studio]), num(f[F.br1]), num(f[F.br2]), num(f[F.br3]), num(f[F.br4])],
    st: sel(f[F.status]) || "Complete",
    src: sel(f[F.sources]),
    spc: f[F.special] || "",
    nt: f[F.notes] || "",
    url: (f[F.site] || "").trim(),
    type: sel(f[F.type]),
    ph: photos,
  };
}

async function getData(force) {
  const fresh = Date.now() - cache.at < Number(CACHE_MINUTES) * 60e3;
  if (cache.data && fresh && !force) return cache.data;
  if (!cache.pending) {
    cache.pending = fetchAllRecords()
      .then((recs) => {
        const properties = recs.map(toProperty).filter((p) => p.n);
        cache = { at: Date.now(), data: { updatedAt: new Date().toISOString(), properties }, pending: null };
        return cache.data;
      })
      .catch((e) => { cache.pending = null; throw e; });
  }
  return cache.pending;
}

// Create a share link (team only — behind the login)
app.post("/api/shares", (req, res) => {
  const { ids, client = "", clientEmail = "", clientPhone = "", note = "", br = -1 } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "Pick at least one property." });
  if (String(client).trim().length < 2) return res.status(400).json({ error: "Enter the client's name so tour requests are tied to them." });
  const clean = [...new Set(ids.filter((x) => typeof x === "string" && /^rec[A-Za-z0-9]{14}$/.test(x)))].slice(0, 40);
  if (!clean.length) return res.status(400).json({ error: "None of the selected properties could be shared. Refresh the page and pick them again." });
  const days = Math.max(1, Number(SHARE_DAYS) || 30);
  const tok = makeToken({ i: clean, c: String(client).trim().slice(0, 80), ce: String(clientEmail).trim().slice(0, 120),
    cp: String(clientPhone).trim().slice(0, 30), t: Date.now(), m: String(note).slice(0, 600),
    b: Number.isInteger(br) && br >= 0 && br <= 4 ? br : -1, e: Date.now() + days * 864e5 });
  const base = (PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  res.json({ url: `${base}/s/${tok}`, count: clean.length, expiresDays: days,
    agent: { name: AGENT_NAME, phone: AGENT_PHONE, email: AGENT_EMAIL, brand: BRAND_NAME, rebate: REBATE } });
});

app.get("/api/properties", async (req, res) => {
  try {
    const data = await getData(req.query.refresh === "1");
    res.set("Cache-Control", "no-store").json(data);
  } catch (e) {
    console.error(e);
    if (cache.data) return res.json({ ...cache.data, stale: true }); // serve last good copy
    res.status(502).json({ error: "Could not load data from Airtable" });
  }
});

app.get("/healthz", (_, res) => res.send("ok"));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));

app.listen(PORT, () => console.log(`Finder running on port ${PORT}`));
