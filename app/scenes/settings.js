/* Scene: settings. Six sections behind a left nav: Billing rules (explain by picture, D-118), the
   Box 33 roster, clearinghouse connections, users and roles, add-ons (Remit, Coding Assist,
   Arbitration) with the filing-limit setting, and the view switch. Store transitions used:
   setUser, setView, setAddon, setSetting. Everything else (the chosen rule, added entities,
   connection edits, role and permission ticks) is scene-local demo state in UI. */
(function () {
  "use strict";
  var UI = { rule: "payer", pvPayer: "", pvHosp: "", pvSurg: "", entities: [], hiddenEnt: {}, ch: {}, chExtra: [], roles: {}, perms: null };
  var SECTIONS = [
    { key: "rules", label: "Billing rules" },
    { key: "box33", label: "Box 33 roster" },
    { key: "clearinghouses", label: "Clearinghouse connections" },
    { key: "users", label: "Users and roles" },
    { key: "addons", label: "Add-ons" },
    { key: "view", label: "View" }
  ];
  var PERMS = ["File claims", "Post payments", "Work denials", "Send to IDR", "Close claims", "Edit billing rules", "Manage users", "See reports"];
  function defaultPerms() { return { biller: [true, true, true, true, true, false, false, false], supervisor: [true, true, true, true, true, true, true, true] }; }

  var STYLE = '<style>' +
    '.row.st-root .side { flex: 0 0 230px; }' +
    '.st-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; align-items: stretch; }' +
    '.st-cards .card { margin-bottom: 0; }' +
    '.st-choice { cursor: pointer; } .st-choice.on { border-color: var(--brand); box-shadow: 0 0 0 2px var(--accent); } .st-choice .picture { margin-bottom: 8px; }' +
    '.st-choice p { margin: 4px 0 8px; font-size: 13px; }' +
    '.st-preview { margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--line2); background: var(--accent); }' +
    '.st-preview .big { font-size: 16px; font-weight: 650; }' +
    '.st-head { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; } .st-head .spacer { flex: 1; }' +
    '.st-switch { display: inline-flex; align-items: center; gap: 8px; } .st-switch input { width: 18px; height: 18px; margin: 0; }' +
    '.st-sub { margin: 0 0 12px; }' +
    '</style>';

  function hash(s) { var h = 7; s = String(s || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } }); return out.sort(); }
  function merge(a, b) { var o = {}; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; }); return o; }
  function disabledBtn(text, why, cls) { return '<button type="button" class="btn ' + (cls || "") + '" disabled title="' + why + '">' + text + '</button>'; }

  // ----------------------------------------------------------------------------------- the drawings (inline SVG, CSS variables only)
  function ruleDrawing(kind) {
    var word = kind === "payer" ? "Payer" : kind === "facility" ? "Facility" : "Surgeon";
    var hit = kind === "payer" ? 0 : kind === "facility" ? 1 : 2;
    var ys = [8, 47, 86];
    var s = '<svg viewBox="0 0 320 120" role="img" aria-label="A claim routed to one billing entity by ' + word.toLowerCase() + '">';
    s += '<rect x="8" y="40" width="68" height="40" rx="4" style="fill:var(--paper);stroke:var(--ink)"/>';
    s += '<text x="42" y="57" text-anchor="middle" style="font-size:11px;font-weight:600;fill:var(--ink)">Claim</text>';
    s += '<text x="42" y="71" text-anchor="middle" style="font-size:8.5px;fill:var(--muted)">from legacy</text>';
    s += '<line x1="76" y1="60" x2="104" y2="60" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="104,56 112,60 104,64" style="fill:var(--muted)"/>';
    s += '<rect x="112" y="42" width="78" height="36" rx="18" style="fill:var(--accent);stroke:var(--brand);stroke-width:1.5"/>';
    s += '<text x="151" y="57" text-anchor="middle" style="font-size:10px;font-weight:600;fill:var(--brand)">by ' + word.toLowerCase() + '</text>';
    s += '<text x="151" y="69" text-anchor="middle" style="font-size:8px;fill:var(--brand)">the rule looks here</text>';
    ys.forEach(function (y, i) {
      var on = i === hit;
      s += '<line x1="190" y1="60" x2="220" y2="' + (y + 13) + '" style="stroke:' + (on ? 'var(--brand)' : 'var(--line2)') + ';stroke-width:' + (on ? 2 : 1) + (on ? '' : ';stroke-dasharray:3 3') + '"/>';
      if (on) s += '<polygon points="' + (220 - 8) + ',' + (y + 9) + ' 222,' + (y + 13) + ' ' + (220 - 8) + ',' + (y + 17) + '" style="fill:var(--brand)"/>';
      s += '<rect x="222" y="' + y + '" width="92" height="26" rx="4" style="fill:' + (on ? 'var(--ok-bg)' : 'var(--paper)') + ';stroke:' + (on ? 'var(--ok)' : 'var(--line2)') + ';stroke-width:' + (on ? 1.5 : 1) + '"/>';
      s += '<text x="268" y="' + (y + 16) + '" text-anchor="middle" style="font-size:8.5px;' + (on ? 'font-weight:600;fill:var(--ok)' : 'fill:var(--muted)') + '">Entity ' + "ABC"[i] + (on ? ' (Box 33)' : '') + '</text>';
    });
    return s + '</svg>';
  }
  function viewDrawing(kind) {
    var s = '<svg viewBox="0 0 220 120" role="img" aria-label="The ' + kind + ' view">';
    if (kind === "familiar") {
      s += '<rect x="0" y="0" width="220" height="16" rx="3" style="fill:var(--brand)"/><rect x="6" y="5" width="34" height="6" rx="3" style="fill:#fff;opacity:.9"/>';
      [0, 1, 2].forEach(function (i) { s += '<rect x="' + (6 + i * 70) + '" y="24" width="64" height="26" rx="6" style="fill:var(--paper);stroke:var(--line)"/><rect x="' + (12 + i * 70) + '" y="31" width="22" height="7" rx="2" style="fill:var(--ink);opacity:.7"/><rect x="' + (12 + i * 70) + '" y="41" width="40" height="4" rx="2" style="fill:var(--muted);opacity:.5"/>'; });
      s += '<rect x="6" y="58" width="208" height="56" rx="6" style="fill:var(--paper);stroke:var(--line)"/>';
      [0, 1, 2].forEach(function (i) { var y = 66 + i * 15; s += '<rect x="14" y="' + y + '" width="60" height="5" rx="2" style="fill:var(--ink);opacity:.6"/><rect x="90" y="' + (y - 2) + '" width="34" height="9" rx="5" style="fill:' + ['var(--ok-bg)', 'var(--warn-bg)', 'var(--info-bg)'][i] + ';stroke:' + ['var(--ok)', 'var(--warn)', 'var(--info)'][i] + ';stroke-width:.6"/><rect x="150" y="' + (y - 2) + '" width="40" height="9" rx="4" style="fill:var(--brand)"/>'; });
    } else {
      s += '<rect x="0" y="0" width="220" height="14" style="fill:var(--brand)"/><rect x="4" y="4" width="40" height="6" style="fill:#fff"/><rect x="206" y="3" width="10" height="8" style="fill:#fff"/>';
      s += '<rect x="0" y="14" width="220" height="12" style="fill:var(--line)"/>';
      [0, 1, 2, 3].forEach(function (i) { s += '<rect x="' + (3 + i * 42) + '" y="16" width="38" height="9" style="fill:var(--paper);stroke:var(--line2);stroke-width:.8"/>'; });
      s += '<rect x="0" y="30" width="220" height="90" style="fill:var(--paper);stroke:var(--line2);stroke-width:.8"/>';
      s += '<rect x="0" y="30" width="220" height="11" style="fill:var(--line)"/>';
      [0, 1, 2, 3, 4, 5].forEach(function (i) { s += '<line x1="0" y1="' + (41 + i * 13) + '" x2="220" y2="' + (41 + i * 13) + '" style="stroke:var(--line2);stroke-width:.6"/>'; });
      [45, 95, 140, 180].forEach(function (x) { s += '<line x1="' + x + '" y1="30" x2="' + x + '" y2="120" style="stroke:var(--line2);stroke-width:.6"/>'; });
      [0, 1, 2, 3, 4].forEach(function (i) { var y = 46 + i * 13; s += '<rect x="4" y="' + y + '" width="34" height="4" style="fill:var(--ink);opacity:.7"/><rect x="50" y="' + y + '" width="30" height="4" style="fill:var(--ink);opacity:.45"/><rect x="100" y="' + y + '" width="28" height="4" style="fill:var(--ink);opacity:.45"/><rect x="145" y="' + y + '" width="22" height="4" style="fill:var(--ink);opacity:.45"/>'; });
    }
    return s + '</svg>';
  }

  // ----------------------------------------------------------------------------------- render
  function render(root, api, r) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label;
    var section = r.parts[1] || "rules";
    if (!SECTIONS.some(function (s) { return s.key === section; })) section = "rules";
    if (!UI.perms) UI.perms = defaultPerms();

    var nav = '<ul class="menu-list">' + SECTIONS.map(function (s) {
      var extra = s.key === "addons" ? '<span class="sub">Remit ' + (ST.get().addons.remit ? "on" : "off") + '</span>' : s.key === "view" ? '<span class="sub">' + esc(ST.get().view) + '</span>' : '';
      return '<li data-act="st-go" data-href="#settings/' + s.key + '"' + (s.key === section ? ' class="on"' : '') + '>' + esc(s.label) + extra + '</li>';
    }).join("") + '</ul>';

    var body = section === "rules" ? rules(api) : section === "box33" ? box33(api) : section === "clearinghouses" ? clearinghouses(api) : section === "users" ? users(api) : section === "addons" ? addons(api) : view(api);

    root.innerHTML = STYLE + '<h1>' + esc(L("settings")) + '</h1>' +
      '<div class="row st-root"><div class="side">' + C.panel(esc(L("settings")), nav) + '</div><div class="st-main">' + body + '</div></div>';

    root.onclick = function (ev) { onClick(ev, root, api, r, section); };
    root.onchange = function (ev) { onChange(ev, root, api, r, section); };
    root.oninput = function (ev) { onChange(ev, root, api, r, section); };
  }

  // ----------------------------------------------------------------------------------- sections
  function rules(api) {
    var C = api.components, ST = api.state, esc = api.esc;
    var payers = api.data.payers, claims = ST.all();
    var hosps = uniq(claims.map(function (c) { return c.hosp; })), surgs = uniq(claims.map(function (c) { return c.surg; }));
    if (!UI.pvPayer && payers.length) UI.pvPayer = String(payers[0].id);
    if (!UI.pvHosp && hosps.length) UI.pvHosp = hosps[0];
    if (!UI.pvSurg && surgs.length) UI.pvSurg = surgs[0];
    var payer = payers.find(function (p) { return String(p.id) === UI.pvPayer; }) || payers[0];
    var ents = api.data.entities, n = ents.length;
    var idx = UI.rule === "payer" ? (payer ? payer.id % n : 0) : UI.rule === "facility" ? hash(UI.pvHosp) % n : hash(UI.pvSurg) % n;
    var ent = ents[idx];
    var choices = [
      { key: "payer", title: "By payer", text: "Every claim for one insurance goes to the entity you mapped to that payer. The usual setup when a payer credentialed one of your entities." },
      { key: "facility", title: "By facility", text: "Every claim from one hospital or surgery center goes to the entity that holds that facility’s contract, whatever the insurance." },
      { key: "surgeon", title: "By surgeon", text: "Every claim for one surgeon’s cases goes to the entity that surgeon’s group bills under. Used where a surgeon brings their own billing arrangement." }
    ];
    var html = '<h2 style="margin-top:0">Which entity goes in Box 33</h2>' +
      '<p class="sub st-sub">Box 33 is where the money goes. Pick the rule, then check it below with a real payer and facility. In legacy these rules come from the client’s biller_options; here a supervisor edits them.</p>';
    html += '<div class="st-cards">' + choices.map(function (ch) {
      var on = UI.rule === ch.key;
      return '<div class="card st-choice' + (on ? ' on' : '') + '" data-act="st-rule" data-rule="' + ch.key + '" role="button" tabindex="0"><div class="picture">' + ruleDrawing(ch.key) + '</div><h3>' + esc(ch.title) + (on ? ' ' + C.pill("Current rule", "ready") : '') + '</h3><p>' + esc(ch.text) + '</p>' +
        (on ? disabledBtn("Chosen", "This is the rule in force", "sm") : C.btn("Use this rule", "st-rule", { rule: ch.key }, "sm primary")) + '</div>';
    }).join("") + '</div>';
    html += '<div class="card" style="margin-top:14px"><h3>Live preview: your choices</h3><p class="sub">Pick a payer, a facility and a surgeon from this client’s data; the preview shows the entity the current rule puts in Box 33. Only the input the rule looks at changes the answer.</p>' +
      '<div class="form">' +
      '<label>Payer<select data-act="st-pv" data-k="pvPayer">' + payers.map(function (p) { return '<option value="' + p.id + '"' + (String(p.id) === UI.pvPayer ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.type) + ')</option>'; }).join("") + '</select></label>' +
      '<label>Facility<select data-act="st-pv" data-k="pvHosp">' + hosps.map(function (h) { return '<option value="' + esc(h) + '"' + (h === UI.pvHosp ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join("") + '</select></label>' +
      '<label>Surgeon<select data-act="st-pv" data-k="pvSurg">' + surgs.map(function (s) { return '<option value="' + esc(s) + '"' + (s === UI.pvSurg ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join("") + '</select></label>' +
      '<label>Rule in force<div>' + C.pill(UI.rule === "payer" ? "By payer" : UI.rule === "facility" ? "By facility" : "By surgeon", "ready") + '</div></label>' +
      '</div>' +
      '<div class="st-preview"><div class="sub">Box 33 billing entity</div><div class="big">' + esc(ent.name) + '</div><div class="sub">NPI ' + esc(ent.npi) + ' · ' + esc(ent.city) + ', ' + esc(ent.st) + '</div>' +
      '<p style="margin:8px 0 0">Chosen ' + (UI.rule === "payer" ? 'because the payer is <b>' + esc(payer.name) + '</b>' : UI.rule === "facility" ? 'because the facility is <b>' + esc(UI.pvHosp) + '</b>' : 'because the surgeon is <b>' + esc(UI.pvSurg) + '</b>') + '. On the ' + esc(api.label("new")) + ' worklist this shows under ' + esc(api.label("box33")) + ' with a confirm chip; the biller always confirms before filing.</p></div></div>';
    return html;
  }

  function box33(api) {
    var C = api.components, esc = api.esc;
    var ents = api.data.entities.concat(UI.entities);
    var hiddenCount = ents.filter(function (e) { return UI.hiddenEnt[e.id]; }).length;
    var html = '<div class="st-head"><h2 style="margin:0">Box 33 roster</h2><span class="spacer"></span>' + C.btn("Add entity", "st-add-entity", null, "sm primary") + '</div>' +
      '<p class="sub st-sub">The billing entities this client files under. The billing rule picks one per claim; a hidden entity stays on old claims but is never picked for new ones.' + (hiddenCount ? ' ' + hiddenCount + ' hidden.' : '') + '</p>';
    html += C.grid({
      id: "st-entities",
      columns: [
        { key: "name", label: "Entity", render: function (e) { return '<b' + (UI.hiddenEnt[e.id] ? ' class="greyed"' : '') + '>' + esc(e.name) + '</b>' + (UI.hiddenEnt[e.id] ? ' ' + C.pill("Hidden", "closed") : '') + (e.local ? ' ' + C.pill("Added here", "new") : ''); } },
        { key: "npi", label: "NPI", cls: "mono", render: function (e) { return esc(e.npi); } },
        { key: "taxid", label: "Tax id", cls: "mono", render: function (e) { return e.taxid ? esc(e.taxid) : '<span class="sub">on file in legacy</span>'; } },
        { key: "city", label: "City" },
        { key: "st", label: "State" },
        { key: "act", label: "", render: function (e) { return C.btn(UI.hiddenEnt[e.id] ? "Show" : "Hide", "st-hide-entity", { id: e.id }, "sm"); } }
      ],
      rows: ents
    });
    return html;
  }

  function clearinghouses(api) {
    var C = api.components, esc = api.esc;
    var list = api.data.clearinghouses.concat(UI.chExtra).map(function (c) { return merge(c, UI.ch[c.id]); });
    var html = '<div class="st-head"><h2 style="margin:0">Clearinghouse connections</h2><span class="spacer"></span>' + C.btn("Add connection", "st-add-ch", null, "sm primary") + '</div>' +
      '<p class="sub st-sub">One connection per clearinghouse the client chose; USMON never writes to legacy.</p>';
    html += '<div class="st-cards">' + list.map(function (c) {
      var sftp = c.kind === "SFTP";
      return '<div class="card"><h3>' + esc(c.name) + ' ' + C.pill(c.kind, "await") + '</h3>' +
        C.kv([
          ["Status", C.pill(c.status === "connected" ? "Connected" : c.status === "ready" ? "Ready" : c.status, c.status === "connected" ? "paid" : "filed"), true],
          ["Host", c.host ? '<span class="mono">' + esc(c.host) + '</span>' : '<span class="sub">none (local print)</span>', true],
          ["User", c.user ? esc(c.user) : '<span class="sub">not set</span>', true],
          ["Folder", c.folder ? '<span class="mono">' + esc(c.folder) + '</span>' : '<span class="sub">default</span>', true],
          ["Last activity", c.last ? esc(c.last) : '<span class="sub">none yet</span>', true],
          ["Note", c.note ? esc(c.note) : '<span class="sub">none</span>', true]
        ]) +
        '<p style="margin:10px 0 0">' + C.btn("Test connection", "st-test-ch", { id: c.id, kind: c.kind, name: c.name }, "sm") + ' ' + C.btn("Edit", "st-edit-ch", { id: c.id }, "sm") + '</p></div>';
    }).join("") + '</div>';
    return html;
  }

  function users(api) {
    var C = api.components, ST = api.state, esc = api.esc, L = api.label;
    var me = ST.me();
    var html = '<h2 style="margin-top:0">Users and roles</h2><p class="sub st-sub">Who can sign in and what they may do. Roles map onto Cognito groups in the module; changes here are demo-local.</p>';
    html += C.grid({
      id: "st-users",
      columns: [
        { key: "name", label: "User", render: function (u) { return C.avatar(u.id) + ' <b>' + esc(u.name) + '</b>' + (u.id === me.id ? ' ' + C.pill("working as", "ready") : ''); } },
        { key: "role", label: "Role", render: function (u) { var role = UI.roles[u.id] || u.role; return '<select data-act="st-role" data-id="' + u.id + '"><option value="biller"' + (role === "biller" ? ' selected' : '') + '>biller</option><option value="supervisor"' + (role === "supervisor" ? ' selected' : '') + '>supervisor</option></select>' + (role !== u.role ? ' <span class="sub">changed here</span>' : ''); } },
        { key: "team", label: "Team" },
        { key: "act", label: "", render: function (u) { return u.id === me.id ? disabledBtn("Working as this user", "You are already working as " + esc(u.name), "sm") : C.btn("Work as this user", "st-work-as", { id: u.id }, "sm"); } }
      ],
      rows: api.data.users
    });
    var perms = UI.perms;
    html += '<div class="card" style="margin-top:14px"><h3>Permissions</h3><p class="sub">Tick what each role may do. In the module these are the Cognito groups the API checks on every call.</p>' +
      '<table class="grid"><thead><tr><th>Permission</th><th>Biller</th><th>Supervisor</th></tr></thead><tbody>' + PERMS.map(function (p, i) {
        return '<tr><td>' + esc(p) + '</td>' + ["biller", "supervisor"].map(function (role) { return '<td><input type="checkbox" data-act="st-perm" data-role="' + role + '" data-i="' + i + '"' + (perms[role][i] ? ' checked' : '') + ' title="' + esc(role + (perms[role][i] ? " may " : " may not ") + p.toLowerCase()) + '"></td>'; }).join("") + '</tr>';
      }).join("") + '</tbody></table>' +
      '<p style="margin:10px 0 0">' + C.btn("Reset to defaults", "st-perm-reset", null, "sm") + '</p></div>';
    return html;
  }

  function addons(api) {
    var C = api.components, ST = api.state, esc = api.esc;
    var s = ST.get();
    function sw(name, on) { return '<label class="st-switch" title="Turn ' + name + ' ' + (on ? "off" : "on") + '"><input type="checkbox" role="switch" data-act="st-addon" data-name="' + name + '"' + (on ? ' checked' : '') + '> ' + C.pill(on ? "On" : "Off", on ? "paid" : "closed") + '</label>'; }
    var html = '<h2 style="margin-top:0">Add-ons</h2><p class="sub st-sub">Optional pieces built into the module. Turning one on changes the screens right away; nothing else moves.</p>';
    html += '<div class="st-cards">' +
      '<div class="card"><div class="st-head"><h3 style="margin:0">Remit</h3><span class="spacer"></span>' + sw("remit", s.addons.remit) + '</div><p class="sub">Auto-posting from 835s, paper EOB compare.</p><p>Turns on the Remit tab on every filed claim, lands 835 rows on the Payments posting queue as proposed rows for the biller to confirm, and enables Compare with paper EOB where a paper EOB exists.</p></div>' +
      '<div class="card"><div class="st-head"><h3 style="margin:0">Coding Assist</h3><span class="spacer"></span>' + sw("codingAssist", s.addons.codingAssist) + '</div><p class="sub">Missed CPT codes from the tech and Cadwell reports.</p><p>Turns on the suggested-codes panel on Prepare, each suggestion highlighted for the biller to accept or decline before filing.</p></div>' +
      '<div class="card"><div class="st-head"><h3 style="margin:0">Arbitration</h3><span class="spacer"></span>' + C.pill("Included", "paid") + '</div><p class="sub">IDR packets to USMON Arbitration.</p><p>Always on: when an out-of-network negotiation ends without agreement, the Send to IDR packet goes to USMON Arbitration or the vendor you pick.</p></div>' +
      '</div>';
    html += '<div class="card" style="margin-top:14px"><h3>Filing limit</h3><p class="sub">Days from the date of service to file. Changes the filing clock on every ' + esc(api.label("new")) + ' claim at once. Illustrative here; per payer in the module.</p>' +
      '<div class="toolbar"><input type="number" id="st-limit" min="1" max="365" step="1" value="' + esc(s.settings.filingLimit) + '" style="width:90px"> <span class="sub">days</span> ' + C.btn("Save", "st-limit", null, "sm primary") + ' <span class="sub">Now ' + esc(s.settings.filingLimit) + ' days.</span></div></div>';
    return html;
  }

  function view(api) {
    var C = api.components, ST = api.state;
    var cur = ST.get().view;
    function card(key, title, text) {
      var on = cur === key;
      return '<div class="card' + (on ? ' st-choice on' : '') + '"><div class="picture">' + viewDrawing(key) + '</div><h3>' + title + (on ? ' ' + C.pill("Current view", "ready") : '') + '</h3><p>' + text + '</p>' +
        (on ? disabledBtn("In use", "You are already in the " + key + " view", "sm") : C.btn("Use this view", "st-view", { view: key }, "sm primary")) + '</div>';
    }
    return '<h2 style="margin-top:0">View</h2><p class="sub st-sub">Same data, same statuses, same buttons. Every user may switch at any time and the choice is remembered per user.</p>' +
      '<div class="st-cards">' +
      card("familiar", "Familiar", "Rounded cards and pills, a tile row on top, plain words in the status column. The default.") +
      card("classic", "Classic", "Title bars, gridlines and beveled buttons, the labels the legacy screens used (Refile Claim, Days Aged). The comfort skin for billers who know the old system.") +
      '</div>';
  }

  // ----------------------------------------------------------------------------------- events
  function onClick(ev, root, api, r, section) {
    var C = api.components, ST = api.state, esc = api.esc;
    var t = ev.target.closest("[data-act]"); if (!t || !root.contains(t)) return;
    var act = t.getAttribute("data-act");
    function again() { render(root, api, r); }
    if (act === "st-go") { api.go(t.getAttribute("data-href")); }
    else if (act === "st-rule") { if (ev.target.closest("select")) return; UI.rule = t.getAttribute("data-rule"); again(); api.toast("Box 33 rule: by " + UI.rule + ". The preview below follows it.", "info"); }
    else if (act === "st-add-entity") { entityDialog(api, root, r); }
    else if (act === "st-hide-entity") { var id = t.getAttribute("data-id"); UI.hiddenEnt[id] = !UI.hiddenEnt[id]; again(); api.toast(UI.hiddenEnt[id] ? "Entity hidden from new picks." : "Entity shown again.", "info"); }
    else if (act === "st-add-ch") { chDialog(api, root, r, null); }
    else if (act === "st-edit-ch") { chDialog(api, root, r, t.getAttribute("data-id")); }
    else if (act === "st-test-ch") {
      var name = t.getAttribute("data-name"), kind = t.getAttribute("data-kind");
      api.toast("Testing " + name + "...", "info");
      setTimeout(function () { api.toast(name + ": " + (kind === "SFTP" ? "Connected, canary PASS" : "Printer ready"), "ok"); }, 600);
    }
    else if (act === "st-work-as") { var uid = t.getAttribute("data-id"); ST.T.setUser(uid); api.toast("Now working as " + ST.user(uid).name + ".", "info"); }
    else if (act === "st-perm-reset") { UI.perms = defaultPerms(); again(); api.toast("Permissions back to the defaults.", "info"); }
    else if (act === "st-limit") {
      var el = root.querySelector("#st-limit"); var n = Number(el && el.value);
      if (!n || n < 1 || n > 365 || n !== Math.floor(n)) { api.toast("Enter a whole number of days from 1 to 365.", "warn"); return; }
      ST.T.setSetting("filingLimit", n); api.toast("Filing limit is now " + n + " days. Every filing clock moved with it.", "ok");
    }
    else if (act === "st-view") { var v = t.getAttribute("data-view"); ST.T.setView(v); api.toast("Switched to the " + v + " view. Same data, same state.", "info"); }
  }

  function onChange(ev, root, api, r, section) {
    var ST = api.state;
    var t = ev.target.closest("[data-act]"); if (!t || !root.contains(t)) return;
    var act = t.getAttribute("data-act");
    if (ev.type === "input" && act !== "st-pv") return;
    if (act === "st-pv") { if (ev.type === "input") return; UI[t.getAttribute("data-k")] = t.value; render(root, api, r); }
    else if (act === "st-role") { var id = t.getAttribute("data-id"); UI.roles[id] = t.value; render(root, api, r); api.toast(ST.user(id).name + " is now a " + t.value + " (demo-local).", "info"); }
    else if (act === "st-perm") { UI.perms[t.getAttribute("data-role")][Number(t.getAttribute("data-i"))] = t.checked; render(root, api, r); }
    else if (act === "st-addon") { var name = t.getAttribute("data-name"); ST.T.setAddon(name, t.checked); api.toast((name === "remit" ? "Remit" : "Coding Assist") + " is " + (t.checked ? "on" : "off") + ".", t.checked ? "ok" : "info"); }
  }

  // ----------------------------------------------------------------------------------- dialogs
  function field(id, label, value, opts) { opts = opts || {}; return '<label' + (opts.full ? ' class="full"' : '') + '>' + label + '<input id="' + id + '" type="text" value="' + value + '" placeholder="' + (opts.ph || "") + '"' + (opts.mono ? ' class="mono"' : '') + '></label>'; }
  function dval(id) { var el = document.getElementById("dialog").querySelector("#" + id); return el ? el.value.trim() : ""; }

  function entityDialog(api, root, r) {
    var C = api.components, esc = api.esc;
    C.dialog("Add a billing entity", '<p class="sub">A new entity for Box 33. It joins the roster now and the rule may pick it for new claims.</p><div class="form">' +
      field("st-e-name", "Entity name", "", { full: true, ph: "Legal name as credentialed" }) + field("st-e-npi", "NPI", "", { mono: true, ph: "10 digits" }) + field("st-e-tax", "Tax id", "", { mono: true, ph: "12-3456789" }) +
      field("st-e-addr", "Address", "", { full: true, ph: "Street" }) + field("st-e-city", "City", "") + field("st-e-st", "State", "", { ph: "Two letters" }) + '</div>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Add entity", act: "st-e-save", cls: "primary" }]);
    var d = document.getElementById("dialog"); d.onchange = null;
    d.onclick = function (ev) {
      var t = ev.target.closest("[data-act=st-e-save]"); if (!t) return;
      var name = dval("st-e-name"), npi = dval("st-e-npi");
      if (!name) { api.toast("The entity needs a name.", "warn"); return; }
      if (npi && !/^\d{10}$/.test(npi)) { api.toast("An NPI is 10 digits.", "warn"); return; }
      UI.entities.push({ id: "local-" + (UI.entities.length + 1), name: name, npi: npi || "pending", taxid: dval("st-e-tax"), address: dval("st-e-addr"), city: dval("st-e-city"), st: dval("st-e-st").toUpperCase().slice(0, 2), local: true });
      C.closeDialog(); render(root, api, r); api.toast("Added " + name + " to the Box 33 roster.", "ok");
    };
  }

  function chDialog(api, root, r, id) {
    var C = api.components, esc = api.esc;
    var base = id ? api.data.clearinghouses.concat(UI.chExtra).find(function (c) { return c.id === id; }) : null;
    var cur = base ? merge(base, UI.ch[id]) : { name: "", kind: "SFTP", host: "", user: "", folder: "" };
    C.dialog(id ? "Edit " + esc(cur.name) : "Add a clearinghouse connection",
      '<p class="sub">The client picks the clearinghouse; we hold one connection per clearinghouse and read what it returns. Nothing here touches legacy.</p><div class="form">' +
      (id ? '' : field("st-c-name", "Name", "", { full: true, ph: "Clearinghouse name" }) + '<label>Kind<select id="st-c-kind"><option value="SFTP">SFTP</option><option value="print">print (CMS-1500)</option></select></label>') +
      field("st-c-host", "Host", esc(cur.host || ""), { mono: true, ph: "sftp.example.invalid" }) + field("st-c-user", "User", esc(cur.user || ""), { ph: "account name" }) + field("st-c-folder", "Folder", esc(cur.folder || ""), { mono: true, full: true, ph: "/outbound/837" }) + '</div>',
      [{ text: "Cancel", act: "dialog-close" }, { text: "Save", act: "st-c-save", cls: "primary" }]);
    var d = document.getElementById("dialog"); d.onchange = null;
    d.onclick = function (ev) {
      var t = ev.target.closest("[data-act=st-c-save]"); if (!t) return;
      var patch = { host: dval("st-c-host"), user: dval("st-c-user"), folder: dval("st-c-folder") };
      if (id) { UI.ch[id] = merge(UI.ch[id], patch); C.closeDialog(); render(root, api, r); api.toast("Saved the connection for " + cur.name + ".", "ok"); return; }
      var name = dval("st-c-name"); var kind = d.querySelector("#st-c-kind").value;
      if (!name) { api.toast("The connection needs a name.", "warn"); return; }
      if (kind === "SFTP" && !patch.host) { api.toast("An SFTP connection needs a host.", "warn"); return; }
      UI.chExtra.push({ id: "chx" + (UI.chExtra.length + 1), name: name, kind: kind, host: patch.host, user: patch.user, folder: patch.folder, status: "ready", last: "", note: "Added in this session; not yet tested" });
      C.closeDialog(); render(root, api, r); api.toast("Added " + name + ". Test the connection when ready.", "ok");
    };
  }

  window.SCENES.settings = { title: "Settings", render: render };
})();
