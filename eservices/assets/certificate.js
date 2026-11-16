/* MiGOVT SOS e-Services: printable certificates (ES module).
   showCertificate({ kind, title, name, statement, fields, number, accent, accent2 }) opens a full-screen preview of a
   landscape Letter certificate. "Print or save as PDF" prints only the certificate; choose "Save as PDF" as the printer. */
const W = 1056, H = 816;   // 11in x 8.5in at 96 dpi

const CSS = `
#certlayer{position:fixed;inset:0;z-index:200;background:rgba(15,35,39,.82);overflow:auto;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
#certlayer .cbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:12px 18px;background:#0f2327;color:#c8dadd}
#certlayer .cbar b{color:#fff;font-size:15px}
#certlayer .cbar span{font-size:13px}
#certlayer .cbar button{border:0;border-radius:999px;padding:10px 20px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;background:#ff7a3d;color:#fff}
#certlayer .cbar button.s{background:#fff;color:#0a5d65;margin-left:8px}
#certlayer .sw{margin:22px auto 40px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.cert{width:${W}px;height:${H}px;position:relative;overflow:hidden;transform-origin:top left;color:#17323a;
  background:radial-gradient(ellipse at 50% 45%,#fffef9 0%,#fbf6e8 62%,#f3ead3 100%);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
.cert svg.cb{position:absolute;inset:0;width:100%;height:100%}
.cert .ci{position:absolute;inset:0;padding:76px 92px 80px;display:flex;flex-direction:column;align-items:center;text-align:center}
.cert .micro{position:absolute;top:61px;left:90px;right:90px;font-size:5.4px;letter-spacing:.3em;color:var(--a);opacity:.55;white-space:nowrap;overflow:hidden;font-weight:700}
.cert .micro.b{top:auto;bottom:61px}
.cert .logo svg{height:44px;width:auto;display:block}
.cert .kick{font-size:11px;letter-spacing:.34em;font-weight:800;color:var(--a);margin-top:10px}
.cert h1{font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-weight:700;font-size:42px;line-height:1.05;margin:6px 0 0;color:#10282f;letter-spacing:.01em}
.cert .orn{display:flex;align-items:center;gap:12px;margin:8px 0 6px;color:var(--b)}
.cert .orn i{display:block;width:150px;height:1.5px;background:linear-gradient(90deg,transparent,var(--b))}
.cert .orn i:last-child{background:linear-gradient(270deg,transparent,var(--b))}
.cert .lead{font-size:12.5px;letter-spacing:.24em;text-transform:uppercase;color:#5d7379;font-weight:700}
.cert .nm{font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-style:italic;font-weight:500;color:var(--a);line-height:1.1;margin:8px 0 6px}
.cert .stmt{font-family:'Playfair Display',Georgia,serif;font-size:15.5px;line-height:1.55;color:#34505a;max-width:700px;margin:0}
.cert .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:14px;width:100%;max-width:820px;border-top:1.5px solid var(--a);border-bottom:1.5px solid var(--a)}
.cert .grid div{padding:9px 10px 8px;border-left:1px solid rgba(23,50,58,.16);border-top:1px solid rgba(23,50,58,.16)}
.cert .grid div:nth-child(3n+1){border-left:0}
.cert .grid div:nth-child(-n+3){border-top:0}
.cert .grid small{display:block;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:#6a8088;font-weight:800}
.cert .grid b{display:block;font-size:15.5px;margin-top:3px;color:#10282f;font-weight:700}
.cert .foot{display:grid;grid-template-columns:1fr 120px 1fr;align-items:end;width:100%;max-width:860px;margin-top:auto}
.cert .foot .l{text-align:left;font-size:11.5px;color:#52696f;line-height:1.7}
.cert .foot .l b{color:#10282f}
.cert .foot .r{text-align:right}
.cert .sig{border-bottom:1.3px solid #17323a;height:46px;margin-left:auto;width:230px}
.cert .sig svg{width:100%;height:100%;display:block}
.cert .foot .r small{display:block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#52696f;margin-top:5px;font-weight:700}
.cert .bcode{display:flex;flex-direction:column;align-items:center;margin-top:8px}
.cert .bcode svg{height:22px;width:240px;display:block}
.cert .bcode span{font-size:9px;letter-spacing:.22em;color:#52696f;font-weight:700;margin-top:3px}
.cert .sim{font-size:8.5px;color:#8a9ca1;margin-top:5px;letter-spacing:.04em}
@page{size:11in 8.5in;margin:0}
@media print{
  html,body{background:#fff!important}
  body.cert-open > *:not(#certlayer){display:none!important}
  body.cert-open{margin:0!important;padding:0!important;height:auto!important}
  body.cert-open #certlayer{position:static!important;overflow:hidden!important;background:#fff!important;display:block!important;width:${W}px!important;height:${H}px!important}
  body.cert-open #certlayer .cbar{display:none!important}
  body.cert-open #certlayer .sw{width:${W}px!important;height:${H}px!important;margin:0!important;box-shadow:none!important}
  body.cert-open #certlayer .cert{transform:none!important}
}
`;

