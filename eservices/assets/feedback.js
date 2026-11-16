/* Clear feedback for anything a person submits. One call, three states: working, done, failed.

     import { submit } from "https://migovt.org/sos/eservices/assets/feedback.js";
     const ok = await submit({
       working: "Submitting your registration",
       work: async () => fileCase(...),                       // whatever saves the thing; its return value goes to `done`
       done: r => ({ title: "Registration submitted", body: "The Division will review it.", ref: r && r.id, next: ["Watch Your filings for the decision.", "You are only charged if it is approved."] }),
       reload: true                                          // reload the page when the person presses Done (default true)
     });

   While it works the whole page is covered by a spinner so nothing can be clicked twice. When it succeeds, a green check
   appears with what happened and what comes next, and it stays until the person presses Done. When it fails, a red panel
   says why and nothing was sent, and the person can close it and try again. submit() returns true or false. */
const CSS = `
.fbk{position:fixed;inset:0;z-index:9999;background:rgba(10,32,36,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;animation:fbk-in .15s ease}
.fbk-card{width:min(440px,100%);background:#fff;border-radius:22px;padding:30px 28px 24px;text-align:center;box-shadow:0 30px 70px rgba(0,0,0,.35);animation:fbk-pop .22s cubic-bezier(.2,1.2,.4,1)}
.fbk-ic{width:76px;height:76px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.fbk-ic.sp{border:6px solid #d9ecee;border-top-color:#0e7c86;animation:fbk-spin .8s linear infinite}
.fbk-ic.ok{background:#e3f4ea}.fbk-ic.no{background:#fde8e6}
.fbk-ic svg{width:44px;height:44px}.fbk-ic path{fill:none;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:60;stroke-dashoffset:60;animation:fbk-draw .45s .15s ease forwards}
.fbk-ic.ok path{stroke:#1c8a46}.fbk-ic.no path{stroke:#c0362c}
.fbk-card h3{margin:0 0 6px;font-size:21px;font-weight:800;color:#10272b}.fbk-card p{margin:0;color:#4a6166;font-size:15px;line-height:1.5}
.fbk-ref{display:inline-block;margin-top:12px;background:#eef5f6;border-radius:99px;padding:5px 14px;font:600 13px 'IBM Plex Mono',ui-monospace,monospace;color:#07474e}
.fbk-next{margin:16px 0 0;padding:12px 14px 12px 32px;text-align:left;background:#f3f9f9;border-radius:14px;font-size:14px;color:#2c4348;line-height:1.5}.fbk-next li{margin:3px 0}
.fbk-acts{display:flex;gap:10px;justify-content:center;margin-top:20px}
.fbk-btn{border:0;border-radius:99px;padding:12px 28px;font:700 15px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer;background:#0e7c86;color:#fff}.fbk-btn.g{background:#e8f0f1;color:#10272b}.fbk-btn:focus-visible{outline:3px solid #ff7a3d;outline-offset:2px}
@keyframes fbk-in{from{opacity:0}}@keyframes fbk-pop{from{transform:scale(.92);opacity:0}}@keyframes fbk-spin{to{transform:rotate(360deg)}}@keyframes fbk-draw{to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.fbk,.fbk-card,.fbk-ic,.fbk-ic path{animation:none!important}.fbk-ic path{stroke-dashoffset:0}}`;
let styled = false;
function node(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function icon(kind) {
  const d = node("div", "fbk-ic " + kind); if (kind === "sp") return d;
  d.innerHTML = kind === "ok" ? '<svg viewBox="0 0 48 48"><path d="M11 25l9 9 18-20"/></svg>' : '<svg viewBox="0 0 48 48"><path d="M13 13l22 22M35 13L13 35"/></svg>'; return d;
}
/* Turns a Firebase or network error into something a person can act on. */
export function explain(e) {
  const c = e && e.code ? String(e.code) : "";
  if (c.includes("permission-denied")) return "The server refused this request. That is a permissions problem on our side, not something you did. Tell a staff member.";
  if (c.includes("unavailable") || c.includes("network") || /network|offline/i.test(e && e.message || "")) return "Could not reach the server. Check your connection and try again.";
  if (c.includes("deadline") || c.includes("timeout")) return "The server took too long to answer. Try again in a moment.";
  return "Something went wrong and nothing was sent. Try again in a moment.";
}
export async function submit({ working = "Submitting", work, done = {}, reload = true, minMs = 700 } = {}) {
  if (!styled) { const s = node("style"); s.textContent = CSS; document.head.append(s); styled = true; }
  const prevFocus = document.activeElement, ov = node("div", "fbk"), card = node("div", "fbk-card"); ov.setAttribute("role", "alertdialog"); ov.setAttribute("aria-live", "assertive"); ov.append(card); document.body.append(ov);
  const show = (kind, title, body, extra, buttons) => { card.replaceChildren(icon(kind), node("h3", "", title)); if (body) card.append(node("p", "", body)); (extra || []).forEach(x => card.append(x));
    if (buttons) { const a = node("div", "fbk-acts"); buttons.forEach(b => a.append(b)); card.append(a); b0 = buttons[0]; if (b0) b0.focus(); } };
  let b0 = null;
  show("sp", working + "...", "Please keep this page open.");
  const t0 = Date.now(); let result, err = null;
  try { result = await work(); } catch (e) { console.error(e); err = e; }
  const wait = minMs - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const close = () => { ov.remove(); document.removeEventListener("keydown", key); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch {} };
  const key = e => { if (e.key === "Escape" && !ov.querySelector(".sp")) close(); };
  document.addEventListener("keydown", key);
  if (err) {
    const retry = node("button", "fbk-btn", "Close and try again"); retry.type = "button"; retry.addEventListener("click", close);
    show("no", "That did not go through", explain(err), [], [retry]); return false;
  }
  const d = typeof done === "function" ? done(result) : done, extra = [];
  if (d.ref) extra.push(node("div", "fbk-ref", "Reference " + String(d.ref).slice(0, 8).toUpperCase()));
  if (d.next && d.next.length) { const ul = node("ul", "fbk-next"); d.next.forEach(t => ul.append(node("li", "", t))); extra.push(ul); }
  const ok = node("button", "fbk-btn", "Done"); ok.type = "button"; ok.addEventListener("click", () => { close(); if (reload) location.reload(); });
  show("ok", d.title || "Submitted", d.body || "", extra, [ok]); return true;
}