// backend/src/routes/adminPage/stockTab.ts
//
// Stage 1: stock is editable, BBD is displayed only.
//
// Rows are read-only until the merchant opens one. A weekly count means going
// down dozens of rows, and a table of always-live number inputs makes it far
// too easy to nudge a value without noticing.

export function stockTabMarkup(): string {
  return `
  <div id="tab-stock" class="tab-pane">
  <div class="card">
    <h2>Stock</h2>
    <p class="desc">The products you track, with live stock from Shopify. Count weekly: open a row, enter what you counted, then save. Best Before Dates are read from each product's description (editing them comes later).</p>
    <div class="stock-toolbar">
      <div class="stock-add">
        <input type="text" id="stockAddSearch" placeholder="Search products to add…" autocomplete="off" />
        <div class="po-pick" id="stockAddResults"></div>
      </div>
      <label id="stockLocationWrap" style="display:none">Location
        <select id="stockLocation"></select>
      </label>
      <label>Sort
        <select id="stockSort">
          <option value="name">Name</option>
          <option value="stock">Stock (lowest first)</option>
          <option value="bbd">BBD (soonest first)</option>
          <option value="counted">Least recently counted</option>
        </select>
      </label>
    </div>
    <div class="stock-filters">
      <button data-filter="all" class="active">All</button>
      <button data-filter="uncounted">Not counted this week</button>
    </div>
    <table class="po-table" id="stockTable">
      <thead>
        <tr><th>Product</th><th>Stock</th><th>BBD</th><th>Last counted</th><th></th></tr>
      </thead>
      <tbody id="stockTableBody"></tbody>
    </table>
    <p class="desc" id="stockEmpty" style="display:none">
      Nothing tracked yet. Search above to add a product, or confirm a purchase-order import — imported products are added here automatically.
    </p>
    <div class="po-confirm-row">
      <button class="btn" id="stockBulkBtn">Bulk edit</button>
      <button class="btn primary" id="stockSaveBtn" disabled>Save changes</button>
      <span class="msg" id="stockSaveMsg"></span>
    </div>
  </div>
  </div>`;
}

