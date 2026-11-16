/* MiGOVT SOS e-Services: shared logic (ES module).
   Handles MiGOVT sign-in, the SOS account (role + specialPermissions), the top bar user chip, and the history, fee, and notice data every portal page uses.

   Usage in a portal page:
     <script type="module">
       import { boot, list, money, when } from "https://migovt.org/sos/eservices/assets/shared.js";
       const ctx = await boot({ page: "home" });      // ctx = { id, acct, role, perms, created, has(perm) }
       ...build the page with ctx...
     </script>
   Pages need two wrappers: <div id="p-load" class="pload">Loading...</div> and <div id="p-body" hidden>...</div>.
   boot() signs the person in (or sends them to MiGOVT Login and back to the same page), then swaps them.

   Firestore (project misos-f7956):
     accounts/{pin}      { pin, role, specialPermissions[], createdAt, lastLoginAt, loginCount, bureau?, division?,
                        name, firstName, middleName, lastName, dateOfBirth, email, robloxUsername, discordUsername (copied from MiGOVT at sign-in), identitySyncedAt, }   role: "basic" (default) or a staff role (see ROLE_LABELS)
     activity/{id}       { pin, type, summary, actorPin?, actorName?, actorKind?, hidden, at }       what happened to or by the person with this pin
     transactions/{id}   { pin, desc, amount, status, at }                                           fees
     notices/{id}        { pin ("*" = everyone), title, body, level, at, read }                      official notices (created by staff in the console) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, query, where, limit, serverTimestamp, increment, arrayUnion, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export const B = "https://migovt.org/sos/", E = B + "eservices/";
const FB = { apiKey: "AIzaSyCzMDtySiPOXM5J15ePmjyUZRn_Zcyz2w0", authDomain: "misos-f7956.firebaseapp.com", projectId: "misos-f7956",
  storageBucket: "misos-f7956.firebasestorage.app", messagingSenderId: "696781263120", appId: "1:696781263120:web:0a2b3c56d8ad9ede0f5595", measurementId: "G-JRGCL61BWX" };
export const db = getFirestore(initializeApp(FB));

/* ---------- labels: add new roles and special permissions here ---------- */
export const ROLE_LABELS = {
  basic: "Basic",
  "system-administrator": "System Administrator", "secretary-of-state": "Secretary of State", "deputy-secretary-of-state": "Deputy Secretary of State",
  "bureau-director": "Bureau Director", "deputy-bureau-director": "Deputy Bureau Director",
  "division-director": "Division Director", "deputy-division-director": "Deputy Division Director",
  "licensing-officer": "Licensing Officer", "records-officer": "Records Officer", "elections-officer": "Elections Officer", "hearing-officer": "Hearing Officer"
};
/* Every role except "basic" is Department of State staff and can open the staff portal at /sos/eservices/staff/home/. */
export const STAFF_ROLES = Object.keys(ROLE_LABELS).filter(r => r !== "basic");
export const PERM_LABELS = { dealer: "Licensed dealer", insurer: "Licensed insurer", "records-access": "Records access" };

/* ---------- small helpers ---------- */
export const $ = id => document.getElementById(id);
export const cap = s => String(s || "").replace(/^./, c => c.toUpperCase());
export const money = n => (n < 0 ? "-" : "") + "$" + Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ms = t => (t && t.toMillis ? t.toMillis() : +t || 0);
export const when = t => { const m = ms(t); return m ? new Date(m).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longDate = iso => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ""); return m ? LONG[+m[2] - 1] + " " + +m[3] + ", " + m[1] : (iso || "Not on file"); };
/* build DOM safely: el("div", { class: "x" }, "text", childNode) */
export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) { if (k === "class") e.className = props[k]; else if (k === "text") e.textContent = props[k]; else e.setAttribute(k, props[k]); }
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
}
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }, del: k => { try { sessionStorage.removeItem(k); } catch {} } };

/* ---------- session (MiGOVT sign-in carried over to SOS) ---------- */
const SK = "sos_session", DAYS = 30;
export function loadSession() {
  try { const o = JSON.parse(ls.get(SK) || "null"); if (o && o.pin && o.exp > Date.now()) return o; } catch {}
  ls.del(SK); return null;
}
const saveSession = id => ls.set(SK, JSON.stringify({ ...id, exp: Date.now() + DAYS * 864e5 }));
export const loginUrl = (returnTo) => "https://migovt.org/login/?redirect_uri=" + encodeURIComponent(returnTo || (location.origin + location.pathname)) + "&site_name=" + encodeURIComponent("SOS e-Services");
export function signOut() { ls.del(SK); ss.del("sos_counted"); ss.del("sos_signin_logged"); location.href = E; }