/* ---------- small helpers ---------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
const LOGO = `<svg viewBox="0 0 430 100" role="img" aria-label="Michigan Secretary of State"><g font-family="'Plus Jakarta Sans','Segoe UI',Arial,sans-serif"><text x="4" y="30" font-size="13" font-weight="700" fill="#0e7c86" letter-spacing="5">MICHIGAN</text><text x="2" y="70" font-size="44" font-weight="800" fill="#0f2327" letter-spacing="-1">Secretary of State</text></g><rect x="4" y="82" width="365" height="5" rx="2.5" fill="#0e7c86"/><path d="M388 80l10 10 20-22" fill="none" stroke="#ff7a3d" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ornate frame, guilloche rosettes, corner arcs */
function frame() {
  let wm = "";
  for (let i = 0; i < 36; i++) wm += `<ellipse cx="0" cy="0" rx="250" ry="86" transform="rotate(${i * 5})" stroke="var(--a)" stroke-opacity=".085" stroke-width=".9" fill="none"/>`;
  for (let i = 0; i < 36; i++) wm += `<ellipse cx="0" cy="0" rx="170" ry="58" transform="rotate(${i * 5 + 2.5})" stroke="var(--b)" stroke-opacity=".075" stroke-width=".8" fill="none"/>`;
  wm += `<circle r="38" stroke="var(--a)" stroke-opacity=".1" fill="none"/><circle r="26" stroke="var(--b)" stroke-opacity=".1" fill="none"/>`;
  let arcs = "";
  [[54, 54], [W - 54, 54], [54, H - 54], [W - 54, H - 54]].forEach(([x, y], i) => {
    [16, 26, 36, 46].forEach((r, k) => arcs += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${k % 2 ? "var(--b)" : "var(--a)"}" stroke-width="${k % 2 ? 1 : 1.6}" clip-path="url(#ic)"/>`);
    arcs += `<circle cx="${x}" cy="${y}" r="7" fill="var(--b)" clip-path="url(#ic)"/>`;
  });
  return `<svg class="cb" viewBox="0 0 ${W} ${H}" aria-hidden="true">
<defs>
<pattern id="wv" width="26" height="22" patternUnits="userSpaceOnUse"><path d="M0 11 Q6.5 -1 13 11 T26 11" fill="none" stroke="var(--a)" stroke-width="1.3"/><path d="M0 11 Q6.5 23 13 11 T26 11" fill="none" stroke="var(--a)" stroke-opacity=".55" stroke-width="1"/></pattern>
<clipPath id="ic"><rect x="54" y="54" width="${W - 108}" height="${H - 108}"/></clipPath>
</defs>
<g transform="translate(${W / 2} ${H / 2 + 6})">${wm}</g>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="var(--a)" stroke-width="4"/>
<rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="var(--b)" stroke-width="1.2"/>
<rect x="38" y="38" width="${W - 76}" height="${H - 76}" fill="none" stroke="url(#wv)" stroke-width="20"/>
<rect x="50" y="50" width="${W - 100}" height="${H - 100}" fill="none" stroke="var(--b)" stroke-width="1.2"/>
<rect x="54" y="54" width="${W - 108}" height="${H - 108}" fill="none" stroke="var(--a)" stroke-width="2.2"/>
${arcs}
</svg>`;
}

/* round "certified" medallion */
function medallion(uid) {
  let petals = "";
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; petals += `<circle cx="${(60 + Math.cos(a) * 54).toFixed(2)}" cy="${(60 + Math.sin(a) * 54).toFixed(2)}" r="6.4" fill="url(#mg${uid})"/>`; }
  return `<svg viewBox="0 0 120 120" width="108" height="108" style="display:block;margin:0 auto" aria-hidden="true">
<defs><radialGradient id="mg${uid}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="var(--b)"/><stop offset="1" stop-color="var(--a)"/></radialGradient>
<path id="mp${uid}" d="M60 60 m-39 0 a39 39 0 1 1 78 0 a39 39 0 1 1 -78 0"/></defs>
${petals}
<circle cx="60" cy="60" r="50" fill="url(#mg${uid})"/>
<circle cx="60" cy="60" r="46.5" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1"/>
<circle cx="60" cy="60" r="29" fill="#fff" fill-opacity=".95"/>
<text font-family="'Plus Jakarta Sans',Arial,sans-serif" font-size="7.2" font-weight="800" fill="#fff"><textPath href="#mp${uid}" startOffset="0" textLength="238" lengthAdjust="spacing">CERTIFIED TRUE COPY * STATE OF MICHIGAN *</textPath></text>
<path d="M45 61l10 10 21-24" fill="none" stroke="var(--b)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
/* decorative signature flourish */
const SIG = `<svg viewBox="0 0 230 46" aria-hidden="true"><path d="M6 32c10-26 22-28 20-12-2 13-12 20-4 20 9 0 12-24 22-24 7 0 0 18 6 18 8 0 10-12 18-12 6 0-2 12 4 12 9 0 14-10 24-10 8 0 0 11 8 11 14 0 22-14 40-14 8 0 22 4 42 2" fill="none" stroke="#17323a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function barcode(seed) {
  const r = rng(seed); let x = 0, bars = "";
  while (x < 240) { const w = 1 + Math.floor(r() * 3), gap = 1 + Math.floor(r() * 2); if (x + w > 240) break; bars += `<rect x="${x}" y="0" width="${w}" height="22" fill="#17323a"/>`; x += w + gap; }
  return `<svg viewBox="0 0 240 22" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

export function buildCertificate(c) {
  const a = c.accent || "#0e7c86", b = c.accent2 || "#ff7a3d";
  const h = hash(c.kind + "|" + c.number), uid = h.toString(36);
  const nameSize = c.name.length > 34 ? 38 : c.name.length > 26 ? 46 : 56;
  const micro = Array(14).fill("MICHIGAN DEPARTMENT OF STATE  -  OFFICIAL RECORD  -  ").join("");
  const cert = document.createElement("div");
  cert.className = "cert"; cert.style.setProperty("--a", a); cert.style.setProperty("--b", b);
  const issued = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  cert.innerHTML = frame() +
    `<div class="ci">
<div class="micro">${micro}</div><div class="micro b">${micro}</div>
<div class="logo">${LOGO}</div>
<div class="kick">STATE OF MICHIGAN</div>
<h1>${esc(c.title)}</h1>
<div class="orn"><i></i><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 1l2.6 7.4L21 11l-7.4 2.6L11 21l-2.6-7.4L1 11l7.4-2.6z" fill="currentColor"/></svg><i></i></div>
<div class="lead">${esc(c.lead || "This certifies that")}</div>
<div class="nm" style="font-size:${nameSize}px">${esc(c.name)}</div>
<p class="stmt">${esc(c.statement)}</p>
<div class="grid">${c.fields.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}</div>
<div class="foot">
<div class="l"><b>Date issued</b><br>${esc(issued)}<br><b>Certificate No.</b><br>${esc(c.number)}</div>
<div>${medallion(uid)}</div>
<div class="r"><div class="sig">${SIG}</div><small>Secretary of State</small></div>
</div>
<div class="bcode">${barcode(h)}<span>${esc(c.number)}</span></div>
<div class="sim">Simulated document. MiGOVT is a fictional government and this is not a real record.</div>
</div>`;
  return cert;
}

export function showCertificate(c) {
  if (!document.getElementById("cert-css")) { const st = document.createElement("style"); st.id = "cert-css"; st.textContent = CSS; document.head.append(st); }
  closeCertificate();
  const layer = document.createElement("div"); layer.id = "certlayer";
  const bar = document.createElement("div"); bar.className = "cbar";
  bar.innerHTML = `<div><b>${esc(c.title)}</b><br><span>Choose "Save as PDF" as the destination in the print window.</span></div><div><button type="button" id="cprint">Print or save as PDF</button><button type="button" class="s" id="cclose">Close</button></div>`;
  const sw = document.createElement("div"); sw.className = "sw";
  const cert = buildCertificate(c); sw.append(cert);
  layer.append(bar, sw); document.body.classList.add("cert-open"); document.body.append(layer);
  const fit = () => { const s = Math.min(1, (layer.clientWidth - 28) / W); cert.style.transform = "scale(" + s + ")"; sw.style.width = W * s + "px"; sw.style.height = H * s + "px"; };
  fit(); window.addEventListener("resize", fit); layer._fit = fit;
  bar.querySelector("#cprint").addEventListener("click", () => window.print());
  bar.querySelector("#cclose").addEventListener("click", closeCertificate);
  layer._esc = e => { if (e.key === "Escape") closeCertificate(); }; document.addEventListener("keydown", layer._esc);
}
export function closeCertificate() {
  const l = document.getElementById("certlayer"); if (!l) return;
  window.removeEventListener("resize", l._fit); document.removeEventListener("keydown", l._esc);
  l.remove(); document.body.classList.remove("cert-open");
}