export function stockTabScript(): string {
  return `
  // ---- shared confirmation modal (also used by the Import tab) -------------
  // Every write to Shopify goes through this. Sections let a caller lead with
  // a warning block; the promise resolves false unless the merchant confirms.
  window.confirmModal = function (title, sections, confirmLabel) {
    return new Promise(function (resolve) {
      var back = document.createElement("div"); back.className = "modal-back";
      var box = document.createElement("div"); box.className = "modal";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      var h = document.createElement("h3"); h.textContent = title; box.appendChild(h);

      sections.forEach(function (sec) {
        if (!sec.items.length) return;
        var d = document.createElement("div"); d.className = "m-sec" + (sec.warn ? " warn" : "");
        var t = document.createElement("h4"); t.textContent = sec.title; d.appendChild(t);
        var ul = document.createElement("ul");
        sec.items.forEach(function (item) {
          var li = document.createElement("li"); li.textContent = item; ul.appendChild(li);
        });
        d.appendChild(ul); box.appendChild(d);
      });

      var actions = document.createElement("div"); actions.className = "m-actions";
      var cancel = document.createElement("button"); cancel.className = "btn"; cancel.textContent = "Cancel";
      var ok = document.createElement("button"); ok.className = "btn primary"; ok.textContent = confirmLabel;
      actions.appendChild(cancel); actions.appendChild(ok); box.appendChild(actions);
      back.appendChild(box); document.body.appendChild(back);

      function done(v) {
        document.removeEventListener("keydown", onKey);
        document.body.removeChild(back);
        resolve(v);
      }
      function onKey(e) { if (e.key === "Escape") done(false); }
      document.addEventListener("keydown", onKey);
      cancel.addEventListener("click", function () { done(false); });
      ok.addEventListener("click", function () { done(true); });
      back.addEventListener("click", function (e) { if (e.target === back) done(false); });
      // Focus Cancel, not the write-to-Shopify button — this workflow trains
      // the merchant to hit Enter repeatedly while counting, and a stray
      // Enter here must not silently write to Shopify.
      cancel.focus();
    });
  };

  // ---- Stock tab -----------------------------------------------------------
  var stockRows = [];        // server rows, as loaded
  var stockLocations = [];
  var stockEdits = {};       // variantId -> { value, compareQuantity, counted } — CONFIRMED counts only; only ✓/Enter writes here
  var stockOpen = {};        // variantId -> true while its editor is open
  var stockPending = {};     // variantId -> raw input text while a row is open but not yet confirmed. No semantic meaning:
                              // never staged, never submitted, never stamps a count. Exists only so a re-render triggered by
                              // confirming/cancelling a DIFFERENT row (or an incidental reload) doesn't erase what's mid-typed here.
  var stockFilter = "all";
  var MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // The three stores are cleared together everywhere except inside
  // confirmThisRow(), which deliberately keeps the stockEdits entry it has
  // just written. Routing every other site through these two helpers is what
  // makes "does this path discard the merchant's work?" answerable by reading
  // one function instead of five call sites.
  function clearRow(id) {
    delete stockEdits[id]; delete stockOpen[id]; delete stockPending[id];
  }
  function clearAll() {
    stockEdits = {}; stockOpen = {}; stockPending = {};
  }

  function weekAgo() { return Math.floor(Date.now() / 1000) - 7 * 86400; }

  function whenText(ts) {
    if (!ts) return "Never";
    var days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 14) return days + " days ago";
    return Math.floor(days / 7) + " weeks ago";
  }

  function bbdText(bbd) {
    if (!bbd) return "";
    if (bbd.kind === "parsed") return MONTH_NAMES[bbd.month - 1] + " " + bbd.year;
    if (bbd.kind === "unparseable") return "Unrecognised";
    return "Not set";
  }

  function bbdSortKey(bbd) {
    // Rows without a usable date sort last, so the soonest-expiring products
    // are never pushed down the list by products that simply have no date.
    if (!bbd || bbd.kind !== "parsed") return 999999;
    return bbd.year * 12 + bbd.month;
  }

  function stockAt(row) {
    var locId = document.getElementById("stockLocation").value;
    var found = (row.stockByLocation || []).find(function (s) { return s.locationId === locId; });
    return found ? found.available : 0;
  }

  function visibleRows() {
    var rows = stockRows.slice();
    if (stockFilter === "uncounted") {
      var cutoff = weekAgo();
      rows = rows.filter(function (r) { return r.missing || !r.lastCountedAt || r.lastCountedAt < cutoff; });
    }
    var sort = document.getElementById("stockSort").value;
    rows.sort(function (a, b) {
      if (a.missing && b.missing) return 0;
      if (a.missing || b.missing) return a.missing ? 1 : -1;
      if (sort === "stock") return stockAt(a) - stockAt(b);
      if (sort === "bbd") return bbdSortKey(a.bbd) - bbdSortKey(b.bbd);
      if (sort === "counted") return (a.lastCountedAt || 0) - (b.lastCountedAt || 0);
      return (a.title || "").localeCompare(b.title || "");
    });
    return rows;
  }

  function renderStockRows() {
    var body = document.getElementById("stockTableBody");
    body.innerHTML = "";
    var rows = visibleRows();
    var emptyEl = document.getElementById("stockEmpty");
    if (stockRows.length === 0) {
      emptyEl.textContent = "Nothing tracked yet. Search above to add a product, or confirm a purchase-order import — imported products are added here automatically.";
      emptyEl.style.display = "";
    } else if (rows.length === 0) {
      emptyEl.textContent = 'Nothing matches this filter. Every tracked product has been counted this week — try "All".';
      emptyEl.style.display = "";
    } else {
      emptyEl.style.display = "none";
    }

    rows.forEach(function (row) {
      var tr = document.createElement("tr");

      if (row.missing) {
        var td = document.createElement("td"); td.colSpan = 4; td.className = "stock-missing";
        td.textContent = "Deleted in Shopify — " + row.variantId;
        var actions = document.createElement("td");
        actions.appendChild(removeButton(row.variantId));
        tr.appendChild(td); tr.appendChild(actions); body.appendChild(tr);
        return;
      }

      // Product
      var prodCell = document.createElement("td");
      var title = document.createElement("div"); title.className = "po-prod-title"; title.textContent = row.title;
      var code = document.createElement("div"); code.className = "po-code";
      code.textContent = row.sku ? "SKU " + row.sku : "No SKU";
      prodCell.appendChild(title); prodCell.appendChild(code);

      // Stock — read-only until this row is opened, and not staged until the
      // merchant explicitly confirms with ✓. Focusing or typing in the box
      // must never stage a count nobody actually took — that would stamp
      // last-counted-at (and clear the "not counted this week" filter) for a
      // row the merchant only tabbed past.
      var stockCell = document.createElement("td");
      var current = stockAt(row);
      var confirmThisRow = null;
      if (stockOpen[row.variantId]) {
        var wrap = document.createElement("span"); wrap.className = "stock-qty";
        var minus = document.createElement("button"); minus.type = "button"; minus.textContent = "−";
        var input = document.createElement("input"); input.type = "number"; input.min = "0";
        // Priority: what's mid-typed (stockPending) beats what's already
        // confirmed (stockEdits) beats the server figure. A re-render must
        // never regress an open box back to an earlier value.
        input.value = stockPending[row.variantId] !== undefined ? stockPending[row.variantId]
          : String(stockEdits[row.variantId] ? stockEdits[row.variantId].value : current);
        input.dataset.variant = row.variantId;
        var plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
        var qtyErr = document.createElement("div"); qtyErr.className = "stock-row-err"; qtyErr.style.display = "none";

        // Pending-value changes only — none of these stage the row. They ARE
        // remembered (in stockPending, never stockEdits) so confirming or
        // cancelling a DIFFERENT row — which re-renders the whole table —
        // does not silently discard what the merchant is mid-typing here.
        input.addEventListener("input", function () { stockPending[row.variantId] = input.value; qtyErr.style.display = "none"; });
        minus.addEventListener("click", function () {
          input.value = String(Math.max(0, (parseInt(input.value, 10) || 0) - 1));
          stockPending[row.variantId] = input.value;
          qtyErr.style.display = "none";
        });
        plus.addEventListener("click", function () {
          input.value = String((parseInt(input.value, 10) || 0) + 1);
          stockPending[row.variantId] = input.value;
          qtyErr.style.display = "none";
        });

        confirmThisRow = function () {
          var raw = input.value.trim();
          if (raw === "" || !/^\\d+$/.test(raw)) {
            qtyErr.textContent = "Enter a whole number to confirm this count";
            qtyErr.style.display = "";
            return false;
          }
          // The unchanged case is deliberate: a confirmed row always submits
          // its value, even when it matches what was on screen. That's what
          // proves, via compareQuantity, that stock did not move underneath
          // the merchant between page load and this count.
          stockEdits[row.variantId] = { value: parseInt(raw, 10), compareQuantity: current, counted: true };
          delete stockOpen[row.variantId];
          delete stockPending[row.variantId];
          refreshSaveButton();
          renderStockRows();
          return true;
        };

        input.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          e.preventDefault();
          // Enter is the keyboard binding for ✓, not a passive "move on"
          // key — it must confirm exactly what clicking ✓ would, and only
          // advance the count when that confirmation actually staged.
          var all = Array.prototype.slice.call(document.querySelectorAll("#stockTableBody input[data-variant]"));
          var idx = all.indexOf(input);
          var nextVariant = all[idx + 1] ? all[idx + 1].dataset.variant : null;
          if (!confirmThisRow()) return;
          if (nextVariant) {
            var nextInput = document.querySelector('#stockTableBody input[data-variant="' + nextVariant + '"]');
            if (nextInput) { nextInput.focus(); nextInput.select(); }
          }
        });

        wrap.appendChild(minus); wrap.appendChild(input); wrap.appendChild(plus);
        stockCell.appendChild(wrap);
        stockCell.appendChild(qtyErr);
      } else {
        // A confirmed-but-not-yet-saved row must show what was just counted,
        // not the stale server figure — and must look visibly different from
        // a row nobody has touched, since "which rows have I done" is the
        // question a weekly pass over dozens of rows keeps asking.
        var staged = stockEdits[row.variantId];
        var num = document.createElement("span"); num.className = "stock-num"; num.textContent = String(staged ? staged.value : current);
        stockCell.appendChild(num);
        if (staged) {
          var badge = document.createElement("span"); badge.className = "stock-badge counted"; badge.textContent = "Counted";
          badge.style.marginLeft = "6px";
          stockCell.appendChild(badge);
        }
      }

      // BBD — display only in Stage 1
      var bbdCell = document.createElement("td");
      var b = document.createElement("span");
      if (row.bbd && row.bbd.kind === "parsed") { b.textContent = bbdText(row.bbd); }
      else { b.className = "stock-badge" + (row.bbd && row.bbd.kind === "unparseable" ? " warn" : ""); b.textContent = bbdText(row.bbd); }
      bbdCell.appendChild(b);

      // Last counted
      var whenCell = document.createElement("td");
      var when = document.createElement("span");
      when.className = "stock-when" + (!row.lastCountedAt || row.lastCountedAt < weekAgo() ? " stale" : "");
      when.textContent = whenText(row.lastCountedAt);
      whenCell.appendChild(when);

      // Actions — read-only rows get Edit; an open row gets an explicit ✓
      // (the only thing that stages a count) and Cancel (discards it).
      var actCell = document.createElement("td");
      if (stockOpen[row.variantId]) {
        var confirmBtn = document.createElement("button"); confirmBtn.className = "btn primary"; confirmBtn.textContent = "✓";
        confirmBtn.title = "Confirm this count";
        confirmBtn.addEventListener("click", function () { confirmThisRow(); });
        var cancelBtn = document.createElement("button"); cancelBtn.className = "btn"; cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () {
          clearRow(row.variantId);
          refreshSaveButton(); renderStockRows();
        });
        actCell.appendChild(confirmBtn); actCell.appendChild(cancelBtn);
      } else {
        var editBtn = document.createElement("button"); editBtn.className = "btn"; editBtn.textContent = "Edit";
        editBtn.addEventListener("click", function () {
          stockOpen[row.variantId] = true;
          renderStockRows();
        });
        actCell.appendChild(editBtn);
      }
      actCell.appendChild(removeButton(row.variantId));

      if (row._error) {
        var err = document.createElement("div"); err.className = "stock-row-err"; err.textContent = row._error;
        prodCell.appendChild(err);
      }

      tr.appendChild(prodCell); tr.appendChild(stockCell); tr.appendChild(bbdCell);
      tr.appendChild(whenCell); tr.appendChild(actCell);
      body.appendChild(tr);
    });
  }

  function removeButton(variantId) {
    var rm = document.createElement("button"); rm.className = "btn"; rm.textContent = "✕";
    rm.title = "Stop tracking (does not change Shopify)";
    rm.addEventListener("click", async function () {
      // The tab's only destructive control. An unguarded api() throws on any
      // non-2xx, which used to skip both the local cleanup and the reload —
      // the merchant clicked ✕ and simply nothing happened. And the local
      // cleanup must run only AFTER the DELETE lands, or a failed remove
      // silently drops a staged count while the tracking row survives.
      var msg = document.getElementById("stockSaveMsg");
      try {
        await api("/admin/api/stock/items/" + encodeURIComponent(variantId), { method: "DELETE" });
      } catch (e) {
        msg.textContent = "Couldn't stop tracking that product — check your connection and try again.";
        return;
      }
      msg.textContent = "";
      clearRow(variantId);
      refreshSaveButton();
      loadStock();
    });
    return rm;
  }

  function refreshSaveButton() {
    var n = Object.keys(stockEdits).length;
    var btn = document.getElementById("stockSaveBtn");
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? "Save changes" : "Save changes (" + n + ")";
  }

  var stockLocationPrev = null; // the location select's value before its last change — used to revert if a discard is declined

  // Refreshes the tracked-product list from Shopify. Deliberately does NOT
  // touch stockEdits/stockOpen/stockPending — this function is called from
  // several places that are not "the merchant just finished a count"
  // (retrying a failed first load, adding or removing a tracked product,
  // reopening the tab) and none of those may silently discard a count the
  // merchant already confirmed or is mid-typing. The only places allowed to
  // clear staged state are the save handler (for exactly the ids it just
  // submitted) and the location-change handler (which warns first).
  //
  // Sets window.__stockLoaded itself on success, so every caller — the tab
  // switcher AND the in-row Retry link — benefits: a failed load leaves the
  // flag false and is retried on the next trigger instead of leaving the
  // tab permanently blank for the session.
  async function loadStock() {
    var body = document.getElementById("stockTableBody");
    try {
      var res = await api("/admin/api/stock");
      var data = await res.json();
      stockRows = data.rows; stockLocations = data.locations;

      var sel = document.getElementById("stockLocation");
      if (sel.options.length !== stockLocations.length) {
        sel.innerHTML = "";
        stockLocations.forEach(function (l) {
          var o = document.createElement("option"); o.value = l.id; o.textContent = l.name; sel.appendChild(o);
        });
      }
      document.getElementById("stockLocationWrap").style.display = stockLocations.length > 1 ? "" : "none";
      stockLocationPrev = sel.value;

      window.__stockLoaded = true;
      refreshSaveButton(); renderStockRows();
      return true;
    } catch (e) {
      document.getElementById("stockEmpty").style.display = "none";
      body.innerHTML = "";
      var tr = document.createElement("tr");
      var td = document.createElement("td"); td.colSpan = 5; td.className = "state";
      td.appendChild(document.createTextNode("Couldn't load stock. "));
      var retry = document.createElement("a"); retry.href = "#"; retry.textContent = "Retry";
      retry.addEventListener("click", function (ev) { ev.preventDefault(); loadStock(); });
      td.appendChild(retry);
      tr.appendChild(td); body.appendChild(tr);
      return false;
    }
  }

  document.getElementById("stockBulkBtn").addEventListener("click", function () {
    visibleRows().forEach(function (r) { if (!r.missing) stockOpen[r.variantId] = true; });
    renderStockRows();
    var first = document.querySelector("#stockTableBody input[data-variant]");
    if (first) { first.focus(); first.select(); }
  });

  document.getElementById("stockSort").addEventListener("change", renderStockRows);

  document.querySelectorAll(".stock-filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".stock-filters button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      stockFilter = b.dataset.filter;
      renderStockRows();
    });
  });

  // Changing location changes what "current stock" and compareQuantity mean
  // for every open or staged row. Carrying old edits across a location
  // switch would silently write one location's count against another
  // location's comparison — so switching always clears staged/open state,
  // with a warning first if that would throw away real work.
  document.getElementById("stockLocation").addEventListener("change", async function () {
    var sel = this;
    // Snapshot the previous location SYNCHRONOUSLY, before any await.
    // loadStock() is the other writer of stockLocationPrev, and a load in
    // flight while the modal is open (a ✕ remove or a tab switch can start
    // one) resolves with sel.value already at the NEW location and writes
    // that in. Reading the variable after the await would then "revert" to
    // the new location while keeping counts captured against the old one —
    // and a save would write location A's counts to location B with A's
    // compareQuantity, which Shopify accepts whenever B happens to hold the
    // same number (both 0 is routine for a product not stocked at B).
    var prev = stockLocationPrev;

    // Everything below is the merchant's work, and all of it is about to be
    // thrown away: confirmed counts (stockEdits) AND rows still open or
    // mid-typed (stockOpen/stockPending). Warning on stockEdits alone meant
    // twenty typed-but-unconfirmed numbers vanished with no modal at all.
    var confirmed = Object.keys(stockEdits);
    var editing = Object.keys(stockOpen).concat(Object.keys(stockPending))
      .filter(function (id, i, all) { return all.indexOf(id) === i && stockEdits[id] === undefined; });

    function rowTitle(id) {
      var row = stockRows.find(function (r) { return r.variantId === id; });
      return row ? row.title : id;
    }

    if (confirmed.length || editing.length) {
      var sections = [];
      if (confirmed.length) {
        sections.push({
          title: "Discard " + confirmed.length + " confirmed count" + (confirmed.length === 1 ? "" : "s") + " for this location",
          items: confirmed.map(function (id) { return rowTitle(id) + " — counted " + stockEdits[id].value; }),
          warn: true,
        });
      }
      if (editing.length) {
        sections.push({
          title: "Discard " + editing.length + " row" + (editing.length === 1 ? "" : "s") + " you were still editing — typed, never confirmed with ✓",
          items: editing.map(function (id) {
            var typed = stockPending[id];
            return rowTitle(id) + (typed !== undefined && typed !== "" ? " — typed " + typed + ", not confirmed" : " — open, nothing typed yet");
          }),
          warn: true,
        });
      }
      var ok = await window.confirmModal("Switch location?", sections, "Switch and discard");
      // Re-point stockLocationPrev at whatever the revert actually produced,
      // so a loadStock() that landed during the modal cannot leave the
      // variable describing a location the select is no longer showing.
      if (!ok) { sel.value = prev; stockLocationPrev = sel.value; return; }
    }
    stockLocationPrev = sel.value;
    clearAll();
    refreshSaveButton(); renderStockRows();
  });

  document.getElementById("stockSaveBtn").addEventListener("click", async function () {
    var ids = Object.keys(stockEdits);
    if (!ids.length) return;

    var changed = [], same = [];
    ids.forEach(function (id) {
      var row = stockRows.find(function (r) { return r.variantId === id; });
      var e = stockEdits[id];
      if (e.value === e.compareQuantity) same.push(row.title + " — " + e.value + " (unchanged)");
      else changed.push(row.title + " — stock " + e.compareQuantity + " → " + e.value);
    });

    var ok = await window.confirmModal(
      "Write these changes to Shopify?",
      [
        { title: changed.length + " change" + (changed.length === 1 ? "" : "s"), items: changed },
        { title: same.length + " counted with no change — re-checked against Shopify", items: same },
      ],
      "Write to Shopify"
    );
    if (!ok) return;

    var btn = this, msg = document.getElementById("stockSaveMsg");
    btn.disabled = true; msg.textContent = "Saving…";

    try {
      var res = await api("/admin/api/stock/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId: document.getElementById("stockLocation").value,
          rows: ids.map(function (id) {
            return { variantId: id, stock: { value: stockEdits[id].value, compareQuantity: stockEdits[id].compareQuantity }, counted: true };
          }),
        }),
      });
      var data = await res.json();
      var failed = data.results.filter(function (r) { return !r.ok; });

      // These ids were just submitted (whether they landed or not) — clear
      // exactly their staged/pending state before reloading. loadStock()
      // itself never touches stockEdits/stockOpen/stockPending, so any OTHER
      // row the merchant confirmed or was mid-typing during this request is
      // untouched by the reload below.
      ids.forEach(clearRow);

      await loadStock();
      failed.forEach(function (f) {
        var row = stockRows.find(function (r) { return r.variantId === f.variantId; });
        if (row) row._error = f.error;
      });
      renderStockRows();

      msg.textContent = failed.length
        ? failed.length + " of " + data.results.length + " failed"
        : "Saved " + data.results.length + " product" + (data.results.length === 1 ? "" : "s");
    } catch (e) {
      // Nothing here tells us how much of the batch landed before the
      // failure — the button must not be left disabled on "Saving…" with no
      // way to tell whether anything was written.
      msg.textContent = "Save failed — check your connection and try again.";
    }
    refreshSaveButton();
  });

  // Add-box — reuses the Import tab's product search endpoint.
  var stockSearchT;
  document.getElementById("stockAddSearch").addEventListener("input", function (e) {
    var q = e.target.value.trim();
    var box = document.getElementById("stockAddResults");
    clearTimeout(stockSearchT);
    if (q.length < 2) { box.classList.remove("open"); box.innerHTML = ""; return; }

    // A failed search or add must say so. Unguarded, api()'s throw left the
    // box populated and the product absent, with nothing on screen to say
    // the click had done anything at all.
    function stockAddError(text) {
      box.innerHTML = "";
      var m = document.createElement("div"); m.className = "state"; m.style.padding = "8px 10px";
      m.textContent = text;
      box.appendChild(m); box.classList.add("open");
    }

    stockSearchT = setTimeout(async function () {
      try {
        var res = await api("/admin/api/products/search?q=" + encodeURIComponent(q));
        var data = await res.json();
      } catch (err) {
        stockAddError("Couldn't search products — check your connection and try again.");
        return;
      }
      box.innerHTML = "";
      if (!data.variants.length) { box.classList.remove("open"); return; }

      data.variants.slice(0, 8).forEach(function (v) {
        var a = document.createElement("a"); a.href = "#";
        var meta = document.createElement("div");
        var t = document.createElement("div"); t.className = "pk-title"; t.textContent = v.title;
        var s = document.createElement("div"); s.className = "pk-sku"; s.textContent = v.sku ? "SKU " + v.sku : "No SKU";
        meta.appendChild(t); meta.appendChild(s); a.appendChild(meta);
        a.addEventListener("click", async function (ev) {
          ev.preventDefault();
          try {
            await api("/admin/api/stock/items", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ variantId: v.id, productId: v.productId }),
            });
          } catch (err) {
            stockAddError("Couldn't add that product — check your connection and try again.");
            return;
          }
          e.target.value = ""; box.classList.remove("open"); box.innerHTML = "";
          loadStock();
        });
        box.appendChild(a);
      });
      box.classList.add("open");
    }, 250);
  });
  `;
}
