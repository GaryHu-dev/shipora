// backend/src/routes/adminPage/historyTab.ts

export function historyTabMarkup(): string {
  return `
  <div id="tab-history" class="tab-pane">
  <div class="card">
    <h2>Stock history</h2>
    <p class="desc">Every change StockProof has made to your stock, newest first — weekly counts and delivery-note imports in one timeline. Nothing here is editable; it is the record of what was written and when.</p>
    <div class="stock-filters" id="histFilters">
      <button data-hist="all" class="active">All</button>
      <button data-hist="count">Counts</button>
      <button data-hist="import">Imports</button>
    </div>
    <ul class="rl" id="poHistoryList"></ul>
  </div>
  <div class="card" id="poHistoryDetailCard" style="display:none">
    <h2 id="poHistoryDetailTitle">Detail</h2>
    <p class="desc" id="poHistoryDetailWhen"></p>
    <button class="btn" id="poHistoryPdfLink" type="button"><span class="btn-ico">\u2913</span> Download original PDF</button>
    <div class="tbl-scroll">
    <table class="po-table" id="poHistoryDetailTable">
      <thead><tr><th>Product</th><th id="histQtyHead">Received</th><th>Stock before → after</th><th>Expiry</th><th>Result</th></tr></thead>
      <tbody id="poHistoryDetailBody"></tbody>
    </table>
    </div>
  </div>
  </div>`;
}