/* MiGOVT Login sends people back to the page they came from with their details in the address. */
function identityFromReturn() {
  const p = new URLSearchParams(location.search);
  if (!p.has("mipass_pin")) return null;
  const pin = (p.get("mipass_pin") || "").trim(), g = k => (p.get("mipass_" + k) || "").trim();
  history.replaceState({}, "", location.pathname + location.hash);
  if (!/^\d{4,20}$/.test(pin)) return null;
  return { pin, name: g("name"), first: g("first"), middle: g("middle"), last: g("last"), dob: g("dob"), roblox: g("user"), email: g("email"), discord: g("discord") };
}

/* ---------- account: created the first time, "basic" with no special permissions ----------
   The MiGOVT details that sign-in hands us are copied onto the SOS account, so SOS reads its own database from then on. */
const IDENT = id => {
  const m = { name: id.name, firstName: id.first, middleName: id.middle, lastName: id.last, dateOfBirth: id.dob, email: id.email, robloxUsername: id.roblox, discordUsername: id.discord }, o = {};
  for (const k in m) if (m[k]) o[k] = String(m[k]).slice(0, 120);
  return o;
};
async function ensureAccount(id) {
  const pin = id.pin, ref = doc(db, "accounts", pin), snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { pin, role: "basic", specialPermissions: [], ...IDENT(id), identitySyncedAt: serverTimestamp(), createdAt: serverTimestamp(), lastLoginAt: serverTimestamp(), loginCount: 1 });
    ss.set("sos_counted", pin);
    return { data: (await getDoc(ref)).data(), created: true };
  }
  const cur = snap.data(); let changed = false;
  if (ss.get("sos_counted") !== pin) { ss.set("sos_counted", pin); await updateDoc(ref, { lastLoginAt: serverTimestamp(), loginCount: increment(1) }).catch(() => {}); }
  /* Accounts made before this copy existed get their MiGOVT details once. */
  if (!cur.identitySyncedAt) { try { await updateDoc(ref, { ...IDENT(id), identitySyncedAt: serverTimestamp() }); changed = true; } catch (e) { console.warn("Could not copy MiGOVT details", e); } }
  else {
    /* Contact details can change at MiGOVT, so keep those current. Name and date of birth stay as the SOS record has them. */
    const up = {}, ident = IDENT(id);
    ["email", "robloxUsername", "discordUsername"].forEach(k => { if (ident[k] && ident[k] !== cur[k]) up[k] = ident[k]; });
    if (Object.keys(up).length) { try { await updateDoc(ref, up); changed = true; } catch (e) { console.warn("Could not refresh contact details", e); } }
  }
  return { data: changed ? (await getDoc(ref)).data() : cur, created: false };
}

/* ---------- data: history, fees, notices ---------- */
/* Newest first. Filters on pin only, so no Firestore index is needed. */
export async function list(coll, pin, n = 50) {
  const q = await getDocs(query(collection(db, coll), where("pin", "==", String(pin)), limit(200)));
  return q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.at) - ms(a.at)).slice(0, n);
}
/* Notices for one person plus notices for everyone. */
export async function notices(pin, n = 20) {
  const [mine, all] = await Promise.all([list("notices", pin, 100), list("notices", "*", 100)]);
  return [...mine, ...all].sort((a, b) => ms(b.at) - ms(a.at)).slice(0, n);
}
/* Something happened on this person's account. actor = { pin, name, kind } (kind: "self", "person", "agency", "insurer", "employer", "lein").
   hidden entries never show on the person's own history (use for law enforcement network searches). */
