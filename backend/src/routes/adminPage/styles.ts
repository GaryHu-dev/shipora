// backend/src/routes/adminPage/styles.ts

// The admin page's entire <style> block. Moved verbatim from the original
// adminPage.ts; the page is served as one HTML string, so the CSS lives as a
// string too rather than as a separate asset the Worker would have to route.
export const ADMIN_STYLES = `
<style>
  /* Tuned to the current Shopify admin rather than the palette Polaris used a
     few years ago. This page renders inside their frame, so anything off — the
     grey, the ink, the shape of a button — reads as a bolt-on.
     The loudest tell was the primary button: Shopify's is near-black now, and
     a blue one is recognisable as not-theirs at a glance to anyone who works
     in that admin all day. Blue stays, but only where it still belongs —
     links, focus, selection. */
  :root {
    --bg:#f1f1f1; --surface:#fff; --text:#303030; --subdued:#616161; --border:#e3e3e3;
    --accent:#005bd3; --accent-press:#004299;
    --primary-bg:#303030; --primary-bg-press:#1a1a1a;
    --amber-bg:#fff1d6; --amber-fg:#8a6116; --green-bg:#e3f1df; --green-fg:#0f5132;
    --radius:12px; --shadow:0 1px 2px rgba(0,0,0,.05), 0 0 1px rgba(0,0,0,.08);
  }
  * { box-sizing:border-box; }
  body { font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    margin:0; padding:20px 16px 40px; color:var(--text); background:var(--bg); -webkit-font-smoothing:antialiased; }
  .wrap { max-width:720px; margin:0 auto; }
  .page-h { font-size:20px; font-weight:650; margin:0 0 4px; }
  .page-sub { color:var(--subdued); font-size:14px; margin:0 0 20px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:20px; margin-bottom:16px; }
  .card h2 { font-size:15px; font-weight:650; margin:0 0 4px; }
  .card .desc { color:var(--subdued); font-size:13.5px; margin:0 0 16px; line-height:1.45; }

  .qr-wrap { display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; }
  .qr-box { border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff; flex:none; }
  .qr-box img { display:block; width:180px; height:180px; image-rendering:pixelated; }
  .qr-side { flex:1; min-width:200px; }
  .join-url { word-break:break-all; font-size:12px; color:var(--subdued); background:#f6f6f7; border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin:0 0 10px; }
  .row-btns { display:flex; gap:8px; flex-wrap:wrap; }
  .reset-note { color:var(--subdued); font-size:12px; margin-top:8px; }
  .btn { padding:9px 14px; font-size:13.5px; font-weight:600; border-radius:8px; border:1px solid var(--border); background:#fff; color:var(--text); cursor:pointer; }
  .btn.primary { background:var(--primary-bg); color:#fff; border-color:var(--primary-bg); }
  .btn.primary:active { background:var(--primary-bg-press); border-color:var(--primary-bg-press); }

  .layout { display:grid; grid-template-columns:1fr 300px; gap:16px; align-items:start; }
  @media (max-width:820px){ .layout { grid-template-columns:1fr; } }
  .side .card { position:sticky; top:16px; }
  .settings-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .settings-row .num { width:70px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-size:14px; }
  .settings-row2 { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .msg { color:var(--subdued); font-size:13px; }
  .recent-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:8px; }
  .recent-item { position:relative; }
  .recent-item img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; background:#eee; cursor:pointer; display:block; }
  .recent-item .tag { position:absolute; left:4px; bottom:4px; background:rgba(0,0,0,.6); color:#fff; font-size:10px; padding:1px 5px; border-radius:5px; }
  .recent-search { width:100%; box-sizing:border-box; padding:8px 11px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:10px; }
  .rl { list-style:none; margin:0; padding:0; }
  .rl-item { display:flex; align-items:center; gap:8px; padding:9px 0; border-top:1px solid #f1f2f4; }
  .rl-item:first-child { border-top:none; }
  .sk { position:relative; overflow:hidden; background:#e6e8ec; border-radius:6px; }
  .sk::after { content:""; position:absolute; inset:0; transform:translateX(-100%); background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent); animation:shimmer 1.3s infinite; }
  @keyframes shimmer { 100% { transform:translateX(100%); } }
  .sk-row { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-top:1px solid #f1f2f4; }
  .sk-row:first-child { border-top:none; }
  .rl-main { flex:1; min-width:0; }
  .rl-ord { font-weight:650; font-size:13.5px; }
  .rl-cat { display:block; color:var(--subdued); font-size:12px; margin-top:1px; }
  .rl-view { color:var(--accent); font-size:12.5px; font-weight:600; text-decoration:none; flex:none; }

  .order { border:1px solid var(--border); border-radius:10px; margin-bottom:8px; overflow:hidden; }
  .order-head { display:flex; align-items:center; gap:10px; padding:13px 14px; cursor:pointer; background:#fff; }
  .order-head:hover { background:#fafbfb; }
  .order-head .num { font-weight:650; font-size:14.5px; flex:1; }
  .order-head .chev { color:#b5bcc4; transition:transform .15s ease; }
  .order.open .order-head .chev { transform:rotate(90deg); }
  .badge { display:inline-block; padding:2px 9px; font-size:11.5px; font-weight:600; border-radius:999px; }
  .badge.unf { background:var(--amber-bg); color:var(--amber-fg); }
  .badge.ful { background:var(--green-bg); color:var(--green-fg); }
  .order-body { display:none; padding:0 14px 14px; }
  .order.open .order-body { display:block; }
  .thumbs { display:grid; grid-template-columns:repeat(auto-fill,minmax(84px,1fr)); gap:8px; }
  .thumbs img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; background:#eee; cursor:pointer; }
  .tl { list-style:none; margin:0; padding:0; }
  .tl-item { display:flex; gap:11px; align-items:center; padding:10px 0; border-top:1px solid #f1f2f4; }
  .tl-item:first-child { border-top:none; }
  .tl-thumb { width:46px; height:46px; border-radius:8px; object-fit:cover; background:#eee; flex:none; cursor:pointer; }
  .tl-meta { flex:1; min-width:0; }
  .tl-cat { font-weight:600; font-size:13.5px; }
  .tl-sub { color:var(--subdued); font-size:12px; margin-top:1px; }
  .tl-view { color:var(--accent); font-size:12.5px; font-weight:600; text-decoration:none; flex:none; }
  .muted { color:var(--subdued); font-size:13px; padding:8px 0; }

  .state { color:var(--subdued); font-size:14px; padding:8px 0; }

  .tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--border); }
  .tab-btn { padding:9px 14px; font-size:14px; font-weight:600; border:none; background:none; color:var(--subdued); cursor:pointer; border-bottom:2px solid transparent; }
  .tab-btn.active { color:var(--text); border-bottom-color:var(--accent); }
  .tab-pane { display:none; }
  .tab-pane.active { display:block; }
  /* ---- Purchase-order import ---- */
  .po-drop { position:relative; display:block; border:1.5px dashed var(--border); border-radius:12px;
    background:#fbfcfd; padding:26px 20px; text-align:center; cursor:pointer; transition:border-color .15s, background .15s; }
  .po-drop:hover, .po-drop.drag { border-color:var(--accent); background:#f5f9ff; }
  .po-drop input[type=file] { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
  .po-drop .ic { width:34px; height:34px; margin:0 auto 8px; color:var(--accent); display:block; }
  .po-drop .big { font-size:14px; font-weight:600; color:var(--text); }
  .po-drop .small { font-size:12.5px; color:var(--subdued); margin-top:3px; }
  .po-file { display:flex; align-items:center; gap:10px; justify-content:center; }
  .po-file .doc { font-size:22px; line-height:1; }
  .po-file .nm { font-weight:600; font-size:13.5px; }
  .po-file .sz { color:var(--subdued); font-size:12px; }
  .po-actions, .po-confirm-row { display:flex; align-items:center; gap:12px; margin-top:14px; }

  .spin { width:15px; height:15px; border:2px solid rgba(44,110,203,.25); border-top-color:var(--accent);
    border-radius:50%; animation:spin .7s linear infinite; display:inline-block; vertical-align:-2px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .po-loading { display:flex; align-items:center; gap:11px; padding:20px 2px; color:var(--subdued); font-size:14px; }
  .po-loading .spin { width:20px; height:20px; border-width:3px; }

  .po-table { width:100%; border-collapse:separate; border-spacing:0; font-size:13.5px; margin:2px 0 4px; }
  .po-table thead th { text-align:left; padding:6px 10px; font-size:11px; font-weight:600; text-transform:uppercase;
    letter-spacing:.04em; color:var(--subdued); border-bottom:1px solid var(--border); white-space:nowrap; }
  .po-table td { padding:11px 10px; border-bottom:1px solid #f1f2f4; vertical-align:top; }
  .po-table tbody tr:hover { background:#fafbfc; }
  .po-table tbody tr.skip td > *:not(.po-skip) { opacity:.4; }
  .po-table input[type=number], .po-table input[type=date], .po-table input[type=text], .po-table select {
    width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid var(--border); border-radius:7px; font-size:13px; background:#fff; }
  .po-table input:focus, .po-table select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(44,110,203,.15); }
  .po-table td:nth-child(3){ width:74px; } .po-table td:nth-child(4){ width:130px; } .po-table td:nth-child(6){ width:44px; }
  .po-idx { color:var(--subdued); font-size:12px; font-variant-numeric:tabular-nums; }
  .po-prod { display:flex; gap:10px; align-items:flex-start; }
  .po-prod .txt { flex:1; min-width:0; }
  .po-thumb { width:42px; height:42px; border-radius:7px; object-fit:cover; background:#eef0f2; flex:none; border:1px solid var(--border); display:block; }
  .po-thumb.ph { display:flex; align-items:center; justify-content:center; color:#b5bcc4; font-size:15px; }
  a.po-thumb-link { flex:none; display:block; }
  a.po-thumb-link:hover .po-thumb { border-color:var(--accent); }
  .po-prod-title { font-weight:600; }
  .po-prod-title a { color:var(--text); text-decoration:none; }
  .po-prod-title a:hover { color:var(--accent); text-decoration:underline; }
  .po-change { color:var(--accent); font-size:12px; font-weight:600; cursor:pointer; margin-top:6px; display:inline-block; }
  .po-change:hover { text-decoration:underline; }
  .po-code { color:var(--subdued); font-size:12px; margin-top:1px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600; margin-top:6px; }
  .pill.sku { background:var(--green-bg); color:var(--green-fg); }
  .pill.map, .pill.manual { background:#e8f0fb; color:#1f5199; }
  .pill.fuzzy { background:var(--amber-bg); color:var(--amber-fg); }
  .pill.none { background:#fdeceb; color:#b42318; }
  .po-stock { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .po-stock .to { color:var(--subdued); margin:0 5px; }
  .po-stock .aft { font-weight:700; }
  .po-stock .delta { color:var(--green-fg); font-weight:600; font-size:12px; margin-left:7px; }
  .po-note { font-size:11px; margin-top:5px; }
  .po-note.up { color:var(--green-fg); } .po-note.keep { color:var(--subdued); }
  .po-search { position:relative; margin-top:6px; }
  .po-pick { position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:30; background:#fff;
    border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 22px rgba(16,24,40,.14);
    overflow:auto; max-height:230px; display:none; }
  .po-pick.open { display:block; }
  .po-pick a { display:flex; gap:9px; align-items:center; padding:7px 10px; text-decoration:none; border-top:1px solid #f1f2f4; }
  .po-pick a:first-child { border-top:none; }
  .po-pick a:hover { background:#f5f9ff; }
  .po-pick .pk-thumb { width:30px; height:30px; border-radius:5px; object-fit:cover; background:#eef0f2; flex:none;
    border:1px solid var(--border); display:flex; align-items:center; justify-content:center; color:#b5bcc4; font-size:12px; }
  .po-pick .pk-title { font-size:12.5px; font-weight:500; color:var(--text); line-height:1.25; }
  .po-pick .pk-sku { font-size:11px; color:var(--subdued); }
  .po-skip { text-align:center; }

  .po-res { list-style:none; margin:0; padding:0; }
  .po-res li { display:flex; align-items:center; gap:9px; padding:9px 2px; border-top:1px solid #f1f2f4; font-size:13.5px; }
  .po-res li:first-child { border-top:none; }
  .po-res .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .po-res .ok .dot { background:#12805c; } .po-res .err .dot { background:#b42318; } .po-res .skip .dot { background:#b5bcc4; }
  .po-res .er { color:#b42318; font-size:12px; }
  .po-res .st { margin-left:auto; font-size:12px; font-weight:600; text-transform:capitalize; }
  .po-res .ok .st { color:#12805c; } .po-res .err .st { color:#b42318; } .po-res .skip .st { color:var(--subdued); }

  /* ---- Stock tab ---- */
  .stock-toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  /* The selects were unstyled, so they rendered as raw OS controls sitting in
     the middle of a page that otherwise matches the Shopify admin — the one
     element that gave away that this is not a native screen. */
  .stock-toolbar label { display:inline-flex; align-items:center; gap:6px;
    font-size:12.5px; font-weight:600; color:var(--subdued); }
  .stock-toolbar select {
    appearance:none; -webkit-appearance:none;
    padding:7px 30px 7px 10px; font:inherit; font-size:13.5px; font-weight:500; color:var(--text);
    background-color:#fff; border:1px solid var(--border); border-radius:8px; cursor:pointer;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23616161' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
    background-repeat:no-repeat; background-position:right 8px center;
  }
  .stock-toolbar select:hover { background-color:#fafafa; }
  .stock-toolbar select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(0,91,211,.16); }
  .stock-add { position:relative; flex:1; min-width:220px; }
  .stock-add input { width:100%; padding:7px 10px; border:1px solid var(--border); border-radius:8px; font-size:13.5px; }
  .stock-add input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(0,91,211,.16); }
  .stock-filters { display:flex; gap:6px; margin-bottom:10px; }
  .stock-filters button { padding:5px 11px; font-size:12.5px; border:1px solid var(--border);
    background:#fff; border-radius:999px; cursor:pointer; color:var(--subdued); }
  .stock-filters button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  .stock-qty { display:inline-flex; align-items:center; gap:4px; }
  .stock-qty button { width:24px; height:26px; border:1px solid var(--border); background:#fff;
    border-radius:5px; cursor:pointer; font-size:14px; line-height:1; }
  .stock-qty input { width:58px; text-align:center; font-variant-numeric:tabular-nums; }
  .stock-num { font-variant-numeric:tabular-nums; font-weight:600; }
  .stock-when { font-size:12px; color:var(--subdued); white-space:nowrap; }
  .stock-when.stale { color:#b45309; }
  .stock-row-err { font-size:12px; color:#b42318; margin-top:3px; }
  .stock-badge { font-size:11px; padding:1px 6px; border-radius:4px; background:#f1f2f4; color:var(--subdued); }
  .stock-badge.warn { background:#fef0c7; color:#b45309; }
  .stock-badge.counted { background:var(--green-bg); color:var(--green-fg); }
  .stock-missing { color:#b42318; font-size:13px; }
  .modal-back { position:fixed; inset:0; background:rgba(0,0,0,.42); display:flex;
    align-items:center; justify-content:center; z-index:50; padding:20px; }
  .modal { background:#fff; border-radius:10px; max-width:520px; width:100%;
    max-height:80vh; overflow:auto; padding:20px; }
  .modal h3 { margin:0 0 12px; font-size:16px; }
  .modal .m-sec { margin-bottom:14px; }
  .modal .m-sec h4 { margin:0 0 6px; font-size:13px; }
  .modal .m-sec.warn h4 { color:#b45309; }
  .modal .m-sec ul { margin:0; padding-left:18px; font-size:13px; line-height:1.65; }
  .modal .m-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; }
  .back-to-stock { width: auto; padding: 7px 13px; font-size: 13.5px; font-weight: 600;
    color: var(--text); background: #fff; border: 1px solid var(--border); margin-bottom: 12px; }
  .back-to-stock:hover { background: #f6f7f9; }
  .sync-warn { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
    background:#fff1d6; border:1px solid #e0c48a; border-radius:10px;
    padding:11px 14px; margin-bottom:16px; font-size:13.5px; color:#8a6116; }
  .sync-warn .btn { flex:none; }
  .map-add { display:flex; gap:8px; align-items:flex-start; flex-wrap:wrap; margin-bottom:10px; }
  .map-add .map-code { width:160px; padding:7px 10px; border:1px solid var(--border); border-radius:8px; font-size:13.5px; }
  .map-add .map-prod { flex:1; min-width:220px; }
  .map-chosen { font-size:13px; color:var(--subdued); margin-bottom:10px; }
  .map-chosen b { color:var(--text); }
  .map-list { display:flex; flex-direction:column; gap:6px; }
  .map-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:#fff; }
  .map-row .code { font-weight:700; font-variant-numeric:tabular-nums; min-width:90px; }
  .map-row .arrow { color:var(--subdued); }
  .map-row img, .map-row .noimg { width:32px; height:32px; border-radius:6px; object-fit:cover; background:#f1f2f4; flex:none; }
  .map-row .who { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13.5px; }
  .map-row .gone { color:#b42318; font-size:12.5px; font-weight:600; }
  .map-row .rm { flex:none; padding:5px 10px; font-size:12.5px; }
  .map-empty { color:var(--subdued); font-size:13px; padding:6px 2px; }
  /* Scoped to the stock list, not to .po-table generally: the import review
     table shares that class and its cells hold inputs and dropdowns, which need
     the taller row. Here a row is a name, a number and two small buttons, and
     the point of the screen is to run your eye down dozens of them — every
     pixel of row height is a row you cannot see at once. */
  #stockTable td { padding:6px 10px; vertical-align:middle; }
  #stockTable .po-prod-title { line-height:1.25; }
  #stockTable .po-code { margin-top:0; line-height:1.2; }
  #stockTable .btn { padding:5px 10px; font-size:12.5px; }
  #stockTable .stock-qty button { height:24px; }
  #stockTable .stock-qty input { padding:4px 6px; }
</style>`;
