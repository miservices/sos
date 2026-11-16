/* MiGOVT SOS e-Services: staff portal logic (ES module).
   Roles, bureaus, what each role can do, the case system, person lookup, notices, and the audit log.

   Usage in a staff page:
     import { bootStaff, ... } from "https://migovt.org/sos/eservices/assets/staff.js";
     const ctx = await bootStaff({ page: "queue", cap: "queue.decide", desk: "lara" });   // cap and desk are optional gates

   Staff accounts are normal e-Services accounts whose `role` is a staff role. Set these in the Firestore console:
     accounts/{pin}.role      "system-administrator", "secretary-of-state", "deputy-secretary-of-state", "bureau-director",
                              "deputy-bureau-director", "division-director", "deputy-division-director",
                              "licensing-officer", "records-officer", "elections-officer", "hearing-officer"
     accounts/{pin}.bureau    "lara" (Licensing and Regulatory Affairs), "elections", or "hearings" (Administrative Hearings and Appeals).
                              Officers get a default from their role; directors need it set.
     accounts/{pin}.division  free text, for division directors
   Extra collections:
     cases/{id}   { pin, name?, type, title, detail{}, status, bureau, assignee?, assigneeName?, notes[], createdAt, updatedAt, updatedBy? }
                  Public portal pages create these (status "open"); staff work them here.
     audit/{id}   { actorPin, actorName, role, bureau, action, target, detail, at } */
import { boot, db, E, $, el, cap, ms, when, ROLE_LABELS, STAFF_ROLES, PERM_LABELS, logActivity, logAccess, list, money } from "https://migovt.org/sos/eservices/assets/shared.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore, doc, getDocs, addDoc, updateDoc, collection, query, where, limit, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
export { $, el, cap, ms, when, ROLE_LABELS, STAFF_ROLES, PERM_LABELS, E, db, list, money };

/* ---------- bureaus and roles ---------- */
export const BUREAUS = { lara: "Licensing and Regulatory Affairs", elections: "Elections", hearings: "Administrative Hearings and Appeals" };
/* Each officer belongs to one bureau. Directors and deputies are assigned a bureau on their account. */
const ROLE_BUREAU = { "licensing-officer": "lara", "records-officer": "lara", "elections-officer": "elections", "hearing-officer": "hearings" };
export const RANK = { "system-administrator": 95, "secretary-of-state": 100, "deputy-secretary-of-state": 90, "bureau-director": 80, "deputy-bureau-director": 70, "division-director": 60, "deputy-division-director": 50, "licensing-officer": 30, "records-officer": 30, "elections-officer": 30, "hearing-officer": 30 };
/* These roles see every bureau. Everyone else sees only their own. */
const ALL_BUREAUS = ["system-administrator", "secretary-of-state", "deputy-secretary-of-state"];
const NOT_SYSADMIN = STAFF_ROLES.filter(r => r !== "system-administrator");
const CAPS = {
  "queue.decide": NOT_SYSADMIN,                    // change a case's status, assign it, add notes
  "cases.open": NOT_SYSADMIN,                      // open a case for a person
  "notices.send": NOT_SYSADMIN,                    // send a notice to one person
  "notices.global": ["system-administrator", "secretary-of-state", "deputy-secretary-of-state", "bureau-director"], // notice to everyone
  "accounts.manage": ALL_BUREAUS.slice(),          // open the account administration page, edit bureau, division, special permissions
  "accounts.roles": ["system-administrator"],      // change a role
  "audit.view": [...ALL_BUREAUS, "bureau-director", "deputy-bureau-director"]
};

/* What the Department tells a person about an action. Staff names stay in the audit log, not on the person's history. */
export const AGENCY = { kind: "agency", name: "Department of State" };