export function logActivity(pin, type, summary, actor, hidden = false) {
  const d = { pin: String(pin), type, summary: String(summary).slice(0, 300), hidden: !!hidden, at: serverTimestamp() };
  if (actor) { if (actor.pin) d.actorPin = String(actor.pin); if (actor.name) d.actorName = String(actor.name).slice(0, 80); if (actor.kind) d.actorKind = String(actor.kind); }
  return addDoc(collection(db, "activity"), d).catch(e => console.warn("Could not log activity", e));
}
/* Someone looked up a person. kind: "search" (they appeared in a result list), "open" (the result was clicked),
   "license", "record", "registration", "title", "insurance". Pass actor.kind "lein" for law enforcement network searches, which stay hidden. */
const ACCESS = { search: ["search.appeared", "Appeared in a search"], open: ["search.opened", "Your result was opened"], license: ["access.license", "License status viewed"], record: ["access.record", "Driving record accessed"], registration: ["access.registration", "Registration viewed"], title: ["access.title", "Title viewed"], insurance: ["access.insurance", "Insurance viewed"] };
export function logAccess(subjectPin, kind, actor) {
  const a = ACCESS[kind] || ["access.other", "Account viewed"];
  return logActivity(subjectPin, a[0], a[1] + (actor && actor.name ? " by " + actor.name : ""), actor, !!(actor && actor.kind === "lein"));
}
/* A fee was charged. */
export function charge(pin, desc, amount, status = "paid") {
  return addDoc(collection(db, "transactions"), { pin: String(pin), desc: String(desc).slice(0, 120), amount: Number(amount), status, at: serverTimestamp() }).catch(e => console.warn("Could not record fee", e));
}
/* A person files a request with the Department (name change, ID application, record request...). Staff work it from the Work Queue. */
export async function fileCase(ctx, type, title, detail, bureau = "lara") {
  const d = { pin: ctx.id.pin, type, title: String(title).slice(0, 140), status: "open", bureau, createdBy: ctx.id.pin, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  if (ctx.id.name) d.name = ctx.id.name; if (detail) d.detail = detail;
  const ref = await addDoc(collection(db, "cases"), d);
  await logActivity(ctx.id.pin, "case.opened", String(title).slice(0, 140), { pin: ctx.id.pin, name: ctx.id.name, kind: "self" });
  return ref;
}
/* The person's own requests, newest first. */
export async function myCases(pin, n = 50) {
  const q = await getDocs(query(collection(db, "cases"), where("pin", "==", String(pin)), limit(100)));
  return q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)).slice(0, n);
}
/* ---------- vital records: the "persons" collection in the records Firestore (project mi-vital-records) ----------
   persons/{pin} = { firstName, middleName, lastName, dob "MM/DD/YYYY", birthTime, cityOfBirth, countyOfBirth, stateOfBirth, status?, updatedAt (ISO text) }
   status is "None", "Citizen", or "Resident"; a record with no status counts as "None". */
const RECORDS = { apiKey: "AIzaSyCO08jleK1_Mk4__huY3cP-wKa5SDdLitw", authDomain: "mi-vital-records.firebaseapp.com", projectId: "mi-vital-records",
  storageBucket: "mi-vital-records.firebasestorage.app", messagingSenderId: "775067715147", appId: "1:775067715147:web:7c2ff2e56a9f98929d2fce" };
let _rdb = null;
export const recDb = () => _rdb || (_rdb = getFirestore(initializeApp(RECORDS, "records")));
export const STATUSES = ["None", "Citizen", "Resident"];
export const statusOf = r => { const v = String((r && r.status) || "").trim().toLowerCase(); return v === "citizen" ? "Citizen" : v === "resident" ? "Resident" : "None"; };
export async function getRecord(pin) {
  const s = await getDoc(doc(recDb(), "persons", String(pin)));
  return s.exists() ? { pin: String(pin), ...s.data() } : null;
}
/* Staff change a person's status. Written to the vital record, which is where status lives. */
export async function setRecordStatus(pin, status) {
  if (!STATUSES.includes(status)) throw new Error("Unknown status");
  await updateDoc(doc(recDb(), "persons", String(pin)), { status, updatedAt: new Date().toISOString() });
}
/* Names on the vital record. previousNames = [{ first, middle, last, until }] in order, oldest first, so previousNames[0] is the birth name.
   An approved name change writes the new name onto the record and appends the name it replaced. Returns false when there is no record. */
