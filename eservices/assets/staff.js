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
import { boot, db, E, $, el, cap, ms, when, ROLE_LABELS, STAFF_ROLES, PERM_LABELS, logActivity, logAccess, charge, list, money, getRecord, setRecordStatus, applyNameToRecord, applyNameToMiGOVT, applyNameToCourts, statusOf, STATUSES, recordDate } from "https://migovt.org/sos/eservices/assets/shared.js";
import { submit } from "https://migovt.org/sos/eservices/assets/feedback.js";
import { TYPES as BIZ_TYPES, plusYear, bizNumber } from "https://migovt.org/sos/eservices/assets/business.js";
import { doc, getDoc, getDocs, addDoc, updateDoc, setDoc, collection, query, where, limit, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
export { $, el, cap, ms, when, ROLE_LABELS, STAFF_ROLES, PERM_LABELS, E, db, list, money, getRecord, setRecordStatus, applyNameToRecord, applyNameToMiGOVT, applyNameToCourts, statusOf, STATUSES, recordDate };

/* ---------- bureaus and roles ---------- */
export const BUREAUS = { lara: "Licensing and Regulatory Affairs", elections: "Elections", hearings: "Administrative Hearings and Appeals" };
/* Each officer belongs to one bureau. Directors and deputies are assigned a bureau on their account. */
const ROLE_BUREAU = { "licensing-officer": "lara", "records-officer": "lara", "elections-officer": "elections", "hearing-officer": "hearings" };
export const RANK = { "system-administrator": 95, "secretary-of-state": 100, "deputy-secretary-of-state": 90, "bureau-director": 80, "deputy-bureau-director": 70, "division-director": 60, "deputy-division-director": 50, "licensing-officer": 30, "records-officer": 30, "elections-officer": 30, "hearing-officer": 30 };
/* These roles see every bureau. Everyone else sees only their own. */
const ALL_BUREAUS = ["system-administrator", "secretary-of-state", "deputy-secretary-of-state"];
const CAPS = {
  "queue.decide": STAFF_ROLES,                    // change a case's status, assign it, add notes
  "cases.open": STAFF_ROLES,                      // open a case for a person
  "notices.send": STAFF_ROLES,                    // send a notice to one person
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
  "id.application": ["ID application", "lara"], "license.renewal": ["License renewal", "lara"], "license.card": ["Card request", "lara"], "name.change": ["Name change", "lara"], "dealer.license": ["Dealership license", "lara"],
  "insurer.license": ["Insurance license", "lara"], "professional.license": ["Professional license application", "lara"], "professional.renewal": ["Professional license renewal", "lara"],
  "record.copy": ["Certified record request", "lara"], "vital.request": ["Vital record request", "lara"],
  "voter.registration": ["Voter registration", "elections"], "candidate.filing": ["Candidate filing", "elections"], "finance.report": ["Campaign finance report", "elections"],
  "business.registration": ["Business registration", "lara"], "business.annual-report": ["Business annual report", "lara"], "business.amendment": ["Business amendment", "lara"], "business.dissolution": ["Business dissolution", "lara"], "business.reinstatement": ["Business reinstatement", "lara"], "notary.commission": ["Notary commission", "elections"],
  "appeal": ["Administrative appeal", "hearings"]
};
export const typeLabel = t => (CASE_TYPES[t] || [cap(String(t).replace(/\./g, " "))])[0];
/* A case has a STATUS (where it is in the process) and a RESULT (the decision, once there is one).
   status: open | in-review | scheduled (hearings) | closed.   result: "" while pending, else one of RESULTS.
   Older cases stored the decision in status (approved/denied/decided). fix() converts those when they are loaded. */
export const STATUS = { open: "Open", "in-review": "In review", scheduled: "Scheduled", closed: "Closed" };
export const RESULT = { approved: "Approved", denied: "Denied", withdrawn: "Withdrawn", upheld: "Upheld", overturned: "Overturned", dismissed: "Dismissed" };
export const statusesFor = bureau => bureau === "hearings" ? ["open", "in-review", "scheduled", "closed"] : ["open", "in-review", "closed"];
export const resultsFor = bureau => bureau === "hearings" ? ["upheld", "overturned", "dismissed", "withdrawn"] : ["approved", "denied", "withdrawn"];
const ACTIVE = ["open", "in-review", "scheduled"];
const fix = d => {
  const r = { ...d };
  if (r.status === "approved" || r.status === "denied") { r.result = r.result || r.status; r.status = "closed"; }
  else if (r.status === "decided") { r.result = r.result || "upheld"; r.status = "closed"; }
  r.result = r.result || "";
  return r;
};
/* "Closed: Approved", "In review", and so on. */
export const stateText = r => (STATUS[r.status] || cap(String(r.status))) + (r.result ? ": " + (RESULT[r.result] || cap(r.result)) : "");
const statusClass = r => r.result === "approved" || r.result === "upheld" ? "g" : r.status === "open" ? "o" : ACTIVE.includes(r.status) ? "" : "n";

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

/* Approving a license renewal or card request updates licenses/{pin}.{driver|motorcycle|chauffeur|cdl} and charges the fee once. */
async function applyLicenseCase(ctx, r) {
  const k = r.detail && r.detail.kind; if (!["driver", "motorcycle", "chauffeur", "cdl"].includes(k)) return "This request has no license type.";
  const ref = doc(db, "licenses", String(r.pin)), snap = await getDoc(ref), l = snap.exists() ? snap.data()[k] : null;
  if (!l) return "No " + k + " license is on file for this person, so nothing was updated.";
  const now = new Date(), up = { updatedBy: ctx.id.pin, updatedAt: serverTimestamp() };
  const tm = v => v && v.toMillis ? v.toMillis() : typeof v === "string" ? (Date.parse(v) || 0) : (+v || 0);
  if (r.type === "license.renewal") {
    /* 12 months from the current expiration, or from today if it has already expired */
    const from = new Date(Math.max(tm(l.expiresAt), now.getTime())); from.setFullYear(from.getFullYear() + 1);
    up[k + ".expiresAt"] = from.toISOString(); up[k + ".renewedAt"] = now.toISOString();
    if (String(l.status || "").toLowerCase() === "expired") up[k + ".status"] = "active";
  } else up[k + ".cardIssuedAt"] = now.toISOString();
  await updateDoc(ref, up);
  await audit(ctx, r.type === "license.renewal" ? "license.renew" : "license.card", r.pin, (r.detail.license || k));
  await logActivity(r.pin, r.type === "license.renewal" ? "license.renewed" : "license.card", (r.type === "license.renewal" ? "Renewed: " : "Card issued: ") + (r.detail.license || k), AGENCY);
  const fee = parseFloat(String(r.detail.fee || "").replace(/[^0-9.]/g, "")), desc = ((r.type === "license.renewal" ? "License renewal: " : "Card fee: ") + (r.detail.license || k)).slice(0, 120);
  if (fee > 0) { const prior = await list("transactions", r.pin, 100).catch(() => []); if (!prior.some(t => t.desc === desc)) await charge(r.pin, desc, fee); }
  return "";
}

/* Approving a professional license application creates the license record; approving a renewal extends it. */
const PRO_PREFIX = { "medical-physician": "MD", "medical-paramedic": "PM", "medical-aemt": "AE", "medical-emt": "EM", "bail-bond": "BB" };
async function applyProfessionalCase(ctx, r) {
  const k = r.detail && r.detail.kind; if (!PRO_PREFIX[k]) return "This request has no license type, so no license record was created.";
  const ref = doc(db, "professionalLicenses", String(r.pin) + "_" + k), snap = await getDoc(ref), now = new Date();
  const tm = v => v && v.toMillis ? v.toMillis() : typeof v === "string" ? (Date.parse(v) || 0) : (+v || 0);
  if (r.type === "professional.renewal") {
    if (!snap.exists()) return "No license record exists for this person, so there was nothing to renew. Approve a new application instead.";
    const from = new Date(Math.max(tm(snap.data().expiresAt), now.getTime())); from.setFullYear(from.getFullYear() + 1);
    const up = { expiresAt: from.toISOString(), renewedAt: now.toISOString(), updatedBy: ctx.id.pin, updatedAt: serverTimestamp() };
    if (["expired", "inactive"].includes(String(snap.data().status || "").toLowerCase())) up.status = "active";
    await updateDoc(ref, up);
  } else {
    if (snap.exists() && !["expired", "inactive"].includes(String(snap.data().status || "").toLowerCase())) return "This person already holds this license, so no new record was created.";
    const exp = new Date(now); exp.setFullYear(exp.getFullYear() + 1);
    const num = snap.exists() && snap.data().number ? snap.data().number : PRO_PREFIX[k] + "-" + String(Math.floor(100000 + Math.random() * 900000));
    const med = k.startsWith("medical-");
    await setDoc(ref, { pin: String(r.pin), name: r.name || "", type: med ? "medical" : k, ...(med ? { classification: k.replace("medical-", "") } : {}), number: num, status: "active",
      issuedAt: now.toISOString(), expiresAt: exp.toISOString(), restrictions: snap.exists() ? (snap.data().restrictions || []) : [], conditions: snap.exists() ? (snap.data().conditions || []) : [],
      discipline: snap.exists() ? (snap.data().discipline || []) : [], updatedBy: ctx.id.pin, updatedAt: serverTimestamp() });
  }
  const what = r.detail.license || k;
  await audit(ctx, r.type === "professional.renewal" ? "pro.renew" : "pro.issue", r.pin, what);
  await logActivity(r.pin, r.type === "professional.renewal" ? "license.renewed" : "license.issued", (r.type === "professional.renewal" ? "Renewed: " : "Issued: ") + what, AGENCY);
  return "";
}

/* Approving a candidate filing certifies them for that office. Voters need no approval: citizens and residents are registered automatically. */
async function applyElectionCase(ctx, r) {
  const d = r.detail || {}; if (!d.officeKey || !d.termYear) return "This filing has no office or election year, so the candidate was not certified.";
  const id = d.termYear + "_" + r.pin + "_" + d.officeKey, ref = doc(db, "candidates", id), snap = await getDoc(ref);
  if (snap.exists() && snap.data().status === "certified") return "This person is already certified for that office.";
  const c = { pin: String(r.pin), name: r.name || "", officeKey: d.officeKey, office: d.office || d.officeKey, level: d.level || "", termYear: Number(d.termYear), status: "certified", certifiedAt: new Date().toISOString(), updatedBy: ctx.id.pin, updatedAt: serverTimestamp() };
  if (d.runningMate) c.runningMate = String(d.runningMate).slice(0, 20);
  await setDoc(ref, c);
  await audit(ctx, "candidate.certify", r.pin, (d.office || d.officeKey) + " " + d.termYear);
  await logActivity(r.pin, "candidate.certified", "Certified as a candidate for " + (d.office || d.officeKey) + " (" + d.termYear + ")", AGENCY);
  return "";
}

/* Turns a case's detail into readable rows. Nested lists and objects (business owners, address, agent, signature) are written out, never shown as [object Object]. */
const DETAIL_LABELS = { typeKey: "Business type key", typeLabel: "Business type", tradeName: "Trade name (DBA)", businessId: "Business record", oldName: "Previous name", certified: "Certifications", fee: "Fee", late: "Days late" };
const CERT_TEXT = { accurate: "Information is accurate and complete", authorized: "Business is authorized to operate under applicable law", submitter: "Applicant is authorized to submit", notify: "Agrees to notify the Department of material changes" };
function detailValue(k, v) {
  if (v === null || v === undefined || v === "") return "";
  if (k === "fee") { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return isNaN(n) ? String(v) : "$" + n.toFixed(2); }
  if (k === "owners" && Array.isArray(v)) return v.map(o => o && typeof o === "object" ? (o.name || "Unnamed") + ", PIN " + (o.pin || "") + (o.dob ? ", born " + o.dob : "") + (o.percent ? ", " + o.percent + "%" : "") : String(o)).join("\n");
  if (k === "agent" && typeof v === "object") return (v.name || "Unnamed") + ", PIN " + (v.pin || "") + (v.dob ? ", born " + v.dob : "");
  if (k === "address" && typeof v === "object") return [v.street, [v.city, v.state, v.zip].filter(Boolean).join(" ")].filter(Boolean).join("\n");
  if (k === "signature" && typeof v === "object") return (v.name || "") + (v.date ? ", signed " + v.date : "");
  if (k === "certified" && Array.isArray(v)) return v.map(x => "Yes: " + (CERT_TEXT[x] || x)).join("\n");
  if (Array.isArray(v)) return v.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(", ");
  if (typeof v === "object") return Object.entries(v).map(([a, b]) => cap(a) + ": " + b).join("\n");
  return String(v);
}
function detailRows(r) {
  const d = r.detail && typeof r.detail === "object" ? r.detail : {};
  const order = r.type && r.type.startsWith("business.") ? ["name", "tradeName", "typeLabel", "industry", "description", "address", "website", "discord", "owners", "agent", "certified", "signature", "fee", "late", "oldName", "businessId"] : [];
  const keys = [...order.filter(k => k in d), ...Object.keys(d).filter(k => !order.includes(k) && k !== "typeKey")];
  return keys.map(k => [DETAIL_LABELS[k] || cap(String(k).replace(/([A-Z])/g, " $1").toLowerCase()), detailValue(k, d[k])]).filter(([, v]) => v !== "");
}

/* Approving a business filing creates or updates the business record at businesses/{id}. Fees are charged once. */
async function applyBusinessCase(ctx, r) {
  const d = r.detail || {}, now = new Date().toISOString(), day = now.slice(0, 10), by = { updatedBy: ctx.id.pin, updatedAt: serverTimestamp() };
  const fee = parseFloat(String(d.fee || "").replace(/[^0-9.]/g, ""));
  const bill = async desc => { desc = desc.slice(0, 120); if (fee > 0) { const prior = await list("transactions", r.pin, 100).catch(() => []); if (!prior.some(t => t.desc === desc)) await charge(r.pin, desc, fee); } };
  /* The details a person submits, in the shape the business record stores them. */
  const owners = (Array.isArray(d.owners) ? d.owners : []).filter(o => o && typeof o === "object").map(o => ({ name: String(o.name || ""), dob: String(o.dob || ""), pin: String(o.pin || ""), percent: String(o.percent || "") }));
  const agent = d.agent && typeof d.agent === "object" ? { name: String(d.agent.name || ""), dob: String(d.agent.dob || ""), pin: String(d.agent.pin || "") } : null;
  const fields = () => ({ name: d.name, tradeName: d.tradeName || "", description: d.description || "", industry: d.industry || "", address: d.address || {}, website: d.website || "", discord: d.discord || "",
    ownerDetails: owners, owners: owners.map(o => o.pin), agent: agent || { name: "", dob: "", pin: "" }, access: [...new Set([...owners.map(o => o.pin), agent ? agent.pin : "", String(r.pin)].filter(Boolean))],
    signature: { name: (d.signature && d.signature.name) || "", signedAt: now } });
  if (r.type === "business.registration") {
    const T = BIZ_TYPES[d.typeKey]; if (!T || !d.name) return "This registration has no business type or name, so no business was created.";
    if (!owners.length || !agent) return "This registration is missing owner or registered agent details, so no business was created.";
    const dup = await getDocs(query(collection(db, "businesses"), where("caseId", "==", r.id), limit(1)));
    if (!dup.empty) return "A business was already created from this application.";
    let num = ""; for (let i = 0; i < 10 && !num; i++) { const n = bizNumber(); if ((await getDocs(query(collection(db, "businesses"), where("businessNumber", "==", n), limit(1)))).empty) num = n; }
    if (!num) return "A business ID could not be generated. Approve it again.";
    const b = { ...fields(), businessNumber: num, type: d.typeKey, typeLabel: T.t, applicantPin: String(r.pin), status: "active", approvedAt: now, approvedBy: ctx.id.pin, registeredAt: now, caseId: r.id, ...by };
    if (T.report) { b.dueDate = plusYear(day); b.expiresAt = b.dueDate; }
    await addDoc(collection(db, "businesses"), b);
    await audit(ctx, "business.register", r.pin, d.name + " (" + T.t + ") " + num);
    await logActivity(r.pin, "business.registered", "Business registered: " + d.name + " (" + num + ")", AGENCY);
    await bill("Business registration: " + d.name); return "";
  }
  if (!d.businessId) return "This filing is not linked to a business, so nothing was updated.";
  const ref = doc(db, "businesses", d.businessId), snap = await getDoc(ref); if (!snap.exists()) return "The business no longer exists.";
  const b = snap.data();
  const merged = () => { const f = fields(); return { ...f, name: f.name || b.name, ownerDetails: owners.length ? owners : (b.ownerDetails || []), owners: owners.length ? f.owners : (b.owners || []), agent: agent || b.agent || f.agent,
    access: [...new Set([...(b.access || []), ...(owners.length ? f.access : [])])] }; };
  if (r.type === "business.annual-report") {
    const due = plusYear(b.dueDate || day);
    await updateDoc(ref, { ...merged(), name: b.name, status: "active", lastReportAt: now, dueDate: due, expiresAt: due, ...by });
    await audit(ctx, "business.report", r.pin, b.name); await logActivity(r.pin, "business.report", "Annual report accepted: " + b.name, AGENCY); await bill("Annual report: " + b.name);
  } else if (r.type === "business.amendment") {
    await updateDoc(ref, { ...merged(), ...by });
    await audit(ctx, "business.amend", r.pin, b.name + (d.name && d.name !== b.name ? " to " + d.name : "")); await logActivity(r.pin, "business.amended", "Business details updated: " + (d.name || b.name), AGENCY);
  } else if (r.type === "business.dissolution") {
    await updateDoc(ref, { status: "dissolved", dissolvedAt: now, ...by }); await audit(ctx, "business.dissolve", r.pin, b.name); await logActivity(r.pin, "business.dissolved", "Business dissolved: " + b.name, AGENCY);
  } else if (r.type === "business.reinstatement") {
    const due = plusYear(day);
    await updateDoc(ref, { ...merged(), name: b.name, status: "active", dueDate: due, expiresAt: due, lastReportAt: now, ...by }); await audit(ctx, "business.reinstate", r.pin, b.name); await logActivity(r.pin, "business.reinstated", "Business reinstated: " + b.name, AGENCY); await bill("Business reinstatement: " + b.name);
  }
  return "";
}

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

/* Draw a filterable case table with quick actions and a detail panel. rows come from loadCases(). */
export function renderQueue(root, ctx, rows, { emptyText } = {}) {
  const state = { filter: "active", text: "" };
  const bar = el("div", { class: "bar" });
  const FILTERS = [["active", "Active"], ["mine", "Assigned to me"], ["unassigned", "Unassigned"], ["all", "All"], ...Object.keys(STATUS).map(k => ["s:" + k, "Status: " + STATUS[k]]), ...Object.keys(RESULT).map(k => ["r:" + k, "Result: " + RESULT[k]])];
  const sel = el("select", { "aria-label": "Show" }, FILTERS.map(([v, t]) => el("option", { value: v, text: t })));
  const txt = el("input", { type: "search", placeholder: "Filter by PIN, name, or title", "aria-label": "Filter" });
  bar.append(sel, txt);
  const wrap = el("div", { class: "tw" }), panel = el("div", { class: "mt" });
  root.replaceChildren(bar, wrap, panel);
  const mineOf = r => r.assignee === ctx.id.pin;
  const canWorkOn = r => ctx.can("queue.decide") && ctx.deskOk(r.bureau);
  const match = r => {
    const f = state.filter;
    if (f === "all") return true;
    if (f === "active") return ACTIVE.includes(r.status);
    if (f === "mine") return mineOf(r) && ACTIVE.includes(r.status);
    if (f === "unassigned") return !r.assignee && ACTIVE.includes(r.status);
    if (f.startsWith("s:")) return r.status === f.slice(2);
    return r.result === f.slice(2);
  };

  /* One place that changes a case. Any action assigns the case to you unless it is already yours (pass take:false to leave it alone). */
  async function act(r, { status, result, note, take = true, release = false }) {
    const up = { status, result, updatedAt: serverTimestamp(), updatedBy: ctx.id.pin };
    if (take && !mineOf(r)) { up.assignee = ctx.id.pin; up.assigneeName = ctx.id.name || ""; }
    if (!take && release && mineOf(r)) { up.assignee = ""; up.assigneeName = ""; }
    const nt = (note || "").trim(), nn = nt ? { by: ctx.id.pin, name: ctx.id.name || "Staff", text: nt.slice(0, 600), at: Date.now() } : null;
    if (nn) up.notes = arrayUnion(nn);
    await updateDoc(doc(db, "cases", r.id), up);
    /* An approved name change is applied to the person's account. */
    const warns = [];
    if (result === "approved" && r.result !== "approved" && r.type === "name.change" && r.detail && r.detail.first && r.detail.last) {
      const parts = { first: r.detail.first, middle: r.detail.middle || "", last: r.detail.last };
      /* The name being replaced and the date of birth, read from the vital record before it changes (they go on the MC 53 filed with the courts). */
      const before0 = await getRecord(r.pin).catch(() => null);
      const info = { fromParts: before0 && (before0.firstName || before0.lastName) ? { first: before0.firstName || "", middle: before0.middleName || "", last: before0.lastName || "" } : null, dob: (before0 && before0.dob) || (r.detail.dob || ""), by: ctx.id.name || "Department of State" };
      /* The vital record gets the new name and keeps the old one in previousNames. */
      try {
        const ok = await applyNameToRecord(r.pin, parts);
        if (ok) await audit(ctx, "name.record", r.pin, "Vital record name changed to " + (r.detail.to || ""));
        else warns.push("This person has no vital record.");
      } catch (e) { console.error(e); warns.push("The vital record could not be updated. Check the records Firestore rules."); }
      /* The MiGOVT account keeps the same name. */
      try {
        const ok = await applyNameToMiGOVT(r.pin, parts);
        if (ok) await audit(ctx, "name.migovt", r.pin, "MiGOVT account name changed to " + (r.detail.to || ""));
        else warns.push("No MiGOVT account was found for this PIN.");
      } catch (e) { console.error(e); warns.push("The MiGOVT account could not be updated. Check the MiGOVT Firestore rules."); }
      /* The courts portal: the person's account and State Bar entry, and their name on every case (the old name is kept as an a/k/a). An MC 53 is filed on each case they are a party to. */
      try {
        const o = await applyNameToCourts(r.pin, parts, r.detail.from, info);
        if (o.accounts || o.bar || o.cases) await audit(ctx, "name.courts", r.pin, "Courts portal: " + o.accounts + " account, " + o.bar + " bar entry, " + o.cases + " case(s) updated, " + o.notices + " MC 53 filed, to " + (r.detail.to || ""));
        if (o.noticeFailed) warns.push(o.noticeFailed + " MC 53 notice(s) could not be filed on the courts' cases. Check the courts Storage rules.");
      } catch (e) { console.error(e); warns.push("The courts portal could not be updated. Check the courts Firestore rules."); }
      await updateDoc(doc(db, "accounts", r.pin), { name: r.detail.to || [r.detail.first, r.detail.middle, r.detail.last].filter(Boolean).join(" "), firstName: r.detail.first, middleName: r.detail.middle || "", lastName: r.detail.last, updatedBy: ctx.id.pin, updatedAt: serverTimestamp() });
      await logActivity(r.pin, "account.name", "Your name was changed to " + (r.detail.to || ""), AGENCY);
      /* Charge the fee once. A retried approval finds the earlier charge and skips it. */
      const fee = parseFloat(String(r.detail.fee || "").replace(/[^0-9.]/g, "")), desc = ("Name change to " + (r.detail.to || "")).slice(0, 120);
      if (fee > 0) { const prior = await list("transactions", r.pin, 100).catch(() => []); if (!prior.some(t => t.desc === desc)) await charge(r.pin, desc, fee); }
    }
    if (result === "approved" && r.result !== "approved" && (r.type === "license.renewal" || r.type === "license.card")) {
      try { const w = await applyLicenseCase(ctx, r); if (w) warns.push(w); } catch (e) { console.error(e); warns.push("The license could not be updated. Check the Firestore rules for licenses."); }
    }
    if (result === "approved" && r.result !== "approved" && (r.type === "professional.license" || r.type === "professional.renewal")) {
      try { const w = await applyProfessionalCase(ctx, r); if (w) warns.push(w); } catch (e) { console.error(e); warns.push("The license record could not be saved. Check the Firestore rules for professionalLicenses."); }
    }
    if (result === "approved" && r.result !== "approved" && /^business\.(registration|annual-report|amendment|dissolution|reinstatement)$/.test(r.type)) {
      try { const w = await applyBusinessCase(ctx, r); if (w) warns.push(w); } catch (e) { console.error(e); warns.push("The business record could not be saved. Check the Firestore rules for businesses."); }
    }
    if (result === "approved" && r.result !== "approved" && r.type === "candidate.filing") {
      try { const w = await applyElectionCase(ctx, r); if (w) warns.push(w); } catch (e) { console.error(e); warns.push("The election record could not be saved. Check the Firestore rules for voters and candidates."); }
    }
    const before = stateText(r), after = stateText({ status, result });
    if (before !== after) { await audit(ctx, "case.status", r.pin, typeLabel(r.type) + ": " + before + " to " + after); await logActivity(r.pin, "case.status", typeLabel(r.type) + ": " + after, AGENCY); }
    else if (nn) await audit(ctx, "case.note", r.pin, typeLabel(r.type));
    if (up.assignee !== undefined && up.assignee) await audit(ctx, "case.assign", r.pin, typeLabel(r.type) + ": assigned to " + (ctx.id.name || ctx.id.pin));
    r._warn = warns.length ? (r.type === "name.change" ? "The SOS account name was changed, but: " : "The case was saved, but: ") + warns.join(" ") : "";
    Object.assign(r, { status, result, assignee: up.assignee ?? r.assignee, assigneeName: up.assigneeName ?? r.assigneeName, notes: nn ? [...(Array.isArray(r.notes) ? r.notes : []), nn] : r.notes, updatedAt: Date.now() });
  }

  /* The buttons that make sense for this case right now. */
  function actionsFor(r) {
    const h = r.bureau === "hearings", a = [];
    if (!ACTIVE.includes(r.status)) return [["Reopen", { status: "in-review", result: "" }]];
    if (r.status === "open") a.push(["Start review", { status: "in-review", result: "" }]);
    else if (!mineOf(r)) a.push(["Take case", { status: r.status, result: "" }]);
    if (h) { if (r.status !== "scheduled") a.push(["Schedule", { status: "scheduled", result: "" }]); a.push(["Uphold", { status: "closed", result: "upheld", ok: 1 }], ["Overturn", { status: "closed", result: "overturned", ok: 1 }], ["Dismiss", { status: "closed", result: "dismissed", ok: 1 }]); }
    else a.push(["Approve", { status: "closed", result: "approved", ok: 1 }], ["Deny", { status: "closed", result: "denied", ok: 1 }]);
    return a;
  }

  function draw() {
    const q = state.text.toLowerCase();
    const list = rows.filter(r => match(r) && (!q || (r.pin + " " + (r.name || "") + " " + (r.title || "") + " " + typeLabel(r.type)).toLowerCase().includes(q)));
    if (!list.length) { wrap.replaceChildren(el("div", { class: "empty", text: emptyText && !rows.length ? emptyText : "No cases match." })); return; }
    const t = el("table", { class: "tbl" }, el("tr", {}, ["Case", "Person", "Status", "Assigned", "Updated", "Quick actions"].map(h => el("th", { text: h }))));
    list.forEach(r => {
      const qa = el("td", { class: "qa" });
      if (canWorkOn(r)) actionsFor(r).slice(0, 3).forEach(([label, v]) => {
        const b = el("button", { class: "btn2 s", type: "button", text: label });
        b.addEventListener("click", async e => {
          e.stopPropagation();
          if (v.ok && !confirm(label + " this case for " + (r.name || "PIN " + r.pin) + "?")) return;
          b.disabled = true;
          try { await act(r, v); if (r._warn) alert(r._warn); draw(); if (panel.firstChild) detail(r); } catch (err) { console.error(err); b.disabled = false; b.textContent = "Failed"; }
        });
        qa.append(b);
      });
      const tr = el("tr", { class: "row", tabindex: "0" },
        el("td", {}, el("b", { text: typeLabel(r.type) }), el("br"), r.title || ""),
        el("td", {}, r.name || "PIN " + r.pin, el("br"), el("small", { class: "empty", text: "PIN " + r.pin })),
        el("td", {}, el("span", { class: "pill " + statusClass(r), text: stateText(r) })),
        el("td", { text: mineOf(r) ? "You" : r.assigneeName || "Unassigned" }),
        el("td", { text: when(r.updatedAt) }), qa);
      const open = () => detail(r); tr.addEventListener("click", open); tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
      t.append(tr);
    });
    wrap.replaceChildren(t);
  }

  function detail(r) {
    const canWork = canWorkOn(r);
    const box = el("div", { class: "pc detail" }, el("h3", { text: typeLabel(r.type) + ": " + (r.title || "") }),
      el("p", { class: "sub", text: (r.name || "PIN " + r.pin) + " | Opened " + when(r.createdAt) + " | " + (BUREAUS[r.bureau] || "") + " | " + (mineOf(r) ? "Assigned to you" : r.assigneeName ? "Assigned to " + r.assigneeName : "Unassigned") }),
      el("p", {}, el("span", { class: "pill " + statusClass(r), text: stateText(r) })));
    if (r._warn) box.append(el("div", { class: "alert", text: r._warn }));
    const det = detailRows(r);
    if (det.length) { const kv = el("div", { class: "kv2" }); det.forEach(([k, v]) => kv.append(el("div", {}, el("span", { text: k }), el("b", { text: v, style: "white-space:pre-line" })))); box.append(kv); }
    box.append(el("h4", { class: "grp-h", text: "Notes" }));
    const notes = Array.isArray(r.notes) ? r.notes : [];
    if (!notes.length) box.append(el("div", { class: "empty", text: "No notes yet." }));
    notes.forEach(n => box.append(el("div", { class: "notice" }, el("b", { text: n.name || "Staff" }), el("span", { text: n.text }), el("small", { class: "empty", text: " " + when(n.at) }))));
    if (canWork) {
      const note = el("textarea", { rows: "3", placeholder: "Add a note (optional). It is saved with whichever button you press.", "aria-label": "Note" });
      const msg = el("div", { class: "empty" });
      const run = async (label, v, btn) => {
        if (v.ok && !confirm(label + " this case for " + (r.name || "PIN " + r.pin) + "?")) return;
        box.querySelectorAll("button").forEach(b => b.disabled = true); msg.textContent = "";
        const who = r.name || "PIN " + r.pin, verb = { Approve: "approved", Deny: "denied", Uphold: "upheld", Overturn: "overturned", Dismiss: "dismissed" }[label];
        const ok = await submit({ working: "Saving", reload: false, work: () => act(r, { ...v, note: note.value }),
          done: () => ({ title: verb ? "Case " + verb : "Case updated", body: r._warn || (verb ? typeLabel(r.type) + " for " + who + " was " + verb + ". They have been notified." : "Your change was saved and " + who + " has been notified of any status change.") }) });
        if (ok) { draw(); detail(r); } else box.querySelectorAll("button").forEach(b => b.disabled = false);
      };
      const qa = el("div", { class: "bar" });
      actionsFor(r).forEach(([label, v]) => { const b = el("button", { class: "btn2" + (v.ok ? "" : " s"), type: "button", text: label }); b.addEventListener("click", () => run(label, v, b)); qa.append(b); });
      const st = el("select", { id: "cs" }, statusesFor(r.bureau).map(s => el("option", { value: s, text: STATUS[s] }))); st.value = r.status;
      const rs = el("select", { id: "cr" }, [el("option", { value: "", text: "No result yet" }), ...resultsFor(r.bureau).map(x => el("option", { value: x, text: RESULT[x] }))]); rs.value = r.result || "";
      if (r.result && !resultsFor(r.bureau).includes(r.result)) rs.append(el("option", { value: r.result, text: RESULT[r.result] || cap(r.result) })), rs.value = r.result;
      /* A result only makes sense on a closed case, and a closed case needs one. */
      st.addEventListener("change", () => { if (st.value !== "closed") rs.value = ""; else if (!rs.value) rs.value = resultsFor(r.bureau)[0]; });
      rs.addEventListener("change", () => { if (rs.value) st.value = "closed"; });
      const mine = el("input", { type: "checkbox", id: "ca" }); mine.checked = true;
      const save = el("button", { class: "btn2 s", type: "button", text: "Save changes" });
      save.addEventListener("click", () => { if (st.value === "closed" && !rs.value) { msg.textContent = "Pick a result to close this case."; return; } run("Save", { status: st.value, result: rs.value, take: mine.checked, release: !mine.checked }, save); });
      box.append(el("h4", { class: "grp-h", text: "Work this case" }),
        el("div", { class: "fld" }, el("label", { text: "Note" }), note),
        el("div", { class: "fld" }, el("label", { text: "Quick actions" }), qa),
        el("p", { class: "empty", text: "Any action assigns this case to you" + (r.assignee && !mineOf(r) ? " (it is currently with " + (r.assigneeName || "someone else") + ")" : "") + "." }),
        el("h4", { class: "grp-h", text: "Set manually" }),
        el("div", { class: "bar" }, el("div", { class: "fld" }, el("label", { for: "cs", text: "Status" }), st), el("div", { class: "fld" }, el("label", { for: "cr", text: "Result" }), rs)),
        el("div", { class: "fld" }, el("label", { for: "ca" }, mine, " Assign to me")),
        save, msg);
    } else box.append(el("div", { class: "empty mt", text: "You can view this case but not change it." }));
    const close = el("button", { class: "btn2 s mt", type: "button", text: "Close panel" }); close.addEventListener("click", () => panel.replaceChildren());
    box.append(el("p", {}, close));
    panel.replaceChildren(box); box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  sel.addEventListener("change", () => { state.filter = sel.value; draw(); });
  txt.addEventListener("input", () => { state.text = txt.value.trim(); draw(); });
  draw();
}

/* ---------- people (MiGOVT accounts) ---------- */
const shape = (d) => ({ pin: String(d.pin || ""), name: d.name || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" "), dob: d.dateOfBirth || "", roblox: d.robloxUsername || "", discord: d.discordUsername || "", email: d.email || "" });
/* People are the SOS accounts (their MiGOVT details were copied over at sign-in), so only people who have signed in to e-Services can be found. */
export async function getPerson(pin) {
  const s = await getDoc(doc(db, "accounts", String(pin)));
  return s.exists() ? shape(s.data()) : null;
}
/* Search by PIN (digits) or by the start of a name. */
export async function searchPeople(text) {
  const q = text.trim(); if (!q) return [];
  if (/^\d{4,20}$/.test(q)) { const p = await getPerson(q); return p ? [p] : []; }
  const col = collection(db, "accounts"), out = new Map();
  for (const v of new Set([q, q.replace(/\b\w/g, c => c.toUpperCase()), q.toLowerCase()])) {
    const s = await getDocs(query(col, where("name", ">=", v), where("name", "<=", v + "\uf8ff"), limit(10)));
    s.docs.forEach(d => { const p = shape(d.data()); if (p.pin) out.set(p.pin, p); });
  }
  return [...out.values()];
}

/* ---------- staff, accounts, notices ---------- */
export async function listStaff() {
  const s = await getDocs(query(collection(db, "accounts"), where("role", "!=", "basic"), limit(300)));
  const rows = s.docs.map(d => d.data());
  rows.forEach(r => { r.person = shape(r); });
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