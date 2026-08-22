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
    /* 720px was a reading-width column, but this page is worked in, not read:
     the stock list is a wide table you scan down. Shopify's own admin gives its
     content far more room, so the app sat in a narrow strip inside a wide
     frame. Bounded rather than fluid so the table does not sprawl on a large
     monitor. */
  .wrap { max-width:1180px; margin:0 auto; }
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
  /* Scoped to the import table. Unscoped, these landed on every .po-table —
     the stock list's BBD column inherited the import table's 74px and was
     cramped for no reason anyone could see from its own markup. */
  #poTable td:nth-child(3){ width:74px; } #poTable td:nth-child(4){ width:130px; } #poTable td:nth-child(6){ width:44px; }
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
  .po-pick a > div:nth-child(2) { flex:1; min-width:0; }
  .po-pick .pk-side { flex:none; text-align:right; line-height:1.25; }
  .po-pick .pk-qty { font-size:12.5px; font-weight:600; color:var(--text); white-space:nowrap; }
  .po-pick .pk-bbd { font-size:11px; color:var(--subdued); white-space:nowrap; }
  /* An added row stays in the list rather than vanishing: seeing what you just
     added is the confirmation, and the list is normally the source of several
     products in one pass. */
  .po-pick a.pk-added { cursor:default; background:#f6f6f7; }
  .po-pick a.pk-added:hover { background:#f6f6f7; }
  .po-pick a.pk-added .pk-title, .po-pick a.pk-added .pk-sku,
  .po-pick a.pk-added .pk-qty, .po-pick a.pk-added .pk-bbd { color:var(--subdued); }
  .po-pick a.pk-added .pk-thumb { opacity:.55; }
  .po-pick .pk-added-tag { flex:none; margin-left:2px; font-size:11px; font-weight:600;
    color:var(--green-fg); background:var(--green-bg); border-radius:999px; padding:2px 8px; }
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
  .stock-toolbar > .stock-add { margin-right:auto; }
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
  /* Was flex:1, so widening the page to 1180px stretched this box across half
     the toolbar. A search field should be the size of what you type into it —
     a product code or a couple of words — not the size of its container. */
  .stock-add { position:relative; flex:0 1 300px; min-width:180px; }
  /* A statement of fact, not a control — no border, no chevron, nothing that
     invites a click. Shown only when more than one location exists. */
  .stock-loc-note { font-size:12.5px; color:var(--subdued); white-space:nowrap; }
  .po-stock .to { margin:0 6px; color:var(--subdued); }
  .po-stock .aft { font-weight:650; }
  .po-unknown { color:var(--amber-fg); background:var(--amber-bg); border-radius:6px; padding:1px 7px; font-size:12.5px; }
  /* Confirmation tables. Same visual language as the import review table the
     merchant was just looking at — the dialog should read as that screen
     restated, not as a different kind of document. */
  .m-tablewrap { max-height:46vh; overflow:auto; border:1px solid var(--border); border-radius:8px; }
  .m-table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
  .m-table th { position:sticky; top:0; background:#fafafa; text-align:left; padding:6px 10px;
    font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.03em;
    color:var(--subdued); border-bottom:1px solid var(--border); white-space:nowrap; }
  .m-table td { padding:5px 10px; border-bottom:1px solid #f1f2f4; vertical-align:middle; white-space:nowrap; }
  .m-table tr:last-child td { border-bottom:none; }
  /* The product name is the only cell without a bounded length. */
  .m-table td:first-child { white-space:normal; min-width:180px; }
  .m-table td:nth-child(2) { color:var(--subdued); font-variant-numeric:tabular-nums; }
  .m-table .m-up { color:#0f5132; font-weight:650; }
  .m-table .m-down { color:#b42318; font-weight:650; }
  .m-table .m-unknown { color:var(--amber-fg); }
  .m-sec.warn .m-tablewrap { border-color:#e0c48a; }
  .m-prod { display:flex; align-items:center; gap:8px; min-width:0; }
  .m-thumb { width:28px; height:28px; border-radius:5px; object-fit:cover; background:#eef0f2;
    flex:none; display:flex; align-items:center; justify-content:center; color:#b5bcc4; font-size:13px; }
  .m-name { color:var(--text); text-decoration:none; }
  a.m-name:hover { color:var(--accent); text-decoration:underline; }
  /* The thumbnail is a link too, to a DIFFERENT place than the name beside it.
     It has to look tappable without competing with the product name. */
  .m-thumblink, .stock-thumblink { display:block; flex:none; border-radius:5px; line-height:0; }
  .m-thumblink:hover, .stock-thumblink:hover { box-shadow:0 0 0 2px var(--accent); }

  /* ---- blocking overlay ---- */
  /* Above the confirmation modal (z 40) — it appears after one is dismissed,
     and must cover anything that outlives it. */
  .busy-back { position:fixed; inset:0; z-index:60; background:rgba(255,255,255,.72);
    backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
    display:flex; align-items:center; justify-content:center; }
  .busy-box { background:#fff; border:1px solid var(--border); border-radius:12px;
    box-shadow:0 12px 32px rgba(16,24,40,.16); padding:18px 22px; text-align:center;
    display:flex; flex-direction:column; align-items:center; gap:4px; max-width:min(340px,86vw); }
  .busy-box .spin { width:22px; height:22px; border-width:3px; margin-bottom:6px; }
  .busy-text { font-size:14px; font-weight:600; color:var(--text); }
  .busy-note { font-size:12px; color:var(--subdued); }

  /* ---- download button ---- */
  /* Was a bare link, which said nothing about being an action that takes a
     moment and produces a file. */
  #poHistoryPdfLink { display:inline-flex; align-items:center; gap:7px; margin-bottom:12px; }
  #poHistoryPdfLink:disabled { opacity:.65; cursor:default; }
  .btn-ico { font-size:14px; line-height:1; color:var(--subdued); }
  #poHistoryPdfLink:hover:not(:disabled) { background:#fafafa; border-color:#c9ccd1; }

  /* ---- history list polish ---- */
  #poHistoryList .rl-item { padding:11px 2px; }
  #poHistoryList .rl-ord { display:inline-flex; align-items:center; }
  #poHistoryDetailTable td:first-child { max-width:340px; }
  #poHistoryDetailTable .po-prod-title { font-weight:550; }
  #histFilters { margin-bottom:4px; }
  /* The resulting figure is what the record is consulted for. */
  .hist-before { color:var(--subdued); font-variant-numeric:tabular-nums; }
  .hist-arrow { color:var(--subdued); }
  .hist-after { color:var(--green-fg); font-weight:650; font-variant-numeric:tabular-nums; }
  .hist-after.down { color:#b42318; }
  /* Same rule in the live tables: the number that is true now stands out. */
  .po-stock .aft { color:var(--green-fg); }

  /* Cancel discards what you typed. It is not the same kind of button as Edit
     beside it, and at counting speed the two were only told apart by reading. */
  .btn.danger { color:#b42318; border-color:#f0c4bf; }
  .btn.danger:hover { background:#fef3f2; border-color:#e5a9a2; }

  /* ---- stock table skeleton ---- */
  .sk-tr td { padding:7px 10px; vertical-align:middle; }
  .sk-bar { height:11px; border-radius:5px; }
  .sk-thumb { width:26px; height:26px; border-radius:5px; flex:none; }
  /* ---- responsive ---- */
  /* Wide tables scroll inside their own card rather than squeezing columns
     until text wraps. A counting row is a line you read ACROSS — product,
     code, count, date — and once it wraps, rows stop being the same height
     and the eye loses the line it was following. Better to move the viewport
     than to destroy the row. The page body itself never scrolls sideways. */
  .tbl-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .tbl-scroll > table { min-width:760px; }
  #poTable { min-width:860px; }        /* six columns, two of them inputs */

  @media (max-width:900px) {
    body { padding:14px 10px 32px; }
    .card { padding:16px 14px; }
    /* The toolbar already wraps; give the search box the full row rather than
       a 300px stub beside three other controls. */
    .stock-add { flex:1 1 100%; }
    .stock-add .po-pick { min-width:0; left:0; right:0; max-width:none; }
    /* Below this the modal was a 520px box inside a 360px screen. */
    .modal { max-width:none; max-height:86vh; }
    .m-tablewrap { max-height:52vh; }
  }

  @media (max-width:560px) {
    .page-h { font-size:18px; }
    .card h2 { font-size:14.5px; }
    .card .desc { font-size:13px; }
    .tabs { overflow-x:auto; }
    .tab-btn { white-space:nowrap; padding:9px 11px; }
    .row-btns .btn, .po-confirm-row .btn { flex:1 1 auto; }
    .fatal-bar { left:8px; right:8px; bottom:8px; }
  }

  .fatal-bar { position:fixed; left:16px; right:16px; bottom:16px; z-index:80;
    background:#fef3f2; border:1px solid #f0c4bf; color:#b42318; border-radius:10px;
    padding:11px 14px; font-size:13px; box-shadow:0 8px 24px rgba(16,24,40,.14); }
  /* The results, though, need the room the input gave up: product titles here
     run to "Anchor CalciYum Strawberry Flavoured Milk 250ML X 24". */
  .stock-add .po-pick { right:auto; min-width:420px; max-width:min(560px, 88vw); }
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
  /* A counted row is a line you read across: product, code, count, date. Once
     any cell wraps, rows stop being the same height and the eye loses the
     line it is following. So nothing wraps — the product name, the only cell
     without a bounded length, clips instead and carries its full text in a
     tooltip. */
  #stockTable td, #stockTable th { white-space:nowrap; }
  /* Fixed layout, so every column is the width declared below and nothing can
     shove its neighbours. Product used to be width:100% — it absorbed all the
     leftover space on a 1180px page (~600px of it) and squeezed the actions
     column down onto its own buttons. */
  #stockTable { table-layout:fixed; }
  #stockTable .stock-prod { overflow:hidden; }
  #stockTable .stock-prod-in { display:flex; align-items:center; gap:8px; min-width:0; }
  /* 26px, not the picker's 30: this repeats down a list the merchant wants as
     many rows of as will fit, and the thumbnail must not be what sets the row
     height back up after we just cut it. */
  #stockTable .stock-thumb { width:26px; height:26px; border-radius:5px; object-fit:cover;
    background:#eef0f2; flex:none; display:flex; align-items:center; justify-content:center;
    color:#b5bcc4; font-size:13px; }
  #stockTable .stock-prod .po-prod-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  #stockTable .stock-prod-link { color:var(--text); text-decoration:none; }
  #stockTable .stock-prod-link:hover { color:var(--accent); text-decoration:underline; }
  /* Percentages, so the split holds at any page width. Product gets the most,
     but bounded: a name is something you recognise, not something you read
     word by word, and past ~350px the extra width is white space taken from
     the columns you are actually comparing. */
  #stockTable th:nth-child(1), #stockTable td:nth-child(1) { width:26%; }
  #stockTable th:nth-child(2), #stockTable td:nth-child(2) { width:12%; }
  #stockTable th:nth-child(3), #stockTable td:nth-child(3) { width:14%; }
  /* "September 2027" is the longest thing this column ever holds. */
  #stockTable th:nth-child(4), #stockTable td:nth-child(4) { width:14%; }
  #stockTable th:nth-child(5), #stockTable td:nth-child(5) { width:12%; }
  /* Holds two controls at rest (Edit ✕) and three while counting
     (✓ Cancel ✕) — 52px fitted none of them. */
  #stockTable th:nth-child(6), #stockTable td:nth-child(6) { width:22%; }
  #stockTable td:nth-child(6) { text-align:right; }
  #stockTable td:nth-child(6) .btn + .btn { margin-left:5px; }
  #stockTable .stock-sku { font-variant-numeric:tabular-nums; color:var(--subdued);
    overflow:hidden; text-overflow:ellipsis; }

  /* Scoped to the stock list, not to .po-table generally: the import review
     table shares that class and its cells hold inputs and dropdowns, which need
     the taller row. Here a row is a name, a number and two small buttons, and
     the point of the screen is to run your eye down dozens of them — every
     pixel of row height is a row you cannot see at once. */
  #stockTable td { padding:7px 10px; vertical-align:middle; line-height:1.3; }
  #stockTable .po-prod-title { line-height:1.25; }
  #stockTable .po-code { margin-top:0; line-height:1.2; }
  #stockTable .btn { padding:4px 10px; font-size:12.5px; }
  #stockTable .stock-qty button { height:24px; }
  #stockTable .stock-qty input { padding:4px 6px; }
  #stockTable .stock-row-err { white-space:normal; }
  #stockTable tr.stock-err td { padding-top:0; border-top:none; color:#b42318; font-size:12.5px; white-space:normal; }
</style>`;
