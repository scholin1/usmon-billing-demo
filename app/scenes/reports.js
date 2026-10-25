/* Scene: reports. Six honest charts drawn as inline SVG from the live store (no libraries), each
   with a one-sentence takeaway and the same numbers as a small grid underneath (both skins), then
   the modules catalog. Money is illustrative where the kit did not generate it. */
(function () {
  "use strict";
  var CLASSES = [
    { key: "oon", label: "Out-of-network", fill: "var(--brand-2)" },
    { key: "government", label: "Government", fill: "var(--ok)" },
    { key: "inn", label: "In-network", fill: "var(--idr)" },
    { key: "other", label: "Other", fill: "var(--warn)" }
  ];
  var W = 680, LABEL_W = 170, VALUE_W = 92, BAR_H = 13, GAP = 3, PAD = 10;

  function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
  function sum(arr, f) { return Math.round(arr.reduce(function (a, x) { return a + f(x); }, 0) * 100) / 100; }
  var esc = function (s) { return String(s == null ? "" : s); }; // replaced by api.esc at render time

  // Horizontal grouped bars. rows: [{label, values:[n, ...]}]; series: [{name, fill}]; fmt(n) for the value text.
  function hbars(rows, series, fmt, opts) {
    opts = opts || {};
    var max = opts.max || Math.max.apply(null, rows.map(function (r) { return Math.max.apply(null, r.values); }).concat([1]));
    var rowH = series.length * (BAR_H + GAP) + 8;
    var H = PAD + rows.length * rowH + 26;
    var x0 = LABEL_W, areaW = W - LABEL_W - VALUE_W;
    var ticks = [0, 0.25, 0.5, 0.75, 1];
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || "bar chart") + '">';
    ticks.forEach(function (t) { var x = x0 + areaW * t; h += '<line x1="' + x + '" y1="' + PAD + '" x2="' + x + '" y2="' + (H - 22) + '" style="stroke:var(--line)" />'; h += '<text class="sub" fill="currentColor" x="' + x + '" y="' + (H - 6) + '" text-anchor="' + (t === 0 ? "start" : t === 1 ? "end" : "middle") + '">' + esc(fmt(max * t, true)) + '</text>'; });
    rows.forEach(function (r, i) {
      var y = PAD + i * rowH;
      h += '<text class="sub" fill="currentColor" x="' + (x0 - 8) + '" y="' + (y + rowH / 2) + '" text-anchor="end" dominant-baseline="middle">' + esc(r.label) + '</text>';
      r.values.forEach(function (v, k) {
        var by = y + 4 + k * (BAR_H + GAP), bw = Math.max(0, areaW * (v / max));
        h += '<rect x="' + x0 + '" y="' + by + '" width="' + bw.toFixed(1) + '" height="' + BAR_H + '" rx="2" style="fill:' + series[k].fill + '"><title>' + esc(r.label + ", " + series[k].name + ": " + fmt(v)) + '</title></rect>';
        h += '<text class="sub" fill="currentColor" x="' + (x0 + bw + 5).toFixed(1) + '" y="' + (by + BAR_H / 2) + '" dominant-baseline="middle">' + esc(fmt(v)) + '</text>';
      });
    });
    h += '<line x1="' + x0 + '" y1="' + PAD + '" x2="' + x0 + '" y2="' + (H - 22) + '" style="stroke:var(--line2)" />';
    return h + '</svg>';
  }
  function legend(series) { return '<div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.fill + '"></i>' + esc(s.name) + '</span>'; }).join("") + '</div>'; }
  function stacked(parts, total) {
    // one horizontal stacked bar; parts: [{label, n, fill}]
    var h = '<svg viewBox="0 0 ' + W + ' 54" role="img" aria-label="payer mix"><rect x="0" y="8" width="' + W + '" height="26" rx="3" style="fill:var(--line)" />';
    var x = 0;
    parts.forEach(function (p) {
      var w = total ? W * p.n / total : 0;
      h += '<rect x="' + x.toFixed(1) + '" y="8" width="' + w.toFixed(1) + '" height="26" style="fill:' + p.fill + '"><title>' + esc(p.label + ": " + p.n + " claims, " + pct(p.n, total) + " percent") + '</title></rect>';
      if (w > 42) h += '<text x="' + (x + w / 2).toFixed(1) + '" y="21" text-anchor="middle" dominant-baseline="middle" style="fill:#fff;font-size:12px;font-weight:600">' + pct(p.n, total) + '%</text>';
      x += w;
    });
    h += '<text class="sub" fill="currentColor" x="0" y="48">0</text><text class="sub" fill="currentColor" x="' + W + '" y="48" text-anchor="end">' + total + ' claims</text>';
    return h + '</svg>';
  }
  function chart(api, title, takeaway, svg, legendHtml, grid, sub) {
    return api.components.panel(title, '<p class="take">' + takeaway + '</p>' + (legendHtml || '') + '<div class="chart">' + svg + '</div>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '<details class="nums" open><summary class="sub">The numbers (same data as the chart)</summary>' + grid + '</details>');
  }

  function render(root, api) {
    var C = api.components, ST = api.state, L = api.label, fmt = api.fmt, D = api.data;
    esc = api.esc;
    var money = function (n, axis) { return axis ? "$" + Math.round(n / 1000) + "k" : fmt.money(n); };
    var count = function (n) { return String(Math.round(n)); };
    var all = ST.all(), newList = ST.list("new"), ongoing = ST.list("ongoing");
    var open = ongoing.filter(function (c) { return c.status !== "closed"; });

    var html = '<style>' +
      '#rp .take { margin: 0 0 8px; font-weight: 600; }' +
      '#rp .chart svg { display: block; width: 100%; max-width: 760px; font-size: 12px; }' +
      '#rp .chart text.sub { font-size: 11.5px; }' +
      '#rp .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-bottom: 6px; }' +
      '#rp .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }' +
      '#rp details.nums { margin-top: 8px; } #rp details.nums summary { cursor: pointer; }' +
      '#rp details.nums table.grid { margin-top: 6px; max-width: 760px; }' +
      '#rp .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } @media (max-width: 1100px) { #rp .two { grid-template-columns: 1fr; } }' +
      '#rp .two .panel { margin-bottom: 0; }' +
      '#rp .modules { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; } @media (max-width: 1100px) { #rp .modules { grid-template-columns: 1fr 1fr; } }' +
      '#rp .modules .card { margin-bottom: 0; } #rp .modules .card .pill { float: right; }' +
      '</style><div id="rp">';
    html += C.banner(D.illustrative);

    // ---------------------------------------------------------------------------- 1 workload by biller
    var billers = D.users.filter(function (u) { return u.role === "biller"; });
    var wl = billers.map(function (u) { return { label: u.name, id: u.id, team: u.team, values: [newList.filter(function (c) { return c.assignee === u.id; }).length, ongoing.filter(function (c) { return c.assignee === u.id; }).length] }; });
    var unassigned = newList.filter(function (c) { return !c.assignee; }).length;
    wl.push({ label: "Unassigned", id: "", team: "", values: [unassigned, ongoing.filter(function (c) { return !c.assignee; }).length] });
    var busiest = wl.slice(0, billers.length).sort(function (a, b) { return (b.values[0] + b.values[1]) - (a.values[0] + a.values[1]); })[0];
    var wlSeries = [{ name: L("new"), fill: "var(--brand-2)" }, { name: L("ongoing"), fill: "var(--ok)" }];
    html += '<div class="two">';
    html += chart(api, "Workload by biller",
      esc(busiest.label) + " carries the most open claims (" + (busiest.values[0] + busiest.values[1]) + "); " + unassigned + (unassigned === 1 ? " claim" : " claims") + " in " + esc(L("new")) + " " + (unassigned === 1 ? "is" : "are") + " unassigned.",
      hbars(wl, wlSeries, count, { aria: "workload by biller" }), legend(wlSeries),
      C.grid({ columns: [{ key: "label", label: L("biller") }, { key: "team", label: "Team" }, { key: "n", label: L("new"), cls: "num" }, { key: "o", label: L("ongoing"), cls: "num" }, { key: "t", label: "Total", cls: "num" }],
        rows: wl.map(function (r) { return { label: r.label, team: r.team, n: r.values[0], o: r.values[1], t: r.values[0] + r.values[1] }; }) }));

    // ---------------------------------------------------------------------------- 2 aging of open balances
    var buckets = [{ label: "0 to 30 days", lo: 0, hi: 30 }, { label: "31 to 60", lo: 31, hi: 60 }, { label: "61 to 90", lo: 61, hi: 90 }, { label: "91 to 120", lo: 91, hi: 120 }, { label: "Over 120", lo: 121, hi: 1e9 }];
    buckets.forEach(function (b) { b.n = 0; b.bal = 0; });
    open.forEach(function (c) { var filed = c.filedOn || c.filed; if (!filed) return; var d = ST.daysBetween(filed, ST.TODAY); var bal = ST.totals(c).balance; if (bal <= 0) return; var b = buckets.find(function (x) { return d >= x.lo && d <= x.hi; }); if (b) { b.n++; b.bal += bal; } });
    var totalBal = sum(buckets, function (b) { return b.bal; });
    var over120 = buckets[4].bal;
    html += chart(api, "Aging of open balances (days since filed)",
      fmt.money(over120) + " of the " + fmt.money(totalBal) + " open (" + pct(over120, totalBal) + " percent) has been out more than 120 days.",
      hbars(buckets.map(function (b) { return { label: b.label, values: [b.bal] }; }), [{ name: "Open balance", fill: "var(--warn)" }], money, { aria: "aging of open balances" }), null,
      C.grid({ columns: [{ key: "label", label: "Age" }, { key: "n", label: "Claims", cls: "num" }, { key: "bal", label: L("balance"), cls: "num", render: function (r) { return fmt.money(r.bal); } }, { key: "share", label: "Share", cls: "num", render: function (r) { return pct(r.bal, totalBal) + "%"; } }],
        rows: buckets.map(function (b) { return { label: b.label, n: b.n, bal: Math.round(b.bal * 100) / 100 }; }) }),
      "Open means in " + esc(L("ongoing")) + " and not closed, with a balance above zero. " + open.length + " claims qualify.");
    html += '</div>';

    // ---------------------------------------------------------------------------- 3 collections by payer class
    var col = CLASSES.map(function (k) { var cs = ongoing.filter(function (c) { return c.payerClass === k.key; }); return { key: k.key, label: k.label, n: cs.length, billed: sum(cs, function (c) { return c.billed; }), collected: sum(cs, function (c) { return ST.totals(c).collected; }) }; });
    var best = col.filter(function (r) { return r.billed > 0; }).sort(function (a, b) { return pct(b.collected, b.billed) - pct(a.collected, a.billed); });
    var colSeries = [{ name: "Billed", fill: "var(--brand-2)" }, { name: L("collected"), fill: "var(--ok)" }];
    html += '<div class="two">';
    html += chart(api, "Collections by payer class (" + esc(L("ongoing")) + ")",
      (best.length ? esc(best[0].label) + " pays " + pct(best[0].collected, best[0].billed) + " percent of billed; " + esc(best[best.length - 1].label) + " " + pct(best[best.length - 1].collected, best[best.length - 1].billed) + " percent." : "No filed claims yet.") + " Collected is what the ledger posted, illustrative.",
      hbars(col.map(function (r) { return { label: r.label, values: [r.billed, r.collected] }; }), colSeries, money, { aria: "collections by payer class" }), legend(colSeries),
      C.grid({ columns: [{ key: "label", label: "Payer class" }, { key: "n", label: "Claims", cls: "num" }, { key: "billed", label: "Billed", cls: "num", render: function (r) { return fmt.money(r.billed); } }, { key: "collected", label: L("collected"), cls: "num", render: function (r) { return fmt.money(r.collected); } }, { key: "rate", label: "Rate", cls: "num", render: function (r) { return pct(r.collected, r.billed) + "%"; } }], rows: col }));

    // ---------------------------------------------------------------------------- 4 denial rate by category
    var cats = {};
    ongoing.forEach(function (c) { var code = c.fin && c.fin.code; if (!code) return; var cat = D.denialCategory[code] || "Other"; if (!cats[cat]) cats[cat] = { label: cat, code: code, n: 0 }; cats[cat].n++; if (cats[cat].code.indexOf(code) < 0) cats[cat].code += ", " + code; });
    var denRows = Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (a, b) { return b.n - a.n; });
    var denied = sum(denRows, function (r) { return r.n; });
    html += chart(api, "Denial rate by category (" + esc(L("ongoing")) + ")",
      denied + " of " + ongoing.length + " filed claims (" + pct(denied, ongoing.length) + " percent) carry a denial code" + (denRows.length ? "; " + esc(denRows[0].label.toLowerCase()) + " leads with " + denRows[0].n + "." : "."),
      hbars(denRows.map(function (r) { return { label: r.label, values: [r.n] }; }), [{ name: "Claims", fill: "var(--bad)" }], count, { aria: "denial rate by category" }), null,
      C.grid({ columns: [{ key: "label", label: "Category (plain words)" }, { key: "code", label: "CARC", cls: "mono" }, { key: "n", label: "Claims", cls: "num" }, { key: "share", label: "Share of filed", cls: "num", render: function (r) { return pct(r.n, ongoing.length) + "%"; } }], rows: denRows, empty: "No denials in Ongoing." }),
      "A claim counts once, by the code on its latest remittance. Partial payments with CO-45 (over fee schedule) count as denials of the short-paid line.");
    html += '</div>';

    // ---------------------------------------------------------------------------- 5 payer mix
    var mix = D.payerMix || {};
    var mixTotal = sum(Object.keys(mix), function (k) { return mix[k]; });
    var mixParts = CLASSES.map(function (k) { return { key: k.key, label: k.label, n: mix[k.key] || 0, fill: k.fill }; });
    var relabelled = all.filter(function (c) { return c.mixAdjusted; }).length;
    html += '<div class="two">';
    html += chart(api, "Payer mix (all " + mixTotal + " claims in the set)",
      pct(mix.oon, mixTotal) + " percent out-of-network, " + pct(mix.government, mixTotal) + " percent government, " + pct(mix.inn, mixTotal) + " percent in-network" + (mix.other ? ", " + pct(mix.other, mixTotal) + " percent other" : "") + ".",
      stacked(mixParts, mixTotal), legend(mixParts.map(function (p) { return { name: p.label, fill: p.fill }; })),
      C.grid({ columns: [{ key: "label", label: "Payer class" }, { key: "n", label: "Claims", cls: "num" }, { key: "share", label: "Share", cls: "num", render: function (r) { return pct(r.n, mixTotal) + "%"; } }, { key: "stated", label: "Client's stated mix", cls: "num" }],
        rows: mixParts.map(function (p) { return { label: p.label, n: p.n, stated: p.key === "oon" ? "about 70%" : p.key === "government" ? "about 30%" : p.key === "inn" ? "about 5%" : "" }; }) }),
      "The demo layer relabelled a subset of payers (" + relabelled + " claims) to move the synthetic set toward the client's stated mix of about 70 percent out-of-network, 30 percent government and 5 percent in-network. The set is still short of that on out-of-network; the shares shown are the real counts.");

    // ---------------------------------------------------------------------------- 6 out-of-network pipeline
    var pipe = [
      { key: "negotiating", label: "Negotiating" }, { key: "idr_due", label: "IDR window open" }, { key: "idr_sent", label: "At IDR" }, { key: "idr_decided", label: "Decided" }
    ].map(function (p) { p.n = all.filter(function (c) { return c.status === p.key; }).length; p.billed = sum(all.filter(function (c) { return c.status === p.key; }), function (c) { return c.billed; }); return p; });
    var inPipe = sum(pipe, function (p) { return p.n; });
    var oonOpen = open.filter(function (c) { return c.payerClass === "oon"; }).length;
    html += chart(api, "Out-of-network pipeline",
      inPipe + " of " + oonOpen + " open out-of-network claims " + (inPipe === 1 ? "is" : "are") + " in negotiation or IDR" + (pipe[1].n ? "; " + pipe[1].n + " must go to IDR within the window." : "."),
      hbars(pipe.map(function (p) { return { label: p.label, values: [p.n] }; }), [{ name: "Claims", fill: "var(--idr)" }], count, { aria: "out-of-network pipeline", max: Math.max(4, Math.max.apply(null, pipe.map(function (p) { return p.n; }))) }), null,
      C.grid({ columns: [{ key: "label", label: "Stage" }, { key: "n", label: "Claims", cls: "num" }, { key: "billed", label: "Billed", cls: "num", render: function (r) { return fmt.money(r.billed); } }], rows: pipe }),
      'Negotiation runs 30 days from the notice, then a 4 business day window to start IDR. Medicare and Medicaid have no IDR path. <a href="#idr">Open ' + esc(L("idr")) + '</a>.');
    html += '</div>';

    // ---------------------------------------------------------------------------- modules catalog
    var addons = ST.get().addons || {};
    var modules = [
      { name: "Insurance Billing", kind: "core", pill: C.pill("core", "filed"), text: "The two worklists, prepare, scrub, file, acknowledgement, tracking, assignment, notes and reports. Always on." },
      { name: "Remit", kind: "add-on", pill: C.pill(addons.remit ? "add-on, on" : "add-on, off", addons.remit ? "paid" : "closed"), text: "Reads the 835 and the paper EOB, proposes the posting line by line, validates against the printed check, and owns the denial status vocabulary. " + (addons.remit ? "On for this client." : "Off for this client; proposed rows post by hand.") },
      { name: "Coding Assist", kind: "add-on", pill: C.pill(addons.codingAssist ? "add-on, on" : "add-on, off", addons.codingAssist ? "paid" : "closed"), text: "Reads the tech and Cadwell reports and suggests CPT codes the case may have missed; the biller confirms every suggestion. " + (addons.codingAssist ? "On for this client." : "Off for this client.") },
      { name: "USMON Arbitration", kind: "included", pill: C.pill("included", "idr"), text: "The out-of-network path: negotiation clock, the IDR alert, the packet to USMON Arbitration or a vendor, and the decision back on the claim." }
    ];
    html += C.panel("Modules", '<p class="sub">What the module ships with and what the client switches on. Add-ons are part of the module, API-connected to legacy; turn them on or off under ' + esc(L("settings")) + '.</p><div class="modules">' + modules.map(function (m) { return C.card(esc(m.name) + m.pill, '<p>' + esc(m.text) + '</p><a href="#settings/addons">' + (m.kind === "add-on" ? "Turn on or off" : "See the add-ons") + '</a>'); }).join("") + '</div>');

    html += '</div>';
    root.innerHTML = html;
  }

  window.SCENES.reports = { title: "Reports", render: render };
})();
