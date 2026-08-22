// backend/src/routes/adminPage/stockTab.ts
//
// Stage 1: stock is editable, BBD is displayed only.
//
// Rows are read-only until the merchant opens one. A weekly count means going
// down dozens of rows, and a table of always-live number inputs makes it far
// too easy to nudge a value without noticing.

export function stockTabMarkup(): string {
  return `
  <div id="tab-stock" class="tab-pane active">
  <div class="card">
    <h2>Stock</h2>
    <p class="desc">The products you track, with live stock from Shopify. Count weekly: open a row, enter what you counted, then save. Best Before Dates are read from each product's description (editing them comes later).</p>
    <div class="stock-toolbar">
      <div class="stock-add">
        <input type="text" id="stockAddSearch" placeholder="Search products to add…" autocomplete="off" />
        <div class="po-pick" id="stockAddResults"></div>
      </div>
      <span class="stock-loc-note" id="stockLocationWrap" style="display:none"></span>
      <button class="btn" id="stockImportBtn" type="button">Import delivery note</button>
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
    <div class="tbl-scroll">
    <table class="po-table" id="stockTable">
      <thead>
        <tr><th>Product</th><th>SKU</th><th>Stock</th><th>BBD</th><th>Last counted</th><th></th></tr>
      </thead>
      <tbody id="stockTableBody"></tbody>
    </table>
    </div>
    <p class="desc" id="stockEmpty" style="display:none">
      Nothing tracked yet. Search above to add a product, or confirm a purchase-order import — imported products are added here automatically.
    </p>
    <div class="po-confirm-row">
      <button class="btn" id="stockBulkBtn">Bulk edit</button>
      <button class="btn danger" id="stockCancelAllBtn" style="display:none">Cancel all</button>
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

      // A section is either a bullet list (items) or a table (head + rows).
      // Numbers are what these dialogs are about — "Anchor Butter — 12 → 9" as
      // a sentence makes the reader parse each line to find the two figures,
      // while a column of befores beside a column of afters can be scanned. It
      // also matches the review table the import screen already shows, so the
      // last thing seen before writing looks like the thing being confirmed.
      sections.forEach(function (sec) {
        var hasRows = sec.rows && sec.rows.length;
        var hasItems = sec.items && sec.items.length;
        if (!hasRows && !hasItems) return;
        var d = document.createElement("div"); d.className = "m-sec" + (sec.warn ? " warn" : "");
        var t = document.createElement("h4"); t.textContent = sec.title; d.appendChild(t);

        if (hasRows) {
          var wrap = document.createElement("div"); wrap.className = "m-tablewrap";
          var table = document.createElement("table"); table.className = "m-table";
          if (sec.head) {
            var thead = document.createElement("thead"); var htr = document.createElement("tr");
            sec.head.forEach(function (h2) { var th = document.createElement("th"); th.textContent = h2; htr.appendChild(th); });
            thead.appendChild(htr); table.appendChild(thead);
          }
          var tb = document.createElement("tbody");
          sec.rows.forEach(function (cells) {
            var tr = document.createElement("tr");
            cells.forEach(function (cell) {
              var td = document.createElement("td");
              if (cell && typeof cell === "object" && cell.product) {
                // The picture is what tells "Salted" from "Unsalted" at a
                // glance, and this dialog is the last look before writing.
                var w = document.createElement("div"); w.className = "m-prod";
                var th2;
                if (cell.img) { th2 = document.createElement("img"); th2.className = "m-thumb"; th2.src = cell.img; th2.alt = ""; th2.loading = "lazy"; }
                else { th2 = document.createElement("div"); th2.className = "m-thumb"; th2.textContent = "\u25A6"; }
                // Two destinations, because counting raises two kinds of
                // question. The picture is the thing you edit — tap it for the
                // admin. The name is the thing you sell — tap it for the page
                // a shopper sees.
                if (cell.adminHref) {
                  var thLink = document.createElement("a");
                  thLink.href = cell.adminHref; thLink.target = "_blank"; thLink.rel = "noopener noreferrer";
                  thLink.className = "m-thumblink"; thLink.title = "Open in the Shopify admin";
                  thLink.appendChild(th2); th2 = thLink;
                }
                var nameEl;
                if (cell.href) {
                  // The customer-facing page, not the admin: checking a
                  // product mid-count means seeing what the shopper sees.
                  nameEl = document.createElement("a");
                  nameEl.href = cell.href; nameEl.target = "_blank"; nameEl.rel = "noopener noreferrer";
                } else {
                  nameEl = document.createElement("span");
                  nameEl.title = "No storefront page for this product";
                }
                nameEl.className = "m-name"; nameEl.textContent = cell.text;
                w.appendChild(th2); w.appendChild(nameEl); td.appendChild(w);
              } else if (cell && typeof cell === "object") {
                td.textContent = cell.text; if (cell.cls) td.className = cell.cls;
              } else {
                td.textContent = cell === null || cell === undefined ? "" : String(cell);
              }
              tr.appendChild(td);
            });
            tb.appendChild(tr);
          });
          table.appendChild(tb); wrap.appendChild(table); d.appendChild(wrap);
        } else {
          var ul = document.createElement("ul");
          sec.items.forEach(function (item) {
            var li = document.createElement("li"); li.textContent = item; ul.appendChild(li);
          });
          d.appendChild(ul);
        }
        box.appendChild(d);
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

  // ---- blocking overlay ----------------------------------------------------
  // Shown while a write to Shopify is in flight. Disabling the button that
  // started it is not enough: every OTHER control stays live, so a merchant
  // can switch tabs, edit a row, or start a second write while the first is
  // still going — against an API where each of these is irreversible. The
  // overlay makes "wait" the only available action, and says what is happening
  // rather than just freezing.
  window.busyOverlay = function (text) {
    var back = document.createElement("div"); back.className = "busy-back";
    var boxEl = document.createElement("div"); boxEl.className = "busy-box";
    var sp = document.createElement("span"); sp.className = "spin";
    var label = document.createElement("span"); label.className = "busy-text"; label.textContent = text;
    boxEl.appendChild(sp); boxEl.appendChild(label);
    var note = document.createElement("div"); note.className = "busy-note";
    note.textContent = "Don't close this page.";
    boxEl.appendChild(note);
    back.appendChild(boxEl); document.body.appendChild(back);
    // Swallow keys too — Escape or Enter must not reach anything underneath.
    function eat(e) { e.stopPropagation(); e.preventDefault(); }
    document.addEventListener("keydown", eat, true);
    return {
      say: function (t) { label.textContent = t; },
      done: function () {
        document.removeEventListener("keydown", eat, true);
        if (back.parentNode) back.parentNode.removeChild(back);
      },
    };
  };

  // ---- Stock tab -----------------------------------------------------------
  var stockRows = [];        // server rows, as loaded
  var stockLocations = [];
  var stockLocationId = null;  // the selected location; see loadStock()
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

  var stockStoreHandle = "";

  // The Shopify admin page for a row's product. Needs the store handle, which
  // the stock list supplies from the verified session.
  function adminProductLink(row) {
    var pid = String((row && row.productId) || "").split("/").pop();
    if (!stockStoreHandle || !pid) return null;
    return "https://admin.shopify.com/store/" + stockStoreHandle + "/products/" + pid;
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
    var locId = stockLocationId;
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

    var caBtn = document.getElementById("stockCancelAllBtn");
    if (caBtn) caBtn.style.display = (Object.keys(stockOpen).length + Object.keys(stockEdits).length) ? "" : "none";

    rows.forEach(function (row) {
      var tr = document.createElement("tr");

      if (row.missing) {
        var td = document.createElement("td"); td.colSpan = 5; td.className = "stock-missing";
        td.textContent = "Deleted in Shopify — " + row.variantId;
        var actions = document.createElement("td");
        actions.appendChild(removeButton(row.variantId, "Deleted in Shopify — " + row.variantId));
        tr.appendChild(td); tr.appendChild(actions); body.appendChild(tr);
        return;
      }

      // Product — one line, clipped. SKU moved to its own column: it is a code
      // you scan down and compare against a delivery note, which stacking it
      // under each title made impossible.
      var prodCell = document.createElement("td"); prodCell.className = "stock-prod";
      var cellIn = document.createElement("div"); cellIn.className = "stock-prod-in";

      // The same thumbnail the picker has: these names differ by one word
      // ("Salted" against "Unsalted") and the picture is what separates them
      // at counting speed.
      var th;
      if (row.imageUrl) { th = document.createElement("img"); th.className = "stock-thumb"; th.src = row.imageUrl; th.alt = ""; th.loading = "lazy"; }
      else { th = document.createElement("div"); th.className = "stock-thumb"; th.textContent = "\u25A6"; }
      var adminHref = adminProductLink(row);
      if (adminHref) {
        var thWrap = document.createElement("a");
        thWrap.href = adminHref; thWrap.target = "_blank"; thWrap.rel = "noopener noreferrer";
        thWrap.className = "stock-thumblink"; thWrap.title = "Open in the Shopify admin";
        thWrap.appendChild(th); th = thWrap;
      }

      // Straight to the product in the Shopify admin. Counting turns up
      // questions this app deliberately cannot answer — the BBD in the
      // description, the price, whether it is even still published — and
      // without a link the merchant hunts for the product by name in another
      // tab. App Bridge resolves shopify://admin at the top frame, so this
      // escapes the embedded iframe rather than nesting the admin inside it.
      // Opens a NEW TAB, deliberately. Navigating this frame away would
      // discard every count staged but not yet saved — checking a product's
      // details mid-count must not cost the merchant the count.
      var title = document.createElement("a");
      title.className = "po-prod-title stock-prod-link";
      title.textContent = row.title;
      title.title = row.title; // the full name, for the ones that clip
      // The customer-facing page. Counting raises questions about the thing
      // being sold — is the photo right, does the description still say the
      // old Best Before Date — and those are answered by what a shopper sees.
      if (row.onlineStoreUrl) {
        title.href = row.onlineStoreUrl;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
      } else {
        title.title = row.title;
      }

      cellIn.appendChild(th); cellIn.appendChild(title);
      prodCell.appendChild(cellIn);

      var skuCell = document.createElement("td"); skuCell.className = "stock-sku";
      skuCell.textContent = row.sku || "\u2014";
      if (!row.sku) skuCell.title = "This product has no SKU in Shopify";

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
        minus.title = "One less"; minus.setAttribute("aria-label", "One less");
        var input = document.createElement("input"); input.type = "number"; input.min = "0";
        // Priority: what's mid-typed (stockPending) beats what's already
        // confirmed (stockEdits) beats the server figure. A re-render must
        // never regress an open box back to an earlier value.
        input.value = stockPending[row.variantId] !== undefined ? stockPending[row.variantId]
          : String(stockEdits[row.variantId] ? stockEdits[row.variantId].value : current);
        input.dataset.variant = row.variantId;
        var plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
        plus.title = "One more"; plus.setAttribute("aria-label", "One more");
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
        var confirmBtn = document.createElement("button"); confirmBtn.className = "btn primary"; confirmBtn.textContent = "Confirm";
        confirmBtn.title = "Confirm this count (or press Enter)";
        confirmBtn.addEventListener("click", function () { confirmThisRow(); });
        var cancelBtn = document.createElement("button"); cancelBtn.className = "btn danger"; cancelBtn.textContent = "Cancel";
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
      actCell.appendChild(removeButton(row.variantId, row.title));

      tr.appendChild(prodCell); tr.appendChild(skuCell); tr.appendChild(stockCell); tr.appendChild(bbdCell);
      tr.appendChild(whenCell); tr.appendChild(actCell);
      body.appendChild(tr);

      // Its own full-width row. It used to live inside the product cell, which
      // now clips to one line — a save failure ("Stock changed since loading")
      // would have been truncated to a few characters or hidden entirely, and
      // that message is the whole point of the staleness check.
      if (row._error) {
        var errTr = document.createElement("tr"); errTr.className = "stock-err";
        var errTd = document.createElement("td"); errTd.colSpan = 6; errTd.textContent = row._error;
        errTr.appendChild(errTd); body.appendChild(errTr);
      }
    });
  }

  function removeButton(variantId, title) {
    var rm = document.createElement("button"); rm.className = "btn danger"; rm.textContent = "Remove";
    rm.title = "Stop tracking this product (does not change Shopify stock)";
    rm.addEventListener("click", async function () {
      // ✕ sits next to Edit at the end of every row, which is exactly where a
      // mis-click lands. It is not recoverable from this screen: re-adding
      // means finding the product in search again, and any count staged for
      // the row goes with it. Every other write in this tab is confirmed —
      // this one was the exception.
      var staged = stockEdits[variantId];
      var lines = [title || variantId];
      if (staged) lines.push("A count of " + staged.value + " is staged for this row and will be discarded.");
      var ok = await window.confirmModal(
        "Stop tracking this product?",
        [{ title: "Removed from the Stock list — its stock in Shopify is not changed", items: lines }],
        "Stop tracking"
      );
      if (!ok) return;

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
    // Cancel all is offered only when there is something to cancel, so it
    // never sits there inviting a click that does nothing.
    var openish = Object.keys(stockOpen).length + Object.keys(stockEdits).length;
    var ca = document.getElementById("stockCancelAllBtn");
    if (ca) ca.style.display = openish ? "" : "none";
    var n = Object.keys(stockEdits).length;
    var btn = document.getElementById("stockSaveBtn");
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? "Save changes" : "Save changes (" + n + ")";
  }

  // Refreshes the tracked-product list from Shopify. Deliberately does NOT
  // touch stockEdits/stockOpen/stockPending — this function is called from
  // several places that are not "the merchant just finished a count"
  // (retrying a failed first load, adding or removing a tracked product,
  // reopening the tab) and none of those may silently discard a count the
  // merchant already confirmed or is mid-typing. The only places allowed to
  // clear staged state is the save handler, for exactly the ids it just
  // submitted.
  //
  // Sets window.__stockLoaded itself on success, so every caller — the tab
  // switcher AND the in-row Retry link — benefits: a failed load leaves the
  // flag false and is retried on the next trigger instead of leaving the
  // tab permanently blank for the session.
  // The table's own shape, drawn while the live read is in flight. This load
  // hits Shopify for every tracked product, so on a real list it is a visible
  // wait — and an empty table during it reads as "nothing tracked", which is
  // the same wrong conclusion the merchant drew from a failed load once
  // already. Rows are the height of real rows so nothing jumps when they
  // arrive.
  function stockSkeleton(n) {
    var body = document.getElementById("stockTableBody");
    document.getElementById("stockEmpty").style.display = "none";
    body.innerHTML = "";
    for (var i = 0; i < n; i++) {
      var tr = document.createElement("tr"); tr.className = "sk-tr";
      // Widths follow the real columns, and vary a little so the block does
      // not read as a loading GRID rather than a list of products.
      [[null, 60 + (i % 3) * 12], [null, 70], [null, 46], [null, 62], [null, 54], [null, 40]]
        .forEach(function (spec, c) {
          var td = document.createElement("td");
          var bar = document.createElement("div"); bar.className = "sk sk-bar";
          bar.style.width = spec[1] + "%";
          if (c === 0) {
            var wrap = document.createElement("div"); wrap.className = "stock-prod-in";
            var th = document.createElement("div"); th.className = "sk sk-thumb";
            wrap.appendChild(th); wrap.appendChild(bar); td.appendChild(wrap);
          } else td.appendChild(bar);
          tr.appendChild(td);
        });
      body.appendChild(tr);
    }
  }

  async function loadStock() {
    var body = document.getElementById("stockTableBody");
    // Only when there is nothing to show. A refresh after a save or an add
    // already has rows on screen, and replacing them with grey bars would be a
    // flash of "it's gone" every time.
    if (!stockRows.length) stockSkeleton(6);
    try {
      var res = await api("/admin/api/stock");
      var data = await res.json();
      stockRows = data.rows; stockLocations = data.locations;
      stockStoreHandle = data.storeHandle || stockStoreHandle;


      // No picker, by the owner's decision: this business has one warehouse,
      // and a control that only ever has one answer is noise on every screen.
      // Counts therefore go to the first location Shopify returns.
      //
      // What stays is a statement, not a question. With two or more locations
      // the merchant cannot otherwise tell where a count landed, and a number
      // written to the wrong warehouse looks perfectly right in both of them.
      // One location: nothing is shown at all.
      stockLocationId = stockLocations.length ? stockLocations[0].id : null;
      var note = document.getElementById("stockLocationWrap");
      note.style.display = stockLocations.length > 1 ? "" : "none";
      if (stockLocations.length > 1) {
        note.textContent = "Counting at " + stockLocations[0].name
          + (stockLocations[0].isDefault ? " (default)" : "");
        note.title = stockLocations.length + " locations exist; StockProof counts at the shop's default.";
      }

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

  // Bulk edit opens every visible row at once; without this the only ways out
  // were to close forty rows one at a time or to save counts nobody took.
  document.getElementById("stockCancelAllBtn").addEventListener("click", async function () {
    var confirmed = Object.keys(stockEdits);
    var typed = Object.keys(stockPending).filter(function (id) {
      return stockEdits[id] === undefined && stockPending[id] !== "" && stockPending[id] !== undefined;
    });

    // Closing empty rows costs nothing, so do not interrupt for it. Real work
    // — confirmed counts, or numbers typed but not yet confirmed — is worth a
    // question, and the dialog names what would be lost rather than saying
    // "are you sure".
    if (confirmed.length || typed.length) {
      var sections = [];
      if (confirmed.length) {
        sections.push({
          title: "Discard " + confirmed.length + " confirmed count" + (confirmed.length === 1 ? "" : "s"),
          head: ["Product", "Counted"],
          rows: confirmed.map(function (id) {
            var row = stockRows.find(function (r) { return r.variantId === id; });
            return [
              { product: true, text: row ? row.title : id, img: row && row.imageUrl,
                href: row && row.onlineStoreUrl, adminHref: row && adminProductLink(row) },
              String(stockEdits[id].value),
            ];
          }),
          warn: true,
        });
      }
      if (typed.length) {
        sections.push({
          title: "Discard " + typed.length + " row" + (typed.length === 1 ? "" : "s") + " you were still editing",
          head: ["Product", "Typed"],
          rows: typed.map(function (id) {
            var row = stockRows.find(function (r) { return r.variantId === id; });
            return [
              { product: true, text: row ? row.title : id, img: row && row.imageUrl,
                href: row && row.onlineStoreUrl, adminHref: row && adminProductLink(row) },
              String(stockPending[id]),
            ];
          }),
          warn: true,
        });
      }
      var ok = await window.confirmModal("Cancel all edits?", sections, "Discard them");
      if (!ok) return;
    }

    clearAll();
    refreshSaveButton();
    renderStockRows();
    document.getElementById("stockSaveMsg").textContent = "";
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

  document.getElementById("stockSaveBtn").addEventListener("click", async function () {
    var saveMsgEl = document.getElementById("stockSaveMsg");
    var ids = Object.keys(stockEdits);
    if (!ids.length) {
      // Enabled but with nothing staged should be impossible — refreshSaveButton
      // drives both from the same object. Say so rather than doing nothing,
      // because "nothing happens" is the one outcome that cannot be diagnosed.
      saveMsgEl.textContent = "Nothing to save — open a row, enter the count, then press Confirm.";
      return;
    }
    saveMsgEl.textContent = "";
    try {

    // Same shape as the import review table, deliberately: both screens are
    // "here is every line about to be written, check it".
    var changed = [], same = [], net = 0;
    ids.forEach(function (id) {
      var row = stockRows.find(function (r) { return r.variantId === id; });
      var e = stockEdits[id];
      var title = row ? row.title : id;
      var sku = row && row.sku ? row.sku : "\u2014";
      var prod = {
        product: true, text: title,
        img: row && row.imageUrl,
        href: row && row.onlineStoreUrl,        // name  -> what the customer sees
        adminHref: row && adminProductLink(row), // thumb -> where you change it
      };
      if (e.value === e.compareQuantity) {
        same.push([prod, sku, String(e.value)]);
      } else {
        var d = e.value - e.compareQuantity;
        net += d;
        changed.push([
          prod, sku, String(e.compareQuantity), String(e.value),
          { text: (d > 0 ? "+" : "") + d, cls: d > 0 ? "m-up" : "m-down" },
        ]);
      }
    });

    var ok = await window.confirmModal(
      "Write these changes to Shopify?",
      [
        {
          title: changed.length + " change" + (changed.length === 1 ? "" : "s")
            + (net !== 0 ? "  \u00b7  net " + (net > 0 ? "+" : "") + net + " units" : ""),
          head: ["Product", "SKU", "Now", "Counted", "Change"],
          rows: changed,
        },
        {
          // Not padding: these rows are about to be written to Shopify too,
          // and each one re-checks that stock has not moved since loading.
          title: same.length + " counted with no change \u2014 re-checked against Shopify",
          head: ["Product", "SKU", "Counted"],
          rows: same,
        },
      ],
      "Write to Shopify"
    );
    if (!ok) return;

    var btn = this, msg = document.getElementById("stockSaveMsg");
    btn.disabled = true; msg.textContent = "";
    var busy = window.busyOverlay("Writing " + ids.length + " change" + (ids.length === 1 ? "" : "s") + " to Shopify…");

    try {
      var res = await api("/admin/api/stock/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId: stockLocationId,
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
    } finally {
      // In a finally, not on each path: a write that threw halfway must still
      // give the page back, or the merchant is left staring at a spinner with
      // no way to find out what happened.
      busy.done();
    }
    refreshSaveButton();
    } catch (fatal) {
      // Anything thrown BEFORE the request — building the preview, opening the
      // dialog — used to reject silently and leave the button looking dead.
      saveMsgEl.textContent = "Couldn't open the confirmation: " + (fatal && fatal.message ? fatal.message : fatal);
      if (window.__showFatal) window.__showFatal("Save changes", fatal);
      refreshSaveButton();
    }
  });

  // Add-box — reuses the Import tab's product search endpoint.
  // Products added during this run of the picker. loadStock() is what makes
  // them appear in stockRows, and it is deliberately debounced below, so for a
  // moment the picker knows about an addition the table does not.
  var stockAdded = {};
  function stockTracked(variantId) {
    if (stockAdded[variantId]) return true;
    return stockRows.some(function (r) { return r.variantId === variantId && !r.missing; });
  }
  function markAdded(a) {
    a.classList.add("pk-added");
    var tag = document.createElement("div"); tag.className = "pk-added-tag"; tag.textContent = "Added";
    a.appendChild(tag);
  }
  // Adding five products in a row should cost one table reload, not five —
  // each one is a full live read of every tracked product from Shopify.
  var stockAddRefreshT;
  function refreshAfterAdds() {
    clearTimeout(stockAddRefreshT);
    stockAddRefreshT = setTimeout(loadStock, 500);
  }

  var stockRun = window.searchRunner();
  // The list no longer closes itself on a click, so give it an explicit way
  // out that does not require reaching for the mouse.
  document.getElementById("stockAddSearch").addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var box = document.getElementById("stockAddResults");
    stockRun.cancel(); box.classList.remove("open"); box.innerHTML = "";
    e.target.value = "";
  });

  document.getElementById("stockAddSearch").addEventListener("input", function (e) {
    var q = e.target.value.trim();
    var box = document.getElementById("stockAddResults");
    if (q.length < 2) { stockRun.cancel(); box.classList.remove("open"); box.innerHTML = ""; return; }
    // A fresh query starts a fresh pass; what was added under the old one
    // stays true, so stockAdded is not cleared here.

    // A failed search or add must say so. Unguarded, api()'s throw left the
    // box populated and the product absent, with nothing on screen to say
    // the click had done anything at all.
    function stockAddError(text) {
      box.innerHTML = "";
      var m = document.createElement("div"); m.className = "state"; m.style.padding = "8px 10px";
      m.textContent = text;
      box.appendChild(m); box.classList.add("open");
    }

      // The search can take a couple of seconds: when nothing matches a SKU
      // prefix the backend falls through to scanning the catalogue. Leaving
      // the box blank meanwhile reads as broken — the same failure as closing
      // it silently, just on a timer.
      box.innerHTML = "";
      var busy = document.createElement("div");
      busy.className = "state"; busy.style.padding = "8px 10px";
      busy.textContent = "Searching\u2026";
      box.appendChild(busy); box.classList.add("open");

    stockRun(400, async function (signal) {
      try {
        var res = await api("/admin/api/products/search?stock=1&q=" + encodeURIComponent(q)
          + (stockLocationId ? "&locationId=" + encodeURIComponent(stockLocationId) : ""),
          { signal: signal });
        var data = await res.json();
      } catch (err) {
        if (window.isAbort(err)) return;
        stockAddError("Couldn't search products — check your connection and try again.");
        return;
      }
      if (signal.aborted) return; // superseded by a later keystroke
      box.innerHTML = "";
      if (!data.variants.length) {
          // Say so. Silently closing the list is indistinguishable from the
          // search being broken, which is exactly how it was read.
          box.innerHTML = "";
          var none = document.createElement("div");
          none.className = "state"; none.style.padding = "8px 10px";
          none.textContent = "No product matches \u201c" + q + "\u201d \u2014 checked titles and SKUs.";
          box.appendChild(none); box.classList.add("open");
          return;
        }

      data.variants.slice(0, 8).forEach(function (v) {
        var a = document.createElement("a"); a.href = "#";
        // Thumbnail, as the import picker has had all along. Titles here are
        // long and near-identical — "Anchor Butter Salted 24X454G" against
        // "Anchor Butter Unsalted 24X454G" — and the picture is what tells
        // them apart at a glance. This list was the one that went without.
        var th;
        if (v.imageUrl) { th = document.createElement("img"); th.className = "pk-thumb"; th.src = v.imageUrl; th.alt = ""; }
        else { th = document.createElement("div"); th.className = "pk-thumb"; th.textContent = "\u25A6"; }
        var meta = document.createElement("div");
        var t = document.createElement("div"); t.className = "pk-title"; t.textContent = v.title;
        var s = document.createElement("div"); s.className = "pk-sku"; s.textContent = v.sku ? "SKU " + v.sku : "No SKU";
        meta.appendChild(t); meta.appendChild(s); a.appendChild(th); a.appendChild(meta);

        // What you already hold, and how fresh it is. Choosing what to track
        // is a judgement about stock — eight near-identical names alone do not
        // support it. Absent when the annotation lookup failed; the row still
        // works, it just says less.
        if (v.available !== undefined || v.bbd) {
          var side = document.createElement("div"); side.className = "pk-side";
          var qty = document.createElement("div"); qty.className = "pk-qty";
          qty.textContent = v.available === null || v.available === undefined ? "\u2014" : v.available + " in stock";
          var bb = document.createElement("div"); bb.className = "pk-bbd";
          bb.textContent = bbdText(v.bbd);
          side.appendChild(qty); side.appendChild(bb); a.appendChild(side);
        }
        // Already on the list — from an earlier click just now, or from a
        // previous session. Offering it again invites a click that does
        // nothing visible (the add is a no-op server-side), so say so instead.
        if (stockTracked(v.id)) { markAdded(a); }
        else {
          a.addEventListener("click", async function (ev) {
            ev.preventDefault();
            if (a.classList.contains("pk-added")) return;
            try {
              await api("/admin/api/stock/items", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ variantId: v.id }),
              });
            } catch (err) {
              stockAddError("Couldn't add that product — check your connection and try again.");
              return;
            }
            // The list stays open and the query stays in the box. One search
            // ("anchor", "3110") is normally the source of several products,
            // and closing after the first made the merchant retype it every
            // time. The row marks itself instead, so what has been added this
            // pass is visible without looking at the table.
            stockAdded[v.id] = true;
            markAdded(a);
            refreshAfterAdds();
          });
        }
        box.appendChild(a);
      });
      box.classList.add("open");
    });
  });
  `;
}