export const nameOf = n => [n.first ?? n.firstName, n.middle ?? n.middleName, n.last ?? n.lastName].filter(Boolean).join(" ");
export const previousNamesOf = r => (r && Array.isArray(r.previousNames)) ? r.previousNames : [];
/* The name recorded at birth: the oldest previous name if the person has changed it, otherwise the current name. */
export const birthNameOf = r => { const p = previousNamesOf(r); return p.length ? nameOf(p[0]) : nameOf(r || {}); };
export async function applyNameToRecord(pin, parts) {
  const ref = doc(recDb(), "persons", String(pin)), snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const cur = snap.data(), now = new Date().toISOString();
  await updateDoc(ref, { firstName: parts.first, middleName: parts.middle || "", lastName: parts.last,
    previousNames: arrayUnion({ first: cur.firstName || "", middle: cur.middleName || "", last: cur.lastName || "", until: now }), updatedAt: now });
  return true;
}
/* The MiGOVT account (project mipass-77b56, collection "mipass", looked up by pin). An approved name change is written back here too,
   so the person's name is the same everywhere. Returns false when no MiGOVT account has that pin. */
const MIGOVT = { apiKey: "AIzaSyCWJBf_xxGj8JWbfwzzEHmtdzMmiLTGTas", authDomain: "mipass-77b56.firebaseapp.com", projectId: "mipass-77b56",
  storageBucket: "mipass-77b56.firebasestorage.app", messagingSenderId: "326401354685", appId: "1:326401354685:web:dee9e48de3975a72d600d4" };
let _mdb = null;
const migovtDb = () => _mdb || (_mdb = getFirestore(initializeApp(MIGOVT, "migovt")));
export async function applyNameToMiGOVT(pin, parts) {
  const q = await getDocs(query(collection(migovtDb(), "mipass"), where("pin", "==", String(pin)), limit(1)));
  if (q.empty) return false;
  await updateDoc(q.docs[0].ref, { name: [parts.first, parts.middle, parts.last].filter(Boolean).join(" "), firstName: parts.first, middleName: parts.middle || "", lastName: parts.last });
  return true;
}
/* ---------- courts portal: the Michigan Courts Firestore (project micourt-dada6) ----------
   An approved name change is carried into the courts portal so the person has one name everywhere:
     accounts/{uid}   the portal account (found by mipassPin or pin): name changes, the old name is added to previousNames
     sbm/{bar number} the State Bar registry entry for an attorney (found by pin): same
     cases, mscCases  every party with this pin gets the new name and the old name(s) added to aliases (shown as "a/k/a"),
                      every attorney entry with the person's bar number gets the new name, and a judge or magistrate's name on a case is updated.
                      On every case where the person is a party, an MC 53 (Notice of Legal Name Change) is filed on the docket.
   Case history (docket events, filings, documents) is never rewritten: what was signed under the old name stays as it was. */
const COURTS = { apiKey: "AIzaSyA8sUFIq81cs6uQvqduardpGJ4R2DxO8NQ", authDomain: "micourt-dada6.firebaseapp.com", projectId: "micourt-dada6",
  storageBucket: "micourt-dada6.firebasestorage.app", messagingSenderId: "1013564619997", appId: "1:1013564619997:web:8f259dab457915758f6f34" };
let _cdb = null;
let _capp = null;
const courtsApp = () => _capp || (_capp = initializeApp(COURTS, "courts"));
const courtsDb = () => _cdb || (_cdb = getFirestore(courtsApp()));
const lcn = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const uniqNames = a => { const seen = new Set(), out = []; for (const n of a) { const t = String(n || "").replace(/\s+/g, " ").trim(), k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } } return out; };
/* What a name change does to one case record. Returns the fields to write, or null when the case is not affected.
   who = { pin, newName, oldNames[], bars[] (bar numbers), judge (true if this person sits as a judge or magistrate) } */
