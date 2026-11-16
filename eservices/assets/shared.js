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
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, query, where, limit, serverTimestamp, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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
/* "07/17/1971" or "1971-07-17" to "July 17, 1971". */
export function recordDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || "")) || (() => { const i = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(v || "")); return i ? [0, i[2], i[3], i[1]] : null; })();
  return m ? LONG[+m[1] - 1] + " " + +m[2] + ", " + m[3] : (v || "Not on file");
}
/* Change the person's name on their SOS account right away and charge the fee. parts = { first, middle, last }. */
export async function changeName(ctx, parts, fee) {
  const first = parts.first, middle = parts.middle || "", last = parts.last, name = [first, middle, last].filter(Boolean).join(" "), old = ctx.id.name || "";
  await updateDoc(doc(db, "accounts", ctx.id.pin), { name, firstName: first, middleName: middle, lastName: last, nameChangedAt: serverTimestamp() });
  await charge(ctx.id.pin, "Name change", fee);
  await logActivity(ctx.id.pin, "account.name", "Name changed from " + old + " to " + name, { pin: ctx.id.pin, name, kind: "self" });
  ctx.id = { ...ctx.id, name, first, middle, last };
  return name;
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