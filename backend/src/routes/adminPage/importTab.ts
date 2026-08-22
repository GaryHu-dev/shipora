// backend/src/routes/adminPage/importTab.ts

export function importTabMarkup(): string {
  return `
  <div id="tab-import" class="tab-pane">
  <!-- Reached from the Stock tab rather than from the tab bar, so it needs its
       own way back: a tab pane normally has one because a tab button is always
       visible, and this one no longer does. -->
  <button class="btn back-to-stock" id="importBackBtn" type="button">← Back to stock</button>
  <div class="card">
    <h2>Import a delivery note</h2>
    <p class="desc">Upload a Fonterra delivery-docket PDF. Review the recognised lines, then confirm to add the delivered quantities to Shopify stock. (Expiry dates are shown from the delivery note but not written back for now.)</p>
    <label class="po-drop" id="poDrop">
      <input type="file" id="poFile" accept="application/pdf" />
      <div id="poDropIdle">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
        <div class="big">Drop your delivery-note PDF here, or click to browse</div>
        <div class="small">Fonterra delivery docket · PDF up to 10 MB</div>
      </div>
      <div class="po-file" id="poDropChosen" style="display:none">
        <span class="doc">📄</span>
        <span><span class="nm" id="poFileName"></span> <span class="sz" id="poFileSize"></span></span>
      </div>
    </label>
    <div class="po-actions">
      <button class="btn primary" id="poParseBtn">Parse PDF</button>
      <span class="msg" id="poParseMsg"></span>
    </div>
  </div>
  <div class="card" id="poReviewCard" style="display:none">
    <h2>Review before confirming</h2>
    <div class="po-loading" id="poLoading"><span class="spin"></span> Reading the PDF and matching products…</div>
    <div id="poReviewBody" style="display:none">
      <div class="stock-loc-note" id="poLocationRow" style="display:none"></div>
      <div class="tbl-scroll">
      <table class="po-table" id="poTable">
        <thead>
          <tr><th>#</th><th>Product</th><th>Received</th><th>Expiry (BBD)</th><th>Stock</th><th>Skip</th></tr>
        </thead>
        <tbody id="poTableBody"></tbody>
      </table>
      </div>
      <div class="po-confirm-row">
        <button class="btn primary" id="poConfirmBtn">Confirm sync</button>
        <span class="msg" id="poConfirmMsg"></span>
      </div>
    </div>
  </div>
  <!-- Sits with the import flow because it is a matching setting, not stock:
       these codes decide which product a delivery-note line lands on. It is
       also the only way to pre-load the pairings before the first import, so
       the first one does not have to be picked entirely by hand. -->
  <div class="card" id="mapCard">
    <h2>Remembered material codes</h2>
    <p class="desc">When you pick a product by hand during an import, that pairing is remembered and applied automatically next time — ahead of any guess. Corrections and new pairings go here.</p>
    <div class="map-add">
      <input class="map-code" id="mapCodeInput" type="text" placeholder="Material code, e.g. 122352" />
      <div class="stock-add map-prod">
        <input type="text" id="mapProdSearch" placeholder="Search the product it should match…" autocomplete="off" />
        <div class="po-pick" id="mapProdResults"></div>
      </div>
      <button class="btn primary" id="mapAddBtn" type="button" disabled>Remember</button>
    </div>
    <div id="mapChosen" class="map-chosen" style="display:none"></div>
    <div id="mapList" class="map-list"></div>
  </div>

  <div class="card" id="poResultCard" style="display:none">
    <h2>Result</h2>
    <ul class="po-res" id="poResultList"></ul>
  </div>
  </div>`;
}