export function renameInCase(c, who) {
  const pin = String(who.pin), newName = who.newName, olds = who.oldNames, bars = new Set((who.bars || []).map(String));
  const isOld = n => olds.some(o => lcn(o) === lcn(n));
  let touched = false;
  const fixAtty = a => { if (!a || typeof a !== "object" || !a.name) return a; if (a.barNumber && bars.has(String(a.barNumber)) && a.name !== newName) { touched = true; return { ...a, name: newName }; } return a; };
  const patch = {};
  if (Array.isArray(c.parties)) {
    const parties = c.parties.map(p => {
      if (!p || typeof p !== "object") return p;
      let q = p;
      if (String(p.pin || "") === pin && p.name !== newName) {
        const aliases = uniqNames([...(Array.isArray(p.aliases) ? p.aliases : []), p.name, ...olds]).filter(n => lcn(n) !== lcn(newName));
        q = { ...q, name: newName, aliases }; touched = true;
      }
      if (bars.size) {
        if (Array.isArray(q.attorneys)) { const at = q.attorneys.map(fixAtty); if (at.some((x, i) => x !== q.attorneys[i])) q = { ...q, attorneys: at }; }
        if (q.attorney) { const at = fixAtty(q.attorney); if (at !== q.attorney) q = { ...q, attorney: at }; }
      }
      return q;
    });
    if (touched) patch.parties = parties;
  }
  if (who.judge) {
    const swap = s => { let t = String(s || ""); for (const o of olds) if (o && lcn(t).includes(lcn(o))) t = t.replace(new RegExp(o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i"), newName); return t; };
    if (typeof c.judge === "string" && c.judge && swap(c.judge) !== c.judge) patch.judge = swap(c.judge);
    if (Array.isArray(c.judges) && c.judges.some(j => typeof j === "string" && swap(j) !== j)) patch.judges = c.judges.map(j => typeof j === "string" ? swap(j) : j);
  }
  return Object.keys(patch).length ? patch : null;
}
const usDate = d => String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + "/" + d.getFullYear();
const dobText = v => { const t = String(v || ""), m = /^(\d{4})-(\d\d)-(\d\d)/.exec(t); return m ? m[2] + "/" + m[3] + "/" + m[1] : t; };
const side = r => /defendant|respondent|appellee/i.test(r || "") ? 1 : /plaintiff|petitioner|prosecut|appellant|applicant|complainant|claimant/i.test(r || "") ? 0 : null;
/* The MC 53 (Notice of Legal Name Change) as a saved form (.md), in the same format the court's Document Drafting uses. */
function mc53Md(c, caseId, o) {
  const ps = Array.isArray(c.parties) ? c.parties.filter(p => p && p.name) : [], nm = p => { const a = (Array.isArray(p.aliases) ? p.aliases : []).filter(Boolean); return a.length ? p.name + ", a/k/a " + a.join(", a/k/a ") : p.name; };
  const pl = ps.filter(p => side(p.role) === 0), df = ps.filter(p => side(p.role) === 1);
  const cap = (pl[0] && df[0]) ? pl[0].name + " v. " + df[0].name : (pl[0] || df[0] || {}).name || "";
  const L = (k, v) => "- " + k + ": " + String(v == null ? "" : v).replace(/\n/g, " ");
  const blk = (k, v) => "\n### " + k + "\n\n```text\n" + (v || "") + "\n```";
  const f = o.fromParts, n = o.parts;
  return ["---\nform: MC 53\ntitle: Notice of Legal Name Change\n---\n\n# MC 53\n",
    ["## Case\n", L("Judge", typeof c.judge === "string" ? c.judge : ""), L("Case No.", caseId), L("Plaintiff/Petitioner name", pl.map(nm).join(", ")), L("Defendant/Respondent name", df.map(nm).join(", ")), L("In the matter of", c.caseTitleOverride || cap), blk("Plaintiff/Petitioner address", ""), blk("Defendant/Respondent address", "")].join("\n") + "\n",
    ["## Former legal name\n", L("Former first name", f.first), L("Former middle name", f.middle), L("Former last name", f.last)].join("\n") + "\n",
    ["## Current legal name\n", L("Current first name", n.first), L("Current middle name", n.middle), L("Current last name", n.last), L("Date of birth", o.dob), L("Personal identification number", o.pin)].join("\n") + "\n",
    ["## Certification\n", L("Authorized representative", o.by), L("Date", usDate(new Date())), L("Signature", o.by)].join("\n") + "\n"].join("\n");
}
/* Save the MC 53 with the court's filed documents and return the link to open it. Needs the Storage rule for MC 53 uploads. */
async function saveMc53(caseId, md, who) {
  const st = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js");
  const path = "filingUploads/" + caseId + "/" + Date.now() + "-MC53_" + String(who).replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40) + ".md";
  await st.uploadBytes(st.ref(st.getStorage(courtsApp()), path), new Blob([md], { type: "text/markdown" }), { contentType: "text/markdown" });
  return "https://migovt.org/courts/documents/#/" + path.split("/").map(encodeURIComponent).join("/");
}
/* parts = { first, middle, last }; fromName = the name the person had when they applied.
   info = { fromParts: { first, middle, last } (the name being replaced), dob, by (who files it) }.
   Returns { accounts, bar, cases, notices, noticeFailed } (records changed, MC 53s filed, MC 53s that could not be filed).
   Throws if the courts Firestore refuses a write. */
export async function applyNameToCourts(pin, parts, fromName, info = {}) {
  pin = String(pin);
  const db2 = courtsDb(), newName = [parts.first, parts.middle, parts.last].filter(Boolean).join(" "), when = new Date().toISOString();
  const out = { accounts: 0, bar: 0, cases: 0, notices: 0, noticeFailed: 0 }, olds = [fromName], bars = new Set(); let judge = false;
  /* the portal account(s) */
  const accts = new Map();
  for (const f of ["mipassPin", "pin"]) {
    const s = await getDocs(query(collection(db2, "accounts"), where(f, "==", pin), limit(5)));
    s.docs.forEach(d => accts.set(d.id, d));
  }
  for (const d of accts.values()) {
    const a = d.data(); olds.push(a.name);
    if (a.barNumber) bars.add(String(a.barNumber));
    if (/judge|magistrate|justice/i.test(String(a.role || ""))) judge = true;
  }
  /* the State Bar registry */
  const reg = new Map(), vals = [pin]; if (/^\d+$/.test(pin)) vals.push(Number(pin));
  const rs = await getDocs(query(collection(db2, "sbm"), where("pin", "in", vals), limit(5)));
  rs.docs.forEach(d => reg.set(d.id, d));
  for (const n of bars) if (!reg.has(n)) { const g = await getDoc(doc(db2, "sbm", n)); if (g.exists()) reg.set(g.id, g); }
  for (const d of reg.values()) { olds.push(d.data().name); bars.add(String(d.id)); }
  const oldNames = uniqNames(olds).filter(n => lcn(n) !== lcn(newName));
  /* write them */
  for (const d of accts.values()) {
    const a = d.data(); if (a.name === newName) continue;
    await updateDoc(d.ref, { name: newName, previousNames: arrayUnion({ name: a.name || fromName || "", until: when }) }); out.accounts++;
  }
  for (const d of reg.values()) {
    const a = d.data(); if (a.name === newName) continue;
    await updateDoc(d.ref, { name: newName, previousNames: arrayUnion({ name: a.name || fromName || "", until: when }) }); out.bar++;
  }
  /* the cases: change the name, and where the person is a party, file the MC 53 on the docket */
  const who = { pin, newName, oldNames, bars: [...bars], judge };
  const by = info.by || "Department of State", dob = dobText(info.dob);
  const fp = info.fromParts || (() => { const w = String(fromName || "").trim().split(/\s+/); return { first: w[0] || "", middle: w.length > 2 ? w.slice(1, -1).join(" ") : "", last: w.length > 1 ? w[w.length - 1] : "" }; })();
  for (const col of ["cases", "mscCases"]) {
    const s = await getDocs(collection(db2, col));
    for (const d of s.docs) {
      const first = renameInCase(d.data(), who); if (!first) continue;
      const cid = d.data().caseId || d.id, litigant = Array.isArray(d.data().parties) && d.data().parties.some(p => p && String(p.pin || "") === pin);
      let link = null;
      if (litigant && info.file !== false) {
        try {
          const after = { ...d.data(), ...first };
          link = await saveMc53(cid, mc53Md(after, cid, { fromParts: fp, parts, dob, pin, by }), newName);
        } catch (e) { console.warn("Could not save the MC 53 for " + cid, e); out.noticeFailed++; }
      }
      await runTransaction(db2, async tx => {
        const sn = await tx.get(d.ref); if (!sn.exists()) return;
        const cur = sn.data(), patch = renameInCase(cur, who); if (!patch) return;
        if (link) {
          const ev = cur.events || [], no = ev.reduce((m, e) => Math.max(m, e.eventNumber || 0), 0) + 1;
          patch.events = [...ev, { eventNumber: no, sealed: false, type: "filing", date: when, description: "Notice of legal name change (MC 53) filed by " + by + ".", docName: "Notice of Legal Name Change (MC 53)", documentLink: link, filedBy: by, role: "Department of State", enteredBy: by, judge: cur.judge || null }];
          patch["dates.lastUpdated"] = when; out.notices++;
        }
        tx.update(d.ref, patch); out.cases++;
      });
    }
  }
  return out;
}
/* "07/17/1971" or "1971-07-17" to "July 17, 1971". */
export function recordDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || "")) || (() => { const i = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(v || "")); return i ? [0, i[2], i[3], i[1]] : null; })();
  return m ? LONG[+m[1] - 1] + " " + +m[2] + ", " + m[3] : (v || "Not on file");
}
export const visible = rows => rows.filter(r => !r.hidden);
export const accessLog = rows => visible(rows).filter(r => /^(access|search)\./.test(r.type));

