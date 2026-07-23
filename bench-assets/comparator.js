/* comparator.js — "compare models side by side".
   Vanilla JS, no libraries. One IIFE. Reads window.BENCH_DATA and lazily
   fetches per-model run files only when an output tab is first opened. */
(function () {
  "use strict";

  var root = document.getElementById("comparator");
  if (!root) return;
  var DATA = window.BENCH_DATA;
  if (!DATA || !DATA.models || !DATA.tasks) {
    root.innerHTML = '<p class="cmp-empty">The comparison data has not loaded.</p>';
    return;
  }

  // where per-model run files live; overridable via data-runs-base on the section
  var RUNS_BASE = root.getAttribute("data-runs-base") || "bench-assets/runs/";

  var selModels = new Set();   // model ids
  var selTasks = new Set();    // task numbers (as numbers)
  var openTab = {};            // "taskN:modelId" -> run index currently shown
  var runsCache = {};          // modelId -> {state:"ok"|"err", data:...} once resolved
  var runsPending = {};        // modelId -> Promise while in flight

  function cellFor(modelId, n) {
    return (DATA.cells && DATA.cells[modelId] && DATA.cells[modelId][n]) || null;
  }
  function taskFor(n) {
    for (var i = 0; i < DATA.tasks.length; i++) if (DATA.tasks[i].n === n) return DATA.tasks[i];
    return null;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ordinal(k) {
    var s = ["th", "st", "nd", "rd"], v = k % 100;
    return k + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---------------------------------------------------------------- pickers
  function buildPickers() {
    var pickers = el("div", "cmp-pickers");

    // models
    var mp = el("div", "cmp-picker");
    var mh = el("div", "cmp-picker-h");
    mh.appendChild(el("h3", null, "Models"));
    var mcount = el("span", "cmp-count"); mh.appendChild(mcount);
    mp.appendChild(mh);
    var mlist = el("div", "cmp-list");
    DATA.models.forEach(function (m) {
      var row = el("label", "cmp-row");
      var cb = el("input"); cb.type = "checkbox"; cb.value = m.id;
      cb.addEventListener("change", function () {
        if (cb.checked) selModels.add(m.id); else selModels.delete(m.id);
        refreshCounts(); render();
      });
      row.appendChild(cb);
      var main = el("div", "cmp-row-main");
      main.appendChild(el("span", "cmp-row-title", m.label));
      main.appendChild(el("small", "cmp-row-sub", m.mode || ""));
      row.appendChild(main);
      row._cb = cb; row._model = m.id;
      mlist.appendChild(row);
    });
    mp.appendChild(mlist);
    pickers.appendChild(mp);

    // tasks, grouped by family
    var tp = el("div", "cmp-picker");
    var th = el("div", "cmp-picker-h");
    th.appendChild(el("h3", null, "Tasks"));
    var tcount = el("span", "cmp-count"); th.appendChild(tcount);
    tp.appendChild(th);
    var tlist = el("div", "cmp-list");

    var families = [];
    var byFam = {};
    DATA.tasks.forEach(function (t) {
      if (!byFam[t.family]) { byFam[t.family] = []; families.push(t.family); }
      byFam[t.family].push(t);
    });
    families.forEach(function (fam) {
      var group = el("div", "cmp-group");
      var gh = el("div", "cmp-group-h");
      var glab = el("label");
      var gcb = el("input"); gcb.type = "checkbox";
      gcb.addEventListener("change", function () {
        byFam[fam].forEach(function (t) {
          if (gcb.checked) selTasks.add(t.n); else selTasks.delete(t.n);
        });
        syncTaskBoxes(); refreshCounts(); render();
      });
      glab.appendChild(gcb);
      glab.appendChild(el("span", "cmp-fam", fam + " · all"));
      gh.appendChild(glab);
      group._gcb = gcb; group._fam = fam;
      tlist.appendChild(group);
      gh._fam = fam;
      group.appendChild(gh);

      byFam[fam].forEach(function (t) {
        var row = el("label", "cmp-row");
        var cb = el("input"); cb.type = "checkbox"; cb.value = String(t.n);
        cb.addEventListener("change", function () {
          if (cb.checked) selTasks.add(t.n); else selTasks.delete(t.n);
          syncGroupBoxes(); refreshCounts(); render();
        });
        row.appendChild(cb);
        var main = el("div", "cmp-row-main");
        main.appendChild(el("span", "cmp-row-title", "Task " + t.n + " · " + t.name));
        main.appendChild(el("small", "cmp-row-sub", t.scoredBy || ""));
        row.appendChild(main);
        row._cb = cb; row._task = t.n; row._fam = fam;
        group.appendChild(row);
      });
    });
    tp.appendChild(tlist);
    pickers.appendChild(tp);

    root._mcount = mcount; root._tcount = tcount;
    root._mlist = mlist; root._tlist = tlist;
    return pickers;
  }

  function refreshCounts() {
    if (root._mcount) root._mcount.textContent = selModels.size + " picked";
    if (root._tcount) root._tcount.textContent = selTasks.size + " picked";
  }
  function syncTaskBoxes() {
    // reflect selTasks onto task checkboxes + group boxes
    var rows = root._tlist.querySelectorAll(".cmp-row");
    rows.forEach(function (r) { r._cb.checked = selTasks.has(r._task); });
    syncGroupBoxes();
  }
  function syncModelBoxes() {
    var rows = root._mlist.querySelectorAll(".cmp-row");
    rows.forEach(function (r) { r._cb.checked = selModels.has(r._model); });
  }
  function syncGroupBoxes() {
    var groups = root._tlist.querySelectorAll(".cmp-group");
    groups.forEach(function (g) {
      var tasksIn = DATA.tasks.filter(function (t) { return t.family === g._fam; });
      var all = tasksIn.every(function (t) { return selTasks.has(t.n); });
      var some = tasksIn.some(function (t) { return selTasks.has(t.n); });
      g._gcb.checked = all;
      g._gcb.indeterminate = some && !all;
    });
  }

  // ---------------------------------------------------------------- fetch
  function ensureRuns(modelId) {
    if (runsCache[modelId]) return Promise.resolve(runsCache[modelId]);
    if (runsPending[modelId]) return runsPending[modelId];
    var url = RUNS_BASE + encodeURIComponent(modelId) + ".json";
    var p = fetch(url).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (json) {
      runsCache[modelId] = { state: "ok", data: json };
      delete runsPending[modelId];
      return runsCache[modelId];
    }).catch(function () {
      runsCache[modelId] = { state: "err", data: null };
      delete runsPending[modelId];
      return runsCache[modelId];
    });
    runsPending[modelId] = p;
    return p;
  }

  // ---------------------------------------------------------------- render
  function render() {
    var area = root._area;
    area.innerHTML = "";
    var models = DATA.models.filter(function (m) { return selModels.has(m.id); });
    var tasks = DATA.tasks
      .filter(function (t) { return selTasks.has(t.n); })
      .sort(function (a, b) { return a.n - b.n; });

    if (!models.length || !tasks.length) {
      area.appendChild(el("p", "cmp-empty",
        "Pick one or more models and one or more tasks to line their answers up side by side."));
      return;
    }
    tasks.forEach(function (t) { area.appendChild(renderBlock(t, models)); });
  }

  function isDrawing(t) { return t.family === "drawing"; }

  function renderBlock(t, models) {
    var block = el("div", "cmp-block");
    var h = el("div", "cmp-block-h");
    var link = el("a", "cmp-tname", "Task " + t.n + " — " + t.name);
    link.href = "#task-" + t.n;
    h.appendChild(link);
    h.appendChild(el("span", "cmp-fam", t.family));
    if (t.scoredBy) h.appendChild(el("span", "cmp-scored", "scored by " + t.scoredBy));
    block.appendChild(h);

    var grid = el("div", "cmp-grid");
    var anyDefect = false;
    models.forEach(function (m) {
      var col = renderColumn(t, m);
      if (col._hasDefect) anyDefect = true;
      grid.appendChild(col);
    });
    block.appendChild(grid);

    if (anyDefect) {
      block.appendChild(el("p", "cmp-foot",
        "† a save on our side wrapped the code in stray text; counted as a fail."));
    }
    return block;
  }

  function renderColumn(t, m) {
    var col = el("div", "cmp-col");
    var cell = cellFor(m.id, t.n);

    var ch = el("div", "cmp-col-h");
    ch.appendChild(el("span", "cmp-mlabel", m.label));
    ch.appendChild(el("small", "cmp-mmode", m.mode || ""));
    col.appendChild(ch);

    if (!cell) {
      col.appendChild(el("p", "cmp-summary", "not run"));
      return col;
    }

    // chips
    var chips = el("div", "cmp-chips");
    var runs = cell.runs || [];
    var hasDefect = false;
    runs.forEach(function (r) {
      var clean = !!r.clean;
      var pending = (r.p == null);
      var chip = el("span", "cmp-chip " + (pending ? "pend" : (clean ? "pass" : "fail")));
      var txt = pending ? "—" : (r.p + "/" + r.t);
      if (r.defect) { txt += " †"; hasDefect = true; }
      chip.textContent = txt;
      chips.appendChild(chip);
    });
    col.appendChild(chips);
    col._hasDefect = hasDefect;

    // summary line
    var summary = el("p", "cmp-summary");
    if (isDrawing(t) && (cell.eye || cell.rank)) {
      if (cell.rank) {
        var ofN = DATA.models.filter(function (mm) {
          var c = cellFor(mm.id, t.n); return c && c.rank != null;
        }).length;
        summary.innerHTML = "<strong>" + escapeHtml(cell.eye || "drawn") + "</strong> · ranked " +
          ordinal(cell.rank) + " of " + ofN;
      } else {
        summary.innerHTML = "<strong>" + escapeHtml(cell.eye || "drawn, not yet ranked") + "</strong>";
      }
    } else {
      summary.innerHTML = "clean <strong>" + cell.clean + " of " + cell.total + "</strong> runs";
    }
    col.appendChild(summary);

    // output area (tabs + panel)
    col.appendChild(renderOutput(t, m, cell));
    return col;
  }

  function renderOutput(t, m, cell) {
    var out = el("div", "cmp-out");
    var tabs = el("div", "cmp-tabs");
    var panel = el("div", "cmp-panel");
    var n = cell.total || (cell.runs ? cell.runs.length : 0);
    var key = t.n + ":" + m.id;

    for (var i = 0; i < n; i++) {
      (function (idx) {
        var tab = el("button", "cmp-tab", "run " + (idx + 1));
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", "false");
        tab.addEventListener("click", function () {
          openTab[key] = idx;
          selectTab(tabs, idx);
          showRun(panel, t, m, idx);
        });
        tabs.appendChild(tab);
      })(i);
    }
    out.appendChild(tabs);
    out.appendChild(panel);

    if (openTab[key] != null && openTab[key] < n) {
      selectTab(tabs, openTab[key]);
      showRun(panel, t, m, openTab[key]);
    } else {
      panel.appendChild(el("div", "cmp-hint", "Open a run to see the answer."));
    }
    return out;
  }

  function selectTab(tabs, idx) {
    var kids = tabs.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].setAttribute("aria-selected", i === idx ? "true" : "false");
    }
  }

  function showRun(panel, t, m, idx) {
    panel.innerHTML = "";
    panel.appendChild(el("div", "cmp-hint", "Loading run …"));
    ensureRuns(m.id).then(function (res) {
      panel.innerHTML = "";
      if (res.state === "err") {
        panel.appendChild(el("div", "cmp-hint", "outputs could not be loaded"));
        return;
      }
      var tnode = res.data && res.data.tasks && res.data.tasks[String(t.n)];
      var run = tnode && tnode.runs && tnode.runs[idx];
      if (!run) {
        panel.appendChild(el("div", "cmp-hint", "outputs could not be loaded"));
        return;
      }
      if (run.withheld) {
        panel.appendChild(el("div", "cmp-hint",
          "answer text withheld — publishing it would give away the private answer sheet; " +
          "the scores above are the full grade."));
        return;
      }
      if (isDrawing(t) && run.out) {
        renderDrawing(panel, run.out);
        return;
      }
      if (run.file) panel.appendChild(el("div", "cmp-filename", run.file));
      var pre = el("pre", null, run.out != null ? run.out : "");
      panel.appendChild(pre);
    });
  }

  function renderDrawing(panel, svgText) {
    var wrap = el("div", "cmp-draw");
    // The srcdoc is set as a parsed HTML attribute (not the .srcdoc property) so the
    // sandboxed frame paints everywhere, including headless screenshots.
    // grid centering (flex collapses a viewBox-only SVG to zero height)
    var doc = "<!doctype html><meta charset='utf-8'>" +
      "<style>html,body{margin:0;height:100%;background:#0b0f14}" +
      "body{display:grid;place-items:center}" +
      "svg{max-width:100%;max-height:100%;width:auto;height:auto}</style>" +
      svgText;
    var attr = String(doc).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    // attach first, then fill — so the sandboxed frame loads while in the document
    panel.appendChild(wrap);
    wrap.innerHTML = '<iframe sandbox title="drawing" width="100%" height="260" ' +
      'style="width:100%;height:260px;border:0;display:block;background:#0b0f14" ' +
      'srcdoc="' + attr + '"></iframe>';
    var toggle = el("span", "cmp-showcode", "show code");
    var codeShown = false;
    var pre = null;
    toggle.addEventListener("click", function () {
      codeShown = !codeShown;
      if (codeShown) {
        pre = el("pre", null, svgText);
        panel.appendChild(pre);
        toggle.textContent = "hide code";
      } else if (pre) {
        panel.removeChild(pre); pre = null;
        toggle.textContent = "show code";
      }
    });
    panel.appendChild(toggle);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---------------------------------------------------------------- deep link
  function applyHash() {
    var m = /#compare=(\d+)/.exec(location.hash || "");
    if (!m) return false;
    var n = parseInt(m[1], 10);
    if (!taskFor(n)) return false;
    selTasks.add(n);
    // preselect the first two models
    DATA.models.slice(0, 2).forEach(function (mm) { selModels.add(mm.id); });
    syncModelBoxes(); syncTaskBoxes(); refreshCounts(); render();
    root.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  // ---------------------------------------------------------------- boot
  root.innerHTML = "";
  root.appendChild(el("p", "cmp-lead", "Compare models side by side"));
  root.appendChild(buildPickers());
  var area = el("div", "cmp-compare");
  root._area = area;
  root.appendChild(area);

  refreshCounts();
  if (!applyHash()) render();
  window.addEventListener("hashchange", function () { applyHash(); });

  // expose a tiny handle so the demo page's autodemo hook can drive the UI
  root._cmp = {
    selModels: selModels, selTasks: selTasks,
    syncModelBoxes: syncModelBoxes, syncTaskBoxes: syncTaskBoxes,
    refreshCounts: refreshCounts, render: render,
    openTabAt: function (taskN, modelId, idx) {
      openTab[taskN + ":" + modelId] = idx; render();
    }
  };
})();
