/* Scene: payments (#payments) and the per-claim ledger view (#claim/<seq>/ledger, through
   window.CLAIM_VIEWS.ledger). Payments live at the module's claim_pay grain: one row per payment
   occurrence on a service line. A new payment is always a NEW row, never an edit; a negative row is a
   recoupment. 835 rows arrive proposed and the biller confirms them. The Remit add-on is a widget
   built into this module's design: it looks like the rest of the module. */
(function () {
  "use strict";
  window.SCENES = window.SCENES || {};
  window.CLAIM_VIEWS = window.CLAIM_VIEWS || {};

  var ILLUS_CHECK = 2538.00;      // the printed check total used by the Remit validation (illustrative)
  var UNAPPLIED_INIT = 1284.50;   // illustrative unapplied cash
  var PREPAY_INIT = 600.00;       // illustrative patient pre-payment
  var PR_WORDS = { "PR-1": "Deductible amount (patient responsibility)", "PR-2": "Coinsurance amount (patient responsibility)", "PR-3": "Co-payment amount (patient responsibility)" };
  var SOURCES = ["Manual check", "Patient payment", "Recoupment", "Correction"];
  var OTHER_CLIENT_SEQ = 238000026;  // exactly one claim reads "belongs to another client" so the refused-at-Post path can be shown

  // Scene UI state (filters, selections, the Remit widget's local steps). Not the store: rebuilt freely.
  var UI = { sort: {}, eft: null, remit: {}, unapplied: null, prepay: null };

  // ----------------------------------------------------------------------------------- small helpers
  function money(api, x) { return api.fmt.money(x); }
  function dashDate(iso) { if (!iso) return "-"; var p = iso.slice(0, 10).split("-"); return p[1] + "-" + p[2] + "-" + p[0]; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function sum(rows, f) { return round2(rows.reduce(function (a, r) { return a + (f ? f(r) : r); }, 0)); }
  function isProposed(r) { return r.status === "Proposed, confirm"; }
  function eftDigit(check) { var m = String(check || "").match(/(\d)\s*$/); return m ? Number(m[1]) : 0; }
  function hasEobPage(check) { return eftDigit(check) % 2 === 1; }   // deterministic: EFT numbers ending in an odd digit have a scanned EOB page
  function allRows(ST) {
    // every ledger row across Ongoing claims as {seq, c, r}
    var out = [];
    ST.list("ongoing").forEach(function (c) { (c.ledger || []).forEach(function (r) { out.push({ seq: c.seq, c: c, r: r }); }); });
    return out;
  }
  function byCheck(rows) {
    var g = {}; rows.forEach(function (x) { var k = x.r.check || "(no check number)"; (g[k] = g[k] || []).push(x); });
    return Object.keys(g).sort().map(function (k) { return { check: k, rows: g[k] }; });
  }
  function parseAdj(text) {
    // "CO-45 $-19.85, PR-2 $15.00" -> [{code, amount, raw}]
    return String(text || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var m = s.match(/^([A-Z]{1,2}-\d+)\s*\$?(-?[\d.,]+)?$/);
      return m ? { code: m[1], amount: m[2] != null ? Number(m[2].replace(/,/g, "")) : null, raw: s } : { code: null, amount: null, raw: s };
    });
  }
  function adjMeaning(api, code) {
    if (!code) return "";
    var k = api.data.carc[code]; if (k) return (api.data.denialCategory && api.data.denialCategory[code] ? api.data.denialCategory[code] + ". " : "") + k.meaning;
    return PR_WORDS[code] || "";
  }
  function adjHtml(api, text) {
    var esc = api.esc; var parts = parseAdj(text);
    if (!parts.length) return '<span class="sub">none</span>';
    return parts.map(function (p) { var m = adjMeaning(api, p.code); return '<span class="mono" title="' + esc(m) + '">' + esc(p.raw) + '</span>'; }).join('<br>');
  }
  function adjWords(api, text) {
    var esc = api.esc; var parts = parseAdj(text);
    if (!parts.length) return '<span class="sub">no adjustments</span>';
    return '<ul class="checks">' + parts.map(function (p) { var m = adjMeaning(api, p.code); return '<li class="' + (p.code && p.code.indexOf("PR") === 0 ? "warn" : "ok") + '"><b class="mono">' + esc(p.raw) + '</b><span class="sub">' + esc(m || "Code not in the demo's code list") + '</span></li>'; }).join("") + '</ul>';
  }
  function lineCharge(c, cpt) { var l = (c.lines || []).find(function (x) { return x.cpt === cpt; }); return l ? l.charge : null; }
  function styleBlock() {
    // only existing tokens, so both skins keep working
    return '<style>' +
      '.pay-drop{border:2px dashed var(--line2);border-radius:var(--radius);padding:18px;text-align:center;color:var(--muted);background:var(--paper);margin-bottom:8px}' +
      '.pay-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}' +
      '.pay-cards .card{margin-bottom:0}' +
      'table.grid td.hl{background:var(--warn-bg)}' +
      '.remit-widget .card{margin-top:8px}' +
      '.remit-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}' +
      '</style>';
  }
  function sortFor(id, def) { return UI.sort[id] || def; }
  function wireSort(wrap, rerender) {
    wrap.querySelectorAll("table.grid[id] th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () { var id = th.closest("table").id; var k = th.getAttribute("data-sort"); var s = UI.sort[id] || {}; UI.sort[id] = { key: k, dir: s.key === k && s.dir === "asc" ? "desc" : "asc" }; rerender(); });
    });
  }
  function tilesHtml(api, items) {
    var esc = api.esc;
    return '<div class="tiles">' + items.map(function (t) { return '<div class="tile' + (t.cls ? ' ' + t.cls : '') + '"' + (t.href ? ' data-href="' + esc(t.href) + '"' : '') + '><div class="n">' + esc(t.n) + '</div><div class="l">' + esc(t.l) + (t.sub ? '<br><span class="sub">' + esc(t.sub) + '</span>' : '') + '</div></div>'; }).join("") + '</div>';
  }
  function initIllustrative(api) {
    var ST = api.state;
    if (!UI.unapplied) UI.unapplied = [{ id: "ua1", payer: "Specimen Medicare Plan 1", check: "EFT 10131", date: ST.addDays(ST.TODAY, -3), amount: UNAPPLIED_INIT, why: "The patient control number on the 835 matched no claim on file" }];
    if (!UI.prepay) {
      var c = ST.list("ongoing").find(function (x) { return ST.totals(x).balance > PREPAY_INIT; }) || ST.list("ongoing")[0];
      UI.prepay = c ? [{ id: "pp1", pat: c.pat, seq: c.seq, date: ST.addDays(ST.TODAY, -6), amount: PREPAY_INIT, how: "Patient check, received at the front desk" }] : [];
    }
  }

  // ----------------------------------------------------------------------------------- the #payments scene
  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label;
    initIllustrative(api);
    var tab = ({ queue: 1, remits: 1, unapplied: 1, remit: 1 })[r.parts[1]] ? r.parts[1] : "queue";
    var rows = allRows(ST);
    var proposed = rows.filter(function (x) { return isProposed(x.r); });
    var month = ST.TODAY.slice(0, 7);
    var tiles = [
      { n: proposed.length, l: "Proposed, awaiting confirmation", cls: proposed.length ? "warn" : "ok", href: "#payments/queue" },
      { n: rows.filter(function (x) { return x.r.status === "Posted" && x.r.date === ST.TODAY; }).length, l: "Posted today" },
      { n: money(api, sum(UI.unapplied, function (u) { return u.amount; })), l: "Unapplied cash", sub: "illustrative", href: "#payments/unapplied" },
      { n: money(api, sum(UI.prepay, function (p) { return p.amount; })), l: "Pre-payments", sub: "illustrative", href: "#payments/unapplied" },
      { n: money(api, sum(rows.filter(function (x) { return x.r.status === "Posted" && x.r.paid > 0 && x.r.date.slice(0, 7) === month; }), function (x) { return x.r.paid; })), l: "Collected this month", cls: "ok", sub: "posted rows dated " + month }
    ];
    var html = styleBlock() + '<h1>' + esc(L("payments")) + '</h1>';
    html += C.tabs([
      { key: "queue", href: "#payments/queue", label: "Proposed postings", count: proposed.length },
      { key: "remits", href: "#payments/remits", label: "Remittances (835)", count: byCheck(rows).length },
      { key: "unapplied", href: "#payments/unapplied", label: "Unapplied and pre-payments", count: UI.unapplied.length + UI.prepay.length },
      { key: "remit", href: "#payments/remit", label: "Remit add-on" }
    ], tab);
    html += tilesHtml(api, tiles);
    html += '<div id="pay-wrap">';
    if (tab === "queue") html += queueTab(api, proposed);
    else if (tab === "remits") html += remitsTab(api, rows);
    else if (tab === "unapplied") html += unappliedTab(api);
    else html += remitTab(api, rows);
    html += C.banner(api.data.illustrative) + '</div>';
    root.innerHTML = html;

    var wrap = root.querySelector("#pay-wrap");
    function again() { render(root, api, r); }
    wireSort(wrap, again);
    var sel = wrap.querySelector("#remit-eft"); if (sel) sel.addEventListener("change", function () { UI.eft = sel.value; again(); });
    wrap.addEventListener("click", function (ev) { onAct(ev, api, again, { tab: tab }); });
  }

  function queueTab(api, proposed) {
    var C = api.components, esc = api.esc, L = api.label;
    var html = '<p class="sub">Every 835 row arrives proposed and the biller confirms it. Confirming posts the row at the claim_pay grain, one row per payment occurrence on a service line. A new payment is always a new row, never an edit.</p>';
    if (!proposed.length) return html + C.panel("Nothing waiting", '<p>Every proposed 835 row has been confirmed. New remittances arrive proposed here.</p>');
    byCheck(proposed).forEach(function (g) {
      var cols = queueColumns(api, true);
      html += C.panel(esc(g.check),
        '<p class="sub" style="margin:0 0 8px">' + esc(g.rows[0].r.payer) + ' · ' + esc(api.fmt.date(g.rows[0].r.date)) + ' · ' + g.rows.length + ' proposed row' + (g.rows.length === 1 ? '' : 's') + ' · ' + esc(money(api, sum(g.rows, function (x) { return x.r.paid; }))) + ' proposed on this EFT</p>' + C.grid({ id: "q-" + g.check.replace(/\W/g, ""), columns: cols, rows: g.rows, sort: sortFor("q-" + g.check.replace(/\W/g, ""), { key: "pat", dir: "asc" }) }),
        C.btn("Confirm all from this EFT", "confirm-eft", { check: g.check }, "sm primary"));
    });
    return html;
  }
  function queueColumns(api, withActions) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var cols = [
      { key: "pat", label: L("patient"), sort: function (x) { return x.c.pat; }, render: function (x) { return C.patLink(x.c, esc(x.c.hosp) + " · DOS " + fmt.date(x.c.dos)); } },
      { key: "payer", label: L("payer"), sort: function (x) { return x.r.payer; }, render: function (x) { return esc(x.r.payer); } },
      { key: "check", label: "Check or EFT", sort: function (x) { return x.r.check; }, render: function (x) { return '<span class="mono">' + esc(x.r.check) + '</span><br><span class="sub">' + esc(fmt.date(x.r.date)) + '</span>'; } },
      { key: "line", label: "Line", sort: function (x) { return x.r.line; }, render: function (x) { var ch = lineCharge(x.c, x.r.line); return '<span class="mono">' + esc(x.r.line) + '</span>' + (ch != null ? '<br><span class="sub">billed ' + esc(money(api, ch)) + '</span>' : ''); } },
      { key: "allowed", label: "Allowed", cls: "num", sort: function (x) { return x.r.allowed; }, render: function (x) { return money(api, x.r.allowed); } },
      { key: "paid", label: "Paid", cls: "num", sort: function (x) { return x.r.paid; }, render: function (x) { return x.r.paid < 0 ? '<span class="pill recoup">' + esc(money(api, x.r.paid)) + '</span>' : '<b>' + esc(money(api, x.r.paid)) + '</b>'; } },
      { key: "adj", label: "Adjustments", sort: function (x) { return x.r.adj; }, render: function (x) { return adjHtml(api, x.r.adj); } },
      { key: "remark", label: "Remark", sort: function (x) { return x.r.remark; }, render: function (x) { return x.r.remark ? '<span class="mono">' + esc(x.r.remark) + '</span>' : '<span class="sub">none</span>'; } }
    ];
    if (withActions) cols.push({ key: "act", label: L("next"), render: function (x) { return C.btn(L("confirm").charAt(0).toUpperCase() + L("confirm").slice(1), "confirm-row", { seq: x.seq, id: x.r.id }, "sm primary") + ' ' + C.btn("Reject", "reject-row", { seq: x.seq, id: x.r.id }, "sm"); } });
    return cols;
  }

  function remitsTab(api, rows) {
    var C = api.components, esc = api.esc, fmt = api.fmt;
    var groups = byCheck(rows);
    var html = '<p class="sub">One card per remittance (835), grouped by the check or EFT number. Open the detail to read the claim (CLP) and service line (SVC) level in plain words.</p><div class="pay-cards">';
    groups.forEach(function (g) {
      var prop = g.rows.filter(function (x) { return isProposed(x.r); }).length;
      var claims = {}; g.rows.forEach(function (x) { claims[x.seq] = 1; });
      html += C.card(esc(g.check) + (prop ? ' ' + C.pill(prop + " proposed", "partial") : ' ' + C.pill("all posted", "paid")),
        C.kv([["Payer", g.rows[0].r.payer], ["Date", fmt.date(g.rows[0].r.date)], ["Total paid", money(api, sum(g.rows, function (x) { return x.r.paid; }))], ["Rows", g.rows.length + " on " + Object.keys(claims).length + " claim" + (Object.keys(claims).length === 1 ? "" : "s")], ["Proposed", String(prop)]]) +
        '<div class="toolbar">' + C.btn("View 835 detail", "view-835", { check: g.check }, "sm") + ' ' + C.btn("Open in Remit add-on", "open-remit", { check: g.check }, "sm") + '</div>');
    });
    return html + '</div>';
  }

  function unappliedTab(api) {
    var C = api.components, esc = api.esc, fmt = api.fmt, L = api.label;
    var ua = C.grid({ id: "g-unapplied", columns: [
      { key: "payer", label: L("payer"), render: function (u) { return esc(u.payer); } },
      { key: "check", label: "Check or EFT", render: function (u) { return '<span class="mono">' + esc(u.check) + '</span>'; } },
      { key: "date", label: "Received", render: function (u) { return fmt.date(u.date); } },
      { key: "amount", label: "Amount", cls: "num", render: function (u) { return '<b>' + esc(money(api, u.amount)) + '</b>'; } },
      { key: "why", label: "Why unapplied", render: function (u) { return '<span class="sub">' + esc(u.why) + '</span>'; } },
      { key: "act", label: L("next"), render: function (u) { return C.btn("Apply to a claim", "apply-unapplied", { id: u.id }, "sm primary"); } }
    ], rows: UI.unapplied, empty: "No unapplied cash. Every dollar received is on a claim." });
    var pp = C.grid({ id: "g-prepay", columns: [
      { key: "pat", label: L("patient"), render: function (p) { return '<b>' + esc(p.pat) + '</b>'; } },
      { key: "how", label: "How it came in", render: function (p) { return esc(p.how); } },
      { key: "date", label: "Received", render: function (p) { return fmt.date(p.date); } },
      { key: "amount", label: "Amount", cls: "num", render: function (p) { return '<b>' + esc(money(api, p.amount)) + '</b>'; } },
      { key: "act", label: L("next"), render: function (p) { return C.btn("Apply", "apply-prepay", { id: p.id }, "sm primary"); } }
    ], rows: UI.prepay, empty: "No pre-payments waiting." });
    return C.panel("Unapplied cash <span class=\"sub\">money received that matched no claim (illustrative)</span>", ua) + C.panel("Pre-payments <span class=\"sub\">paid by the patient before the claim settled (illustrative)</span>", pp);
  }

  // ----------------------------------------------------------------------------------- the Remit add-on widget
  function remitTab(api, rows) {
    var C = api.components, esc = api.esc, ST = api.state;
    if (!ST.get().addons.remit) return remitOff(api);
    var groups = byCheck(rows);
    if (!UI.eft || !groups.some(function (g) { return g.check === UI.eft; })) { var first = groups.find(function (g) { return g.rows.some(function (x) { return isProposed(x.r); }); }) || groups[0]; UI.eft = first ? first.check : null; }
    var sel = '<label class="chk">Remittance <select id="remit-eft">' + groups.map(function (g) { var p = g.rows.filter(function (x) { return isProposed(x.r); }).length; return '<option value="' + esc(g.check) + '"' + (g.check === UI.eft ? ' selected' : '') + '>' + esc(g.check) + ' · ' + esc(g.rows[0].r.payer) + (p ? ' · ' + p + ' proposed' : '') + '</option>'; }).join("") + '</select></label>';
    var g = groups.find(function (x) { return x.check === UI.eft; });
    return remitWidget(api, g, { selector: sel });
  }
  function remitOff(api) {
    var C = api.components;
    return C.card("Remit add-on is off", '<p>Remit reads the 835 and the paper EOB, validates each claim line against the printed check, compares the two, and lets the biller approve and post from one place. It is built into this module and switched on per client. <a href="#settings/addons">Turn it on under Settings, Add-ons</a>.</p>');
  }
  function rs(check) { return UI.remit[check] = UI.remit[check] || { uploaded: false, validated: false, compared: false, review: {}, reasons: {}, posted: {}, result: "" }; }
  function claimGroups(g) {
    var m = {}; g.rows.forEach(function (x) { (m[x.seq] = m[x.seq] || { seq: x.seq, c: x.c, rows: [] }).rows.push(x.r); });
    return Object.keys(m).sort().map(function (k) { return m[k]; });
  }
  function usmonMatch(cg) {
    // held reasons first (no 835 for a held row), then the match words. Deterministic from the data.
    if (!cg.c.pat) return { word: "held: patient name missing", held: true };
    if (!cg.c.member) return { word: "held: member id missing from the rebuilt 835", held: true };
    if (cg.rows.some(function (r) { return r.paid < 0 && lineCharge(cg.c, r.line) == null; })) return { word: "held: reversal without charge", held: true };
    if (cg.seq === OTHER_CLIENT_SEQ) return { word: "belongs to another client", held: false };
    var d = cg.seq % 11;
    return { word: d === 5 ? "account mismatch" : d === 9 ? "not found" : "matched", held: false };
  }
  function claimState(ST, cg) {
    // the widget's claim state words and headline
    var paid = sum(cg.rows, function (r) { return r.paid; }), allowed = sum(cg.rows, function (r) { return r.allowed; });
    var co = null; cg.rows.forEach(function (r) { if (r.paid <= 0) parseAdj(r.adj).forEach(function (p) { if (!co && p.code && p.code.indexOf("CO-") === 0 && p.code !== "CO-45") co = p.code; }); });
    var st = cg.c.status;
    if (st === "denied" || st === "recoup" || (allowed <= 0 && paid <= 0)) { var code = (cg.c.fin && cg.c.fin.code) || co || "CO-16"; return { label: "Denied, " + code, cls: "denied", head: "Why was this claim denied?", denied: true, code: code }; }
    if (st === "awaiting" || st === "acknowledged" || st === "filed" || st === "refiled" || st === "appealed") return { label: "Awaiting payer", cls: "await", head: "Claim status: awaiting payer response." };
    if (paid > 0 && paid < cg.c.billed && !co) return { label: "Paid, less than billed", cls: "partial", head: "This claim is ready to approve." };
    return { label: "Ready to approve", cls: "ready", head: "This claim is ready to approve." };
  }
  function remitWidget(api, g, opts) {
    var C = api.components, esc = api.esc, ST = api.state;
    opts = opts || {};
    if (!g) return '<div class="remit-widget"><div class="addon">Remit add-on · built in</div>' + (opts.selector || '') + '<p class="sub">No remittance rows to read yet.</p></div>';
    var s = rs(g.check); var eob = hasEobPage(g.check); var cgs = claimGroups(g);
    var proposedLeft = g.rows.filter(function (x) { return isProposed(x.r); }).length;
    var allPosted = cgs.every(function (cg) { return s.posted[cg.seq]; }) || (proposedLeft === 0 && Object.keys(s.posted).length > 0);
    var compareDone = s.compared || (!eob && s.validated);
    var cur = !s.uploaded ? 0 : !s.validated ? 1 : !compareDone ? 2 : 3;
    var steps = ["Upload", "Validate", "Compare", "Approve"].map(function (t, i) { var done = i === 0 ? s.uploaded : i === 1 ? s.validated : i === 2 ? compareDone : allPosted; return '<span class="step' + (done ? ' done' : i === cur ? ' on' : '') + '">' + (i + 1) + '. ' + t + '</span>'; }).join("");
    var total835 = sum(g.rows, function (x) { return x.r.paid; });

    var html = '<div class="remit-widget" data-check="' + esc(g.check) + '"><div class="remit-head"><div><div class="addon">Remit add-on · built in</div><b>' + esc(g.check) + '</b> <span class="sub">' + esc(g.rows[0].r.payer) + ' · ' + esc(dashDate(g.rows[0].r.date)) + ' · ' + g.rows.length + ' service lines on ' + cgs.length + ' claim' + (cgs.length === 1 ? '' : 's') + (opts.focus ? ' · this claim highlighted' : '') + '</span></div>' + (opts.selector || '') + '</div>';
    html += '<div class="steps">' + steps + '</div>';

    // 1 Upload
    var up = '<div class="pay-drop">' + (s.uploaded ? '<b>835 and paper EOB received</b><br><span class="sub">835 for ' + esc(g.check) + ' read in full. ' + (eob ? 'One scanned EOB page read from the paper EOB.' : 'No paper EOB has been read for this remittance yet.') + '</span>' : 'Drop the 835 file and the scanned EOB pages here, or use the sample.') + '</div>' +
      C.btn(s.uploaded ? "Use the sample again" : "Use the sample 835 and paper EOB", "remit-upload", { check: g.check }, "sm" + (s.uploaded ? "" : " primary"));
    html += C.card("1. Upload", up);

    // 2 Validate
    var val;
    if (!s.uploaded) val = '<p class="sub">Upload first. Validation reads each 835 service line against the claim we filed and the 835 total against the printed check.</p>';
    else {
      val = '<p class="sub">' + (s.validated ? 'Each 835 service line against the claim we filed, and the 835 total against the printed check. The printed check figure is illustrative.' : 'Ready to validate.') + '</p>';
      if (!s.validated) val += C.btn("Run validation", "remit-validate", { check: g.check }, "sm primary");
      else {
        var vrows = []; cgs.forEach(function (cg) { var um = usmonMatch(cg); var cs = claimState(ST, cg); cg.rows.forEach(function (r, i) { var ch = lineCharge(cg.c, r.line); var ok = ch != null && r.paid <= Math.max(r.allowed, ch) + 0.005 && (r.paid <= 0 || r.allowed > 0); vrows.push({ seq: cg.seq, c: cg.c, r: r, first: i === 0, um: um, cs: cs, ok: ok, ch: ch }); }); });
        val += C.grid({ id: "v-" + g.check.replace(/\W/g, ""), columns: [
          { key: "pat", label: "Claim", render: function (x) { return x.first ? '<b>' + esc(x.c.pat) + '</b><br><span class="sub">' + esc(String(x.seq)) + ' · ' + C.pill(x.cs.label, x.cs.cls) + '</span>' : ''; } },
          { key: "um", label: "USMON match", render: function (x) { return x.first ? (x.um.held ? C.pill(x.um.word, "denied") : x.um.word === "matched" ? C.pill("matched", "paid") : C.pill(x.um.word, "partial")) : ''; } },
          { key: "line", label: "Line", render: function (x) { return '<span class="mono">' + esc(x.r.line) + '</span>'; } },
          { key: "billed", label: "Billed", cls: "num", render: function (x) { return x.ch != null ? money(api, x.ch) : '-'; } },
          { key: "allowed", label: "Allowed", cls: "num", render: function (x) { return x.r.allowed > 0 ? money(api, x.r.allowed) : '<span class="pill denied">denied in full</span>'; } },
          { key: "paid", label: "Paid", cls: "num", render: function (x) { return money(api, x.r.paid); } },
          { key: "res", label: "Line check", render: function (x) { return x.um.held ? '<span class="sub">no 835 while held</span>' : C.pill(x.ok ? "Match" : "Mismatch", x.ok ? "paid" : "denied"); } }
        ], rows: vrows, rowCls: function (x) { return opts.focus && x.seq === opts.focus ? "selected" : ""; } });
        var diff = round2(total835 - ILLUS_CHECK);
        val += '<p>835 total <b>' + esc(money(api, total835)) + '</b> against the printed check <b>' + esc(money(api, ILLUS_CHECK)) + '</b> (illustrative): ' + C.pill(Math.abs(diff) < 0.005 ? "Match" : "Mismatch", Math.abs(diff) < 0.005 ? "paid" : "denied") + (Math.abs(diff) >= 0.005 ? ' <span class="sub">difference ' + esc(money(api, diff)) + '. Compare with the EOB page before approving.</span>' : '') + '</p>';
        val += '<p class="sub"><b>How to read the USMON match column:</b> matched, not found, account mismatch, belongs to another client (refused only at Post). Held rows read "held: reason" and get no 835.</p>';
      }
    }
    html += C.card("2. Validate", val);

    // 3 Compare
    var cmp = '<p class="sub">Side by side: the 835 service lines and what was read from the paper EOB for the same claims. Differences are highlighted. A dash means nothing was read; $0.00 means zero was read.</p>';
    if (!eob) cmp += '<p>No paper EOB has been read for this remittance yet.</p>';
    cmp += '<button type="button" class="btn sm' + (eob && s.validated && !s.compared ? ' primary' : '') + '" data-act="remit-compare" data-check="' + esc(g.check) + '"' + (!eob ? ' disabled title="no scanned page is stored for this claim"' : !s.validated ? ' disabled title="Validate first"' : '') + '>Compare with the EOB page</button>';
    if (s.compared && eob) {
      var crows = g.rows.map(function (x, i) { var paper = paperRead(x.r, i); return { seq: x.seq, c: x.c, r: x.r, p: paper }; });
      cmp += C.grid({ id: "c-" + g.check.replace(/\W/g, ""), columns: [
        { key: "pat", label: "Claim", render: function (x) { return '<b>' + esc(x.c.pat) + '</b><br><span class="sub">' + esc(String(x.seq)) + '</span>'; } },
        { key: "line", label: "Line", render: function (x) { return '<span class="mono">' + esc(x.r.line) + '</span>'; } },
        { key: "a835", label: "835 allowed", cls: "num", render: function (x) { return money(api, x.r.allowed); } },
        { key: "apaper", label: "EOB allowed", cls: "num", render: function (x) { return x.p.allowed == null ? '-' : money(api, x.p.allowed); } },
        { key: "p835", label: "835 paid", cls: "num", render: function (x) { return money(api, x.r.paid); } },
        { key: "ppaper", label: "EOB paid", cls: "num", render: function (x) { return x.p.paid == null ? '-' : money(api, x.p.paid); } },
        { key: "adj835", label: "835 adjustments", render: function (x) { return adjHtml(api, x.r.adj); } },
        { key: "adjpaper", label: "EOB adjustments", render: function (x) { return x.p.adj == null ? '<span class="sub">could not be read with confidence</span>' : adjHtml(api, x.p.adj); } },
        { key: "same", label: "Result", render: function (x) { return x.p.same ? C.pill("Same", "paid") : C.pill("Differs", "denied"); } }
      ], rows: crows, rowCls: function (x) { return !x.p.same ? "selected" : ""; } });
      cmp += '<p class="sub">Values in the EOB columns were read from the paper EOB. Rows that differ are highlighted.</p>';
    }
    html += C.card("3. Compare", cmp);

    // 4 Approve, then Post to USMON
    var ap = '<p class="sub">Approve sets each claim\'s review state. Posting is a separate step: Post to USMON writes the payment lines of the approved claims. On this demo Post runs as a dry run and writes nothing, so the module rows stay proposed until the biller confirms them.</p>';
    if (!s.validated) ap += '<p class="sub">Validate first.</p>';
    else {
      ap += C.grid({ id: "a-" + g.check.replace(/\W/g, ""), columns: [
        { key: "pat", label: "Claim", render: function (cg) { var cs = claimState(ST, cg); return '<b>' + esc(cg.c.pat) + '</b> ' + C.pill(cs.label, cs.cls) + '<br><span class="sub">' + esc(String(cg.seq)) + ' · ' + esc(cs.head) + (cs.denied && api.data.carc[cs.code] ? ' ' + esc(api.data.carc[cs.code].meaning) : '') + '</span>'; } },
        { key: "money", label: "Billed / allowed / paid", cls: "num", render: function (cg) { var al = sum(cg.rows, function (r) { return r.allowed; }); return esc(money(api, cg.c.billed)) + ' / ' + (al > 0 ? esc(money(api, al)) : '<span class="pill denied">denied in full</span>') + ' / ' + esc(money(api, sum(cg.rows, function (r) { return r.paid; }))); } },
        { key: "um", label: "USMON match", render: function (cg) { var um = usmonMatch(cg); return um.held ? C.pill(um.word, "denied") : esc(um.word); } },
        { key: "review", label: "Review", render: function (cg) { var st = s.review[cg.seq] || "pending"; var cls = { pending: "await", approved: "ready", rejected: "denied", edited: "prep" }[st]; return C.pill(st, cls) + (s.reasons[cg.seq] ? '<br><span class="sub">' + esc(s.reasons[cg.seq]) + '</span>' : ''); } },
        { key: "result", label: "Result", render: function (cg) { if (s.posted[cg.seq]) return s.posted[cg.seq] === "refused" ? C.pill("refused", "denied") + '<br><span class="sub">belongs to another client: the claim is not this client\'s</span>' : '<span class="sub">would have posted</span>'; var left = cg.rows.filter(isProposed).length; return '<span class="sub">' + (left ? left + ' proposed row' + (left === 1 ? '' : 's') : 'nothing proposed') + '</span>'; } },
        { key: "act", label: "Actions", render: function (cg) { var um = usmonMatch(cg); var dis = um.held || s.posted[cg.seq]; var title = um.held ? ' disabled title="' + esc(um.word + '; a person must release it') + '"' : s.posted[cg.seq] ? ' disabled title="Already posted"' : ''; return '<button type="button" class="btn sm primary" data-act="remit-approve" data-check="' + esc(g.check) + '" data-seq="' + cg.seq + '"' + title + '>Approve</button> <button type="button" class="btn sm" data-act="remit-reject" data-check="' + esc(g.check) + '" data-seq="' + cg.seq + '"' + title + '>Reject</button> <button type="button" class="btn sm" data-act="remit-correct" data-check="' + esc(g.check) + '" data-seq="' + cg.seq + '"' + title + '>Correct claim</button>'; } }
      ], rows: cgs, rowCls: function (cg) { return opts.focus && cg.seq === opts.focus ? "selected" : ""; } });
      var approved = cgs.filter(function (cg) { return s.review[cg.seq] === "approved" && !s.posted[cg.seq]; });
      ap += '<div class="toolbar"><button type="button" class="btn primary" data-act="remit-post" data-check="' + esc(g.check) + '"' + (!approved.length ? ' disabled title="Approve at least one claim first"' : '') + '>Post to USMON</button><span class="sub">' + (approved.length ? approved.length + ' approved claim' + (approved.length === 1 ? '' : 's') + ' ready to post' : 'Approve a claim to enable posting') + '</span></div>';
    }
    if (s.result) ap += dryRunBlock(api, s.result);
    html += C.card("4. Approve", ap);
    return html + '</div>';
  }
  function dryRunBlock(api, res) {
    // everything a live post would do, tagged as a demo dry run; never green, never "Posted to USMON"
    var C = api.components, esc = api.esc;
    var h = '<div class="card">' + C.pill("DEMO DRY RUN", "await") + ' <b>Demo dry run. Nothing was written to USMON. This is what a live post would do:</b>';
    h += '<p class="sub" style="margin:6px 0 2px">Payment lines that would be written (' + res.writes.length + ')' + (res.refused ? ' · ' + res.refused + ' claim' + (res.refused === 1 ? '' : 's') + ' refused: belongs to another client' : '') + '</p>';
    h += C.grid({ columns: [
      { key: "pat", label: "Claim", render: function (w) { return '<b>' + esc(w.pat) + '</b> <span class="sub">' + esc(String(w.seq)) + '</span>'; } },
      { key: "line", label: "Line", render: function (w) { return '<span class="mono">' + esc(w.line) + '</span>'; } },
      { key: "paid", label: "Paid", cls: "num", render: function (w) { return money(api, w.paid); } },
      { key: "allowed", label: "Allowed", cls: "num", render: function (w) { return w.allowed > 0 ? money(api, w.allowed) : '<span class="pill denied">denied in full</span>'; } },
      { key: "adj", label: "Adjustment code", render: function (w) { return w.adj ? '<span class="mono">' + esc(w.adj) + '</span>' : '<span class="sub">none</span>'; } }
    ], rows: res.writes, empty: "No payment lines: no approved claim could be posted." });
    h += '<p class="sub" style="margin:8px 0 2px">Billing note that would be written</p><div class="note-illus">' + esc(res.note) + '<br>Entered by: Remit</div>';
    h += '<p class="sub" style="margin:8px 0 2px">Document that would be filed</p><ul class="checks">' + res.docs.map(function (d) { return '<li class="ok"><b>' + esc(d) + '</b></li>'; }).join("") + '</ul></div>';
    return h;
  }
  function paperRead(r, i) {
    // what was read from the paper EOB for this 835 row: deterministic, illustrative. null means "read nothing".
    var p = { allowed: r.allowed, paid: r.paid, adj: r.adj, same: true };
    if (i % 5 === 1) { p.paid = round2(r.paid + 12); p.same = false; }
    else if (i % 5 === 3) { p.adj = null; p.same = false; }
    return p;
  }

  // ----------------------------------------------------------------------------------- actions (shared by the scene and the ledger view)
  function onAct(ev, api, again, ctx) {
    var t = ev.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act"); if (act === "dialog-close" || act === "view" || act === "arrive") return;
    var C = api.components, ST = api.state, esc = api.esc, T = api.T;
    var seq = Number(t.getAttribute("data-seq")), id = Number(t.getAttribute("data-id")), check = t.getAttribute("data-check");
    var g = check ? byCheck(allRows(ST)).find(function (x) { return x.check === check; }) : null;

    if (act === "confirm-row") { var row = (ST.claim(seq).ledger || []).find(function (x) { return x.id === id; }); T.postProposed(seq, id); api.toast("Posted " + money(api, row.paid) + " on line " + row.line + " for " + ST.claim(seq).pat + ".", "ok"); }
    else if (act === "confirm-eft") { var n = 0; (g ? g.rows : []).forEach(function (x) { if (isProposed(x.r)) { T.postProposed(x.seq, x.r.id); n++; } }); api.toast(n + " row" + (n === 1 ? "" : "s") + " from " + check + " confirmed and posted.", "ok"); }
    else if (act === "reject-row") rejectDialog(api, seq, id);
    else if (act === "view-835") detailDialog(api, g);
    else if (act === "open-remit") { UI.eft = check; api.go("#payments/remit"); }
    else if (act === "apply-unapplied") applyDialog(api, "unapplied", t.getAttribute("data-id"), again);
    else if (act === "apply-prepay") applyDialog(api, "prepay", t.getAttribute("data-id"), again);
    else if (act === "add-payment") addPayment(api, seq, t.closest(".form"));
    else if (act === "remit-upload") { rs(check).uploaded = true; api.toast("Sample 835 and paper EOB loaded for " + check + ".", "ok"); again(); }
    else if (act === "remit-validate") { rs(check).validated = true; api.toast("Validated " + g.rows.length + " service lines against the claims and the printed check.", "info"); again(); }
    else if (act === "remit-compare") { rs(check).compared = true; api.toast("Compared the 835 with the EOB page. Differences are highlighted.", "info"); again(); }
    else if (act === "remit-approve") { var s1 = rs(check); s1.review[seq] = "approved"; delete s1.reasons[seq]; api.toast("Approved " + ST.claim(seq).pat + ". Not posted yet: use Post to USMON.", "ok"); again(); }
    else if (act === "remit-reject") remitRejectDialog(api, check, seq, again);
    else if (act === "remit-correct") { var s2 = rs(check); s2.review[seq] = "edited"; s2.reasons[seq] = "Correct claim: marked edited by " + ST.me().name; api.toast("Marked edited. Open the claim to make the correction.", "info"); again(); }
    else if (act === "remit-post") remitPost(api, check, again);
  }

  function rejectDialog(api, seq, id) {
    var C = api.components, ST = api.state, esc = api.esc;
    var c = ST.claim(seq); var row = (c.ledger || []).find(function (x) { return x.id === id; });
    C.dialog("Reject this proposed row", '<p>' + esc(c.pat) + ', line <span class="mono">' + esc(row.line) + '</span>, ' + esc(money(api, row.paid)) + ' from ' + esc(row.check) + '.</p><div class="form"><label class="full">Why<select id="rej-why"><option>Amount does not match the EOB</option><option>Wrong claim or patient</option><option>Duplicate of a posted row</option><option>Other (say below)</option></select></label><label class="full">Note<textarea id="rej-note" placeholder="What the payer should hear, or what the next biller should know"></textarea></label></div><p class="sub">The row stays in Proposed postings with your note. The module keeps the reason on the row; this demo does not save it.</p>', [{ text: "Cancel", act: "dialog-close" }, { text: "Reject with note", act: "rej-go", cls: "danger" }]);
    document.getElementById("dialog").onclick = function (ev) { var t = ev.target.closest("[data-act=rej-go]"); if (!t) return; C.closeDialog(); api.toast("Row returned to Proposed postings with a note", "warn"); };
  }
  function remitRejectDialog(api, check, seq, again) {
    var C = api.components, ST = api.state, esc = api.esc;
    C.dialog("Reject " + esc(ST.claim(seq).pat), '<div class="form"><label class="full">Reason (optional)<textarea id="rr-note" placeholder="Optional"></textarea></label></div>', [{ text: "Cancel", act: "dialog-close" }, { text: "Reject", act: "rr-go", cls: "danger" }]);
    document.getElementById("dialog").onclick = function (ev) { var t = ev.target.closest("[data-act=rr-go]"); if (!t) return; var note = (document.getElementById("rr-note").value || "").trim(); var s = rs(check); s.review[seq] = "rejected"; if (note) s.reasons[seq] = note; else delete s.reasons[seq]; C.closeDialog(); api.toast("Rejected" + (note ? " with a reason." : "."), "warn"); again(); };
  }
  function remitPost(api, check, again) {
    var ST = api.state;
    var s = rs(check); var g = byCheck(allRows(ST)).find(function (x) { return x.check === check; }); if (!g) return;
    var n = 0, refused = 0, writes = [], cgs = claimGroups(g);
    cgs.forEach(function (cg) {
      if (s.review[cg.seq] !== "approved" || s.posted[cg.seq]) return;
      if (usmonMatch(cg).word === "belongs to another client") { s.posted[cg.seq] = "refused"; refused++; return; }
      // a dry run writes nothing anywhere, the module's ledger included: the rows stay "Proposed, confirm"
      cg.rows.filter(isProposed).forEach(function (r) { writes.push({ seq: cg.seq, pat: cg.c.pat, line: r.line, paid: r.paid, allowed: r.allowed, adj: parseAdj(r.adj).map(function (p) { return p.code; }).filter(Boolean).join(", ") }); });
      s.posted[cg.seq] = true; n++;
    });
    var edited = cgs.filter(function (cg) { return s.review[cg.seq] === "edited"; }).length;
    var first = g.rows[0].r;
    s.result = { claims: n, refused: refused, writes: writes,
      note: "Payment entered from EOB read by Remit. Payer " + first.payer + ". Check " + check + " dated " + dashDate(first.date) + ". " + ST.fmtMoney(sum(writes, function (w) { return w.paid; })) + " across " + writes.length + " line" + (writes.length === 1 ? "" : "s") + ". " + edited + " field" + (edited === 1 ? "" : "s") + " corrected in review.",
      docs: ["835 for " + check + " (" + check.replace(/\s+/g, "_") + ".835)"].concat(hasEobPage(check) ? ["Scanned EOB page for " + check + " (" + check.replace(/\s+/g, "_") + "_EOB.pdf)"] : []) };
    api.toast("Demo dry run: nothing was written to USMON. " + n + " claim" + (n === 1 ? "" : "s") + ", " + writes.length + " payment line" + (writes.length === 1 ? "" : "s") + " shown below.", "info");
    again();
  }

  function detailDialog(api, g) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt;
    if (!g) return;
    var cgs = claimGroups(g);
    var body = C.kv([["Payer", g.rows[0].r.payer], ["Check or EFT", g.check], ["Date", dashDate(g.rows[0].r.date)], ["Total paid", money(api, sum(g.rows, function (x) { return x.r.paid; }))]]);
    cgs.forEach(function (cg) {
      var paid = sum(cg.rows, function (r) { return r.paid; }), allowed = sum(cg.rows, function (r) { return r.allowed; });
      body += '<h2>Claim (CLP): ' + esc(cg.c.pat) + ' <span class="sub">' + esc(String(cg.seq)) + ' · DOS ' + esc(dashDate(cg.c.dos)) + '</span></h2>';
      body += '<p>The payer says: billed ' + esc(money(api, cg.c.billed)) + ', allowed ' + (allowed > 0 ? esc(money(api, allowed)) : 'nothing (denied in full)') + ', paid <b>' + esc(money(api, paid)) + '</b>.' + (paid < 0 ? ' This is a take-back (recoupment).' : '') + '</p>';
      cg.rows.forEach(function (r) {
        var ch = lineCharge(cg.c, r.line);
        body += '<div class="card"><h3>Service line (SVC) <span class="mono">' + esc(r.line) + '</span> ' + C.pill(r.status, isProposed(r) ? "partial" : "paid") + '</h3>' +
          C.kv([["Billed", ch != null ? money(api, ch) : "-"], ["Allowed", r.allowed > 0 ? money(api, r.allowed) : "nothing (denied in full)"], ["Paid", money(api, r.paid)], ["Remark", r.remark || "none"]]) +
          '<p class="sub" style="margin:8px 0 2px">Adjustments, in plain words</p>' + adjWords(api, r.adj) + '</div>';
      });
    });
    C.dialog("835 detail: " + esc(g.check), body, [{ text: "Close", act: "dialog-close" }]);
  }

  function applyDialog(api, kind, id, again) {
    var C = api.components, ST = api.state, esc = api.esc, T = api.T;
    var src = kind === "unapplied" ? UI.unapplied : UI.prepay; var item = src.find(function (x) { return x.id === id; }); if (!item) return;
    var claims = ST.list("ongoing").filter(function (c) { return c.status !== "closed"; }).sort(function (a, b) { return a.pat < b.pat ? -1 : 1; });
    var pick = kind === "prepay" ? (claims.find(function (c) { return c.seq === item.seq; }) || claims[0]) : claims[0];
    function lines(c) { return (c.lines || []).map(function (l) { return '<option value="' + esc(l.cpt) + '">' + esc(l.cpt) + ' · billed ' + esc(money(api, l.charge)) + '</option>'; }).join(""); }
    var title = kind === "unapplied" ? "Apply " + esc(money(api, item.amount)) + " of unapplied cash to a claim" : "Apply the " + esc(money(api, item.amount)) + " pre-payment";
    C.dialog(title, '<p class="sub">' + (kind === "unapplied" ? esc(item.payer) + ', ' + esc(item.check) : esc(item.pat) + ', ' + esc(item.how)) + '. Applying adds a new ledger row on the line you pick; nothing is edited.</p><div class="form"><label class="full">Claim<select id="ap-claim">' + claims.map(function (c) { return '<option value="' + c.seq + '"' + (c.seq === pick.seq ? ' selected' : '') + '>' + esc(c.pat) + ' · ' + esc(c.payer) + ' · balance ' + esc(money(api, ST.totals(c).balance)) + '</option>'; }).join("") + '</select></label><label>Line<select id="ap-line">' + lines(pick) + '</select></label><label>Amount<input id="ap-amt" type="number" step="0.01" value="' + item.amount.toFixed(2) + '"></label></div>', [{ text: "Cancel", act: "dialog-close" }, { text: "Apply", act: "ap-go", cls: "primary" }]);
    var dlg = document.getElementById("dialog");
    dlg.onchange = function (ev) { if (ev.target.id !== "ap-claim") return; var c = ST.claim(Number(ev.target.value)); document.getElementById("ap-line").innerHTML = lines(c); };
    dlg.onclick = function (ev) {
      var t = ev.target.closest("[data-act=ap-go]"); if (!t) return;
      var seq = Number(document.getElementById("ap-claim").value), line = document.getElementById("ap-line").value, amt = Number(document.getElementById("ap-amt").value);
      if (!(amt > 0) || amt > item.amount + 0.005) { api.toast("Enter an amount between $0.01 and " + money(api, item.amount) + ".", "warn"); return; }
      var c = ST.claim(seq);
      T.addPayment(seq, { line: line, paid: amt, allowed: amt, adj: "", remark: "", source: kind === "unapplied" ? "Applied from unapplied cash" : "Patient pre-payment", payer: kind === "unapplied" ? item.payer : "Patient", check: kind === "unapplied" ? item.check : "Patient check", date: ST.TODAY });
      if (amt >= item.amount - 0.005) src.splice(src.indexOf(item), 1); else item.amount = round2(item.amount - amt);
      C.closeDialog(); api.toast("Applied " + money(api, amt) + " to " + c.pat + ", line " + line + ". A new ledger row was added.", "ok");
      again();
    };
  }

  function addPayment(api, seq, form) {
    var ST = api.state, T = api.T;
    if (!form) return;
    function v(name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ""; }
    var paid = Number(v("paid")), allowed = Number(v("allowed")), source = v("source"), line = v("line");
    if (!line) { api.toast("Pick a service line.", "warn"); return; }
    if (!paid || isNaN(paid)) { api.toast("Enter a paid amount. Negative means a recoupment.", "warn"); return; }
    if (source === "Recoupment" && paid > 0) { paid = -paid; api.toast("A recoupment is a negative amount; the sign was flipped.", "info"); }
    var row = T.addPayment(seq, { line: line, paid: paid, allowed: isNaN(allowed) || !allowed ? Math.abs(paid) : allowed, adj: v("adj"), remark: v("remark"), source: source + ", by " + ST.me().name, payer: v("payer") || ST.claim(seq).payer, check: v("check"), date: v("date") || ST.TODAY });
    api.toast((row.paid < 0 ? "Recoupment recorded: " : "Payment added: ") + money(api, row.paid) + " on line " + row.line + ". New row, nothing edited.", "ok");
  }

  // ----------------------------------------------------------------------------------- the per-claim ledger view
  window.CLAIM_VIEWS.ledger = function (container, api, claim, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var c = ST.claim(claim.seq) || claim; var t = ST.totals(c); var ledger = (c.ledger || []).slice();
    var html = styleBlock() + '<div id="ledger-wrap">';
    html += tilesHtml(api, [
      { n: money(api, t.billed), l: "Billed" },
      { n: money(api, t.collected), l: L("collected"), cls: "ok" },
      { n: money(api, t.recoupment), l: "Recoupment", cls: t.recoupment ? "bad" : "" },
      { n: money(api, t.writeoff), l: "Write-off" },
      { n: money(api, t.balance), l: L("balance"), cls: t.balance > 0.005 ? "warn" : "ok" }
    ]);
    var proposed = ledger.filter(isProposed).length;
    html += C.panel("Remittance ledger <span class=\"sub\">claim_pay grain: one row per payment occurrence on a service line</span>",
      C.grid({ id: "ledger-grid", columns: [
        { key: "date", label: "Date", sort: function (x) { return x.date; }, render: function (x) { return fmt.date(x.date); } },
        { key: "line", label: "Line", render: function (x) { var ch = lineCharge(c, x.line); return '<span class="mono">' + esc(x.line) + '</span>' + (ch != null ? '<br><span class="sub">billed ' + esc(money(api, ch)) + '</span>' : ''); } },
        { key: "payer", label: L("payer"), render: function (x) { return esc(x.payer); } },
        { key: "check", label: "Check or EFT", render: function (x) { return x.check ? '<span class="mono">' + esc(x.check) + '</span>' : '<span class="sub">none</span>'; } },
        { key: "allowed", label: "Allowed", cls: "num", render: function (x) { return money(api, x.allowed); } },
        { key: "paid", label: "Paid", cls: "num", render: function (x) { return x.paid < 0 ? '<span class="pill recoup">' + esc(money(api, x.paid)) + '</span>' : '<b>' + esc(money(api, x.paid)) + '</b>'; } },
        { key: "adj", label: "Adjustments", render: function (x) { return adjHtml(api, x.adj); } },
        { key: "remark", label: "Remark", render: function (x) { return x.remark ? '<span class="mono">' + esc(x.remark) + '</span>' : '<span class="sub">none</span>'; } },
        { key: "source", label: "Source", render: function (x) { return '<span class="sub">' + esc(x.source) + (x.confirmedBy ? ' · ' + esc(x.confirmedBy) : '') + '</span>'; } },
        { key: "status", label: L("status"), render: function (x) { return isProposed(x) ? C.pill("Proposed", "partial") + ' ' + C.btn(L("confirm").charAt(0).toUpperCase() + L("confirm").slice(1), "confirm-row", { seq: c.seq, id: x.id }, "sm primary") : C.pill("Posted", "paid"); } }
      ], rows: ledger, sort: sortFor("ledger-grid", { key: "date", dir: "asc" }), empty: "No remittance rows yet. The 835 rows arrive proposed once the payer responds; a manual payment goes below." }),
      proposed ? proposed + ' proposed row' + (proposed === 1 ? '' : 's') + ' to confirm' : ledger.length + ' row' + (ledger.length === 1 ? '' : 's'));

    var lines = (c.lines || []).map(function (l) { return '<option value="' + esc(l.cpt) + '">' + esc(l.cpt) + ' · billed ' + esc(money(api, l.charge)) + '</option>'; }).join("");
    html += C.panel("Add payment <span class=\"sub\">always a new row</span>", '<div class="form" data-seq="' + c.seq + '">' +
      '<label>Service line<select name="line">' + lines + '</select></label>' +
      '<label>Date<input type="date" name="date" value="' + esc(ST.TODAY) + '"></label>' +
      '<label>Paid<input type="number" step="0.01" name="paid" placeholder="0.00"><span class="sub">Negative = recoupment (a take-back)</span></label>' +
      '<label>Allowed<input type="number" step="0.01" name="allowed" placeholder="defaults to the paid amount"></label>' +
      '<label>Adjustments<input type="text" name="adj" placeholder="CO-45 $12.00, PR-2 $15.00"></label>' +
      '<label>Remark<input type="text" name="remark" placeholder="MA01"></label>' +
      '<label>Source<select name="source">' + SOURCES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join("") + '</select></label>' +
      '<label>' + esc(L("payer")) + '<input type="text" name="payer" value="' + esc(c.payer) + '"></label>' +
      '<label>Check or EFT number<input type="text" name="check" placeholder="Check 4471"></label>' +
      '<div class="full"><button type="button" class="btn primary" data-act="add-payment" data-seq="' + c.seq + '">Add payment</button></div></div>');

    var addon = ST.get().addons.remit;
    var check = null; var checks = {}; ledger.forEach(function (x) { if (x.check) checks[x.check] = (checks[x.check] || 0) + (isProposed(x) ? 1 : 0); });
    Object.keys(checks).forEach(function (k) { if (!check || checks[k] > checks[check]) check = k; });
    if (!addon) html += remitOff(api);
    else if (check) html += remitWidget(api, byCheck(allRows(ST)).find(function (g) { return g.check === check; }), { focus: c.seq });
    else html += '<div class="remit-widget"><div class="addon">Remit add-on · built in</div><p class="sub">No remittance on this claim yet. When the 835 arrives its rows show here proposed and the biller confirms them.</p></div>';
    html += C.banner(api.data.illustrative) + '</div>';
    container.innerHTML = html;

    var wrap = container.querySelector("#ledger-wrap");
    function again() { window.CLAIM_VIEWS.ledger(container, api, ST.claim(c.seq) || c, r); }
    wireSort(wrap, again);
    wrap.addEventListener("click", function (ev) { onAct(ev, api, again, { seq: c.seq }); });
  };

  window.SCENES.payments = { title: "Payments", render: render };
})();
