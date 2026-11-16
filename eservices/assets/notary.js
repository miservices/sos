/* Notary commissions. Shared by the Notarial Services page and the staff approval code.
   A commission lives in SOS Firestore at notaries/{pin}:
     { pin, name, number "NP-123456", county, address{street,city,state:"MI",zip}, status "active"|"resigned"|"suspended"|"revoked",
       issuedAt, expiresAt (YYYY-MM-DD), renewedAt?, signature{name,signedAt}, caseId, updatedBy, updatedAt }
   "Expired" is worked out from expiresAt when shown. */
import { isoDay, daysBetween } from "https://migovt.org/sos/eservices/assets/business.js";
export { isoDay, daysBetween };
export const FEE = 20, TERM_YEARS = 4, RENEW_DAYS = 60, MIN_AGE = 18;
export const COUNTIES = ["Alcona", "Alger", "Allegan", "Alpena", "Antrim", "Arenac", "Baraga", "Barry", "Bay", "Benzie", "Berrien", "Branch", "Calhoun", "Cass", "Charlevoix", "Cheboygan", "Chippewa", "Clare", "Clinton", "Crawford", "Delta", "Dickinson", "Eaton", "Emmet", "Genesee", "Gladwin", "Gogebic", "Grand Traverse", "Gratiot", "Hillsdale", "Houghton", "Huron", "Ingham", "Ionia", "Iosco", "Iron", "Isabella", "Jackson", "Kalamazoo", "Kalkaska", "Kent", "Keweenaw", "Lake", "Lapeer", "Leelanau", "Lenawee", "Livingston", "Luce", "Mackinac", "Macomb", "Manistee", "Marquette", "Mason", "Mecosta", "Menominee", "Midland", "Missaukee", "Monroe", "Montcalm", "Montmorency", "Muskegon", "Newaygo", "Oakland", "Oceana", "Ogemaw", "Ontonagon", "Osceola", "Oscoda", "Otsego", "Ottawa", "Presque Isle", "Roscommon", "Saginaw", "St. Clair", "St. Joseph", "Sanilac", "Schoolcraft", "Shiawassee", "Tuscola", "Van Buren", "Washtenaw", "Wayne", "Wexford"];
export const CERTS = [["eligible", "I am at least 18 years old and a citizen or resident of Michigan."], ["duties", "I will faithfully perform the duties of a notary public and follow the law."],
  ["accurate", "The information in this application is accurate and complete."], ["discipline", "I understand the Department of State may suspend or revoke my commission for misconduct."]];
export const plusYears = (iso, n) => { const [y, m, d] = String(iso).split("-").map(Number); return isoDay(new Date(y + n, m - 1, d)); };
export const notaryNumber = () => { let d = ""; for (let i = 0; i < 6; i++) d += Math.floor(Math.random() * 10); return "NP-" + d; };
export const ageOn = (dobIso, today = isoDay(new Date())) => { const [y, m, d] = String(dobIso).split("-").map(Number), [ty, tm, td] = today.split("-").map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); };
/* { label, cls, code, left (days to expiry) } */
export function standing(n, today = isoDay(new Date())) {
  if (!n) return { label: "Not commissioned", cls: "n", code: "none" };
  const st = String(n.status || "active").toLowerCase();
  if (st === "resigned") return { label: "Resigned", cls: "n", code: "resigned" };
  if (st === "revoked") return { label: "Revoked", cls: "n", code: "revoked" };
  if (st === "suspended") return { label: "Suspended", cls: "o", code: "suspended" };
  const left = daysBetween(today, n.expiresAt);
  if (left < 0) return { label: "Expired", cls: "n", code: "expired", left };
  return { label: "Active", cls: "g", code: "active", left };
}