/* ---------- boot ---------- */
function deny(text) {
  const b = $("p-body");
  b.replaceChildren(el("div", { class: "pc" }, el("h2", { text: "Access restricted" }), el("p", { text }), el("p", { class: "mt" }, el("a", { class: "btn2", href: E + "home/", text: "Back to e-Services" }))));
  b.hidden = false;
  return new Promise(() => {});
}
export async function bootStaff(opts = {}) {
  const ctx = await boot({ page: opts.page });
  if (!ctx.isStaff) return deny("This area is for Department of State staff.");
  ctx.bureau = ctx.acct.bureau || ROLE_BUREAU[ctx.role] || null;
  ctx.division = ctx.acct.division || "";
  ctx.scope = ALL_BUREAUS.includes(ctx.role) ? "all" : ctx.bureau;
  ctx.rank = RANK[ctx.role] || 0;
  ctx.roleLabel = ROLE_LABELS[ctx.role] || cap(ctx.role);
  ctx.can = c => (CAPS[c] || []).includes(ctx.role);
  ctx.deskOk = b => ctx.scope === "all" || ctx.scope === b;
  ctx.who = { pin: ctx.id.pin, name: ctx.id.name, kind: "agency" };
  if (opts.cap && !ctx.can(opts.cap)) return deny("Your role does not include this page.");
  if (opts.desk && !ctx.deskOk(opts.desk)) return deny(ctx.scope ? "This desk belongs to " + BUREAUS[opts.desk] + ". Your account is assigned to " + (BUREAUS[ctx.scope] || "no bureau") + "." : "Your account has no bureau yet. A System Administrator can assign one.");
  return ctx;
}

/* ---------- audit ---------- */
export function audit(ctx, action, target, detail) {
  return addDoc(collection(db, "audit"), { actorPin: ctx.id.pin, actorName: ctx.id.name || "", role: ctx.role, bureau: ctx.bureau || "", action, target: String(target || "").slice(0, 60), detail: String(detail || "").slice(0, 300), at: serverTimestamp() }).catch(e => console.warn("Could not write audit entry", e));
}
export async function loadAudit(ctx, n = 150, actorPin) {
  const col = collection(db, "audit");
  const q = actorPin ? query(col, where("actorPin", "==", String(actorPin)), limit(200)) : query(col, limit(400));
  let rows = (await getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));
  if (!actorPin && ctx.scope !== "all") rows = rows.filter(r => r.bureau === ctx.scope);
  return rows.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, n);
}

/* ---------- cases ---------- */
/* type -> [label, bureau]. Public portal pages create cases with one of these types. */
export const CASE_TYPES = {
  "license.contest": ["Contest points", "lara"], "license.application": ["License application", "lara"], "license.reinstatement": ["Reinstatement request", "lara"],
  "id.application": ["ID application", "lara"], "name.change": ["Name change", "lara"], "dealer.license": ["Dealership license", "lara"],
  "insurer.license": ["Insurance license", "lara"], "professional.license": ["Professional license", "lara"],
  "record.copy": ["Certified record request", "lara"], "vital.request": ["Vital record request", "lara"],
  "voter.registration": ["Voter registration", "elections"], "candidate.filing": ["Candidate filing", "elections"], "finance.report": ["Campaign finance report", "elections"],
  "business.registration": ["Business registration", "elections"], "notary.commission": ["Notary commission", "elections"],
  "appeal": ["Administrative appeal", "hearings"]
};
export const typeLabel = t => (CASE_TYPES[t] || [cap(String(t).replace(/\./g, " "))])[0];
export const STATUS = { open: "Open", "in-review": "In review", approved: "Approved", denied: "Denied", closed: "Closed", scheduled: "Scheduled", decided: "Decided" };
export const statusesFor = bureau => bureau === "hearings" ? ["open", "in-review", "scheduled", "decided", "closed"] : ["open", "in-review", "approved", "denied", "closed"];
const ACTIVE = ["open", "in-review", "scheduled"];
const statusClass = s => ACTIVE.includes(s) ? (s === "open" ? "o" : "") : (s === "approved" || s === "decided" ? "g" : "n");

