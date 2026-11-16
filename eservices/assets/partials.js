/* MiGOVT SOS e-Services: shared page chrome (banner, top bar, side navigation, footer) and the map of every portal page.
   Usage inside a portal page:
     <script src="https://migovt.org/sos/eservices/assets/partials.js" data-part="header"></script>
     <div class="shell">
       <script src="https://migovt.org/sos/eservices/assets/partials.js" data-part="nav" data-page="home"></script>
       <main class="pmain"> ... </main>
     </div>
     <script src="https://migovt.org/sos/eservices/assets/partials.js" data-part="footer"></script>
   data-page is the key of the page ("home", "licenses", "driving-record", ...).
   This file is also the single list of portal pages: window.SOS_PAGES (grouped) and window.SOS_FLAT. */
(function () {
  var B = "https://migovt.org/sos/", E = B + "eservices/";

  /* ---------- the map of the portal ----------
     k: key (matches data-page)   t: title   u: path under /sos/eservices/   d: one-line description
     tag: small label shown in the menu for pages built for a special permission
     perm: the specialPermissions value that unlocks the full tools on that page (the page itself stays visible so others can apply) */
  var PAGES = [
    { g: "Overview", items: [
      { k: "home", t: "Home", u: "home/", d: "Your account overview, recent activity, fees, and important notices." },
      { k: "notices", t: "Official Notices", u: "notices/", d: "Notices the Department has sent you, including warning letters and renewal reminders." },
      { k: "history", t: "Transactions and History", u: "history/", d: "Every fee you have paid and every action on your account." }
    ] },
    { g: "Identity and Licensing", items: [
      { k: "identification", t: "Identification", u: "identification/", d: "Your information, name changes, personal ID and REAL ID, birth certificate, citizenship and resident status." },
      { k: "licenses", t: "Driver Licensing", u: "licenses/", d: "Driver, motorcycle, chauffeur, and commercial license status and renewal." },
      { k: "driving-record", t: "Driving Record", u: "driving-record/", d: "View and request a certified copy of your record, and see who has accessed it." },
      { k: "professional-licensing", t: "Professional Licensing", u: "professional-licensing/", d: "View your professional licenses, their status, and any conditions." }
    ] },
    { g: "Vehicles", items: [
      { k: "registration", t: "Vehicle Registration", u: "registration/", d: "See every vehicle registered to you, register a new one, and renew." },
      { k: "titles", t: "Vehicle Titles", u: "titles/", d: "See vehicles you are titled in, apply for a title or duplicate, and transfer a title." },
      { k: "insurance", t: "Insurance Services", u: "insurance/", d: "Coverage status, proof of insurance, compliance, and a list of insurers." }
    ] },
    { g: "Records and Privacy", items: [
      { k: "records-access", t: "Records Access", u: "records-access/", d: "Look up another person's license status, record, registration, title, or insurance." },
      { k: "approvals", t: "Access Approvals", u: "approvals/", d: "Approve or deny requests from people who want to see your records." }
    ] },
    { g: "Elections", items: [
      { k: "voting", t: "Voting Services", u: "voting/", d: "Register to vote, check your registration, and vote." },
      { k: "candidate-services", t: "Candidate Services", u: "candidate-services/", d: "File as a candidate and submit financial reports." }
    ] },
    { g: "Business and Legal", items: [
      { k: "business", t: "Business Services", u: "business/", d: "Register a business and file reports." },
      { k: "notary", t: "Notarial Services", u: "notary/", d: "Apply for and manage a notary commission." },
      { k: "appeals", t: "Appeals and Contests", u: "appeals/", d: "Contest points, and appeal decisions to an Administrative Law Judge." }
    ] },
    { g: "Industry Services", items: [
      { k: "dealer-services", t: "Dealer Services", u: "dealer-services/", d: "Dealership license, title and registration applications for buyers, vehicle sales, and ownership transfers.", tag: "Dealers", perm: "dealer" },
      { k: "insurer-services", t: "Insurance Provider Services", u: "insurer-services/", d: "Auto insurance license, and registering yourself as the insurer of a vehicle.", tag: "Insurers", perm: "insurer" }
    ] }
  ];
  var FLAT = [];
  PAGES.forEach(function (g) { g.items.forEach(function (i) { i.url = E + i.u; i.group = g.g; FLAT.push(i); }); });
  window.SOS_PAGES = PAGES; window.SOS_FLAT = FLAT;

  /* ---------- the map of the staff portal (/sos/eservices/staff/) ---------- */
  var STAFF = [
    { g: "Overview", items: [
      { k: "home", t: "Staff Home", u: "home/", d: "Your role, your assigned cases, and your recent actions." },
      { k: "queue", t: "Work Queue", u: "queue/", d: "Every case in your scope, across desks." }
    ] },
    { g: "Bureau Desks", items: [
      { k: "licensing", t: "Licensing Desk", u: "licensing/", d: "License, ID, dealer, insurer, and professional license requests.", bureau: "lara" },
      { k: "records", t: "Records Desk", u: "records/", d: "Certified record requests and vital record requests.", bureau: "lara" },
      { k: "elections", t: "Elections Desk", u: "elections/", d: "Voter registrations, candidate filings, finance reports, business and notary filings.", bureau: "elections" },
      { k: "hearings", t: "Hearings Desk", u: "hearings/", d: "The docket of administrative appeals.", bureau: "hearings" }
    ] },
    { g: "Tools", items: [
      { k: "lookup", t: "Person Lookup", u: "lookup/", d: "Search for a person and open their file. Every lookup is recorded." },
      { k: "professional-licenses", t: "Professional Licenses", u: "professional-licenses/", d: "Issue medical and bail bond licenses, change status, and record discipline." },
      { k: "notices", t: "Send Notices", u: "notices/", d: "Send an official notice to one person or to everyone." }
    ] },
    { g: "Administration", items: [
      { k: "directory", t: "Staff Directory", u: "directory/", d: "Everyone on staff, by role and bureau." },
      { k: "accounts", t: "Account Administration", u: "accounts/", d: "Assign roles, bureaus, and special permissions." },
      { k: "audit", t: "Audit Log", u: "audit/", d: "A record of staff actions." }
    ] }
  ];
  var SFLAT = [];
  STAFF.forEach(function (g) { g.items.forEach(function (i) { i.url = E + "staff/" + i.u; i.group = g.g; SFLAT.push(i); }); });
  window.SOS_STAFF = STAFF; window.SOS_STAFF_FLAT = SFLAT;

  var LOGO = '<a class="logo" href="' + B + '" aria-label="Michigan Secretary of State"><svg viewBox="0 0 430 100" role="img" aria-label="Michigan Secretary of State"><g font-family="\'Plus Jakarta Sans\',\'Segoe UI\',Arial,sans-serif"><text x="4" y="30" font-size="13" font-weight="700" fill="#0e7c86" letter-spacing="5">MICHIGAN</text><text x="2" y="70" font-size="44" font-weight="800" fill="#0f2327" letter-spacing="-1">Secretary of State</text></g><rect x="4" y="82" width="365" height="5" rx="2.5" fill="#0e7c86"/><path d="M388 80l10 10 20-22" fill="none" stroke="#ff7a3d" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>';

  function nav(current) {
    var h = '<aside class="pnav" aria-label="SOS e-Services"><nav>';
    PAGES.forEach(function (g) {
      h += '<h4>' + g.g + '</h4>';
      g.items.forEach(function (i) {
        h += '<a href="' + i.url + '"' + (i.k === current ? ' class="on" aria-current="page"' : '') + '><span>' + i.t + '</span>' + (i.tag ? '<em>' + i.tag + '</em>' : '') + '</a>';
      });
    });
    h += '<h4>More</h4><a href="https://migovt.org/account/"><span>My MiGOVT account</span></a><a href="' + B + '"><span>Secretary of State home</span></a>';
    return h + '</nav></aside>';
  }

  function staffnav(current) {
    var h = '<aside class="pnav" aria-label="Staff portal"><nav>';
    STAFF.forEach(function (g) {
      h += '<h4>' + g.g + '</h4>';
      g.items.forEach(function (i) { h += '<a href="' + i.url + '"' + (i.k === current ? ' class="on" aria-current="page"' : '') + '><span>' + i.t + '</span></a>'; });
    });
    h += '<h4>More</h4><a href="' + E + 'home/"><span>Back to e-Services</span></a><a href="' + B + '"><span>Secretary of State home</span></a>';
    return h + '</nav></aside>';
  }

  var parts = {
    header: function (_c, staff) {
      if (staff) document.body.classList.add('staff');
      return '<div class="sim">This is not an official government website. This site is a simulated government interface and does not represent any real government body or authority.</div>' +
        '<header class="pbar"><button class="pmenu" type="button" data-pmenu aria-expanded="false" aria-label="Open the menu">Menu</button>' + LOGO +
        '<a class="pbrand" href="' + E + (staff ? 'staff/home/">Staff Portal' : 'home/">e-Services') + '</a>' +
        '<div class="puser" data-puser hidden><span class="av" data-av></span><span class="pn" data-name></span><button class="psignout" type="button" data-signout>Sign out</button></div>' +
        '<a class="psignin" data-signin href="' + E + '">Sign in</a></header>';
    },
    nav: nav,
    staffnav: staffnav,
    footer: function () {
      return '<footer class="pfoot"><div><a href="' + B + 'about/">About</a><a href="' + B + 'directory/">Office directory</a><a href="' + B + 'accessibility/">Accessibility</a><a href="' + B + '">Secretary of State home</a></div>' +
        '<p>Michigan Department of State. A simulated government website for a fictional Michigan.</p></footer>';
    }
  };

  var el = document.currentScript;
  if (!el) return;
  var fn = parts[el.getAttribute('data-part')];
  if (fn) el.insertAdjacentHTML('beforebegin', fn(el.getAttribute('data-page'), el.hasAttribute('data-staff')));

  /* mobile menu button (added once) */
  if (!window.__sosMenu) {
    window.__sosMenu = true;
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pmenu]');
      if (!b) return;
      var on = document.body.classList.toggle('nav-open');
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }
})();