/* ---------- page chrome ---------- */
function initials(s) { const w = String(s || "?").trim().split(/\s+/).filter(Boolean); return ((w[0] || "?")[0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); }
function paintChrome(ctx) {
  if (ctx.isStaff) { const nv = document.querySelector(".pnav nav"); if (nv && !nv.querySelector("[data-staff-link]")) nv.insertAdjacentHTML("beforeend", '<h4>Staff</h4><a data-staff-link href="' + E + 'staff/home/"><span>Staff Portal</span></a>'); }
  document.querySelectorAll("[data-puser]").forEach(u => u.hidden = false);
  document.querySelectorAll("[data-name]").forEach(n => n.textContent = ctx.id.name || "Account");
  document.querySelectorAll("[data-av]").forEach(box => {
    box.textContent = initials(ctx.id.name);
    const im = new Image(); im.alt = ""; im.onload = () => box.replaceChildren(im);
    im.src = "https://www.roblox.com/headshot-thumbnail/image?userId=" + encodeURIComponent(ctx.id.pin) + "&width=150&height=150&format=png";
  });
}
document.addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-signout]")) signOut(); });

/* Show an error where the loading message was. */
export function fail(msg, title = "We could not load this page") {
  const box = $("p-load"); if (!box) return;
  box.replaceChildren(el("div", { class: "pc" }, el("h3", { text: title }), el("p", { text: msg }), el("p", { class: "mt" }, el("a", { class: "btn2", href: location.pathname, text: "Try again" }))));
  box.hidden = false; const b = $("p-body"); if (b) b.hidden = true;
}

