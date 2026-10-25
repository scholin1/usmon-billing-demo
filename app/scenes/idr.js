/* Scene: out-of-network and IDR. The negotiation clock, the "send to IDR" alert, the packet to
   USMON Arbitration or a vendor, status back, the decision. Also the per-claim IDR view
   (window.CLAIM_VIEWS.idr) that scenes/claim.js renders for #claim/<seq>/idr. */
(function () {
  "use strict";
  window.CLAIM_VIEWS = window.CLAIM_VIEWS || {};
  var UI = { sort: { key: "deadline", dir: "asc" }, offers: {}, packet: {}, vendor: {} };
  var IDR_STATUSES = ["negotiating", "idr_due", "idr_sent", "idr_decided"];
  var INTRO = "Out-of-network claims under the No Surprises Act go through a 30-day open negotiation after the payer's initial payment or denial, then a 4-business-day window to start Independent Dispute Resolution (IDR). Medicare, Medicaid and in-network claims never come here; they follow the payer's appeal process instead.";
  var NOT_ELIGIBLE = {
    government: "Medicare, Medicaid and other government payers have no IDR path; a dispute goes through the payer's own appeal process.",
    inn: "In-network claims are paid at the contracted rate; a dispute goes through the contract's appeal process, not IDR.",
    other: "This payer is not classed as out-of-network; IDR applies only to out-of-network claims under the No Surprises Act."
  };

  function inIdr(c) { return c.payerClass === "oon" && IDR_STATUSES.indexOf(c.status) >= 0; }
  function payerOffer(c) { return c.idr && c.idr.payerOffer != null ? c.idr.payerOffer : c.negotiation ? c.negotiation.payerOffer : 0; }
  function ourOffer(c) { if (UI.offers[c.seq] != null) return UI.offers[c.seq]; return c.idr && c.idr.offer != null ? c.idr.offer : c.negotiation ? c.negotiation.offer : Math.round(c.billed * 0.65 * 100) / 100; }
  function vendorName(api, id) { var v = (api.data.idrVendors || []).find(function (x) { return x.id === id; }); return v ? v.name : id || ""; }
  function deadlineClock(nk) { if (!nk) return null; return { left: nk.idrLeft, cls: nk.idrLeft < 0 ? "over" : nk.idrLeft <= 2 ? "late" : "ok" }; }

  // ----------------------------------------------------------------------------------- the scene
  function render(root, api) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label, fmt = api.fmt;
    var all = ST.all().filter(inIdr);
    var due = all.filter(function (c) { return c.status === "idr_due"; });
    var count = function (s) { return all.filter(function (c) { return c.status === s; }).length; };
    var tiles = [
      { n: count("negotiating"), l: "Negotiating (30-day clock running)", cls: "idr" },
      { n: count("idr_due"), l: "IDR window open now", cls: "bad" },
      { n: count("idr_sent"), l: "At IDR, awaiting decision", cls: "idr" },
      { n: count("idr_decided"), l: "Decided", cls: "ok" },
      { n: fmt.money(all.reduce(function (a, c) { return a + (c.billed - payerOffer(c)); }, 0)), l: "Dollars in dispute (billed minus payer offer, illustrative)" }
    ];
    var cols = [
      { key: "pat", label: L("patient"), render: function (c) { return C.patLink(c, esc(c.hosp) + " · DOS " + fmt.date(c.dos) + " · " + esc(c.track)); } },
      { key: "payer", label: L("payer"), render: function (c) { return esc(c.payer) + '<br><span class="sub">out-of-network</span>'; } },
      { key: "billed", label: "Billed", cls: "num", render: function (c) { return fmt.money(c.billed); } },
      { key: "payerOffer", label: "Payer offer", cls: "num", sort: payerOffer, render: function (c) { return fmt.money(payerOffer(c)) + '<br><span class="sub">' + Math.round(payerOffer(c) / c.billed * 100) + '% of billed</span>'; } },
      { key: "ourOffer", label: "Our offer", cls: "num", sort: ourOffer, render: function (c) { return fmt.money(ourOffer(c)); } },
      { key: "clock", label: "Negotiation clock", cls: "num", sort: function (c) { var k = ST.negotiationClock(c); return k ? k.left : 9999; }, render: function (c) { var k = ST.negotiationClock(c); if (!k) return '<span class="sub">none</span>'; return c.status === "negotiating" ? C.clock(k) + '<br><span class="sub">ends ' + fmt.date(k.endsOn) + '</span>' : '<span class="sub">ended ' + fmt.date(k.endsOn) + '</span>'; } },
      { key: "deadline", label: "IDR deadline", cls: "num", sort: function (c) { var k = ST.negotiationClock(c); return k ? k.idrLeft : 9999; }, render: function (c) { var k = ST.negotiationClock(c); if (!k) return ''; if (c.status === "idr_sent" || c.status === "idr_decided") return '<span class="sub">filed ' + fmt.date(c.idr && c.idr.sentOn) + '</span>'; return fmt.date(k.idrDeadline) + '<br>' + C.clock(deadlineClock(k)); } },
      { key: "status", label: L("status"), sort: function (c) { return ST.statusInfo(c).label; }, render: function (c) { return C.statusPill(c); } },
      { key: "vendor", label: "Vendor", sort: function (c) { return c.idr ? vendorName(api, c.idr.vendor) : ""; }, render: function (c) { return c.idr && c.idr.vendor ? esc(vendorName(api, c.idr.vendor)) + '<br><span class="sub">sent ' + fmt.date(c.idr.sentOn) + '</span>' : '<span class="sub">not sent</span>'; } },
      { key: "award", label: "Award", cls: "num", sort: function (c) { return c.idr && c.idr.award != null ? c.idr.award : -1; }, render: function (c) { return c.idr && c.idr.award != null ? '<b>' + fmt.money(c.idr.award) + '</b>' : ''; } },
      { key: "next", label: L("next"), render: function (c) {
        var n = ST.nextAction(c); var h = C.btn(n.label || "Open", "open-idr", { seq: c.seq }, "sm" + (c.status === "idr_due" ? " primary" : ""));
        if (c.status === "negotiating") h += ' ' + C.btn("Simulate: payer responds", "sim-respond", { seq: c.seq }, "sm");
        if (c.status === "idr_sent") h += ' ' + C.btn("Simulate: decision arrives", "sim-decide", { seq: c.seq }, "sm");
        return h;
      } }
    ];
    var html = '<h1>' + esc(L("idr")) + '</h1><p>' + esc(INTRO) + '</p>' + C.tiles(tiles);
    if (due.length) { var soonest = due.map(function (c) { return ST.negotiationClock(c).idrDeadline; }).sort()[0]; html += '<div class="idr-alert">' + due.length + (due.length === 1 ? " claim needs" : " claims need") + ' a decision: send to IDR before ' + fmt.date(soonest) + '.</div>'; }
    html += '<div class="toolbar"><span class="sub">' + all.length + ' out-of-network claims in negotiation or dispute</span><span class="spacer"></span><span class="sub">The Simulate buttons are demo controls standing in for the payer and the IDR entity.</span></div>';
    html += C.grid({ id: "idr-grid", columns: cols, rows: all, sort: UI.sort, empty: "No out-of-network claim is in negotiation or at IDR. Start one from a denial.", rowCls: function (c) { return c.status === "idr_due" ? "selected" : ""; } });
    html += C.banner(api.data.illustrative);
    var el = mount(root, STYLE + html, function (act, el, t) {
      var seq = Number(t.getAttribute("data-seq"));
      if (act === "open-idr") api.go("#claim/" + seq + "/idr");
      else if (act === "sim-respond") respondDialog(api, seq);
      else if (act === "sim-decide") decisionDialog(api, seq);
    });
    el.querySelectorAll("th[data-sort]").forEach(function (th) { th.addEventListener("click", function () { var k = th.getAttribute("data-sort"); UI.sort = { key: k, dir: UI.sort.key === k && UI.sort.dir === "asc" ? "desc" : "asc" }; render(root, api); }); });
  }

  var STYLE = '<style>.idr-alert{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn);border-radius:var(--radius);padding:8px 12px;margin:8px 0;font-weight:600}.idr-cards .card{flex:1;min-width:0}</style>';

  // ----------------------------------------------------------------------------------- demo dialogs
  function respondDialog(api, seq) {
    var C = api.components, ST = api.state, esc = api.esc, c = ST.claim(seq);
    var mid = Math.round((payerOffer(c) + ourOffer(c)) / 2 * 100) / 100;
    C.dialog("Simulate: the payer responds", '<p class="sub">Demo control standing in for ' + esc(c.payer) + '. Billed ' + ST.fmtMoney(c.billed) + ', payer offered ' + ST.fmtMoney(payerOffer(c)) + ', our offer ' + ST.fmtMoney(ourOffer(c)) + '.</p>' +
      '<div class="form"><label>Payer agrees to pay<input id="idr-agree" type="number" step="0.01" min="0" value="' + mid + '"></label><div class="full sub">Agreeing ends the negotiation and the claim waits for the corrected remittance. Declining ends it without agreement and opens the 4-business-day IDR window.</div></div>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Payer declines", act: "sim-decline", cls: "danger" }, { text: "Payer agrees at this amount", act: "sim-agree", cls: "primary" }]);
    var dlg = document.getElementById("dialog");
    dlg.onclick = function (ev) {
      var t = ev.target.closest("[data-act]"); if (!t) return; var act = t.getAttribute("data-act");
      if (act === "sim-agree") { var x = Number(dlg.querySelector("#idr-agree").value); if (!(x > 0)) { api.toast("Enter the amount the payer agrees to.", "warn"); return; } ST.T.endNegotiation(seq, true, x); C.closeDialog(); api.toast(c.payer + " agreed to " + ST.fmtMoney(x) + ". The claim waits for the corrected remittance.", "ok"); }
      else if (act === "sim-decline") { ST.T.endNegotiation(seq, false); C.closeDialog(); api.toast("Negotiation ended without agreement. Send to IDR before " + api.fmt.date(ST.negotiationClock(ST.claim(seq)).idrDeadline) + ".", "warn"); }
    };
  }
  function decisionDialog(api, seq) {
    var C = api.components, ST = api.state, esc = api.esc, c = ST.claim(seq);
    var offer = c.idr && c.idr.offer != null ? c.idr.offer : ourOffer(c);
    C.dialog("Simulate: the IDR decision arrives", '<p class="sub">Demo control standing in for ' + esc(vendorName(api, c.idr && c.idr.vendor)) + '. The entity picks one of the two offers: ours (' + ST.fmtMoney(offer) + ') or the payer\'s (' + ST.fmtMoney(payerOffer(c)) + ').</p>' +
      '<div class="form"><label>Award<input id="idr-award" type="number" step="0.01" min="0" value="' + offer + '"></label><div class="full sub">The payer must pay the award within 30 days of the decision.</div></div>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Record the decision", act: "sim-award", cls: "primary" }]);
    var dlg = document.getElementById("dialog");
    dlg.onclick = function (ev) {
      var t = ev.target.closest("[data-act=sim-award]"); if (!t) return;
      var x = Number(dlg.querySelector("#idr-award").value); if (!(x >= 0)) { api.toast("Enter the award amount.", "warn"); return; }
      ST.T.idrDecision(seq, x); C.closeDialog(); api.toast("IDR decision: " + ST.fmtMoney(x) + " awarded. The payer has 30 days to pay.", "ok");
    };
  }
  function sendDialog(api, seq) {
    var C = api.components, ST = api.state, esc = api.esc, c = ST.claim(seq), offer = ourOffer(c);
    var vendor = UI.vendor[seq] || "usmon";
    C.dialog("Send the packet to IDR", '<p class="sub">Choose who files and argues the dispute. Our offer goes in the packet as ' + ST.fmtMoney(offer) + '.</p><ul class="menu-list">' +
      (api.data.idrVendors || []).map(function (v) { return '<li data-pick="' + esc(v.id) + '"' + (v.id === vendor ? ' class="on"' : '') + '><b>' + esc(v.name) + '</b> <span class="sub">' + esc(v.kind) + ' · ' + esc(v.note) + '</span></li>'; }).join("") + '</ul>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Send to IDR", act: "send-go", cls: "primary" }]);
    var dlg = document.getElementById("dialog");
    dlg.onclick = function (ev) {
      var p = ev.target.closest("[data-pick]"); if (p) { vendor = p.getAttribute("data-pick"); UI.vendor[seq] = vendor; dlg.querySelectorAll("[data-pick]").forEach(function (li) { li.className = li.getAttribute("data-pick") === vendor ? "on" : ""; }); return; }
      var t = ev.target.closest("[data-act=send-go]"); if (!t) return;
      ST.T.sendToIdr(seq, vendor, offer); delete UI.offers[seq]; C.closeDialog(); api.toast("Packet sent to " + vendorName(api, vendor) + " with our offer of " + ST.fmtMoney(offer) + ".", "ok");
    };
  }

  // ----------------------------------------------------------------------------------- the per-claim IDR view
  function idrView(container, api, c, r) {
    var C = api.components, ST = api.state, esc = api.esc, fmt = api.fmt, T = ST.T, seq = c.seq, html = STYLE;
    if (c.payerClass !== "oon") {
      html += C.panel("Not eligible for IDR", '<p><b>Not eligible for IDR: ' + esc(NOT_ELIGIBLE[c.payerClass] || NOT_ELIGIBLE.other) + '</b></p><p class="sub">' + esc(c.payer) + ' · ' + esc(c.instype) + '</p><p><a href="#claim/' + seq + '/denial">Work the denial instead</a> · <a href="#claim/' + seq + '">Back to the claim</a></p>');
      mount(container, html, function () {}); return;
    }
    var s = c.status, nk = ST.negotiationClock(c), po = payerOffer(c), oo = ourOffer(c);
    var stage = s === "idr_decided" ? 4 : s === "idr_sent" ? 3 : s === "idr_due" ? 2 : s === "negotiating" ? 1 : (c.fin && c.fin.last_remit) ? 0 : -1;
    var steps = ["Initial payment", "Open negotiation (30 days)", "IDR window (4 business days)", "IDR filed", "Decision", "Payment"];
    html += '<div class="steps">' + steps.map(function (st, i) { return '<div class="step' + (i < stage ? ' done' : i === stage ? ' on' : '') + '">' + esc(st) + '</div>'; }).join("") + '</div>';
    if (stage === -1 || !nk) {
      html += C.panel("No dispute on this claim yet", '<p>Status: ' + C.statusPill(c) + '</p><p class="sub">' + esc(INTRO) + '</p>' + (c.status === "denied" || c.status === "partial" || c.status === "recoup" ? '<p>' + C.btn("Start open negotiation", "negotiate", { seq: seq }, "primary") + ' <span class="sub">starts the 30-day clock today, ' + fmt.date(ST.TODAY) + '</span></p>' : '<p class="sub">Negotiation can start once the payer has paid or denied the claim.</p>'));
      mount(container, html, function (act) { if (act === "negotiate") { T.startNegotiation(seq, ST.TODAY); api.toast("Open negotiation started; the 30-day clock runs from " + fmt.date(ST.TODAY) + ".", "info"); } }); return;
    }

    var cards = [];
    // clocks
    var clocks = C.kv([
      ["Notice date", fmt.date(c.negotiation.noticeDate)],
      ["Negotiation", (s === "negotiating" ? C.clock(nk) + ' <span class="sub">ends ' + fmt.date(nk.endsOn) + '</span>' : '<span class="sub">ended ' + fmt.date(nk.endsOn) + (c.negotiation.agreed ? ', agreed at ' + fmt.money(c.negotiation.agreed) : ' without agreement') + '</span>'), true],
      ["IDR deadline", s === "negotiating" || s === "idr_due" ? fmt.date(nk.idrDeadline) + ' ' + C.clock(deadlineClock(nk)) : (c.idr ? '<span class="sub">filed ' + fmt.date(c.idr.sentOn) + '</span>' : ''), true]
    ]);
    if (s === "negotiating") clocks += '<p>' + C.btn("Simulate: payer responds", "sim-respond", { seq: seq }, "sm") + ' <span class="sub">demo control</span></p>';
    if (s === "idr_due") clocks += '<div class="idr-alert">The negotiation ended without agreement. Send to IDR before ' + fmt.date(nk.idrDeadline) + '.</div>';
    cards.push(C.card("Clocks", clocks));
    // offers
    var canOffer = s === "negotiating" || s === "idr_due";
    cards.push(C.card("Offers", C.kv([["Billed", fmt.money(c.billed)], ["Payer " + (c.fin && c.fin.collected > 0 ? "paid" : "offered"), fmt.money(po) + " (" + Math.round(po / c.billed * 100) + "% of billed)"]]) +
      '<p><label class="chk">Our offer <input id="idr-offer" type="number" step="0.01" min="0" value="' + oo + '"' + (canOffer ? '' : ' disabled') + '></label> <span class="sub">' + Math.round(oo / c.billed * 100) + '% of billed</span></p>' +
      '<p>' + (canOffer ? C.btn("Send counter-offer", "counter", { seq: seq }, "sm") : '<button type="button" class="btn sm" disabled title="Offers are fixed once the packet is at IDR">Send counter-offer</button>') + '</p>'));
    // packet
    var pk = UI.packet[seq] || (UI.packet[seq] = {});
    var items = [["claim", "Claim form as filed"], ["remit", "835 or denial"], ["note", "Operative note"], ["report", "Monitoring report"], ["letter", "Our offer letter"]];
    var checked = items.filter(function (it) { return pk[it[0]]; }).length;
    var canSend = s === "idr_due" || s === "negotiating";
    cards.push(C.card("The packet", items.map(function (it) { return '<label class="chk" style="display:flex"><input type="checkbox" data-pk="' + it[0] + '"' + (pk[it[0]] ? ' checked' : '') + (s === "idr_sent" || s === "idr_decided" ? ' disabled' : '') + '> ' + esc(it[1]) + '</label>'; }).join("") +
      '<p class="sub">' + (s === "idr_sent" || s === "idr_decided" ? "Sent to " + esc(vendorName(api, c.idr.vendor)) + " on " + fmt.date(c.idr.sentOn) : checked + " of " + items.length + " in the packet") + '</p>' +
      '<p>' + (canSend ? C.btn("Send to IDR", "send", { seq: seq }, "primary") : '<button type="button" class="btn primary" disabled title="' + esc(s === "idr_sent" ? "Already at IDR" : s === "idr_decided" ? "Decided" : "Only while negotiating or in the IDR window") + '">Send to IDR</button>') + (canSend && s === "negotiating" ? ' <span class="sub">allowed before the window too, once the payer has answered</span>' : '') + '</p>'));
    // status back from the vendor
    if (s === "idr_sent") {
      var days = ST.daysBetween(c.idr.sentOn, ST.TODAY);
      cards.push(C.card("Status from " + esc(vendorName(api, c.idr.vendor)), '<ul class="checks"><li class="ok"><b>Received</b><span class="sub">' + fmt.date(c.idr.sentOn) + ', packet complete</span></li><li class="ok"><b>Payer notified</b><span class="sub">' + fmt.date(ST.addDays(c.idr.sentOn, 1)) + '</span></li><li class="warn"><b>Under review</b><span class="sub">' + days + ' days at the entity; a decision usually arrives within 30 business days</span></li></ul>' +
        '<p>' + C.btn("Simulate decision", "sim-decide", { seq: seq }, "sm") + ' <span class="sub">demo control</span></p>'));
    }
    if (s === "idr_decided") {
      var dueOn = ST.addDays(c.idr.decidedOn || ST.TODAY, 30);
      cards.push(C.card("Decision", C.kv([["Award", '<b>' + fmt.money(c.idr.award) + '</b>', true], ["Decided", fmt.date(c.idr.decidedOn)], ["Payer must pay by", fmt.date(dueOn) + " (30 days)"], ["Our offer", fmt.money(c.idr.offer)], ["Payer offer", fmt.money(c.idr.payerOffer)]]) +
        '<p><a class="btn primary" href="#claim/' + seq + '/ledger">Record payment</a></p>'));
    }
    html += C.panel("The dispute", '<div class="row idr-cards">' + cards.join("") + '</div>');
    html += C.banner(api.data.illustrative);

    var el = mount(container, html, function (act, el) {
      if (act === "sim-respond") respondDialog(api, seq);
      else if (act === "sim-decide") decisionDialog(api, seq);
      else if (act === "send") sendDialog(api, seq);
      else if (act === "counter") { var inp = el.querySelector("#idr-offer"); var x = Number(inp && inp.value); if (!(x > 0)) { api.toast("Enter our offer first.", "warn"); return; } UI.offers[seq] = x; T.addNote(seq, "Counter-offer of " + fmt.money(x) + " sent to " + c.payer + " in open negotiation."); api.toast("Counter-offer of " + fmt.money(x) + " sent to " + c.payer + " and noted on the claim.", "ok"); }
    });
    var inp = el.querySelector("#idr-offer"); if (inp) inp.addEventListener("input", function () { var x = Number(inp.value); if (x >= 0) UI.offers[seq] = x; });
    el.addEventListener("change", function (ev) { var a = ev.target.closest("[data-pk]"); if (a) { pk[a.getAttribute("data-pk")] = a.checked; var n = items.filter(function (it) { return pk[it[0]]; }).length; var sub = a.closest(".card").querySelector("p.sub"); if (sub) sub.textContent = n + " of " + items.length + " in the packet"; } });
  }

  function mount(container, html, onAct) {
    var el = document.createElement("div");
    el.innerHTML = html;
    container.innerHTML = ""; container.appendChild(el);
    el.addEventListener("click", function (ev) { var t = ev.target.closest("[data-act]"); if (!t) return; onAct(t.getAttribute("data-act"), el, t); });
    return el;
  }

  window.CLAIM_VIEWS.idr = idrView;
  window.SCENES.idr = { title: "Out-of-network and IDR", render: render };
})();