export function historyTabScript(): string {
  return `
  var histEvents = [], histFilter = "all";

  document.getElementById("tab-history-btn").addEventListener("click", loadPoHistory);
  document.getElementById("histFilters").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-hist]"); if (!b) return;
    histFilter = b.dataset.hist;
    document.querySelectorAll("#histFilters button").forEach(function (x) { x.classList.toggle("active", x === b); });
    renderHistList();
  });

  function histWhen(ts) {
    var d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function renderHistList() {
    var list = document.getElementById("poHistoryList");
    var rows = histEvents.filter(function (e) { return histFilter === "all" || e.kind === histFilter; });
    if (!rows.length) {
      list.innerHTML = '<div class="state">' + (histEvents.length
        ? "Nothing of this kind yet."
        : "Nothing yet. Counts and imports both appear here once you save one.") + "</div>";
      return;
    }
    list.innerHTML = "";
    rows.forEach(function (ev) {
      var li = document.createElement("li"); li.className = "rl-item";
      var main = document.createElement("div"); main.className = "rl-main";

      var name = document.createElement("span"); name.className = "rl-ord";
      // An import is identified by its document; a count by when it happened,
      // because that is how the merchant refers to it ("last Tuesday's count").
      name.textContent = ev.kind === "import" ? (ev.filename || "Delivery note") : "Stock count";
      var pill = document.createElement("span");
      pill.className = "pill " + (ev.kind === "import" ? "sku" : "map");
      pill.textContent = ev.kind === "import" ? "Import" : "Count";
      pill.style.marginLeft = "8px";
      name.appendChild(pill);

      var sub = document.createElement("span"); sub.className = "rl-cat";
      var bits = [histWhen(ev.created_at), ev.line_count + " product" + (ev.line_count === 1 ? "" : "s")];
      // Net movement is the one number that says what the event DID. An import
      // can only add; a count can go either way, so the sign carries meaning.
      if (ev.net_change !== null && ev.net_change !== 0) {
        bits.push((ev.net_change > 0 ? "+" : "") + ev.net_change + " units");
      }
      if (ev.skipped_count) bits.push(ev.skipped_count + " skipped");
      if (ev.error_count) bits.push(ev.error_count + " failed");
      sub.textContent = bits.join(" · ");

      main.appendChild(name); main.appendChild(sub);
      var view = document.createElement("a"); view.className = "rl-view"; view.href = "#"; view.textContent = "View";
      view.addEventListener("click", function (e) { e.preventDefault(); loadPoDetail(ev.id); });
      li.appendChild(main); li.appendChild(view);
      list.appendChild(li);
    });
  }

  async function loadPoHistory() {
    var list = document.getElementById("poHistoryList");
    list.innerHTML = '<div class="state">Loading…</div>';
    try {
      var res = await api("/admin/api/purchase-orders");
      var data = await res.json();
      histEvents = data.events || data.imports || [];
      renderHistList();
    } catch (e) {
      list.innerHTML = '<div class="state">Couldn\\'t load stock history — check your connection and try again.</div>';
    }
  }

  async function loadPoDetail(eventId) {
    var body = document.getElementById("poHistoryDetailBody");
    document.getElementById("poHistoryDetailCard").style.display = "";
    body.innerHTML = '<tr><td colspan="5" class="state">Loading…</td></tr>';
    try {
      var res = await api("/admin/api/purchase-orders/" + eventId);
      var data = await res.json();
    } catch (e) {
      body.innerHTML = '<tr><td colspan="5" class="state">Couldn\\'t load that record.</td></tr>';
      return;
    }
    var ev = data.event || data.import;
    var isImport = ev.kind === "import";

    document.getElementById("poHistoryDetailTitle").textContent =
      isImport ? (ev.filename || "Delivery note") : "Stock count";
    document.getElementById("poHistoryDetailWhen").textContent = histWhen(ev.created_at);
    // Columns that only mean something for a delivery note say so by name.
    document.getElementById("histQtyHead").textContent = isImport ? "Received" : "Counted";

    var pdfLink = document.getElementById("poHistoryPdfLink");
    pdfLink.style.display = isImport ? "" : "none"; // a count has no document
    pdfLink.onclick = async function (e) {
      e.preventDefault();
      if (pdfLink.disabled) return;
      // A PDF can take a moment to come back through the Worker. With no
      // feedback the merchant clicks again, and again — each one another
      // fetch. Say what is happening and refuse the repeat.
      var label = pdfLink.innerHTML;
      pdfLink.disabled = true;
      pdfLink.innerHTML = '<span class="spin"></span> Preparing…';
      try {
        var blob = await (await api("/admin/api/purchase-orders/" + eventId + "/pdf")).blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a"); a.href = url; a.download = ev.filename || "delivery.pdf"; a.click();
        URL.revokeObjectURL(url);
        pdfLink.innerHTML = label;
      } catch (err) {
        pdfLink.innerHTML = "Couldn't download \u2014 try again";
      }
      pdfLink.disabled = false;
    };

    body.innerHTML = "";
    data.lines.forEach(function (l) {
      var tr = document.createElement("tr");
      var moved = l.qty_before !== null && l.qty_after !== null;
      // The Shopify product leads, because "which product did this change" is
      // the question; the supplier's own wording is the supporting detail, and
      // is all there is when nothing matched.
      var primary = l.product_title || l.description;
      var secondary = l.product_title && l.product_title !== l.description ? l.description : "";
      var cells = [
        { two: true, top: primary, bottom: (secondary ? secondary + (l.material_code ? " · " : "") : "") + (l.material_code ? "code " + l.material_code : "") },
        isImport ? String(l.delivered_qty === null ? "—" : l.delivered_qty)
                 : (l.qty_after === null ? "—" : String(l.qty_after)),
        moved ? { move: true, before: l.qty_before, after: l.qty_after } : "—",
        l.sled || "—",
        // The reason matters more than the word "error": this table exists to
        // answer "why didn't that one go through".
        l.skipped ? "skipped" : (l.status === "ok" ? "ok" : (l.error || "failed")),
      ];
      cells.forEach(function (cell, i) {
        var td = document.createElement("td");
        if (cell && typeof cell === "object" && cell.move) {
          // The figure that is true NOW is the one being looked up; the one
          // before it is context. Colour says which is which without a label,
          // and its direction says whether the event added or removed.
          var b1 = document.createElement("span"); b1.className = "hist-before"; b1.textContent = String(cell.before);
          var ar = document.createElement("span"); ar.className = "hist-arrow"; ar.textContent = " \u2192 ";
          var a1 = document.createElement("span");
          a1.className = "hist-after" + (cell.after < cell.before ? " down" : "");
          a1.textContent = String(cell.after);
          td.appendChild(b1); td.appendChild(ar); td.appendChild(a1);
        } else if (cell && typeof cell === "object" && cell.two) {
          var t1 = document.createElement("div"); t1.className = "po-prod-title"; t1.textContent = cell.top;
          td.appendChild(t1);
          if (cell.bottom) {
            var t2 = document.createElement("div"); t2.className = "po-code"; t2.textContent = cell.bottom;
            td.appendChild(t2);
          }
        } else {
          td.textContent = cell;
          if (i === 4 && l.status === "error") td.className = "stock-row-err";
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }`;
}