/* ---------- boot: sign in, load the account, show the page ----------
   opts.require = a specialPermissions value the page needs for its full tools (the page decides what to do when ctx.has() is false). */
export async function boot(opts = {}) {
  let id = identityFromReturn();
  if (id) saveSession(id); else id = loadSession();
  if (!id) { location.replace(loginUrl()); return new Promise(() => {}); }
  try {
    const { data, created } = await ensureAccount(id);
    /* From here on the SOS record is the source for who this person is. */
    id = { ...id, name: data.name || id.name, first: data.firstName || id.first, middle: data.middleName || id.middle, last: data.lastName || id.last, dob: data.dateOfBirth || id.dob, email: data.email || id.email, roblox: data.robloxUsername || id.roblox, discord: data.discordUsername || id.discord };
    const role = String(data.role || "basic").toLowerCase();
    const perms = Array.isArray(data.specialPermissions) ? data.specialPermissions.map(String) : [];
    const ctx = { id, acct: data, role, perms, created, has: p => perms.includes(p), isStaff: STAFF_ROLES.includes(role), page: opts.page || "" };
    if (created) await logActivity(id.pin, "account.created", "SOS e-Services account created", { pin: id.pin, name: id.name, kind: "self" });
    if (ss.get("sos_signin_logged") !== id.pin) { ss.set("sos_signin_logged", id.pin); if (!created) await logActivity(id.pin, "account.signin", "Signed in to SOS e-Services", { pin: id.pin, name: id.name, kind: "self" }); }
    paintChrome(ctx);
    const l = $("p-load"), b = $("p-body"); if (l) l.hidden = true; if (b) b.hidden = false;
    return ctx;
  } catch (e) {
    console.error(e);
    fail(e && e.code === "permission-denied" ? "The account service refused the request. Check the Firestore rules for this project." : "Try again in a moment.");
    return new Promise(() => {});
  }
}