/* Michigan's election calendar and the offices on the ballot. Shared by the Voting Services, Candidate Services and Elections Desk pages.
   Every general election runs on the same calendar: terms run January 1 to December 31, Election Day is 21 days before the term begins (December 11),
   and online voting runs from 30 to 10 days before the term begins (December 2 to December 22). */

export const LEVELS = { state: "State", county: "Genesee County", city: "City of Flint" };

/* seats: how many are filled. head: what the top scorer becomes in a ranked race. tie: who breaks a tie for that head position. */
export const OFFICES = [
  { k: "governor", level: "state", t: "Governor and Lieutenant Governor", seats: 1, note: "Elected jointly as a single ticket. One vote decides both offices together." },
  { k: "legislature", level: "state", t: "Legislator", seats: 12, ranked: true, head: "Speaker of the Legislature", tie: "the newly elected Governor" },
  { k: "judiciary", level: "state", t: "Justice", seats: 7, ranked: true, head: "Chief Justice", tie: "the newly elected Governor" },
  { k: "county-commissioner", level: "county", t: "County Commissioner", seats: 5, ranked: true, head: "Chairperson of the Board", tie: "the newly elected Governor" },
  { k: "county-clerk", level: "county", t: "County Clerk", seats: 1 },
  { k: "county-treasurer", level: "county", t: "County Treasurer", seats: 1 },
  { k: "sheriff", level: "county", t: "Sheriff", seats: 1 },
  { k: "county-prosecutor", level: "county", t: "County Prosecutor", seats: 1 },
  { k: "mayor", level: "city", t: "Mayor", seats: 1 },
  { k: "city-council", level: "city", t: "City Council Member", seats: 3, ranked: true, head: "President of the Council", tie: "the newly elected Mayor" }
];
export const officeOf = k => OFFICES.find(o => o.k === k);

const day = (y, m, d, end) => end ? new Date(y, m, d, 23, 59, 59) : new Date(y, m, d);
/* The next general election that has not finished its online voting window. */
export function cycle(now = new Date()) {
  let y = now.getFullYear();                                   /* a window that ends December 22 of this year belongs to the term starting next January 1 */
  if (now > day(y, 11, 22, true)) y++;
  const term = y + 1;
  const c = { termYear: term, termStart: day(term, 0, 1), termEnd: day(term, 11, 31),
    onlineOpen: day(term - 1, 11, 2), electionDay: day(term - 1, 11, 11), onlineClose: day(term - 1, 11, 22, true),
    runoffOnlineOpen: day(term, 0, 1), runoffOnlineClose: day(term, 0, 10, true), runoffDay: day(term, 0, 5) };
  c.phase = now < c.onlineOpen ? "upcoming" : now <= c.onlineClose ? "open" : "closed";
  c.daysToOpen = Math.ceil((c.onlineOpen - now) / 864e5); c.daysToElection = Math.ceil((c.electionDay - now) / 864e5);
  return c;
}
export const fmtDay = d => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
export const fmtShort = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });