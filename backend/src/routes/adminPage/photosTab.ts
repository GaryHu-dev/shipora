// backend/src/routes/adminPage/photosTab.ts

export function photosTabMarkup(): string {
  return `
  <div id="tab-photos" class="tab-pane active">
  <div class="layout">
  <div class="main">
  <div class="card">
    <h2>Warehouse join QR code</h2>
    <p class="desc">Staff scan this with their phone to open StockProof and start uploading shipping photos. Print it or show it on screen.</p>
    <div class="qr-wrap">
      <div class="qr-box"><div id="qr"><div class="sk" style="width:160px;height:160px;border-radius:10px"></div></div></div>
      <div class="qr-side">
        <div class="join-url" id="joinUrl"></div>
        <div class="row-btns">
          <button class="btn primary" id="copyBtn">Copy link</button>
          <button class="btn" onclick="window.open(document.getElementById('joinUrl').textContent,'_blank')">Open</button>
          <button class="btn" id="resetBtn">Reset code</button>
        </div>
        <div class="reset-note">Reset if a QR/link leaks — the old code stops working and a new one is generated (reprint it for staff).</div>
      </div>
    </div>
  </div>
  <div class="card">
    <h2>Photo storage</h2>
    <p class="desc">Shipping photos are kept for the retention period, then deleted automatically.</p>
    <div class="settings-row">
      <label>Keep photos for</label>
      <input id="retention" class="num" type="number" min="1" max="365" />
      <span>days</span>
      <button class="btn primary" id="saveSettings">Save</button>
    </div>
    <div class="settings-row2">
      <button class="btn" id="cleanupBtn">Clean up expired now</button>
      <span class="msg" id="settingsMsg"></span>
    </div>
  </div>
  </div>
  <aside class="side">
  <div class="card">
    <h2>Recent photos</h2>
    <p class="desc">The latest shipping photos uploaded by your staff.</p>
    <input id="recentSearch" class="recent-search" type="search" placeholder="Search by order number…" />
    <div id="recent">
      <div class="sk-row"><div class="sk" style="width:60%;height:13px"></div></div>
      <div class="sk-row"><div class="sk" style="width:52%;height:13px"></div></div>
      <div class="sk-row"><div class="sk" style="width:66%;height:13px"></div></div>
    </div>
  </div>
  </aside>
  </div>
  </div>`;
}

export function photosTabScript(): string {
  return `  const CAT = { shipping_photo:"Shipping photo", packing_slip:"Packing slip", shipping_label:"Shipping label", damage:"Damage / issue", document:"Document", other:"Other" };
  function ago(ts) {
    return new Date(ts * 1000).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // QR
  async function loadQr() {
    try {
      const { joinUrl, qrDataUrl } = await (await api("/admin/api/join-qr", { method: "POST" })).json();
      document.getElementById("qr").innerHTML = '<img alt="join qr" src="' + qrDataUrl + '">';
      document.getElementById("joinUrl").textContent = joinUrl;
    } catch (e) { document.getElementById("qr").innerHTML = '<div class="state">Failed to generate QR</div>'; }
  }
  await loadQr();
  document.getElementById("copyBtn").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText(document.getElementById("joinUrl").textContent); this.textContent = "Copied ✓"; setTimeout(() => this.textContent = "Copy link", 1500); } catch (e) {}
  });
  document.getElementById("resetBtn").addEventListener("click", async function () {
    if (!confirm("Reset the join code? The current QR and link will stop working — you'll need to reprint the new one for staff.")) return;
    this.disabled = true; this.textContent = "Resetting…";
    try {
      await api("/admin/api/reset-join-code", { method: "POST" });
      await loadQr();
      this.textContent = "Reset ✓"; setTimeout(() => { this.textContent = "Reset code"; this.disabled = false; }, 1500);
    } catch (e) { this.textContent = "Reset code"; this.disabled = false; }
  });

  // Photo storage settings
  try {
    const s = await (await api("/admin/api/settings")).json();
    document.getElementById("retention").value = s.retentionDays;
  } catch (e) {}
  document.getElementById("saveSettings").addEventListener("click", async function () {
    const v = parseInt(document.getElementById("retention").value, 10);
    const msg = document.getElementById("settingsMsg");
    try {
      await api("/admin/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retentionDays: v }) });
      msg.textContent = "Saved ✓"; setTimeout(() => { msg.textContent = ""; }, 2000);
    } catch (e) { msg.textContent = "Enter a number from 1 to 365"; }
  });
  document.getElementById("cleanupBtn").addEventListener("click", async function () {
    const msg = document.getElementById("settingsMsg");
    this.disabled = true; msg.textContent = "Cleaning up…";
    try {
      const { deleted } = await (await api("/admin/api/cleanup", { method: "POST" })).json();
      msg.textContent = "Deleted " + deleted + " expired photo" + (deleted === 1 ? "" : "s");
    } catch (e) { msg.textContent = "Cleanup failed"; }
    this.disabled = false;
  });

  // Recent photos
  const recentBox = document.getElementById("recent");
  async function loadRecent(q) {
    try {
      const url = "/admin/api/recent-photos" + (q ? "?q=" + encodeURIComponent(q) : "");
      const { photos } = await (await api(url)).json();
      if (!photos.length) {
        recentBox.innerHTML = '<div class="state">' + (q ? "No photos for that order" : "No photos yet") + '</div>';
        return;
      }
      const ul = document.createElement("ul"); ul.className = "rl";
      recentBox.innerHTML = ""; recentBox.appendChild(ul);
      photos.forEach(function (p, i) {
        const li = document.createElement("li"); li.className = "rl-item";
        const main = document.createElement("div"); main.className = "rl-main";
        const ordEl = document.createElement("span"); ordEl.className = "rl-ord"; ordEl.textContent = p.order_number;
        const catEl = document.createElement("span"); catEl.className = "rl-cat"; catEl.textContent = (CAT[p.category] || p.category) + " #" + (i + 1);
        main.appendChild(ordEl); main.appendChild(catEl);
        const view = document.createElement("a"); view.className = "rl-view"; view.href = "#"; view.textContent = "View";
        view.addEventListener("click", async function (e) {
          e.preventDefault();
          const old = view.textContent; view.textContent = "…";
          try { const blob = await (await api("/admin/api/photos/" + p.id + "/raw")).blob(); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) {}
          view.textContent = old;
        });
        li.appendChild(main); li.appendChild(view);
        ul.appendChild(li);
      });
    } catch (e) { recentBox.innerHTML = '<div class="state">Failed to load photos</div>'; }
  }
  await loadRecent("");
  var recentT;
  document.getElementById("recentSearch").addEventListener("input", function () {
    clearTimeout(recentT);
    var q = this.value.trim();
    recentT = setTimeout(function () { loadRecent(q); }, 250);
  });`;
}
