// backend/src/routes/adminPage/historyTab.ts

export function historyTabMarkup(): string {
  return `
  <div id="tab-history" class="tab-pane">
  <div class="card">
    <h2>Import history</h2>
    <p class="desc">Every purchase-order PDF you've imported, with the line-level result.</p>
    <ul class="rl" id="poHistoryList"></ul>
  </div>
  <div class="card" id="poHistoryDetailCard" style="display:none">
    <h2>Import detail</h2>
    <a href="#" id="poHistoryPdfLink">Download original PDF</a>
    <table class="po-table" id="poHistoryDetailTable">
      <thead><tr><th>Product</th><th>Qty delivered</th><th>Stock before → after</th><th>Expiry</th><th>Status</th></tr></thead>
      <tbody id="poHistoryDetailBody"></tbody>
    </table>
  </div>
  </div>`;
}

export function historyTabScript(): string {
  return `
  // Purchase-order import history
  document.getElementById("tab-history-btn").addEventListener("click", loadPoHistory);

  async function loadPoHistory() {
    var list = document.getElementById("poHistoryList");
    list.innerHTML = '<div class="state">Loading…</div>';
    try {
      var res = await api("/admin/api/purchase-orders");
      var data = await res.json();
      if (!data.imports.length) { list.innerHTML = '<div class="state">No imports yet</div>'; return; }
      list.innerHTML = "";
      data.imports.forEach(function (imp) {
        var li = document.createElement("li"); li.className = "rl-item";
        var main = document.createElement("div"); main.className = "rl-main";
        var name = document.createElement("span"); name.className = "rl-ord"; name.textContent = imp.filename;
        var sub = document.createElement("span"); sub.className = "rl-cat";
        sub.textContent = imp.line_count + " lines — " + imp.ok_count + " ok, " + imp.skipped_count + " skipped, " + imp.error_count + " failed";
        main.appendChild(name); main.appendChild(sub);
        var view = document.createElement("a"); view.className = "rl-view"; view.href = "#"; view.textContent = "View";
        view.addEventListener("click", function (e) { e.preventDefault(); loadPoDetail(imp.id); });
        li.appendChild(main); li.appendChild(view);
        list.appendChild(li);
      });
    } catch (e) { list.innerHTML = '<div class="state">Failed to load import history</div>'; }
  }

  async function loadPoDetail(importId) {
    var res = await api("/admin/api/purchase-orders/" + importId);
    var data = await res.json();
    document.getElementById("poHistoryDetailCard").style.display = "";
    var pdfLink = document.getElementById("poHistoryPdfLink");
    pdfLink.onclick = async function (e) {
      e.preventDefault();
      var blob = await (await api("/admin/api/purchase-orders/" + importId + "/pdf")).blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = data.import.filename; a.click();
    };
    var body = document.getElementById("poHistoryDetailBody");
    body.innerHTML = "";
    data.lines.forEach(function (l) {
      var tr = document.createElement("tr");
      var cells = [
        l.description,
        String(l.delivered_qty),
        l.skipped ? "—" : (l.qty_before + " → " + l.qty_after),
        l.expiry_updated ? l.sled + " (updated)" : (l.sled + " (unchanged)"),
        l.skipped ? "skipped" : l.status,
      ];
      cells.forEach(function (text) { var td = document.createElement("td"); td.textContent = text; tr.appendChild(td); });
      body.appendChild(tr);
    });
  }`;
}