/* bureau: limit to one bureau. prefixes: only case types that start with one of these ("license.", "id."). */
export async function loadCases(ctx, { bureau, prefixes } = {}) {
  const b = bureau || (ctx.scope !== "all" ? ctx.scope : null), col = collection(db, "cases");
  const snap = await getDocs(b ? query(col, where("bureau", "==", b), limit(300)) : query(col, limit(300)));
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (prefixes) rows = rows.filter(r => prefixes.some(p => String(r.type).startsWith(p)));
  return rows.sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
}
/* Every case for one person, newest first. */
export async function loadCasesFor(pin) {
  const s = await getDocs(query(collection(db, "cases"), where("pin", "==", String(pin)), limit(100)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
}
export const caseStats = rows => ({ open: rows.filter(r => r.status === "open").length, review: rows.filter(r => r.status === "in-review" || r.status === "scheduled").length, done: rows.filter(r => !ACTIVE.includes(r.status)).length });

/* Open a case for a person (staff). */
export async function openCase(ctx, { pin, name, type, title, detail }) {
  const bureau = (CASE_TYPES[type] || [])[1] || ctx.bureau || "lara";
  const d = { pin: String(pin), type, title: String(title).slice(0, 140), status: "open", bureau, createdBy: ctx.id.pin, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  if (name) d.name = name; if (detail) d.detail = detail;
  const ref = await addDoc(collection(db, "cases"), d);
  await audit(ctx, "case.open", pin, typeLabel(type) + ": " + d.title);
  await logActivity(pin, "case.opened", typeLabel(type) + " opened", AGENCY);
  return ref;
}

/* Draw a filterable case table with a detail panel. rows come from loadCases(). */
export function renderQueue(root, ctx, rows, { emptyText } = {}) {
  const state = { filter: "active", text: "" };
  const bar = el("div", { class: "bar" });
  const sel = el("select", { "aria-label": "Status" }, [["active", "Active"], ["all", "All"], ...Object.keys(STATUS).map(k => [k, STATUS[k]])].map(([v, t]) => el("option", { value: v, text: t })));
  const txt = el("input", { type: "search", placeholder: "Filter by PIN, name, or title", "aria-label": "Filter" });
  bar.append(sel, txt);
  const wrap = el("div", { class: "tw" }), panel = el("div", { class: "mt" });
  root.replaceChildren(bar, wrap, panel);

  function draw() {
    const q = state.text.toLowerCase();
    const list = rows.filter(r => (state.filter === "all" || (state.filter === "active" ? ACTIVE.includes(r.status) : r.status === state.filter)) && (!q || (r.pin + " " + (r.name || "") + " " + (r.title || "") + " " + typeLabel(r.type)).toLowerCase().includes(q)));
    if (!list.length) { wrap.replaceChildren(el("div", { class: "empty", text: emptyText || "No cases match." })); return; }
    const t = el("table", { class: "tbl" }, el("tr", {}, ["Case", "Person", "Status", "Assigned", "Updated"].map(h => el("th", { text: h }))));
    list.forEach(r => {
      const tr = el("tr", { class: "row", tabindex: "0" },
        el("td", {}, el("b", { text: typeLabel(r.type) }), el("br"), r.title || ""),
        el("td", {}, r.name || "PIN " + r.pin, el("br"), el("small", { class: "empty", text: "PIN " + r.pin })),
        el("td", {}, el("span", { class: "pill " + statusClass(r.status), text: STATUS[r.status] || cap(r.status) })),
        el("td", { text: r.assigneeName || "Unassigned" }),
        el("td", { text: when(r.updatedAt) }));
      const open = () => detail(r); tr.addEventListener("click", open); tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
      t.append(tr);
    });
    wrap.replaceChildren(t);
  }

  function detail(r) {
    const canWork = ctx.can("queue.decide") && ctx.deskOk(r.bureau);
    const box = el("div", { class: "pc detail" }, el("h3", { text: typeLabel(r.type) + ": " + (r.title || "") }),
      el("p", { class: "sub", text: (r.name || "PIN " + r.pin) + " | Opened " + when(r.createdAt) + " | " + (BUREAUS[r.bureau] || "") }));
    const det = r.detail && typeof r.detail === "object" ? Object.entries(r.detail) : [];
    if (det.length) { const kv = el("div", { class: "kv2" }); det.forEach(([k, v]) => kv.append(el("div", {}, el("span", { text: cap(k) }), el("b", { text: String(v) })))); box.append(kv); }
    box.append(el("h4", { class: "grp-h", text: "Notes" }));
    const notes = Array.isArray(r.notes) ? r.notes : [];
    if (!notes.length) box.append(el("div", { class: "empty", text: "No notes yet." }));
    notes.forEach(n => box.append(el("div", { class: "notice" }, el("b", { text: n.name || "Staff" }), el("span", { text: n.text }), el("small", { class: "empty", text: " " + when(n.at) }))));
    if (canWork) {
      const st = el("select", { id: "cs" }, statusesFor(r.bureau).map(s => el("option", { value: s, text: STATUS[s] }))); st.value = r.status;
      const note = el("textarea", { rows: "3", placeholder: "Add a note (optional)", "aria-label": "Note" });
      const assign = el("input", { type: "checkbox", id: "ca" }); assign.checked = r.assignee === ctx.id.pin;
      const msg = el("div", { class: "empty" });
      const save = el("button", { class: "btn2", type: "button", text: "Save changes" });
      save.addEventListener("click", async () => {
        save.disabled = true; msg.textContent = "Saving...";
        try {
          const up = { status: st.value, updatedAt: serverTimestamp(), updatedBy: ctx.id.pin };
          if (assign.checked && r.assignee !== ctx.id.pin) { up.assignee = ctx.id.pin; up.assigneeName = ctx.id.name || ""; }
          if (!assign.checked && r.assignee === ctx.id.pin) { up.assignee = ""; up.assigneeName = ""; }
          const nt = note.value.trim(); const nn = nt ? { by: ctx.id.pin, name: ctx.id.name || "Staff", text: nt.slice(0, 600), at: Date.now() } : null;
          if (nn) up.notes = arrayUnion(nn);
          await updateDoc(doc(db, "cases", r.id), up);
          if (st.value !== r.status) { await audit(ctx, "case.status", r.pin, typeLabel(r.type) + ": " + (STATUS[r.status] || r.status) + " to " + STATUS[st.value]); await logActivity(r.pin, "case.status", typeLabel(r.type) + ": " + STATUS[st.value], AGENCY); }
          else if (nn) await audit(ctx, "case.note", r.pin, typeLabel(r.type));
          Object.assign(r, { status: st.value, assignee: up.assignee ?? r.assignee, assigneeName: up.assigneeName ?? r.assigneeName, notes: nn ? [...notes, nn] : notes, updatedAt: Date.now() });
          draw(); detail(r);
        } catch (e) { console.error(e); msg.textContent = "Could not save. Check the Firestore rules."; save.disabled = false; }
      });
      box.append(el("h4", { class: "grp-h", text: "Work this case" }),
        el("div", { class: "fld" }, el("label", { for: "cs", text: "Status" }), st),
        el("div", { class: "fld" }, el("label", { text: "Note" }), note),
        el("div", { class: "fld" }, el("label", { for: "ca" }, assign, " Assign to me")),
        save, msg);
    } else box.append(el("div", { class: "empty mt", text: "You can view this case but not change it." }));
    const close = el("button", { class: "btn2 s mt", type: "button", text: "Close" }); close.addEventListener("click", () => panel.replaceChildren());
    box.append(el("p", {}, close));
    panel.replaceChildren(box); box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  sel.addEventListener("change", () => { state.filter = sel.value; draw(); });
  txt.addEventListener("input", () => { state.text = txt.value.trim(); draw(); });
  draw();
}

/* ---------- people (MiGOVT accounts) ---------- */
const MIGOVT = { apiKey: "AIzaSyCWJBf_xxGj8JWbfwzzEHmtdzMmiLTGTas", authDomain: "mipass-77b56.firebaseapp.com", projectId: "mipass-77b56", storageBucket: "mipass-77b56.firebasestorage.app", messagingSenderId: "326401354685", appId: "1:326401354685:web:dee9e48de3975a72d600d4" };
let mdb = null;
const migovt = () => mdb || (mdb = getFirestore(initializeApp(MIGOVT, "migovt")));
const shape = (d, id) => ({ pin: String(d.pin || id || ""), name: d.name || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" "), dob: d.dateOfBirth || "", roblox: d.robloxUsername || "", discord: d.discordUsername || "", email: d.email || "" });
const cache = new Map();
export async function getPerson(pin) {
  pin = String(pin);
  if (cache.has(pin)) return cache.get(pin);
  const s = await getDocs(query(collection(migovt(), "mipass"), where("pin", "==", pin), limit(1)));
  const p = s.empty ? null : shape(s.docs[0].data(), s.docs[0].id);
  cache.set(pin, p); return p;
}
/* Search by PIN (digits) or by the start of a name. */
export async function searchPeople(text) {
  const q = text.trim(); if (!q) return [];
  const col = collection(migovt(), "mipass"), out = new Map();
  const add = s => s.docs.forEach(d => { const p = shape(d.data(), d.id); if (p.pin) out.set(p.pin, p); });
  if (/^\d{4,20}$/.test(q)) add(await getDocs(query(col, where("pin", "==", q), limit(5))));
  else for (const v of new Set([q, q.replace(/\b\w/g, c => c.toUpperCase()), q.toLowerCase()])) add(await getDocs(query(col, where("name", ">=", v), where("name", "<=", v + ""), limit(10))));
  return [...out.values()];
}

/* ---------- staff, accounts, notices ---------- */
export async function listStaff() {
  const s = await getDocs(query(collection(db, "accounts"), where("role", "!=", "basic"), limit(300)));
  const rows = s.docs.map(d => d.data());
  await Promise.all(rows.map(async r => { try { r.person = await getPerson(r.pin); } catch { r.person = null; } }));
  return rows.sort((a, b) => (RANK[b.role] || 0) - (RANK[a.role] || 0));
}
export async function getAccount(pin) {
  const s = await getDocs(query(collection(db, "accounts"), where("pin", "==", String(pin)), limit(1)));
  return s.empty ? null : s.docs[0].data();
}
/* fields: { role?, bureau, division, specialPermissions } */
export async function saveAccount(ctx, pin, fields) {
  const up = { ...fields, updatedBy: ctx.id.pin, updatedAt: serverTimestamp() };
  await updateDoc(doc(db, "accounts", String(pin)), up);
  await audit(ctx, "account.update", pin, Object.keys(fields).map(k => k + "=" + (Array.isArray(fields[k]) ? fields[k].join("|") || "none" : fields[k] || "none")).join(", "));
}
export async function sendNotice(ctx, pin, { title, body, level }) {
  const d = { pin: pin === "*" ? "*" : String(pin), title: String(title).slice(0, 120), body: String(body).slice(0, 800), level: level === "important" ? "important" : "info", at: serverTimestamp(), read: false, by: ctx.id.pin, byName: ctx.id.name || "" };
  await addDoc(collection(db, "notices"), d);
  await audit(ctx, d.pin === "*" ? "notice.global" : "notice.send", d.pin, d.title);
}
export async function sentNotices(ctx) {
  const s = await getDocs(query(collection(db, "notices"), where("by", "==", ctx.id.pin), limit(100)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.at) - ms(a.at));
}

/* Staff looked someone up. Shows on the person's own history as an access by the Department. */
export const logSearchAppeared = (pin) => logAccess(pin, "search", AGENCY);
export const logSearchOpened = (pin) => logAccess(pin, "open", AGENCY);