// backend/src/routes/adminPage/importTab.ts

export function importTabMarkup(): string {
  return `
  <div id="tab-import" class="tab-pane">
  <div class="card">
    <h2>Import a purchase order</h2>
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
      <div class="settings-row">
        <label>Location</label>
        <select id="poLocation"></select>
      </div>
      <table class="po-table" id="poTable">
        <thead>
          <tr><th>#</th><th>Product</th><th>Received</th><th>Expiry (BBD)</th><th>Stock</th><th>Skip</th></tr>
        </thead>
        <tbody id="poTableBody"></tbody>
      </table>
      <div class="po-confirm-row">
        <button class="btn primary" id="poConfirmBtn">Confirm sync</button>
        <span class="msg" id="poConfirmMsg"></span>
      </div>
    </div>
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

  function renderPoReview() {
    document.getElementById("poLoading").style.display = "none";
    document.getElementById("poReviewBody").style.display = "";
    var locSel = document.getElementById("poLocation");
    locSel.innerHTML = "";
    poParsed.locations.forEach(function (loc) {
      var opt = document.createElement("option"); opt.value = loc.id; opt.textContent = loc.name;
      locSel.appendChild(opt);
    });
    locSel.onchange = renderPoRows;
    renderPoRows();
  }

  function currentStock(match) {
    var locId = document.getElementById("poLocation").value;
    var entry = (match && match.stockByLocation || []).find(function (s) { return s.locationId === locId; });
    return entry ? entry.available : 0;
  }

  // A manually picked match carries no stockByLocation — nothing was fetched
  // for it — so currentStock() falls back to 0, which is a guess, not a fact.
  // The confirmation modal must not print that guess as a before-figure.
  function stockIsKnown(match) {
    var locId = document.getElementById("poLocation").value;
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
        var b = currentStock(line.match), a = b + line.deliveredQty;
        stockCell.innerHTML = "";
        var bs = document.createElement("span"); bs.textContent = String(b);
        var to = document.createElement("span"); to.className = "to"; to.textContent = "→";
        var as = document.createElement("span"); as.className = "aft"; as.textContent = String(a);
        stockCell.appendChild(bs); stockCell.appendChild(to); stockCell.appendChild(as);
        if (line.deliveredQty > 0) { var d = document.createElement("span"); d.className = "delta"; d.textContent = "+" + line.deliveredQty; stockCell.appendChild(d); }
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
      var expiryHint = document.createElement("div"); expiryHint.className = "po-code";
      expiryHint.textContent = line.match && line.match.currentBbd && line.match.currentBbd.kind === "parsed"
        ? "currently " + line.match.currentBbd.text + " · not written"
        : "not written";
      expiryCell.appendChild(expiryText); expiryCell.appendChild(expiryHint);

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

  var poSearchT;
  async function onProductSearch(e) {
    var idx = Number(e.target.dataset.idx);
    var q = e.target.value.trim();
    var box = document.getElementById("poPick" + idx);
    clearTimeout(poSearchT);
    if (q.length < 2) { box.classList.remove("open"); box.innerHTML = ""; return; }
    poSearchT = setTimeout(async function () {
      try {
        var res = await api("/admin/api/products/search?q=" + encodeURIComponent(q));
        var data = await res.json();
        box.innerHTML = "";
        if (!data.variants.length) { box.classList.remove("open"); return; }
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
            poParsed.lines[idx].match = { variantId: v.id, inventoryItemId: null, productTitle: v.title, productId: v.productId, imageUrl: v.imageUrl, sku: v.sku, matchSource: "manual", currentBbd: { kind: "absent" }, stockByLocation: [] };
            renderPoRows();
          });
          box.appendChild(a);
        });
        box.classList.add("open");
      } catch (err) {}
    }, 250);
  }

  document.getElementById("poConfirmBtn").addEventListener("click", async function () {
    var msg = document.getElementById("poConfirmMsg");
    var btn = this;

    var skipped = [], adding = [];
    poParsed.lines.forEach(function (l) {
      if (l._skip || !l.match) {
        skipped.push(l.materialCode + " " + l.description + " — " + l.deliveredQty +
          " units, " + (l.match ? "skipped by you" : "no product matched"));
      } else if (!stockIsKnown(l.match)) {
        // Say what we actually know. "0 → 5" for a product that in fact holds
        // 8 is a number this modal exists to be trusted on.
        adding.push(l.match.productTitle + " — current stock unknown → +" + l.deliveredQty);
      } else {
        var before = currentStock(l.match);
        adding.push(l.match.productTitle + " — " + before + " → " + (before + l.deliveredQty) + " (+" + l.deliveredQty + ")");
      }
    });

    var ok = await window.confirmModal(
      "Write this delivery to Shopify?",
      [
        // Skipped lines lead, deliberately: today they are dropped silently, so
        // stock that physically arrived never reaches Shopify and the merchant
        // finds out weeks later as an unexplained shortfall — if ever.
        { title: skipped.length + " line" + (skipped.length === 1 ? "" : "s") +
            " will be skipped — no stock will be added", items: skipped, warn: true },
        { title: adding.length + " line" + (adding.length === 1 ? "" : "s") + " will add stock", items: adding },
        { title: "Best Before Dates", items: ["Previewed only — not written to Shopify"] },
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

    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Syncing…'; msg.textContent = "";
    var fd = new FormData();
    fd.append("pdf", document.getElementById("poFile").files[0]);
    fd.append("locationId", document.getElementById("poLocation").value);
    var payload = poParsed.lines.map(function (l) {
      return {
        materialCode: l.materialCode, description: l.description, deliveredQty: l.deliveredQty, sled: l.sled,
        variantId: l.match ? l.match.variantId : null,
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
    } catch (e) { msg.textContent = "Sync failed — please try again."; }
    btn.disabled = false; btn.textContent = "Confirm sync";
  });`;
}
