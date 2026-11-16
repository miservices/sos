/* Business types, fees, name rules, and standing. Shared by the Business Services portal page and the staff code that approves filings.
   A business lives in SOS Firestore at businesses/{id}:
     { businessNumber "NN-NNNNNNN", name, tradeName, type, typeLabel, description, industry, address{street,city,state:"MI",zip}, website, discord,
       ownerDetails[{name,dob,pin,percent}], owners[pins], agent{name,dob,pin}, access[pins who can manage it], applicantPin, signature{name,signedAt},
       status "active"|"dissolved", approvedAt, approvedBy, registeredAt (= approvedAt), expiresAt + dueDate (YYYY-MM-DD, annual report types only, kept the same),
       lastReportAt?, caseId, updatedBy, updatedAt }
   Standing (Active, Past due, Administratively dissolved) is worked out from dueDate when it is shown, so nothing has to run on a timer. */
export const LATE_FEE = 25, GRACE_DAYS = 30, EARLY_DAYS = 60;
export const TYPES = {
  sole:      { t: "Sole proprietorship",           fee: 25,  report: false, reportFee: 0,  min: 1, max: 1,  re: null,                                   hint: "No designation needed." },
  gp:        { t: "General partnership",           fee: 50,  report: false, reportFee: 0,  min: 2, max: 20, re: null,                                   hint: "No designation needed. Two or more partners." },
  llc:       { t: "Limited liability company",     fee: 150, report: true,  reportFee: 25, min: 1, max: 20, re: /\b(llc|l\.l\.c\.|limited liability company)\.?$/i, hint: 'The name must end with "LLC" or "Limited Liability Company".' },
  corp:      { t: "Corporation",                   fee: 250, report: true,  reportFee: 50, min: 1, max: 20, re: /\b(inc|inc\.|corp|corp\.|company|limited|corporation)$/i, hint: 'The name must end with "Inc.", "Corp.", "Company" or "Limited".' },
  nonprofit: { t: "Nonprofit corporation",         fee: 100, report: true,  reportFee: 10, min: 1, max: 20, re: null,                                   hint: "No designation needed, but the name cannot suggest a for-profit company." },
  lp:        { t: "Limited partnership",           fee: 200, report: true,  reportFee: 25, min: 2, max: 20, re: /\b(lp|l\.p\.|limited partnership)\.?$/i, hint: 'The name must end with "LP" or "Limited Partnership".' }
};
export const money = n => "$" + Number(n).toFixed(2);
export const isoDay = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const plusYear = iso => { const [y, m, d] = String(iso).split("-").map(Number); return isoDay(new Date(y + 1, m - 1, d)); };
const toDate = iso => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); };
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
export const parsePins = s => [...new Set(String(s || "").split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
const BAD = /\b(michigan state police|state police|department of state|secretary of state|attorney general|court|police department|sheriff)\b/i;
/* Returns "" when the name is acceptable, otherwise the reason. */
export function nameProblem(typeKey, name) {
  const T = TYPES[typeKey], n = String(name || "").trim();
  if (!T) return "Choose a business type.";
  if (n.length < 3 || n.length > 80) return "The name must be 3 to 80 characters.";
  if (T.re && !T.re.test(n)) return T.hint;
  if (BAD.test(n)) return "The name cannot suggest a government agency.";
  if (typeKey === "nonprofit" && /\b(llc|inc|corp|corporation|company|limited)\b\.?$/i.test(n)) return "A nonprofit name cannot end like a for-profit company.";
  return "";
}
export const sameName = (a, b) => String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "") === String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/* { label, cls, late (days late), owed (annual report fee plus any late fee) } for a business record. */
export function standing(b, today = isoDay(new Date())) {
  const T = TYPES[b.type] || {};
  if (b.status === "dissolved") return { label: "Dissolved", cls: "n", code: "dissolved" };
  if (!T.report || !b.dueDate) return { label: "Active", cls: "g", code: "active" };
  const late = daysBetween(b.dueDate, today);
  if (late <= 0) return { label: "Active", cls: "g", code: "active", late: 0, owed: T.reportFee };
  if (late <= GRACE_DAYS) return { label: "Past due", cls: "o", code: "past-due", late, owed: T.reportFee + LATE_FEE };
  return { label: "Administratively dissolved", cls: "n", code: "admin-dissolved", late, owed: T.reportFee + LATE_FEE };
}

export const INDUSTRIES = ["Agriculture and farming", "Automotive sales and repair", "Construction and contracting", "Education and training", "Entertainment and media", "Finance and insurance",
  "Food and beverage", "Government contracting", "Health and wellness", "Hospitality and lodging", "Landscaping and outdoor services", "Legal and professional services", "Manufacturing",
  "Nonprofit and community services", "Personal services", "Real estate and property management", "Retail", "Security services", "Technology and software", "Transportation and logistics", "Utilities and energy", "Other"];
export const CERTS = [["accurate", "The information provided in this application is accurate and complete."], ["authorized", "The business is authorized to operate under applicable law."],
  ["submitter", "I am authorized to submit this registration for the business."], ["notify", "I agree to notify the Department of State of any material changes to this information."]];
/* Business ID: nine digits with a hyphen after the first two, for example 47-1938265. */
export const bizNumber = () => { let d = String(1 + Math.floor(Math.random() * 9)); for (let i = 0; i < 8; i++) d += Math.floor(Math.random() * 10); return d.slice(0, 2) + "-" + d.slice(2); };
export const isoDob = v => { const s = String(v || ""); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0"); m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s); return m ? m[1] + "-" + m[2] + "-" + m[3] : ""; };
export const zipOk = z => /^\d{5}(-\d{4})?$/.test(String(z || "").trim());
export const fullNameOk = n => String(n || "").trim().split(/\s+/).filter(Boolean).length >= 2 && String(n).trim().length <= 80;
export const siteNorm = u => { u = String(u || "").trim(); if (!u) return ""; if (!/^https?:\/\//i.test(u)) u = "https://" + u; try { const x = new URL(u); return /\./.test(x.hostname) ? x.href : null; } catch { return null; } };
export const discordNorm = u => { u = String(u || "").trim(); if (!u) return ""; const m = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([A-Za-z0-9-]{2,32})\/?$/i.exec(u); return m ? "https://discord.gg/" + m[1] : null; };