export function importTabScript(): string {
  return `
  // Purchase-order import
  var poParsed = null; // last /parse response

  // Dropzone: show the chosen filename and give drag feedback.
  var poDrop = document.getElementById("poDrop");
  document.getElementById("poFile").addEventListener("change", function () {
    var f = this.files[0];
    var idle = document.getElementById("poDropIdle"), chosen = document.getElementById("poDropChosen");
    if (f) {
      document.getElementById("poFileName").textContent = f.name;
      document.getElementById("poFileSize").textContent = "· " + (f.size / 1048576).toFixed(1) + " MB";
      idle.style.display = "none"; chosen.style.display = "";
    } else { idle.style.display = ""; chosen.style.display = "none"; }
    document.getElementById("poParseMsg").textContent = "";
  });
  ["dragenter", "dragover"].forEach(function (ev) { poDrop.addEventListener(ev, function (e) { e.preventDefault(); poDrop.classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (ev) { poDrop.addEventListener(ev, function () { poDrop.classList.remove("drag"); }); });

  document.getElementById("poParseBtn").addEventListener("click", async function () {
    var fileInput = document.getElementById("poFile");
    var msg = document.getElementById("poParseMsg");
    var btn = this;
    if (!fileInput.files.length) { msg.textContent = "Choose a PDF first"; return; }
    msg.textContent = "";
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Parsing…';
    document.getElementById("poResultCard").style.display = "none";
    document.getElementById("poReviewCard").style.display = "";
    document.getElementById("poLoading").style.display = "";
    document.getElementById("poReviewBody").style.display = "none";
    var fd = new FormData();
    fd.append("pdf", fileInput.files[0]);
    try {
      var res = await api("/admin/api/purchase-orders/parse", { method: "POST", body: fd });
      poParsed = await res.json();
      renderPoReview();
    } catch (e) {
      document.getElementById("poReviewCard").style.display = "none";
      msg.textContent = "Couldn't read that PDF — check it's a Fonterra delivery docket.";
    }
    btn.disabled = false; btn.textContent = "Parse PDF";
  });

  var poLocationId = null; // the shop's only location; see renderPoReview()

  function renderPoReview() {
    document.getElementById("poLoading").style.display = "none";
    document.getElementById("poReviewBody").style.display = "";
    // No picker — see the same decision in stockTab.ts. Delivered quantities
    // are added at the first location Shopify returns; with more than one, say
    // which, because stock added to the wrong warehouse is a number that reads
    // as correct in both.
    poLocationId = poParsed.locations.length ? poParsed.locations[0].id : null;
    var note = document.getElementById("poLocationRow");
    note.style.display = poParsed.locations.length > 1 ? "" : "none";
    if (poParsed.locations.length > 1) {
      note.textContent = "Receiving at " + poParsed.locations[0].name
        + (poParsed.locations[0].isDefault ? " (default)" : "");
    }
    renderPoRows();
  }

  function currentStock(match) {
    var locId = poLocationId;
    var entry = (match && match.stockByLocation || []).find(function (s) { return s.locationId === locId; });
    return entry ? entry.available : 0;
  }

  // A manually picked match carries no stockByLocation — nothing was fetched
  // for it — so currentStock() falls back to 0, which is a guess, not a fact.
  // The confirmation modal must not print that guess as a before-figure.
  function stockIsKnown(match) {
    var locId = poLocationId;
    if (!match) return false;
    if (match.matchSource !== "manual") return true;
    return (match.stockByLocation || []).some(function (s) { return s.locationId === locId; });
  }

  var PILL = {
    sku: ["sku", "Matched by SKU"], mapping: ["map", "Matched (saved)"],
    manual: ["manual", "Selected"], fuzzy: ["fuzzy", "Best guess — check"],
  };

  function adminProductUrl(productId) {
    var num = String(productId || "").split("/").pop();
    return "https://" + poParsed.shopDomain + "/admin/products/" + num;
  }
  function makeThumb(url) {
    if (url) { var img = document.createElement("img"); img.className = "po-thumb"; img.src = url; img.alt = ""; return img; }
    var ph = document.createElement("div"); ph.className = "po-thumb ph"; ph.textContent = "▦"; return ph;
  }

  function renderPoRows() {
    var body = document.getElementById("poTableBody");
    body.innerHTML = "";
    poParsed.lines.forEach(function (line, i) {
      var tr = document.createElement("tr");
      tr.classList.toggle("skip", !!line._skip);

      // # index
      var idxCell = document.createElement("td"); idxCell.className = "po-idx"; idxCell.textContent = String(i + 1);

      // Product cell: thumbnail + matched product (clickable) or product picker.
      var productCell = document.createElement("td");
      var prod = document.createElement("div"); prod.className = "po-prod";
      var thumb = makeThumb(line.match && line.match.imageUrl);
      // Clickable thumbnail → the product's Shopify admin page (matched rows only).
      var thumbNode = thumb;
      if (line.match) {
        var ta = document.createElement("a"); ta.className = "po-thumb-link";
        ta.href = adminProductUrl(line.match.productId); ta.target = "_blank"; ta.rel = "noopener";
        ta.appendChild(thumb); thumbNode = ta;
      }
      var txt = document.createElement("div"); txt.className = "txt";
      // Search box + floating results, wrapped so the dropdown overlays (doesn't
      // push the row). Revealed for matched rows via "Change"; shown when unmatched.
      var search = document.createElement("div"); search.className = "po-search";
      var picker = document.createElement("input");
      picker.type = "text"; picker.placeholder = "Search products…"; picker.dataset.idx = String(i);
      picker.addEventListener("input", onProductSearch);
      var results = document.createElement("div"); results.className = "po-pick"; results.id = "poPick" + i;
      search.appendChild(picker); search.appendChild(results);

      if (line.match) {
        var title = document.createElement("div"); title.className = "po-prod-title";
        var a = document.createElement("a"); a.textContent = line.match.productTitle;
        a.href = adminProductUrl(line.match.productId); a.target = "_blank"; a.rel = "noopener";
        title.appendChild(a);
        var code = document.createElement("div"); code.className = "po-code";
        code.textContent = (line.match.sku ? "SKU " + line.match.sku + " · " : "") + "code " + line.materialCode;
        var p = PILL[line.match.matchSource] || PILL.fuzzy;
        var pill = document.createElement("span"); pill.className = "pill " + p[0]; pill.textContent = p[1];
        var change = document.createElement("span"); change.className = "po-change"; change.textContent = "Change product";
        change.addEventListener("click", function () {
          var show = search.style.display === "none";
          search.style.display = show ? "" : "none";
          change.textContent = show ? "Cancel" : "Change product";
          if (show) picker.focus();
        });
        search.style.display = "none";
        txt.appendChild(title); txt.appendChild(code); txt.appendChild(pill);
        txt.appendChild(document.createElement("br")); txt.appendChild(change);
        txt.appendChild(search);
      } else {
        var code2 = document.createElement("div"); code2.className = "po-code";
        code2.textContent = line.description + " · code " + line.materialCode;
        var pillN = document.createElement("span"); pillN.className = "pill none"; pillN.textContent = "Choose a product";
        txt.appendChild(code2); txt.appendChild(pillN); txt.appendChild(search);
      }
      prod.appendChild(thumbNode); prod.appendChild(txt); productCell.appendChild(prod);

      // Stock before → after (recomputed live as qty changes)
      var stockCell = document.createElement("td"); stockCell.className = "po-stock";
      function paint() {
        stockCell.innerHTML = "";
        // "+5" is dropped: the Received column beside this one already says 5,
        // and "0→5+5" was three numbers with no space between them.
        if (!line.match) { stockCell.textContent = "—"; return; }
        if (!stockIsKnown(line.match)) {
          // Printing a 0 we do not have is worse than admitting we lack it:
          // this column is what the merchant checks the delivery against.
          var unk = document.createElement("span"); unk.className = "po-unknown";
          unk.textContent = "? \u2192 +" + line.deliveredQty;
          unk.title = "Current stock could not be read for this product";
          stockCell.appendChild(unk);
          return;
        }
        var b = currentStock(line.match), a = b + line.deliveredQty;
        var bs = document.createElement("span"); bs.textContent = String(b);
        var to = document.createElement("span"); to.className = "to"; to.textContent = "\u2192";
        var as = document.createElement("span"); as.className = "aft"; as.textContent = String(a);
        stockCell.appendChild(bs); stockCell.appendChild(to); stockCell.appendChild(as);
      }

      // Received qty
      var qtyCell = document.createElement("td");
      var qtyInput = document.createElement("input"); qtyInput.type = "number"; qtyInput.min = "0"; qtyInput.value = String(line.deliveredQty);
      qtyInput.addEventListener("input", function () { line.deliveredQty = parseInt(qtyInput.value, 10) || 0; paint(); });
      qtyCell.appendChild(qtyInput);

      // Expiry (BBD) — read-only. Nothing writes it back, and an input the
      // merchant can type into but which changes nothing is worse than plain text.
      var expiryCell = document.createElement("td");
      var expiryText = document.createElement("div");
      expiryText.textContent = line.sled || "—";
      expiryCell.appendChild(expiryText);
      // Only the genuinely useful half: what Shopify holds today, so the
      // merchant can see the delivery is fresher. "not written" was repeated
      // on all 16 rows while the page header already says it once.
      if (line.match && line.match.currentBbd && line.match.currentBbd.kind === "parsed") {
        var expiryHint = document.createElement("div"); expiryHint.className = "po-code";
        expiryHint.textContent = "now " + line.match.currentBbd.text;
        expiryCell.appendChild(expiryHint);
      }

      // Skip
      var skipCell = document.createElement("td"); skipCell.className = "po-skip";
      var skipBox = document.createElement("input"); skipBox.type = "checkbox"; skipBox.checked = !!line._skip;
      skipBox.addEventListener("change", function () { line._skip = skipBox.checked; tr.classList.toggle("skip", skipBox.checked); });
      skipCell.appendChild(skipBox);

      paint();
      tr.appendChild(idxCell); tr.appendChild(productCell); tr.appendChild(qtyCell); tr.appendChild(expiryCell); tr.appendChild(stockCell); tr.appendChild(skipCell);
      body.appendChild(tr);
    });
  }

  var poRun = window.searchRunner();
  async function onProductSearch(e) {
    var idx = Number(e.target.dataset.idx);
    var q = e.target.value.trim();
    var box = document.getElementById("poPick" + idx);
    if (q.length < 2) { poRun.cancel(); box.classList.remove("open"); box.innerHTML = ""; return; }

    // Every row shares one runner, so starting a search here aborts whatever
    // another row had in flight. That row's list would otherwise sit open on
    // "Searching…" for the rest of the session — a spinner that can never
    // finish, beside a second list that can. Close the others first.
    document.querySelectorAll("#poTableBody .po-pick.open").forEach(function (other) {
      if (other !== box) { other.classList.remove("open"); other.innerHTML = ""; }
    });

    // The search can take a couple of seconds: when nothing matches a SKU
    // prefix the backend falls through to scanning the catalogue. Leaving the
    // box blank meanwhile reads as broken — the same failure as closing it
    // silently, just on a timer.
    box.innerHTML = "";
    var busy = document.createElement("div");
    busy.className = "state"; busy.style.padding = "8px 10px";
    busy.textContent = "Searching\u2026";
    box.appendChild(busy); box.classList.add("open");

    poRun(400, async function (signal) {
      try {
        // Ask for stock and BBD too. Without them a hand-picked line carried
        // stockByLocation:[] and the confirmation modal could only say
        // "current stock unknown" — about a product whose stock the search had
        // fetched one screen earlier.
        var res = await api("/admin/api/products/search?stock=1&q=" + encodeURIComponent(q)
          + (poLocationId ? "&locationId=" + encodeURIComponent(poLocationId) : ""),
          { signal: signal });
        var data = await res.json();
        if (signal.aborted) return; // superseded by a later keystroke
        box.innerHTML = "";
        if (!data.variants.length) {
          box.innerHTML = "";
          var none = document.createElement("div");
          none.className = "state"; none.style.padding = "8px 10px";
          none.textContent = "No product matches that \u2014 checked titles and SKUs.";
          box.appendChild(none); box.classList.add("open");
          return;
        }
        data.variants.slice(0, 8).forEach(function (v) {
          var a = document.createElement("a"); a.href = "#";
          var th;
          if (v.imageUrl) { th = document.createElement("img"); th.className = "pk-thumb"; th.src = v.imageUrl; th.alt = ""; }
          else { th = document.createElement("div"); th.className = "pk-thumb"; th.textContent = "▦"; }
          var meta = document.createElement("div");
          var t = document.createElement("div"); t.className = "pk-title"; t.textContent = v.title;
          var s = document.createElement("div"); s.className = "pk-sku"; s.textContent = v.sku ? "SKU " + v.sku : "No SKU";
          meta.appendChild(t); meta.appendChild(s);
          a.appendChild(th); a.appendChild(meta);
          a.addEventListener("click", function (ev) {
            ev.preventDefault();
            poParsed.lines[idx].match = {
              variantId: v.id, inventoryItemId: null, productTitle: v.title,
              productId: v.productId, imageUrl: v.imageUrl, sku: v.sku,
              matchSource: "manual",
              onlineStoreUrl: v.onlineStoreUrl || null,
              currentBbd: v.bbd || { kind: "absent" },
              stockByLocation: (v.available === null || v.available === undefined)
                ? [] : [{ locationId: poLocationId, available: v.available }],
            };
            renderPoRows();
          });
          box.appendChild(a);
        });
        box.classList.add("open");
      } catch (err) {
        if (window.isAbort(err)) return;
        box.innerHTML = "";
        var perr = document.createElement("div");
        perr.className = "state"; perr.style.padding = "8px 10px";
        perr.textContent = "Couldn't search \u2014 check your connection and try again.";
        box.appendChild(perr); box.classList.add("open");
      }
    });
  }

  document.getElementById("poConfirmBtn").addEventListener("click", async function () {
    var msg = document.getElementById("poConfirmMsg");
    var btn = this;

    var skipped = [], adding = [], net = 0;
    poParsed.lines.forEach(function (l) {
      if (l._skip || !l.match) {
        skipped.push([
          l.description, l.materialCode, String(l.deliveredQty),
          l.match ? "skipped by you" : "no product matched",
        ]);
      } else if (!stockIsKnown(l.match)) {
        // Say what we actually know. "0 → 5" for a product that in fact holds
        // 8 is a number this modal exists to be trusted on.
        net += l.deliveredQty;
        adding.push([
          { product: true, text: l.match.productTitle, img: l.match.imageUrl,
            href: l.match.onlineStoreUrl, adminHref: adminProductUrl(l.match.productId) },
          l.match.sku || "\u2014",
          { text: "?", cls: "m-unknown" }, { text: "?", cls: "m-unknown" },
          { text: "+" + l.deliveredQty, cls: "m-up" },
        ]);
      } else {
        var before = currentStock(l.match);
        net += l.deliveredQty;
        adding.push([
          { product: true, text: l.match.productTitle, img: l.match.imageUrl,
            href: l.match.onlineStoreUrl, adminHref: adminProductUrl(l.match.productId) },
          l.match.sku || "\u2014",
          String(before), String(before + l.deliveredQty),
          { text: "+" + l.deliveredQty, cls: "m-up" },
        ]);
      }
    });

    var ok = await window.confirmModal(
      "Write this delivery to Shopify?",
      [
        // Skipped lines lead, deliberately: today they are dropped silently, so
        // stock that physically arrived never reaches Shopify and the merchant
        // finds out weeks later as an unexplained shortfall — if ever.
        {
          title: skipped.length + " line" + (skipped.length === 1 ? "" : "s") +
            " will be skipped \u2014 no stock will be added",
          head: ["Line", "Code", "Units", "Why"],
          rows: skipped, warn: true,
        },
        {
          title: adding.length + " line" + (adding.length === 1 ? "" : "s") + " will add stock"
            + (net ? "  \u00b7  net +" + net + " units" : ""),
          head: ["Product", "SKU", "Now", "After", "Change"],
          rows: adding,
        },
        { title: "Best Before Dates", items: ["Previewed only \u2014 not written to Shopify"] },
      ],
      "Write to Shopify"
    );
    if (!ok) {
      // Back to review with the unmatched rows' pickers already open, so
      // fixing a missed match is one search away.
      poParsed.lines.forEach(function (l, i) {
        if (!l.match) { var s = document.getElementById("poPick" + i); if (s) s.classList.add("open"); }
      });
      return;
    }

    btn.disabled = true; msg.textContent = "";
    var busy = window.busyOverlay("Adding " + adding.length + " line" + (adding.length === 1 ? "" : "s") + " to Shopify stock…");
    var fd = new FormData();
    fd.append("pdf", document.getElementById("poFile").files[0]);
    fd.append("locationId", poLocationId);
    var payload = poParsed.lines.map(function (l) {
      return {
        materialCode: l.materialCode, description: l.description, deliveredQty: l.deliveredQty, sled: l.sled,
        variantId: l.match ? l.match.variantId : null,
        // So history can say which product this line changed, rather than only
        // the supplier's own wording for it.
        productTitle: l.match ? l.match.productTitle : null,
        matchSource: l.match ? l.match.matchSource : null,
        skip: !!l._skip || !l.match,
      };
    });
    fd.append("lines", JSON.stringify(payload));
    try {
      var res = await api("/admin/api/purchase-orders/confirm", { method: "POST", body: fd });
      var result = await res.json();
      var list = document.getElementById("poResultList"); list.innerHTML = "";
      result.lines.forEach(function (l) {
        var cls = l.status === "ok" ? "ok" : l.status === "skipped" ? "skip" : "err";
        var li = document.createElement("li"); li.className = cls;
        var dot = document.createElement("span"); dot.className = "dot";
        var name = document.createElement("span"); name.textContent = "Code " + l.materialCode;
        li.appendChild(dot); li.appendChild(name);
        if (l.error) { var er = document.createElement("span"); er.className = "er"; er.textContent = l.error; li.appendChild(er); }
        var st = document.createElement("span"); st.className = "st"; st.textContent = l.status; li.appendChild(st);
        list.appendChild(li);
      });
      document.getElementById("poResultCard").style.display = "";
      document.getElementById("poResultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
      // The delivery has landed in Shopify, so the stock figures on the list
      // behind this pane are now stale. Refresh them rather than leaving the
      // merchant looking at pre-import numbers next time they switch back.
      if (window.__stockLoaded) { window.__stockLoaded = false; }
    } catch (e) {
      msg.textContent = "Sync failed — please try again.";
    } finally {
      busy.done();
    }
    btn.disabled = false; btn.textContent = "Confirm sync";
  });
  // ---- Remembered material codes ------------------------------------------
  var mapPick = null;

  async function loadMappings() {
    var list = document.getElementById("mapList");
    try {
      var res = await api("/admin/api/material-codes");
      var data = await res.json();
    } catch (e) {
      list.innerHTML = ""; 
      var err = document.createElement("div"); err.className = "map-empty";
      err.textContent = "Couldn't load the remembered codes.";
      list.appendChild(err); return;
    }
    list.innerHTML = "";
    if (!data.mappings.length) {
      var em = document.createElement("div"); em.className = "map-empty";
      em.textContent = "Nothing remembered yet. Pairings appear here after you pick a product by hand during an import.";
      list.appendChild(em); return;
    }
    data.mappings.forEach(function (m) {
      var row = document.createElement("div"); row.className = "map-row";
      var code = document.createElement("span"); code.className = "code"; code.textContent = m.materialCode;
      var arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "\u2192";
      var th;
      if (m.imageUrl) { th = document.createElement("img"); th.src = m.imageUrl; th.alt = ""; }
      else { th = document.createElement("div"); th.className = "noimg"; }
      var who = document.createElement("span"); who.className = "who";
      if (m.missing) {
        who.className = "who gone";
        who.textContent = "Product deleted in Shopify — this pairing will fail on the next import";
      } else {
        who.textContent = m.title + (m.sku ? "  \u00b7  SKU " + m.sku : "");
      }
      var rm = document.createElement("button"); rm.className = "btn rm"; rm.textContent = "Forget";
      rm.addEventListener("click", async function () {
        rm.disabled = true;
        try {
          await api("/admin/api/material-codes/" + encodeURIComponent(m.materialCode), { method: "DELETE" });
          loadMappings();
        } catch (e) { rm.disabled = false; rm.textContent = "Try again"; }
      });
      row.appendChild(code); row.appendChild(arrow); row.appendChild(th); row.appendChild(who); row.appendChild(rm);
      list.appendChild(row);
    });
  }

  function refreshMapAdd() {
    document.getElementById("mapAddBtn").disabled =
      !(document.getElementById("mapCodeInput").value.trim() && mapPick);
  }
  document.getElementById("mapCodeInput").addEventListener("input", refreshMapAdd);

  var mapRun = window.searchRunner();
  document.getElementById("mapProdSearch").addEventListener("input", function (e) {
    var q = e.target.value.trim();
    var box = document.getElementById("mapProdResults");
    mapPick = null; refreshMapAdd();
    if (q.length < 2) { mapRun.cancel(); box.classList.remove("open"); box.innerHTML = ""; return; }
    box.innerHTML = "";
    var mbusy = document.createElement("div");
    mbusy.className = "state"; mbusy.style.padding = "8px 10px";
    mbusy.textContent = "Searching\u2026";
    box.appendChild(mbusy); box.classList.add("open");
    mapRun(400, async function (signal) {
      try {
        var res = await api("/admin/api/products/search?q=" + encodeURIComponent(q), { signal: signal });
        var data = await res.json();
        if (signal.aborted) return; // superseded by a later keystroke
      } catch (err) {
        if (window.isAbort(err)) return;
        box.innerHTML = "";
        var merr = document.createElement("div");
        merr.className = "state"; merr.style.padding = "8px 10px";
        merr.textContent = "Couldn't search \u2014 check your connection and try again.";
        box.appendChild(merr); box.classList.add("open");
        return;
      }
      box.innerHTML = "";
      if (!data.variants.length) {
          box.innerHTML = "";
          var none = document.createElement("div");
          none.className = "state"; none.style.padding = "8px 10px";
          none.textContent = "No product matches that \u2014 checked titles and SKUs.";
          box.appendChild(none); box.classList.add("open");
          return;
        }
      data.variants.slice(0, 8).forEach(function (v) {
        var a = document.createElement("a"); a.href = "#";
        var th;
        if (v.imageUrl) { th = document.createElement("img"); th.className = "pk-thumb"; th.src = v.imageUrl; th.alt = ""; }
        else { th = document.createElement("div"); th.className = "pk-thumb"; th.textContent = "\u25A6"; }
        var meta = document.createElement("div");
        var t = document.createElement("div"); t.className = "pk-title"; t.textContent = v.title;
        var sk = document.createElement("div"); sk.className = "pk-sku"; sk.textContent = v.sku ? "SKU " + v.sku : "No SKU";
        meta.appendChild(t); meta.appendChild(sk); a.appendChild(th); a.appendChild(meta);
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          mapPick = v;
          e.target.value = "";
          box.classList.remove("open"); box.innerHTML = "";
          var chosen = document.getElementById("mapChosen");
          chosen.innerHTML = ""; chosen.style.display = "";
          chosen.appendChild(document.createTextNode("Will point at "));
          var b = document.createElement("b"); b.textContent = v.title; chosen.appendChild(b);
          refreshMapAdd();
        });
        box.appendChild(a);
      });
      box.classList.add("open");
    });
  });

  document.getElementById("mapAddBtn").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    try {
      await api("/admin/api/material-codes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ materialCode: document.getElementById("mapCodeInput").value.trim(), variantId: mapPick.id }),
      });
      document.getElementById("mapCodeInput").value = "";
      document.getElementById("mapChosen").style.display = "none";
      mapPick = null;
      loadMappings();
    } catch (e) { btn.disabled = false; }
  });

  loadMappings();
`;
}
