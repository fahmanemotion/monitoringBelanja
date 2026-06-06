/* ================================================================
   SIPADU v2 — index.js
   Parser : SAKTI GLP039 Laporan Fa Detail 16 Segmen
   Backend: Supabase (PostgreSQL)
   ================================================================ */

/* ── Supabase Config ──────────────────────────────────────────── */
var SUPA_URL = 'https://npklotmmjighdrbgdjay.supabase.co';
var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wa2xvdG1tamlnaGRyYmdkamF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MjY2MTYsImV4cCI6MjA5NjMwMjYxNn0.3HBW7eptFLSm83vcqqHjFVFdvrPZIwhtxUdGAQpcsnE';

/**
 * supaFetch — wrapper fetch ke Supabase REST API
 * method : GET | POST | PATCH | DELETE
 * table  : nama tabel
 * opts   : { body, query, returning }
 */
async function supaFetch(method, table, opts) {
  opts = opts || {};
  var url = SUPA_URL + '/rest/v1/' + table;
  if (opts.query) url += '?' + opts.query;
  var headers = {
    'apikey':        SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY,
    'Content-Type':  'application/json',
    'Prefer':        opts.returning ? 'return=representation' : 'return=minimal',
  };
  var res = await fetch(url, {
    method:  method,
    headers: headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase ' + method + ' ' + table + ': ' + err);
  }
  if (method === 'DELETE' || !opts.returning) return null;
  var text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ── State ─────────────────────────────────────────────────── */
var APP = {
  theme:    'light',
  source:   'gabungan',  // gabungan | rm | blu
  pieSource:'gabungan',
  chartType:'bar',
  data:     [],          // parsed akun records
  filtered: [],          // after filter+search
  sort:     { col: null, dir: 'asc' },
  kegPage:  1,
  keuPage:  1,
  PER_PAGE: 25,
  KEU_PP:   30,
  meta:     { satker:'', ta:'', periode:'', kode_satker:'' },
  rawWb:    null,        // uploaded workbook
  blokir:   [],          // [{id, uraian, nilai, sumber}] — input manual dari pengaturan
  // targetBulanan: array 12 nilai (index 0=Jan .. 11=Des) dalam Rupiah
  // null = belum diset manual, akan dihitung otomatis dari pagu/12
  targetBulanan: [null,null,null,null,null,null,null,null,null,null,null,null],
  // realisasiBulanan: array 12 objek {nilai, namaFile, tanggalUpdate} atau null
  // Diisi dari upload FA Detail per bulan — tersimpan di localStorage terpisah
  realisasiBulanan: [null,null,null,null,null,null,null,null,null,null,null,null],
  realWb: null,    // workbook FA Detail yang sedang disiapkan upload
  realParsed: null, // {bulanIdx, nilai, namaFile} hasil parse sebelum disimpan
  viewMonth: -1,   // -1 = semua bulan, 0-11 = filter bulan tertentu
};
var CHARTS = {};

/* ── Boot ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  // Theme tetap di localStorage (preferensi lokal per browser)
  APP.theme = localStorage.getItem('sipadu_theme') || 'light';
  applyTheme(APP.theme);

  // Wire UI dulu sebelum async load
  wireSidebar();
  wireNavItems();
  wireSourceTabs();
  wirePills();
  wireFilters();
  wireUpload();
  wireRealUpload();
  wireTargetUpload();
  wireKeyboard();

  // Tampilkan loading state
  showLoadingState();

  // Load semua data dari Supabase secara async
  loadAllFromSupabase();
});

/**
 * showLoadingState — tampilkan indikator loading sebelum data siap
 */
function showLoadingState() {
  var kpiRow = document.getElementById('kpiRow');
  if (kpiRow) kpiRow.innerHTML =
    '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--t3)">' +
    '<i class="fas fa-circle-notch fa-spin" style="font-size:28px;display:block;margin-bottom:12px"></i>' +
    '<div style="font-size:14px;font-weight:600;color:var(--t2)">Memuat data dari Supabase...</div>' +
    '</div>';
}

/**
 * loadAllFromSupabase — muat semua data dari Supabase saat boot
 */
async function loadAllFromSupabase() {
  try {
    // Muat semua tabel secara paralel
    var results = await Promise.all([
      supaFetch('GET', 'sakti_data',        { query: 'select=*&order=id', returning: true }),
      supaFetch('GET', 'metadata',          { query: 'select=*', returning: true }),
      supaFetch('GET', 'blokir',            { query: 'select=*&order=id', returning: true }),
      supaFetch('GET', 'target_bulanan',    { query: 'select=*&order=bulan_idx', returning: true }),
      supaFetch('GET', 'realisasi_bulanan', { query: 'select=*&order=bulan_idx', returning: true }),
    ]);

    var saktiRows  = results[0] || [];
    var metaRows   = results[1] || [];
    var blokirRows = results[2] || [];
    var targetRows = results[3] || [];
    var realRows   = results[4] || [];

    // ── Data SAKTI ──
    APP.data = saktiRows.map(function(r) {
      return {
        id: r.id, kode: [r.prog_kode,r.kro_kode,r.ro_kode,r.akun_kode].filter(Boolean).join('.'),
        prog_kode: r.prog_kode, prog_nama: r.prog_nama,
        kro_kode:  r.kro_kode,  kro_nama:  r.kro_nama,
        ro_kode:   r.ro_kode,   ro_full:   r.ro_full, ro_nama: r.ro_nama,
        akun_kode: r.akun_kode, akun_nama: r.akun_nama,
        jenis: r.jenis, sumber: r.sumber,
        pagu: parseFloat(r.pagu)||0, realisasi: parseFloat(r.realisasi)||0,
        realisasi_lalu: parseFloat(r.realisasi_lalu)||0,
        realisasi_bulan: parseFloat(r.realisasi_bulan)||0,
        sisa: parseFloat(r.sisa)||0, persen: parseFloat(r.persen)||0,
        details: Array.isArray(r.details) ? r.details : (r.details ? JSON.parse(r.details) : []),
      };
    });

    // ── Metadata ──
    var metaMap = {};
    metaRows.forEach(function(r){ metaMap[r.key] = r.value; });
    if (metaMap.satker) APP.meta.satker      = metaMap.satker;
    if (metaMap.ta)     APP.meta.ta          = metaMap.ta;
    if (metaMap.periode)APP.meta.periode     = metaMap.periode;
    if (metaMap.kode_satker) APP.meta.kode_satker = metaMap.kode_satker;

    // ── Blokir ──
    APP.blokir = blokirRows.map(function(r){
      return { id: r.id, uraian: r.uraian, nilai: parseFloat(r.nilai)||0, sumber: r.sumber };
    });

    // ── Target Bulanan ──
    APP.targetBulanan  = new Array(12).fill(null);
    APP._targetDetail  = new Array(12).fill(null);
    targetRows.forEach(function(r){
      var i = r.bulan_idx;
      if (i >= 0 && i <= 11) {
        APP.targetBulanan[i]  = parseFloat(r.total) || null;
        APP._targetDetail[i]  = {
          r51: parseFloat(r.r51)||0, r52: parseFloat(r.r52)||0,
          r53: parseFloat(r.r53)||0, total: parseFloat(r.total)||0,
          src: r.src || 'upload'
        };
      }
    });

    // ── Realisasi Bulanan ──
    APP.realisasiBulanan = new Array(12).fill(null);
    realRows.forEach(function(r){
      var i = r.bulan_idx;
      if (i >= 0 && i <= 11) {
        APP.realisasiBulanan[i] = {
          nilai: parseFloat(r.nilai)||0,
          namaFile: r.nama_file || '',
          tanggalUpdate: r.tanggal_update || '',
        };
      }
    });

    APP.filtered = APP.data.slice();

    if (APP.data.length > 0) {
      buildFilterOpts();
      renderAll();
      updateOrgLabel();
    } else {
      showEmptyState();
      renderKPIs();
      renderBlokirTable();
      renderTargetBulananForm();
      renderRealisasiBulananTable();
    }

  } catch(err) {
    console.error('SIPADU Supabase load error:', err);
    toast('error', 'Gagal Load Data',
      'Tidak dapat terhubung ke database. Cek koneksi internet. (' + err.message + ')');
    showEmptyState();
    renderKPIs();
    renderBlokirTable();
    renderTargetBulananForm();
    renderRealisasiBulananTable();
  }
}

/* ── Empty state (no data loaded) ─────────────────────────── */
function showEmptyState() {
  // Catatan: kpiRow TIDAK dikosongkan di sini — renderKPIs() tetap menampilkan
  // kartu Anggaran Blokir dari localStorage walaupun data SAKTI belum diupload.
  document.getElementById('kegBadge').textContent = '0 Kegiatan';
  document.getElementById('kegInfo').textContent   = 'Belum ada data — upload file SAKTI terlebih dahulu';
  document.getElementById('kegBody').innerHTML =
    '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--t3)">' +
    '<i class="fas fa-database" style="font-size:28px;display:block;margin-bottom:10px"></i>' +
    'Belum ada data. Silakan upload file Excel SAKTI (GLP039).</td></tr>';
  document.getElementById('keuBadge').textContent = '0 Baris';
  document.getElementById('keuBody').innerHTML =
    '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--t3)">' +
    'Belum ada data.</td></tr>';
}

/* ── Full render ────────────────────────────────────────────── */
function renderAll() {
  renderKPIs();
  renderBulananChart();
  renderPieChart();
  renderKegTable();
  renderKeuTable();
  renderBlokirTable();
  renderTargetBulananForm();
  renderRealisasiBulananTable();
}

/* ── Theme ──────────────────────────────────────────────────── */
function applyTheme(t) {
  APP.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('sipadu_theme', t); } catch (e) {}
  var ic = document.getElementById('themeIc');
  if (ic) ic.className = t === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  // Update chart grid/tick colors
  Object.keys(CHARTS).forEach(function (k) {
    var c = CHARTS[k];
    if (!c || !c.options || !c.options.scales) return;
    var gc = t === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    var tc = t === 'dark' ? '#94a3b8' : '#64748b';
    Object.keys(c.options.scales).forEach(function (sk) {
      if (c.options.scales[sk].grid) c.options.scales[sk].grid.color = gc;
      if (c.options.scales[sk].ticks) c.options.scales[sk].ticks.color = tc;
    });
    c.update();
  });
}

/* ── Sidebar / Nav ──────────────────────────────────────────── */
function wireSidebar() {
  document.getElementById('hambBtn').addEventListener('click', function () {
    document.getElementById('sidebar').classList.toggle('mob-open');
    document.getElementById('sbOverlay').classList.toggle('mob-open');
  });
  document.getElementById('sbOverlay').addEventListener('click', function () {
    document.getElementById('sidebar').classList.remove('mob-open');
    document.getElementById('sbOverlay').classList.remove('mob-open');
  });
  document.getElementById('themeBtn').addEventListener('click', function () {
    applyTheme(APP.theme === 'light' ? 'dark' : 'light');
  });
}

function wireNavItems() {
  document.querySelectorAll('.nav-item[id]').forEach(function (el) {
    el.addEventListener('click', function () {
      switchPage(el.id.replace('nav-', ''), el);
    });
  });
}

function switchPage(pageId, navEl) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var pg = document.getElementById('page-' + pageId);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
  if (navEl) navEl.classList.add('active');
  var icons  = { dashboard: 'fa-gauge-high', keuangan: 'fa-coins', pengaturan: 'fa-gear' };
  var labels = { dashboard: 'Dashboard', keuangan: 'Modul Keuangan', pengaturan: 'Pengaturan' };
  var bci = document.getElementById('bcIcon');
  var bct = document.getElementById('bcText');
  if (bci) bci.className = 'fas ' + (icons[pageId] || 'fa-circle');
  if (bct) bct.textContent = labels[pageId] || pageId;
  if (window.innerWidth <= 680) {
    document.getElementById('sidebar').classList.remove('mob-open');
    document.getElementById('sbOverlay').classList.remove('mob-open');
  }
  if (pageId === 'dashboard') {
    setTimeout(function () {
      Object.keys(CHARTS).forEach(function (k) { if (CHARTS[k]) CHARTS[k].resize(); });
    }, 50);
  }
}

/* ── Source filter tabs ─────────────────────────────────────── */
function wireSourceTabs() {
  document.querySelectorAll('#srcTabs .src-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#srcTabs .src-tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      APP.source = btn.dataset.src;
      renderKPIs(); renderBulananChart();
    });
  });

  // Filter bulan periode
  var fb = document.getElementById('filterBulan');
  if (fb) {
    fb.addEventListener('change', function () {
      APP.viewMonth = parseInt(this.value, 10);
      updateOrgLabel();
      renderKPIs();
      renderBulananChart();
      renderPieChart();
    });
  }
}

/* ── Chart type / pie source pills ─────────────────────────── */
function wirePills() {
  document.querySelectorAll('#chartTypePills .pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#chartTypePills .pill').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      APP.chartType = btn.dataset.ctype;
      renderBulananChart();
    });
  });
  document.querySelectorAll('#pieSrcPills .pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#pieSrcPills .pill').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      APP.pieSource = btn.dataset.psrc;
      renderPieChart();
    });
  });
}

/* ── Filters ────────────────────────────────────────────────── */
/* ── Filter helpers ──────────────────────────────────────────────────────── */

/**
 * fillSelect — isi satu dropdown, pertahankan nilai yang sedang terpilih
 * kalau masih ada dalam list baru, reset ke '' kalau sudah tidak relevan.
 */
function fillSelect(selId, pairs, placeholder) {
  var el = document.getElementById(selId);
  if (!el) return;
  var prev = el.value;
  while (el.options.length > 1) el.remove(1);
  pairs.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p[0];
    o.textContent = p[1];
    el.appendChild(o);
  });
  // Pertahankan pilihan sebelumnya jika masih valid
  var stillValid = pairs.some(function (p) { return p[0] === prev; });
  el.value = stillValid ? prev : '';
}

/**
 * buildFilterOpts — isi dropdown Program saja (full list).
 * KRO/RO/Akun/Detail diisi oleh rebuildCascadeFilters() sesuai konteks.
 */
function buildFilterOpts() {
  // Program — selalu full list
  var progMap = {};
  APP.data.forEach(function (r) { if (r.prog_kode) progMap[r.prog_kode] = r.prog_nama; });
  var progPairs = Object.keys(progMap).sort().map(function (k) {
    return [k, k + ' — ' + (progMap[k] || '')];
  });
  fillSelect('fProg', progPairs);
  // Build cascade dari awal (tidak ada filter aktif)
  rebuildCascadeFilters();
}

/**
 * rebuildCascadeFilters — update dropdown KRO → RO → Akun → Detail
 * berdasarkan Program (dan KRO, RO, Akun) yang sudah dipilih.
 * Dipanggil setiap kali salah satu filter berubah.
 */
function rebuildCascadeFilters() {
  var prog   = (document.getElementById('fProg')     || {}).value || '';
  var kro    = (document.getElementById('fKRO')      || {}).value || '';
  var ro     = (document.getElementById('fRO')       || {}).value || '';
  var akun   = (document.getElementById('fAkun')     || {}).value || '';
  var sumber = (document.getElementById('fSumberKeg')|| {}).value || '';

  /* ── Helper filter dasar ── */
  function baseFilter(r) {
    if (prog   && r.prog_kode !== prog)  return false;
    if (kro    && r.kro_kode  !== kro)   return false;
    if (ro     && r.ro_full   !== ro)    return false;
    return true;
  }

  /* ── KRO: pool hanya dari Program (sumber tidak mempengaruhi KRO) ── */
  var kroMap = {};
  APP.data.filter(function(r){ return !prog || r.prog_kode === prog; })
    .forEach(function(r){ if (r.kro_kode) kroMap[r.kro_kode] = r.kro_nama; });
  fillSelect('fKRO', Object.keys(kroMap).sort().map(function(k){
    return [k, k + ' — ' + (kroMap[k] || '')];
  }));

  /* ── RO: pool dari Program + KRO ── */
  var roMap = {};
  APP.data.filter(function(r){
    return (!prog || r.prog_kode === prog) && (!kro || r.kro_kode === kro);
  }).forEach(function(r){ if (r.ro_full) roMap[r.ro_full] = r.ro_nama; });
  fillSelect('fRO', Object.keys(roMap).sort().map(function(k){
    return [k, k + ' — ' + (roMap[k] || '').substring(0, 55)];
  }));

  /* ── Akun: pool dari Program + KRO + RO + SUMBER DANA ──
     Jika Sumber Dana dipilih → hanya tampilkan akun milik sumber itu
     Prefix akun: 511/512 = RM pegawai, 521/522/523/524 = RM barang,
                  531/532/533 = RM modal, 525 = BLU                  */
  var akunMap = {};
  APP.data.filter(function(r){
    if (!baseFilter(r)) return false;
    if (sumber && r.sumber !== sumber) return false;  // ← filter sumber di akun
    return true;
  }).forEach(function(r){ if (r.akun_kode) akunMap[r.akun_kode] = r.akun_nama; });
  fillSelect('fAkun', Object.keys(akunMap).sort().map(function(k){
    return [k, k + ' — ' + (akunMap[k] || '')];
  }));

  /* ── Detail: pool dari Program + KRO + RO + Akun + Sumber Dana ── */
  var detailSet = {};
  APP.data.filter(function(r){
    if (!baseFilter(r)) return false;
    if (akun   && r.akun_kode !== akun)  return false;
    if (sumber && r.sumber    !== sumber) return false;
    return true;
  }).forEach(function(r){
    (r.details || []).forEach(function(d){ if (d.nama) detailSet[d.nama] = 1; });
  });
  fillSelect('fDetail', Object.keys(detailSet).sort().map(function(k){
    return [k, k];
  }));

  /* ── Sumber Dana: pool dari Program + KRO + RO + Akun + Detail ── */
  var detail = (document.getElementById('fDetail') || {}).value || '';
  var sumberSet = {};
  APP.data.filter(function(r){
    if (!baseFilter(r)) return false;
    if (akun && r.akun_kode !== akun) return false;
    if (detail) return (r.details||[]).some(function(d){ return d.nama===detail; });
    return true;
  }).forEach(function(r){ if (r.sumber) sumberSet[r.sumber] = 1; });
  var sumberPairs = [];
  if (sumberSet['rm'])  sumberPairs.push(['rm',  'RM']);
  if (sumberSet['blu']) sumberPairs.push(['blu', 'BLU']);
  fillSelect('fSumberKeg', sumberPairs);
}

function wireFilters() {
  // Program: rebuild semua filter turunan, lalu filter tabel
  var elProg = document.getElementById('fProg');
  if (elProg) elProg.addEventListener('change', function () {
    // Reset semua filter di bawah Program (termasuk Sumber Dana)
    ['fKRO','fRO','fAkun','fDetail','fSumberKeg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    rebuildCascadeFilters();
    applyFilters();
  });

  // KRO: rebuild RO/Akun/Detail, lalu filter tabel
  var elKRO = document.getElementById('fKRO');
  if (elKRO) elKRO.addEventListener('change', function () {
    ['fRO','fAkun','fDetail','fSumberKeg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    rebuildCascadeFilters();
    applyFilters();
  });

  // RO: rebuild Akun/Detail, lalu filter tabel
  var elRO = document.getElementById('fRO');
  if (elRO) elRO.addEventListener('change', function () {
    ['fAkun','fDetail','fSumberKeg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    rebuildCascadeFilters();
    applyFilters();
  });

  // Akun: rebuild Detail, lalu filter tabel
  var elAkun = document.getElementById('fAkun');
  if (elAkun) elAkun.addEventListener('change', function () {
    ['fDetail','fSumberKeg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    rebuildCascadeFilters();
    applyFilters();
  });

  // Detail: reset Sumber Dana, rebuild, lalu filter tabel
  var elDetail = document.getElementById('fDetail');
  if (elDetail) elDetail.addEventListener('change', function () {
    ['fSumberKeg'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    rebuildCascadeFilters();
    applyFilters();
  });

  // Sumber Dana: rebuild Akun + Detail (hanya akun sumber ini), lalu filter tabel
  var elSumber = document.getElementById('fSumberKeg');
  if (elSumber) elSumber.addEventListener('change', function () {
    // Reset Akun dan Detail karena pilihan berubah sesuai sumber
    ['fAkun', 'fDetail'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    rebuildCascadeFilters();
    applyFilters();
  });

  // Search
  var kq = document.getElementById('kegQ');
  if (kq) kq.addEventListener('input', applyFilters);
  var keuq = document.getElementById('keuQ');
  if (keuq) keuq.addEventListener('input', renderKeuTable);
}

function applyFilters() {
  var prog   = (document.getElementById('fProg')   || {}).value || '';
  var kro    = (document.getElementById('fKRO')    || {}).value || '';
  var ro     = (document.getElementById('fRO')     || {}).value || '';
  var akun   = (document.getElementById('fAkun')   || {}).value || '';
  var detail = (document.getElementById('fDetail')    || {}).value || '';
  var sumber = (document.getElementById('fSumberKeg') || {}).value || '';
  var q      = ((document.getElementById('kegQ')      || {}).value || '').toLowerCase().trim();

  APP.filtered = APP.data.filter(function (r) {
    if (prog   && r.prog_kode !== prog)   return false;
    if (kro    && r.kro_kode  !== kro)    return false;
    if (ro     && r.ro_full   !== ro)     return false;
    if (akun   && r.akun_kode !== akun)   return false;
    if (detail) {
      var found = (r.details || []).some(function (d) { return d.nama === detail; });
      if (!found) return false;
    }
    if (sumber && r.sumber !== sumber)    return false;
    if (q) {
      var hay = [r.kode, r.prog_kode, r.kro_kode, r.ro_kode,
                 r.akun_kode, r.akun_nama, r.ro_nama, r.prog_nama,
                 r.kro_nama].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  APP.kegPage = 1;
  renderKegTable();
}

/* ── KPI Summary ────────────────────────────────────────────── */
function computeSummary(src) {
  var rows = src === 'gabungan' ? APP.data : APP.data.filter(function (r) { return r.sumber === src; });
  var pagu = 0, real = 0, rl = 0, ri = 0;
  rows.forEach(function (r) {
    pagu += r.pagu; real += r.realisasi;
    rl   += r.realisasi_lalu || 0; ri += r.realisasi_bulan || 0;
  });

  // ── Filter bulan: jika viewMonth dipilih, gunakan data realisasi bulan tersebut ──
  var vm = APP.viewMonth;
  if (vm >= 0) {
    // Realisasi bulan terpilih — prioritas: upload FA Detail, fallback data SAKTI
    var rbArr = APP.realisasiBulanan;
    var rbItem = rbArr[vm];
    // Hitung curMonth dari meta
    var MMAP = {januari:0,februari:1,maret:2,april:3,mei:4,juni:5,
                juli:6,agustus:7,september:8,oktober:9,november:10,desember:11};
    var curM = 5;
    if (APP.meta.periode) {
      var pStr = APP.meta.periode.toLowerCase().split(' ')[0];
      if (MMAP[pStr] !== undefined) curM = MMAP[pStr];
    }
    if (rbItem !== null && rbItem !== undefined) {
      // Data dari upload FA Detail bulan ini
      real = rbItem.nilai;
      ri   = rbItem.nilai;
      rl   = 0;
    } else if (vm === curM) {
      // Bulan berjalan dari data SAKTI utama
      real = rows.reduce(function(s,r){ return s + (r.realisasi_bulan||0); }, 0);
      ri   = real; rl = 0;
    } else if (vm < curM) {
      // Estimasi bulan sebelumnya (distribusi merata dari realisasi_lalu)
      var totalRl = rows.reduce(function(s,r){ return s + (r.realisasi_lalu||0); }, 0);
      real = curM > 0 ? Math.round(totalRl / curM) : 0;
      ri = real; rl = 0;
    } else {
      // Bulan mendatang — realisasi 0
      real = 0; ri = 0; rl = 0;
    }
  }

  // Hitung total blokir sesuai filter sumber
  // Sumber blokir hanya RM atau BLU (tidak ada gabungan di input)
  // - Filter Gabungan : ambil semua blokir (RM + BLU)
  // - Filter RM       : hanya blokir sumber RM
  // - Filter BLU      : hanya blokir sumber BLU
  var blokir = 0;
  APP.blokir.forEach(function (b) {
    var match = (src === 'gabungan') || (b.sumber === src);
    if (match) blokir += b.nilai;
  });
  // Logika Pagu:
  // - paguEfektif = pagu dari FA Detail (nilai bersih yang bisa digunakan)
  // - paguTotal   = paguEfektif + blokir (pagu kotor sebelum dipotong blokir)
  var paguEfektif = pagu;          // nilai FA Detail = pagu efektif
  var paguTotal   = pagu + blokir; // pagu total termasuk yang diblokir
  var sisa = paguEfektif - real;
  var persenEfektif = paguEfektif > 0 ? (real / paguEfektif) * 100 : 0;
  var persen = paguTotal > 0 ? (real / paguTotal) * 100 : 0;
  return {
    pagu: paguTotal,          // ditampilkan sebagai Total Anggaran (FA + blokir)
    paguEfektif: paguEfektif, // ditampilkan sebagai Pagu Efektif (FA saja)
    real: real, rl: rl, ri: ri,
    sisa: sisa, blokir: blokir,
    persen: persen, persenEfektif: persenEfektif,
  };
}

function renderKPIs() {
  // Tetap render walau data belum ada — kartu blokir harus tampil dari localStorage
  var d   = computeSummary(APP.source);
  // Label sumber untuk judul kartu
  var lbl = APP.source === 'gabungan' ? 'Gabungan RM + BLU' : APP.source.toUpperCase();
  // Label blokir: sesuaikan dengan sumber dana blokir
  var blokirLbl = APP.source === 'gabungan' ? 'RM + BLU' : APP.source.toUpperCase();
  // Label periode untuk sub-text kartu
  var MNAMES = ['Januari','Februari','Maret','April','Mei','Juni',
                'Juli','Agustus','September','Oktober','November','Desember'];
  var periodeLabel = APP.viewMonth >= 0
    ? 'Periode ' + MNAMES[APP.viewMonth]
    : (APP.meta.periode ? 'Periode ' + APP.meta.periode : 'Semua Periode');
  var pct = d.persen.toFixed(2);
  var pctEfektif = d.persenEfektif.toFixed(2);
  var sp  = (100 - d.persen).toFixed(2);
  var paguEfektifPct = d.pagu > 0 ? (d.paguEfektif / d.pagu * 100) : 100;

  document.getElementById('kpiRow').innerHTML =
    // Kartu 1 — Total Anggaran dengan highlight Pagu Efektif
    kpiAnggaranHtml('k-ang', lbl, d.pagu, d.paguEfektif, d.blokir, periodeLabel) +
    // Kartu 2 — Anggaran Blokir: label selalu RM + BLU / sumber aktif
    kpiHtml('k-blokir','r','lock',
      'Anggaran Blokir (' + blokirLbl + ')',
      fmtM(d.blokir),
      d.blokir > 0
        ? 'Blokir / Pagu: ' + (d.pagu > 0 ? (d.blokir/d.pagu*100).toFixed(2) : '0') + '%'
        : 'Belum ada blokir — input di Pengaturan',
      Math.min(d.pagu > 0 ? (d.blokir / d.pagu * 100) : 0, 100), 'r-bar',
      'Blokir / Pagu', d.pagu > 0 ? (d.blokir/d.pagu*100).toFixed(2)+'%' : '0%') +
    // Kartu 3 — Total Realisasi
    kpiHtml('k-real','t','chart-line',
      'Total Realisasi (' + lbl + ')',
      fmtM(d.real),
      periodeLabel + '  |  ' + pctEfektif + '% dari Pagu Efektif',
      Math.min(d.persenEfektif, 100), 't',
      'Penyerapan Pagu Efektif', pctEfektif + '%') +
    // Kartu 4 — Sisa Anggaran
    kpiHtml('k-sisa','a','wallet',
      'Sisa Anggaran (' + lbl + ')',
      fmtM(d.sisa),
      sp + '% belum terserap',
      Math.min(100 - d.persen, 100), 'a',
      'Belum direalisasi', sp + '%');
}

/**
 * kpiAnggaranHtml — kartu Total Anggaran dengan highlight baris Pagu Efektif
 */
function kpiAnggaranHtml(cls, lbl, pagu, paguEfektif, blokir, periodeLabel) {
  var hasBlokir = blokir > 0;
  // Persentase pagu efektif terhadap pagu (untuk progress bar)
  var efektifPct = pagu > 0 ? Math.min((paguEfektif / pagu) * 100, 100) : 100;

  return '<div class="kpi ' + cls + '">' +
    // Header
    '<div class="kpi-hdr">' +
      '<span class="kpi-lbl">Total Anggaran (' + lbl + ')</span>' +
      '<div class="kpi-ic b"><i class="fas fa-file-invoice-dollar"></i></div>' +
    '</div>' +
    // Nilai pagu
    '<div class="kpi-val">' + fmtM(pagu) + '</div>' +
    '<div class="kpi-sub">' + periodeLabel + ' — Pagu DIPA ditetapkan</div>' +
    // Progress bar pagu efektif
    '<div class="kpi-bar-wrap">' +
      '<div class="kpi-track">' +
        '<div class="kpi-fill b" style="width:' + efektifPct.toFixed(1) + '%"></div>' +
      '</div>' +
    '</div>' +
    // Highlight Pagu Efektif
    '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;' +
      'background:' + (hasBlokir ? 'linear-gradient(90deg,rgba(26,86,219,.12),rgba(26,86,219,.06))' : 'rgba(26,86,219,.06)') + ';' +
      'border:1px solid rgba(26,86,219,' + (hasBlokir ? '.25' : '.12') + ')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
        '<span style="font-size:10.5px;font-weight:700;color:var(--blue);' +
          'text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:5px">' +
          '<i class="fas fa-shield-halved" style="font-size:11px"></i>' +
          'Pagu Efektif' +
        '</span>' +
        '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--blue)">' +
          fmtM(paguEfektif) +
        '</span>' +
      '</div>' +

    '</div>' +
  '</div>';
}

function kpiHtml(cls, ic, icon, lbl, val, sub, pct, fc, mL, mR) {
  // fc = 'r-bar' untuk kartu blokir (merah), lainnya pakai class CSS
  var barStyle = fc === 'r-bar'
    ? 'height:100%;border-radius:2px;background:linear-gradient(90deg,#c81e1e,#f87171);width:' + pct + '%'
    : '';
  var barClass = fc === 'r-bar' ? '' : 'kpi-fill ' + fc;
  return '<div class="kpi ' + cls + '">' +
    '<div class="kpi-hdr"><span class="kpi-lbl">' + lbl + '</span>' +
    '<div class="kpi-ic ' + ic + '"><i class="fas fa-' + icon + '"></i></div></div>' +
    '<div class="kpi-val">' + val + '</div>' +
    '<div class="kpi-sub">' + sub + '</div>' +
    '<div class="kpi-bar-wrap"><div class="kpi-track">' +
    '<div class="' + barClass + '" style="' + (barStyle || 'width:' + pct + '%') + '"></div></div>' +
    '<div class="kpi-meta"><span>' + mL + '</span><span>' + mR + '</span></div></div></div>';
}

/* ── Bulanan Chart ──────────────────────────────────────────── */
/* ── Helpers chart bulanan ───────────────────────────────────────────────── */

/**
 * getTargetPerBulan — ambil target per bulan (Juta Rp).
 * Prioritas: (1) input manual APP.targetBulanan, (2) distribusi otomatis dari pagu.
 * Distribusi otomatis menggunakan pola kurva-S sederhana (bobot rendah di awal/akhir).
 */
function getTargetPerBulan(totalPagu) {
  // Bobot kurva-S (12 bulan, total = 1.0)
  var BOBOT = [0.04, 0.06, 0.07, 0.08, 0.09, 0.10, 0.10, 0.10, 0.09, 0.09, 0.10, 0.08];
  return APP.targetBulanan.map(function (val, i) {
    if (val !== null && val !== undefined && val > 0) {
      // Gunakan total (r51+r52+r53) — sudah tersimpan di targetBulanan[i]
      return Math.round(val / 1e6);
    }
    return Math.round(totalPagu * BOBOT[i] / 1e6);  // distribusi otomatis
  });
}

/**
 * getRealPerBulan — distribusi realisasi per bulan (Juta Rp).
 * Bulan lalu: distribusi totalRl merata ke bulan 0..curMonth-1
 * Bulan ini  : totalRi langsung
 * Ke depan   : 0
 */
function getRealPerBulan(totalRl, totalRi, curMonth) {
  // Prioritas: (1) data upload FA Detail per bulan dari localStorage
  //            (2) fallback distribusi dari totalRl/totalRi data SAKTI utama
  var hasUpload = APP.realisasiBulanan.some(function(v){ return v !== null; });

  return Array.from({length: 12}, function (_, i) {
    // Gunakan data upload jika tersedia untuk bulan ini
    if (hasUpload) {
      var rb = APP.realisasiBulanan[i];
      if (rb !== null && rb !== undefined) return Math.round(rb.nilai / 1e6);
      // Bulan setelah bulan terakhir yg ada datanya → null
      var lastIdx = -1;
      APP.realisasiBulanan.forEach(function(v, j){ if (v !== null) lastIdx = j; });
      if (i > lastIdx) return null;
      return 0; // bulan sebelum data ada tapi tidak ada upload = 0
    }
    // Fallback: distribusi dari data SAKTI
    if (i < curMonth && curMonth > 0) return Math.round(totalRl / curMonth / 1e6);
    if (i === curMonth)               return Math.round(totalRi / 1e6);
    return null;
  });
}

/**
 * toCumulative — ubah array per-bulan menjadi kumulatif
 */
function toCumulative(arr) {
  var cum = 0;
  var stopped = false;
  return arr.map(function (v) {
    if (stopped || v === null) { stopped = true; return null; }
    cum += v;
    return cum;
  });
}

function renderBulananChart() {
  if (APP.data.length === 0) return;
  var rows = APP.source === 'gabungan' ? APP.data :
    APP.data.filter(function (r) { return r.sumber === APP.source; });

  var totalPagu = rows.reduce(function (s, r) { return s + r.pagu; }, 0);
  var totalRl   = rows.reduce(function (s, r) { return s + (r.realisasi_lalu || 0); }, 0);
  var totalRi   = rows.reduce(function (s, r) { return s + (r.realisasi_bulan || 0); }, 0);

  // Bulan berjalan dari meta periode
  var MONTH_MAP = { januari:0,februari:1,maret:2,april:3,mei:4,juni:5,
                    juli:6,agustus:7,september:8,oktober:9,november:10,desember:11 };
  var curMonth = 5;
  if (APP.meta.periode) {
    var p = APP.meta.periode.toLowerCase().split(' ')[0];
    if (MONTH_MAP[p] !== undefined) curMonth = MONTH_MAP[p];
  }

  var months    = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var tgtPerBln = getTargetPerBulan(totalPagu);
  var realPerBln = getRealPerBulan(totalRl, totalRi, curMonth);
  var tgtKumul  = toCumulative(tgtPerBln);
  var realKumul = toCumulative(realPerBln);

  var isBar     = APP.chartType === 'bar';
  var dataTarget = isBar ? tgtPerBln  : tgtKumul;
  var dataReal   = isBar ? realPerBln : realKumul;
  var lblTarget  = isBar ? 'Target per Bulan' : 'Target Kumulatif';
  var lblReal    = isBar ? 'Realisasi per Bulan' : 'Realisasi Kumulatif';

  // Warna bar: bulan terpilih lebih terang, lainnya lebih transparan
  var vm = APP.viewMonth;  // -1 = semua
  var barColorTarget = months.map(function(m, i) {
    if (!isBar) return 'transparent';
    return (vm === -1 || vm === i) ? 'rgba(26,86,219,.85)' : 'rgba(26,86,219,.18)';
  });
  var barColorReal = months.map(function(m, i) {
    if (!isBar) return 'transparent';
    return (vm === -1 || vm === i) ? 'rgba(14,159,110,.9)' : 'rgba(14,159,110,.2)';
  });

  var isDark = APP.theme === 'dark';
  var gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  var tc = isDark ? '#94a3b8' : '#64748b';

  var ctx2 = document.getElementById('cBulanan').getContext('2d');
  if (CHARTS.bulanan) CHARTS.bulanan.destroy();
  CHARTS.bulanan = new Chart(ctx2, {
    type: APP.chartType,
    data: {
      labels: months,
      datasets: [
        {
          label: lblTarget,
          data: dataTarget,
          backgroundColor: isBar ? barColorTarget : 'transparent',
          borderColor: '#1a56db',
          borderWidth: isBar ? 0 : 2.5,
          borderDash: isBar ? [] : [6, 3],   // garis putus-putus untuk target kumulatif
          borderRadius: 5,
          fill: false,
          tension: isBar ? 0 : 0.35,
          pointRadius: isBar ? 0 : 4,
          pointStyle: isBar ? 'rect' : 'circle',
          pointBackgroundColor: '#1a56db',
          order: 2,
        },
        {
          label: lblReal,
          data: dataReal,
          backgroundColor: isBar ? barColorReal : 'rgba(14,159,110,.08)',
          borderColor: '#0e9f6e',
          borderWidth: isBar ? 0 : 2.5,
          borderRadius: 5,
          fill: !isBar,                       // area fill untuk kurva S
          tension: isBar ? 0 : 0.4,
          pointRadius: isBar ? 0 : 5,
          pointStyle: isBar ? 'rect' : 'circle',
          pointBackgroundColor: '#0e9f6e',
          pointBorderColor: '#fff',
          pointBorderWidth: isBar ? 0 : 2,
          spanGaps: false,                    // jangan sambung titik null
          order: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: tc, usePointStyle: true, pointStyleWidth: 10,
            font: { family: "'DM Sans',sans-serif", size: 11 } },
        },
        // Judul tengah atas "KURVA S" hanya muncul pada mode line
        title: {
          display: !isBar,
          text: vm >= 0 ? 'KURVA S  —  ' + months[vm] : 'KURVA S',
          color: isDark ? '#e2e8f0' : '#0d1b2a',
          font: { family: "'DM Sans',sans-serif", size: 15, weight: '700' },
          padding: { top: 4, bottom: 4 },
          align: 'center',
        },
        tooltip: {
          backgroundColor: isDark ? '#1e2d45' : '#fff',
          titleColor: isDark ? '#e2e8f0' : '#0d1b2a',
          bodyColor: isDark ? '#94a3b8' : '#4a5568',
          borderColor: gc, borderWidth: 1, padding: 10, cornerRadius: 6,
          callbacks: {
            label: function (c) {
              return ' ' + c.dataset.label + ': Rp ' + c.parsed.y.toLocaleString('id-ID') + ' Jt';
            },
          },
        },
      },
      scales: {
        x: { grid: { color: gc }, ticks: { color: tc, font: { size: 11 } } },
        y: {
          grid: { color: gc },
          ticks: { color: tc, font: { size: 11 },
            callback: function (v) { return v >= 1000 ? Math.round(v/1000) + 'M' : v; },
          },
          title: {
            display: true,
            text: isBar ? 'Rp Juta (per bulan)' : 'Rp Juta (kumulatif)',
            color: tc, font: { size: 10 },
          },
        },
      },
    },
  });
}

/* ── Pie Chart ──────────────────────────────────────────────── */
function renderPieChart() {
  if (APP.data.length === 0) return;
  var rows = APP.pieSource === 'gabungan' ? APP.data :
    APP.data.filter(function (r) { return r.sumber === APP.pieSource; });

  // Always exactly 3 groups — classify by jenis field
  var groups = { 'Belanja Pegawai': 0, 'Belanja Barang': 0, 'Belanja Modal': 0 };
  rows.forEach(function (r) {
    var lbl = r.jenis === 'pegawai' ? 'Belanja Pegawai' :
              r.jenis === 'modal'   ? 'Belanja Modal'   : 'Belanja Barang';
    groups[lbl] += r.pagu;
  });

  var labels = Object.keys(groups);
  var values = Object.values(groups);
  var total  = values.reduce(function (a, b) { return a + b; }, 0);
  var colors = ['#1a56db', '#0e9f6e', '#c27803'];
  var isDark = APP.theme === 'dark';

  var ctx2 = document.getElementById('cPie').getContext('2d');
  if (CHARTS.pie) CHARTS.pie.destroy();
  CHARTS.pie = new Chart(ctx2, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: values, backgroundColor: colors,
      borderColor: isDark ? '#131e32' : '#fff', borderWidth: 3, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: function (c) { return ' ' + c.label + ': ' + fmtM(c.parsed); } },
          backgroundColor: isDark ? '#1e2d45' : '#fff',
          titleColor: isDark ? '#e2e8f0' : '#0d1b2a',
          bodyColor: isDark ? '#94a3b8' : '#4a5568',
          borderWidth: 1, padding: 10, cornerRadius: 6,
        },
      },
    },
  });

  document.getElementById('pieLegend').innerHTML = labels.map(function (l, i) {
    var pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0.0';
    return '<div class="leg-row">' +
      '<div class="leg-dot" style="background:' + colors[i] + '"></div>' +
      '<span>' + l + '</span>' +
      '<span class="leg-pct">' + pct + '%</span>' +
      '</div>';
  }).join('');
}

/* ── Kegiatan Table ─────────────────────────────────────────── */
function sortKeg(col) {
  if (APP.sort.col === col) APP.sort.dir = APP.sort.dir === 'asc' ? 'desc' : 'asc';
  else { APP.sort.col = col; APP.sort.dir = 'asc'; }
  APP.filtered.sort(function (a, b) {
    var va = a[col], vb = b[col];
    var cmp = typeof va === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''));
    return APP.sort.dir === 'asc' ? cmp : -cmp;
  });
  renderKegTable();
}

function renderKegTable() {
  if (APP.data.length === 0) { showEmptyState(); return; }
  var total = APP.filtered.length;
  var from  = (APP.kegPage - 1) * APP.PER_PAGE;
  var rows  = APP.filtered.slice(from, from + APP.PER_PAGE);
  var to    = Math.min(from + APP.PER_PAGE, total);

  document.getElementById('kegBadge').textContent = total + ' Kegiatan';
  document.getElementById('kegInfo').textContent = total === 0
    ? 'Tidak ada data ditemukan'
    : 'Menampilkan ' + (from + 1) + '–' + to + ' dari ' + total + ' kegiatan';

  var tbody = document.getElementById('kegBody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--t3)">' +
      '<i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:8px"></i>' +
      'Tidak ada data ditemukan</td></tr>';
  } else {
    var html = '';
    rows.forEach(function (r, idx) {
      var pc  = pctClass(r.persen);
      var src = srcChip(r.sumber);
      var rid = 'row-' + r.id;
      var hasDetails = r.details && r.details.length > 0;

      // Kode: Program.KRO.RO.Akun
      var kodeDisplay = [r.prog_kode, r.kro_kode, r.ro_kode, r.akun_kode]
        .filter(Boolean).join('.');

      html += '<tr class="detail-parent' + (hasDetails ? ' has-details' : '') + '" ' +
        (hasDetails ? 'onclick="toggleDetail(\'' + rid + '\')" style="cursor:pointer"' : '') +
        ' id="pr-' + rid + '">';
      html += '<td class="kode-cell" style="padding-left:' + (hasDetails ? '28px' : '12px') + '">' + kodeDisplay + '</td>';
      html += '<td>' +
        '<div class="uraian-cell">' + esc(r.akun_nama) +
        '<small>' + esc(r.kro_kode) + ' / ' + esc(r.ro_full) + ' — ' + esc(r.ro_nama || '').substring(0, 60) + '</small>' +
        '</div></td>';
      html += '<td>' + src + '</td>';
      html += '<td class="mono" style="text-align:right">' + fmtM(r.pagu) + '</td>';
      html += '<td class="mono" style="text-align:right;color:var(--teal)">' + fmtM(r.realisasi) + '</td>';
      html += '<td><span class="pct-badge ' + pc + '">' + r.persen.toFixed(2) + '%</span></td>';
      html += '</tr>';

      // Detail sub-rows (hidden by default)
      if (hasDetails) {
        html += '<tr class="detail-group" id="dg-' + rid + '" style="display:none">';
        html += '<td colspan="6" style="padding:0">';
        html += '<table style="width:100%;border-collapse:collapse">';
        r.details.forEach(function (d) {
          var dpc = pctClass(d.persen);
          html += '<tr class="detail-row">';
          html += '<td style="width:28px"></td>';
          html += '<td style="padding:6px 12px 6px 8px;font-size:11.5px;color:var(--t2)">' +
            '<i class="fas fa-angle-right" style="font-size:9px;color:var(--t3);margin-right:6px"></i>' +
            esc(d.nama) + '</td>';
          html += '<td style="padding:6px 12px;text-align:right;font-family:var(--mono);font-size:11px;color:var(--t2)">' + fmtM(d.pagu) + '</td>';
          html += '<td style="padding:6px 12px;text-align:right;font-family:var(--mono);font-size:11px;color:var(--teal)">' + fmtM(d.realisasi) + '</td>';
          html += '<td style="padding:6px 12px"><span class="pct-badge ' + dpc + '" style="font-size:10px">' + d.persen.toFixed(2) + '%</span></td>';
          html += '</tr>';
        });
        html += '</table></td></tr>';
      }
    });
    tbody.innerHTML = html;
    // Update expand arrows via CSS
    updateExpandArrows();
  }

  renderPagin('kegPagin', total, APP.kegPage, APP.PER_PAGE, 'goKeg');
}

function toggleDetail(rid) {
  var dg = document.getElementById('dg-' + rid);
  var pr = document.getElementById('pr-' + rid);
  if (!dg) return;
  var isOpen = dg.style.display !== 'none';
  dg.style.display = isOpen ? 'none' : 'table-row';
  if (pr) pr.classList.toggle('expanded', !isOpen);
}

function updateExpandArrows() {
  document.querySelectorAll('.detail-parent.has-details td:first-child').forEach(function (td) {
    if (!td.style.paddingLeft || td.style.paddingLeft === '12px') {
      td.style.paddingLeft = '28px';
    }
  });
}

function goKeg(p) { APP.kegPage = p; renderKegTable(); }

/* ── Keuangan Table ─────────────────────────────────────────── */
function renderKeuTable() {
  if (APP.data.length === 0) return;
  var q = ((document.getElementById('keuQ') || {}).value || '').toLowerCase().trim();
  var filtered = q ? APP.data.filter(function (r) {
    return [r.akun_kode, r.akun_nama, r.kode, r.ro_nama, r.kro_nama, r.prog_nama]
      .join(' ').toLowerCase().indexOf(q) !== -1;
  }) : APP.data;

  var total = filtered.length;
  var from  = (APP.keuPage - 1) * APP.KEU_PP;
  var rows  = filtered.slice(from, from + APP.KEU_PP);
  var to    = Math.min(from + APP.KEU_PP, total);

  document.getElementById('keuBadge').textContent = total + ' Baris';
  document.getElementById('keuInfo').textContent = total === 0
    ? 'Tidak ada data' : 'Menampilkan ' + (from + 1) + '–' + to + ' dari ' + total;

  var tbody = document.getElementById('keuBody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(function (r) {
    var pc = pctClass(r.persen);
    return '<tr>' +
      '<td class="mono">' + r.akun_kode + '</td>' +
      '<td><div class="uraian-cell">' + esc(r.akun_nama) +
        '<small>' + esc(r.ro_full) + ' — ' + esc((r.ro_nama || '').substring(0, 55)) + '</small></div></td>' +
      '<td>' + srcChip(r.sumber) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtM(r.pagu) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--teal)">' + fmtM(r.realisasi) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--amber)">' + fmtM(r.sisa) + '</td>' +
      '<td><span class="pct-badge ' + pc + '">' + r.persen.toFixed(2) + '%</span></td>' +
      '</tr>';
  }).join('');

  renderPagin('keuPagin', total, APP.keuPage, APP.KEU_PP, 'goKeu');
}

function goKeu(p) { APP.keuPage = p; renderKeuTable(); }

/* ── Pagination ─────────────────────────────────────────────── */
function renderPagin(containerId, total, page, perPage, fnName) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var pages = Math.ceil(total / perPage) || 1;
  var html = '<button class="pg" onclick="' + fnName + '(' + (page - 1) + ')"' +
    (page <= 1 ? ' disabled' : '') + '>‹</button>';
  for (var i = 1; i <= pages; i++) {
    var show = (i === 1 || i === pages || Math.abs(i - page) <= 2);
    var dots  = Math.abs(i - page) === 3;
    if (show) {
      html += '<button class="pg' + (i === page ? ' act' : '') + '" onclick="' + fnName + '(' + i + ')">' + i + '</button>';
    } else if (dots) {
      html += '<button class="pg" disabled>…</button>';
    }
  }
  html += '<button class="pg" onclick="' + fnName + '(' + (page + 1) + ')"' +
    (page >= pages ? ' disabled' : '') + '>›</button>';
  el.innerHTML = html;
}

/* ── SAKTI GLP039 Parser ────────────────────────────────────── */
/*
 * Hierarchy in file:
 * Col 1 = 'DL'        → program group header (skip)
 *       = 'DL.1975'   → program/kegiatan: code = '1975', name = col[8]
 * Col 2 = 'DAB'       → KRO: code = 'DAB', name = col[6]
 *       = 'DAB.002'   → RO: code = '002', full = 'DAB.002', name = col[10]
 * Col 4 = 51.0        → komponen: code = '051'
 * Col 5 = '051.0A'    → sub-komponen name = col[11]
 * Col 7 = 521211.0    → AKUN: code = '521211', name = col[12]
 * Col 13= '000001. ..'→ Detail item name (strip leading digits)
 *
 * Data cols:
 * col[16] = Pagu Revisi
 * col[22] = Realisasi Periode Lalu (cumulative prior months)
 * col[23] = Realisasi Periode Ini  (current month)
 * col[25] = Realisasi s.d. Periode (= 22+23, use this)
 * col[28] = % penyerapan (0–1 fraction)
 * col[30] = Sisa Anggaran
 */
function parseSaktiWorkbook(wb) {
  var ws = wb.Sheets[wb.SheetNames[0]];
  // Use raw:true so numbers stay numeric, defval null for empty
  var raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // ── Extract metadata (rows 0–6)
  var meta = { satker: '', ta: '', periode: '', kode_satker: '' };
  for (var mi = 0; mi < Math.min(7, raw.length); mi++) {
    var r0 = raw[mi][0] ? String(raw[mi][0]).trim() : '';
    var taM = r0.match(/TA\s*(\d{4})/);
    if (taM) meta.ta = taM[1];
    if (r0.indexOf('Periode') !== -1) meta.periode = r0.replace(/^Periode\s*/i, '').trim();
    if (r0.indexOf('Satuan Kerja') !== -1) {
      meta.kode_satker = raw[mi][14] ? String(raw[mi][14]).trim() : '';
      meta.satker      = raw[mi][15] ? String(raw[mi][15]).trim() : '';
    }
  }
  if (!meta.satker)  meta.satker  = 'Satuan Kerja';
  if (!meta.ta)      meta.ta      = new Date().getFullYear().toString();
  if (!meta.periode) meta.periode = '';

  // ── Helper functions
  function cv(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (s === 'null' || s === 'undefined' || s === '') return '';
    // Remove trailing '.0' from floats used as codes (e.g. 521211.0 → 521211)
    if (/^\d+\.0$/.test(s)) return s.slice(0, -2);
    return s;
  }
  function cn(v) {
    if (v === null || v === undefined) return 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function akunJenis(k) {
    if (!k) return 'barang';
    var c1 = k.charAt(0), c2 = k.charAt(1);
    if (c1 === '5' && c2 === '1') return 'pegawai';
    if (c1 === '5' && c2 === '3') return 'modal';
    return 'barang';
  }
  function akunSumber(k) {
    // 525xxx = BLU (Belanja Barang BLU); everything else = RM
    return (k && k.startsWith('525')) ? 'blu' : 'rm';
  }

  // ── Context trackers
  var ctx = {
    pg_kode: '', pg_nama: '',
    kro_kode: '', kro_nama: '',
    ro_kode: '', ro_full: '', ro_nama: '',
    ko_kode: '', sub_nama: '',
  };

  var records = [];
  var rowId   = 0;

  for (var i = 0; i < raw.length; i++) {
    if (i < 9) continue;  // skip title/header block
    var row = raw[i];
    if (!row) continue;

    var c0  = cv(row[0]);
    var c1  = cv(row[1]);
    var c2  = cv(row[2]);
    var c4  = cv(row[4]);
    var c5  = cv(row[5]);
    var c6  = cv(row[6]);
    var c7  = cv(row[7]);
    var c8  = cv(row[8]);
    var c10 = cv(row[10]);
    var c11 = cv(row[11]);
    var c12 = cv(row[12]);
    var c13 = cv(row[13]);

    // Skip footnote rows
    if (c1.indexOf('*') === 0 || c0.indexOf('*') === 0) continue;

    var pagu = cn(row[16]);

    // ── Classify row type by which column has content
    // Program group: col1 = 'DL', 'WA' (2 uppercase letters, no dot)
    if (c1 && /^[A-Z]{2}$/.test(c1)) {
      // just the group header — skip
      continue;
    }

    // Kegiatan: col1 = 'DL.1975', 'WA.4626'
    if (c1 && /^[A-Z]{2}\.\d{4}$/.test(c1)) {
      ctx.pg_kode = c1.split('.')[1];   // '1975'
      ctx.pg_nama = c8;
      ctx.kro_kode = ctx.kro_nama = ctx.ro_kode = ctx.ro_full = ctx.ro_nama = '';
      ctx.ko_kode = ctx.sub_nama = '';
      continue;
    }

    // KRO: col2 = 'DAB' (exactly 3 uppercase letters)
    if (c2 && /^[A-Z]{3}$/.test(c2)) {
      ctx.kro_kode = c2;
      ctx.kro_nama = c6;
      ctx.ro_kode = ctx.ro_full = ctx.ro_nama = '';
      ctx.ko_kode = ctx.sub_nama = '';
      continue;
    }

    // RO: col2 = 'DAB.002' (3 letters + dot + 3 digits)
    if (c2 && /^[A-Z]{3}\.\d{3}$/.test(c2)) {
      ctx.ro_full = c2;                  // 'DAB.002'
      ctx.ro_kode = c2.split('.')[1];    // '002'
      ctx.ro_nama = c10;
      ctx.ko_kode = ctx.sub_nama = '';
      continue;
    }

    // Komponen: col4 has numeric value (e.g. 51 from float 51.0)
    if (c4 && /^\d+$/.test(c4) && !c2 && !c1) {
      ctx.ko_kode = c4.padStart(3, '0'); // '051'
      continue;
    }

    // Sub-komponen: col5 has value like '051.0A' → name in col11
    if (c5) {
      ctx.sub_nama = c11;
      continue;
    }

    // ── AKUN row: col7 = 6-digit number string
    if (c7 && /^\d{6}$/.test(c7)) {
      if (pagu === 0) continue;
      var akNama = c12;
      var ak     = c7;
      var jenis  = akunJenis(ak);
      var sumber = akunSumber(ak);

      var real_lalu = cn(row[22]);
      var real_ini  = cn(row[23]);
      // col[25] is the authoritative cumulative; fall back to sum of lalu+ini
      var real_sd   = cn(row[25]);
      if (real_sd === 0 && (real_lalu + real_ini) > 0) real_sd = real_lalu + real_ini;

      var persen_raw = cn(row[28]);
      // col[28] is stored as 0–1 fraction in this file
      var persen = persen_raw <= 1 ? Math.round(persen_raw * 10000) / 100
                                   : Math.round(persen_raw * 100) / 100;
      var sisa = pagu - real_sd;

      rowId++;
      records.push({
        id:              rowId,
        kode:            [ctx.pg_kode, ctx.kro_kode, ctx.ro_kode, ak].filter(Boolean).join('.'),
        prog_kode:       ctx.pg_kode,
        prog_nama:       ctx.pg_nama,
        kro_kode:        ctx.kro_kode,
        kro_nama:        ctx.kro_nama,
        ro_kode:         ctx.ro_kode,
        ro_full:         ctx.ro_full,
        ro_nama:         ctx.ro_nama,
        akun_kode:       ak,
        akun_nama:       akNama,
        jenis:           jenis,
        sumber:          sumber,
        sub_nama:        ctx.sub_nama,
        pagu:            pagu,
        realisasi:       real_sd,
        realisasi_lalu:  real_lalu,
        realisasi_bulan: real_ini,
        sisa:            sisa,
        persen:          persen,
        details:         [],
      });
      continue;
    }

    // ── DETAIL row: col13 has value, parent akun already pushed
    if (c13 && records.length > 0 && pagu > 0) {
      // Strip leading numeric code like '000001. '
      var detNama = c13.replace(/^\d+\.\s*/, '').trim();
      if (!detNama) continue;

      var dRl  = cn(row[22]);
      var dRi  = cn(row[23]);
      var dSd  = cn(row[25]);
      if (dSd === 0 && (dRl + dRi) > 0) dSd = dRl + dRi;
      var dRaw = cn(row[28]);
      var dPct = dRaw <= 1 ? Math.round(dRaw * 10000) / 100 : Math.round(dRaw * 100) / 100;

      records[records.length - 1].details.push({
        nama:      detNama,
        pagu:      pagu,
        realisasi: dSd,
        persen:    dPct,
      });
    }
  }

  return { meta: meta, records: records };
}

/* ── Upload wiring ──────────────────────────────────────────── */
function wireUpload() {
  var openFn = function () { document.getElementById('uploadModal').classList.add('open'); };
  var ids = ['uploadBtn', 'keuUploadBtn', 'setUploadBtn'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', openFn);
  });
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('btnProcess').addEventListener('click', processUpload);

  var fi = document.getElementById('fileInput');
  fi.addEventListener('change', function () { handleFile(this.files); });

  var dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function ()  { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault(); dz.classList.remove('drag-over'); handleFile(e.dataTransfer.files);
  });
}

function closeModal() {
  document.getElementById('uploadModal').classList.remove('open');
  document.getElementById('filePreview').style.display = 'none';
  var up = document.getElementById('uploadProgress');
  if (up) up.style.display = 'none';
  document.getElementById('btnProcess').disabled = true;
  document.getElementById('fileInput').value = '';
  APP.rawWb = null;
}

function handleFile(files) {
  if (!files || !files[0]) return;
  var f = files[0];
  if (!/\.(xlsx|xls)$/i.test(f.name)) {
    toast('error', 'Format Salah', 'Hanya file .xlsx atau .xls yang didukung'); return;
  }
  document.getElementById('fileName').textContent = f.name;
  document.getElementById('filePreview').style.display = 'block';

  var up  = document.getElementById('uploadProgress');
  var lbl = document.getElementById('upbarLbl');
  var bar = document.getElementById('upbarFill');
  if (up) { up.style.display = 'block'; bar.style.width = '20%'; lbl.textContent = 'Membaca file...'; }

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      bar.style.width = '60%'; lbl.textContent = 'Mengurai struktur SAKTI...';
      // Use raw:true to keep numbers numeric, not converted to strings
      APP.rawWb = XLSX.read(e.target.result, { type: 'binary', raw: false });
      bar.style.width = '100%'; lbl.textContent = 'Siap — klik Proses Data';
      document.getElementById('btnProcess').disabled = false;
      toast('info', 'File Siap', 'Klik "Proses Data" untuk mengimpor ke dashboard.');
    } catch (err) {
      toast('error', 'Gagal Membaca', 'File tidak dapat dibaca: ' + err.message);
      if (up) up.style.display = 'none';
    }
  };
  reader.readAsBinaryString(f);
}

async function processUpload() {
  if (!APP.rawWb) { toast('error', 'Tidak Ada File', 'Pilih file terlebih dahulu'); return; }
  var lbl = document.getElementById('upbarLbl');
  var bar = document.getElementById('upbarFill');
  if (lbl) { lbl.textContent = 'Memproses data...'; bar.style.width = '50%'; }

  // Use async IIFE so UI repaints and we can use await
  await new Promise(function(resolve){ setTimeout(resolve, 50); });
  try {
    var result = parseSaktiWorkbook(APP.rawWb);
      if (!result.records || result.records.length === 0) {
        toast('error', 'Gagal Parse',
          'Tidak ada data akun ditemukan. Pastikan file adalah GLP039 format 16 Segmen.');
        return;
      }
      if (bar) bar.style.width = '90%';
      APP.meta     = result.meta;
      APP.data     = result.records;
      APP.filtered = result.records.slice();
      APP.kegPage  = 1;
      APP.keuPage  = 1;

      // Simpan ke Supabase
      try {
        await supaFetch('DELETE', 'sakti_data', { query: 'id=gt.0' });
        await supaFetch('DELETE', 'metadata',   { query: 'key=neq.null' });
        var batchSize = 500;
        for (var bi = 0; bi < result.records.length; bi += batchSize) {
          var batch = result.records.slice(bi, bi + batchSize).map(function(r) {
            return {
              satker: result.meta.satker, kode_satker: result.meta.kode_satker,
              ta: result.meta.ta, periode: result.meta.periode,
              prog_kode: r.prog_kode, prog_nama: r.prog_nama,
              kro_kode: r.kro_kode, kro_nama: r.kro_nama,
              ro_kode: r.ro_kode, ro_full: r.ro_full, ro_nama: r.ro_nama,
              akun_kode: r.akun_kode, akun_nama: r.akun_nama,
              jenis: r.jenis, sumber: r.sumber,
              pagu: r.pagu, realisasi: r.realisasi,
              realisasi_lalu: r.realisasi_lalu, realisasi_bulan: r.realisasi_bulan,
              sisa: r.sisa, persen: r.persen,
              details: r.details || [],
            };
          });
          await supaFetch('POST', 'sakti_data', { body: batch, returning: false });
        }
        var metaRows = [
          { key: 'satker',      value: result.meta.satker      || '' },
          { key: 'ta',          value: result.meta.ta          || '' },
          { key: 'periode',     value: result.meta.periode     || '' },
          { key: 'kode_satker', value: result.meta.kode_satker || '' },
        ];
        await supaFetch('POST', 'metadata', {
          query: 'on_conflict=key', body: metaRows, returning: false,
        });
      } catch(saveErr) {
        toast('error','Gagal Simpan','Tidak tersimpan ke database: ' + saveErr.message);
      }

      buildFilterOpts();
      // Default view = bulan yang sesuai periode file
      var _MMAP = {januari:0,februari:1,maret:2,april:3,mei:4,juni:5,
                   juli:6,agustus:7,september:8,oktober:9,november:10,desember:11};
      APP.viewMonth = -1; // reset ke semua bulan saat upload baru
      var _fbEl = document.getElementById('filterBulan');
      if (_fbEl) _fbEl.value = '-1';
      updateOrgLabel();
      renderAll();
      if (bar) bar.style.width = '100%';
      closeModal();
      toast('success', 'Import Berhasil',
        result.records.length + ' akun berhasil diimpor dari ' +
        APP.meta.satker + ' (TA ' + APP.meta.ta + ')');
    } catch (err) {
      toast('error', 'Error Parsing', err.message);
      console.error(err);
    }
}

/* ── Org label ──────────────────────────────────────────────── */
function updateOrgLabel() {
  var MONTHS_FULL = ['Januari','Februari','Maret','April','Mei','Juni',
                     'Juli','Agustus','September','Oktober','November','Desember'];
  var el = document.getElementById('orgSub');
  var ta = document.getElementById('taLabel');
  if (el) {
    var parts = [APP.meta.satker || 'Satuan Kerja'];
    if (APP.viewMonth >= 0) {
      parts.push('Periode ' + MONTHS_FULL[APP.viewMonth] + (APP.meta.ta ? ' ' + APP.meta.ta : ''));
    } else if (APP.meta.periode) {
      parts.push('Periode ' + APP.meta.periode);
    }
    el.textContent = parts.join(' — ');
  }
  if (ta) ta.textContent = 'TA ' + (APP.meta.ta || new Date().getFullYear());
}

/* ── Reset ──────────────────────────────────────────────────── */
async function resetData() {
  if (!confirm('Reset semua data SAKTI? (Data realisasi bulanan tidak akan dihapus)')) return;
  try {
    await supaFetch('DELETE', 'sakti_data', { query: 'id=gt.0' });
    await supaFetch('DELETE', 'metadata',   { query: 'key=neq.null' });
    await supaFetch('DELETE', 'blokir',     { query: 'id=gt.0' });
    await supaFetch('DELETE', 'target_bulanan', { query: 'id=gt.0' });
    // Realisasi bulanan TIDAK dihapus (terkunci)
  } catch(e) {
    console.warn('resetData Supabase error:', e.message);
  }
  APP.data = []; APP.filtered = []; APP.blokir = [];
  APP.targetBulanan = [null,null,null,null,null,null,null,null,null,null,null,null];
  APP._targetDetail = null;
  APP.meta = { satker:'', ta:'', periode:'', kode_satker:'' };
  APP.kegPage = 1; APP.keuPage = 1; APP.rawWb = null;
  if (CHARTS.bulanan) { CHARTS.bulanan.destroy(); CHARTS.bulanan = null; }
  if (CHARTS.pie)     { CHARTS.pie.destroy();     CHARTS.pie     = null; }
  ['fProg','fKRO','fRO','fAkun','fDetail'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) while (el.options.length > 1) el.remove(1);
  });
  renderBlokirTable();
  renderTargetBulananForm();
  showEmptyState();
  toast('info','Reset','Data telah dihapus. Upload file SAKTI untuk memuat data baru.');
}


/* ── Anggaran Blokir ─────────────────────────────────────────── */

/**
 * formatBlokirInput — auto-format angka saat mengetik di field nilai blokir
 * Contoh: "5000000000" → "5.000.000.000"
 */
function formatBlokirInput(el) {
  var raw = el.value.replace(/[^0-9]/g, '');
  if (raw === '') { el.value = ''; return; }
  el.value = parseInt(raw, 10).toLocaleString('id-ID');
}

/**
 * addBlokir — tambahkan entry blokir baru dari form input
 */
async function addBlokir() {
  var uraian   = (document.getElementById('blokirUraian').value || '').trim();
  var nilaiStr = (document.getElementById('blokirNilai').value || '').replace(/[^0-9]/g, '');
  var sumber   = document.getElementById('blokirSumber').value;

  if (!uraian) { toast('error', 'Uraian Kosong', 'Isi keterangan blokir terlebih dahulu'); return; }
  if (!nilaiStr || parseInt(nilaiStr,10) === 0) {
    toast('error', 'Nilai Tidak Valid', 'Masukkan nilai blokir yang valid'); return;
  }

  var nilai = parseInt(nilaiStr, 10);
  try {
    var rows = await supaFetch('POST', 'blokir',
      { body: { uraian: uraian, nilai: nilai, sumber: sumber }, returning: true });
    var saved = rows && rows[0];
    if (!saved) throw new Error('Tidak ada data dikembalikan');
    APP.blokir.push({ id: saved.id, uraian: saved.uraian, nilai: parseFloat(saved.nilai), sumber: saved.sumber });
    document.getElementById('blokirUraian').value = '';
    document.getElementById('blokirNilai').value  = '';
    renderBlokirTable();
    renderKPIs();
    toast('success', 'Blokir Ditambahkan', uraian + ' — ' + fmtM(nilai) + ' (' + sumber.toUpperCase() + ')');
  } catch(e) {
    toast('error', 'Gagal Simpan', 'Tidak dapat menyimpan ke database: ' + e.message);
  }
}

/**
 * deleteBlokir — hapus satu entry blokir berdasarkan id
 */
async function deleteBlokir(id) {
  id = Number(id);
  try {
    await supaFetch('DELETE', 'blokir', { query: 'id=eq.' + id });
    APP.blokir = APP.blokir.filter(function(b){ return Number(b.id) !== id; });
    renderBlokirTable();
    renderKPIs();
    toast('info', 'Dihapus', 'Entry blokir telah dihapus');
  } catch(e) {
    toast('error', 'Gagal Hapus', e.message);
  }
}

/**
 * clearAllBlokir — hapus semua entry blokir
 */
async function clearAllBlokir() {
  var count = APP.blokir.length;
  if (count === 0) { toast('info', 'Kosong', 'Tidak ada data blokir'); return; }
  if (!confirm('Hapus semua ' + count + ' entry anggaran blokir?')) return;
  try {
    await supaFetch('DELETE', 'blokir', { query: 'id=gt.0' });
    APP.blokir = [];
    renderBlokirTable();
    renderKPIs();
    toast('info', 'Semua Dihapus', 'Seluruh anggaran blokir telah dihapus');
  } catch(e) {
    toast('error', 'Gagal Hapus', e.message);
  }
}

/**
 * saveBlokirToStorage — simpan ke localStorage
 */
function saveBlokirToStorage() {
  // Wrapper sinkron — tidak dipanggil langsung lagi
  // Simpan via addBlokir / deleteBlokir yang sudah async
}

/**
 * renderBlokirTable — render tabel daftar blokir di halaman Pengaturan
 */
function renderBlokirTable() {
  var tbody = document.getElementById('blokirBody');
  var badge = document.getElementById('blokirCount');
  var totalEl = document.getElementById('blokirTotalDisplay');
  if (!tbody) return;

  var total = APP.blokir.reduce(function (s, b) { return s + b.nilai; }, 0);
  if (badge)   badge.textContent = APP.blokir.length + ' Item';
  if (totalEl) totalEl.textContent = fmtM(total);

  if (APP.blokir.length === 0) {
    tbody.innerHTML = '<tr id="blokirEmpty"><td colspan="5" style="text-align:center;padding:24px;color:var(--t3)">' +
      '<i class="fas fa-unlock" style="font-size:20px;display:block;margin-bottom:8px"></i>' +
      'Belum ada anggaran blokir</td></tr>';
    return;
  }

  var sumberLabel = { rm: 'RM', blu: 'BLU', gabungan: 'RM + BLU' };
  tbody.innerHTML = APP.blokir.map(function (b, i) {
    var src = b.sumber === 'rm'
      ? '<span class="src-rm">RM</span>'
      : '<span class="src-blu">BLU</span>';
    return '<tr>' +
      '<td style="color:var(--t3);font-size:12px">' + (i + 1) + '</td>' +
      '<td style="font-weight:600;color:var(--t1)">' + esc(b.uraian) + '</td>' +
      '<td>' + src + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--red)">' + fmtM(b.nilai) + '</td>' +
      '<td style="text-align:center">' +
        '<button onclick="deleteBlokir(' + b.id + ')" ' +
          'style="width:28px;height:28px;border-radius:var(--r1);' +
          'background:var(--red-l);color:var(--red);font-size:12px;' +
          'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:none">' +
          '<i class="fas fa-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).join('');
}


/* ── Target Bulanan via Upload Excel ─────────────────────────────────────── */

var MONTHS_TARGET = ['Januari','Februari','Maret','April','Mei','Juni',
                     'Juli','Agustus','September','Oktober','November','Desember'];

/**
 * saveTargetBulanan — simpan ke localStorage
 */
async function saveTargetBulanan() {
  try {
    var rows = [];
    for (var i = 0; i < 12; i++) {
      var d = APP._targetDetail && APP._targetDetail[i];
      if (!d) continue;
      rows.push({
        bulan_idx:  i,
        r51:        d.r51   || 0,
        r52:        d.r52   || 0,
        r53:        d.r53   || 0,
        total:      d.total || 0,
        src:        d.src   || 'upload',
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length === 0) return;
    // Upsert (insert or update) berdasarkan bulan_idx
    await supaFetch('POST', 'target_bulanan', {
      query: 'on_conflict=bulan_idx',
      body: rows,
      returning: false,
    });
  } catch(e) {
    console.warn('saveTargetBulanan error:', e.message);
    toast('error','Gagal Simpan Target', e.message);
  }
}

/**
 * wireTargetUpload — hubungkan drop zone upload target
 */
function wireTargetUpload() {
  var fi = document.getElementById('targetFileInput');
  if (fi) fi.addEventListener('change', function(){ handleTargetFile(this.files); });
  var dz = document.getElementById('targetDropZone');
  if (!dz) return;
  dz.addEventListener('dragover',  function(e){ e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function(){ dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e){
    e.preventDefault(); dz.classList.remove('drag-over');
    handleTargetFile(e.dataTransfer.files);
  });
}

/**
 * handleTargetFile — parse file Detail Indikator Halaman 3 DIPA
 * Kolom: [4]=Periode('01'..'12'), [5]=R51, [6]=R52, [7]=R53
 * Nilai pakai prefix tanda kutip ('956214988) — strip sebelum parse
 */
function handleTargetFile(files) {
  if (!files || !files[0]) return;
  var f = files[0];
  if (!/\.(xlsx|xls)$/i.test(f.name)) {
    toast('error','Format Salah','Hanya .xlsx atau .xls yang didukung'); return;
  }

  var lbl  = document.getElementById('targetUpbarLbl');
  var bar  = document.getElementById('targetUpbarFill');
  var prog = document.getElementById('targetUploadProgress');
  var prev = document.getElementById('targetFilePreview');
  var span = document.getElementById('targetFileName');
  var btn  = document.getElementById('btnSimpanTarget');

  if (prog) prog.style.display = 'block';
  if (prev) prev.style.display = 'block';
  if (span) span.textContent   = f.name;
  if (lbl)  lbl.textContent    = 'Membaca file...';
  if (bar)  bar.style.width    = '20%';
  if (btn)  btn.disabled = true;

  var reader = new FileReader();
  reader.onload = function(e2) {
    try {
      if (bar) bar.style.width = '55%';
      if (lbl) lbl.textContent = 'Mengurai Rencana 51 + 52 + 53...';

      // raw:true → nilai angka tetap number, tidak diformat → konsisten di semua browser
      var wb  = XLSX.read(e2.target.result, { type:'binary', raw:true });
      var ws  = wb.Sheets[wb.SheetNames[0]];
      // raw:true → number tetap number; string cell (prefix ') tetap string
      var raw = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null });

      /* helper: parse nilai ke number
         Handle: raw number, string dengan prefix kutip, scientific notation,
         format ribuan dengan titik/koma, format desimal dengan koma */
      function pn(v) {
        if (v === null || v === undefined || v === '') return 0;
        // Jika sudah number (dari raw:true), langsung pakai
        if (typeof v === 'number') return isNaN(v) ? 0 : Math.abs(v);
        var s = String(v).trim()
                  .replace(/^['"]+/, '').replace(/['"]+$/, '')  // strip kutip
                  .replace(/\s/g, '');                          // hapus spasi
        if (!s) return 0;
        // Scientific notation: 9.56E+8 → langsung parseFloat bisa
        if (/[eE]/.test(s)) {
          var n = parseFloat(s.replace(',','.'));
          return isNaN(n) ? 0 : Math.abs(n);
        }
        // Format ribuan Indonesia: 1.234.567 (titik = ribuan, koma = desimal)
        if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
          return Math.abs(parseFloat(s.replace(/\./g,'')) || 0);
        }
        // Format ribuan: 1.234,56
        if (/\.\d{3},/.test(s) || /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
          s = s.replace(/\./g,'').replace(',','.');
        // Format: 1,234.56
        } else if (/,\d{3}\./.test(s) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
          s = s.replace(/,/g,'');
        // Format koma desimal saja: 1234,56
        } else if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) {
          s = s.replace(',', '.');
        }
        var nn = parseFloat(s);
        return isNaN(nn) ? 0 : Math.abs(nn);
      }

      /* ── Parse Detail Indikator Halaman 3 DIPA ────────────────────────────
         Struktur file (FIXED — format KPPN tidak berubah):
           Row 3 (idx 2): header  — col[4]='Periode', col[5]='Rencana'
           Row 4 (idx 3): sub-hdr — col[5]='51', col[6]='52', col[7]='53'
           Row 5..16     : data   — col[4]=01..12, col[5]=R51, col[6]=R52, col[7]=R53
         CATATAN: col[5..28] semua punya sub-header '51','52','53' → JANGAN auto-detect,
                  selalu gunakan col 5,6,7 yang berada di bawah 'Rencana'.
         raw:true → angka sebagai number, text-cell sebagai string (mungkin dengan prefix ')
         Semua di-handle oleh pn() di bawah.                                        */

      console.log('[SIPADU Target] Total rows:', raw.length);
      console.log('[SIPADU Target] Sample row[4]:', raw[4]);

      var parsed = new Array(12).fill(null);
      var found  = 0;

      for (var ri = 0; ri < raw.length; ri++) {
        var row = raw[ri];
        if (!row || row.length < 8) continue;

        /* col[4] = Periode: harus berupa angka 1-12 (atau string '01'..'12') */
        var pVal = row[4];
        if (pVal === undefined || pVal === null || String(pVal).trim() === '') continue;
        var periodeStr = String(pVal).trim().replace(/^['"]+/, '').replace(/['"]+$/, '');
        var bIdx = parseInt(periodeStr, 10) - 1;
        if (isNaN(bIdx) || bIdx < 0 || bIdx > 11) continue;

        /* col[5]=Rencana 51, col[6]=Rencana 52, col[7]=Rencana 53 */
        var r51 = pn(row[5]);
        var r52 = pn(row[6]);
        var r53 = pn(row[7]);
        var tot = r51 + r52 + r53;

        /* Skip baris sub-header (nilai tidak masuk akal kecil) */
        if (tot === 0 && r51 === 0 && r52 === 0) continue;

        parsed[bIdx] = { r51: r51, r52: r52, r53: r53, total: tot, src: 'upload' };
        found++;
      }

      if (found === 0) {
        toast('error', 'Gagal Parse',
          'Data bulan tidak ditemukan. Pastikan file adalah ' +
          '"Detail Indikator Halaman 3 DIPA" dari KPPN (bukan file FA Detail SAKTI).');
        if (bar) bar.style.width = '0'; return;
      }

      var grandTotal = parsed.reduce(function(s,v){ return s + (v ? v.total : 0); }, 0);
      if (bar) bar.style.width = '100%';
      if (lbl) lbl.textContent = found + ' bulan dibaca — Total: ' + fmtM(grandTotal);
      if (btn) btn.disabled = false;

      APP._targetParsed = { data: parsed, namaFile: f.name, found: found };
      toast('info','File Siap', found + ' bulan target berhasil dibaca. Klik Simpan Target.');
    } catch(err) {
      toast('error','Gagal Parse', err.message);
      console.error(err);
    }
  };
  reader.readAsBinaryString(f);
}

/**
 * simpanTargetDariUpload — commit hasil parse ke APP state + localStorage
 */
async function simpanTargetDariUpload() {
  if (!APP._targetParsed) {
    toast('error','Belum Ada Data','Upload file terlebih dahulu'); return;
  }
  var p = APP._targetParsed;
  APP._targetDetail  = p.data;
  APP.targetBulanan  = p.data.map(function(v){ return v ? v.total : null; });
  await saveTargetBulanan();
  renderTargetBulananForm();
  renderBulananChart();

  // Reset UI upload
  APP._targetParsed = null;
  var fi = document.getElementById('targetFileInput');
  if (fi) fi.value = '';
  var prev = document.getElementById('targetFilePreview');
  var prog = document.getElementById('targetUploadProgress');
  var btn  = document.getElementById('btnSimpanTarget');
  if (prev) prev.style.display = 'none';
  if (prog) prog.style.display = 'none';
  if (btn)  btn.disabled = true;

  toast('success','Target Tersimpan',
    p.found + ' bulan target diimpor dari ' + p.namaFile);
}

/**
 * resetTargetBulanan — hapus semua target, kembali ke kurva S otomatis
 */
async function resetTargetBulanan() {
  var count = (APP.targetBulanan || []).filter(function(v){ return v; }).length;
  if (count === 0) { toast('info','Kosong','Belum ada data target'); return; }
  if (!confirm('Reset semua target ke distribusi otomatis kurva S?')) return;
  APP.targetBulanan  = [null,null,null,null,null,null,null,null,null,null,null,null];
  APP._targetDetail  = null;
  APP._targetParsed  = null;
  await saveTargetBulanan();
  renderTargetBulananForm();
  renderBulananChart();
  toast('info','Target Direset','Semua target kembali ke distribusi otomatis.');
}

/**
 * startEditTarget — aktifkan mode edit satu baris bulan (idx 0-11)
 */
function startEditTarget(idx) {
  var d   = APP._targetDetail && APP._targetDetail[idx];
  var r51 = d ? (d.r51 || 0) : 0;
  var r52 = d ? (d.r52 || 0) : 0;
  var r53 = d ? (d.r53 || 0) : 0;
  var fmt = function(n){ return n > 0 ? parseInt(n).toLocaleString('id-ID') : ''; };

  var inputStyle =
    'width:100%;padding:3px 7px;border:1.5px solid #1a56db;border-radius:4px;' +
    'background:var(--card);color:var(--t1);font-family:var(--mono);' +
    'font-size:11.5px;text-align:right;outline:none;box-sizing:border-box';

  /* Ganti tiga sel nilai menjadi input */
  ['ti51','ti52','ti53'].forEach(function(pfx, ki) {
    var cell = document.getElementById('tc_' + pfx + '_' + idx);
    if (!cell) return;
    var vals = [r51, r52, r53];
    cell.innerHTML =
      '<input id="inp_' + pfx + '_' + idx + '" type="text" ' +
      'value="' + fmt(vals[ki]) + '" placeholder="0" ' +
      'oninput="fmtTargetInput(this)" style="' + inputStyle + '"/>';
  });

  /* Tombol Simpan / Batal */
  var actCell = document.getElementById('tc_act_' + idx);
  if (actCell) {
    actCell.innerHTML =
      '<button onclick="commitEditTarget(' + idx + ')" ' +
        'style="padding:3px 10px;background:var(--blue);color:#fff;border:none;' +
        'border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;margin-right:4px">' +
        '<i class="fas fa-check"></i></button>' +
      '<button onclick="cancelEditTarget(' + idx + ')" ' +
        'style="padding:3px 10px;background:var(--bg);color:var(--t2);border:1px solid var(--bd);' +
        'border-radius:4px;font-size:11px;cursor:pointer">' +
        '<i class="fas fa-times"></i></button>';
  }

  /* Fokus ke input pertama */
  var first = document.getElementById('inp_ti51_' + idx);
  if (first) { first.focus(); first.select(); }
}

/**
 * fmtTargetInput — format angka dengan pemisah ribuan saat mengetik
 */
function fmtTargetInput(el) {
  var raw = el.value.replace(/[^0-9]/g, '');
  el.value = raw ? parseInt(raw, 10).toLocaleString('id-ID') : '';
}

/**
 * commitEditTarget — simpan hasil edit satu baris, hitung ulang total
 */
async function commitEditTarget(idx) {
  function readInput(pfx) {
    var el = document.getElementById('inp_' + pfx + '_' + idx);
    if (!el) return 0;
    var raw = el.value.replace(/[^0-9]/g, '');
    return raw ? parseInt(raw, 10) : 0;
  }
  var r51  = readInput('ti51');
  var r52  = readInput('ti52');
  var r53  = readInput('ti53');
  var tot  = r51 + r52 + r53;

  if (!APP._targetDetail) APP._targetDetail = new Array(12).fill(null);
  APP._targetDetail[idx]  = { r51: r51, r52: r52, r53: r53, total: tot, src: 'manual' };
  APP.targetBulanan[idx]  = tot > 0 ? tot : null;

  await saveTargetBulanan();
  renderTargetBulananForm();   /* re-render penuh untuk update semua */
  renderBulananChart();
  toast('success', 'Target Disimpan',
    MONTHS_TARGET[idx] + ': ' + fmtM(tot));
}

/**
 * cancelEditTarget — batalkan edit, kembalikan ke tampilan read-only
 */
function cancelEditTarget(idx) {
  renderTargetBulananForm();  /* cukup re-render ulang */
}

/**
 * renderTargetBulananForm — render tabel target di halaman Pengaturan
 * Setiap baris: Bulan | R51 (read) | R52 (read) | R53 (read) | Total (read) | Status | Edit
 */
function renderTargetBulananForm() {
  var tbody = document.getElementById('targetBulananBody');
  if (!tbody) return;

  var detail = APP._targetDetail;
  if (!detail) {
    try {
      var ds = localStorage.getItem('sipadu_target_detail_v3');
      if (ds) { detail = JSON.parse(ds); APP._targetDetail = detail; }
    } catch(e) {}
  }

  var totalAll = 0, count = 0;

  tbody.innerHTML = MONTHS_TARGET.map(function(mNama, i) {
    var v   = APP.targetBulanan[i];
    var d   = detail && detail[i];
    var r51 = d ? (d.r51 || 0) : 0;
    var r52 = d ? (d.r52 || 0) : 0;
    var r53 = d ? (d.r53 || 0) : 0;
    var tot = d ? (d.total || r51+r52+r53) : (v || 0);
    var hasVal = tot > 0;
    if (hasVal) { totalAll += tot; count++; }

    var src = d ? (d.src || 'upload') : '';
    var badgeTxt   = !hasVal ? 'Otomatis' : src === 'manual' ? '\u270e Manual' : '\u2714 Upload';
    var badgeColor = !hasVal ? 'var(--t3)'
                   : src === 'manual' ? 'var(--blue)' : 'var(--teal)';

    var fmt = function(n){
      return n > 0 ? fmtM(n) : '<span style="color:var(--t3)">0</span>';
    };

    return '<tr id="tr_target_' + i + '" style="transition:background .2s">' +
      /* Bulan */
      '<td style="font-weight:600;color:var(--t1);white-space:nowrap;' +
        'padding:8px 12px;min-width:95px">' + mNama + '</td>' +
      /* Rencana 51 — read-only, bisa jadi input saat edit */
      '<td id="tc_ti51_' + i + '" style="text-align:right;font-family:var(--mono);' +
        'font-size:11.5px;color:var(--t2);padding:8px 12px;min-width:130px">' + fmt(r51) + '</td>' +
      /* Rencana 52 */
      '<td id="tc_ti52_' + i + '" style="text-align:right;font-family:var(--mono);' +
        'font-size:11.5px;color:var(--t2);padding:8px 12px;min-width:130px">' + fmt(r52) + '</td>' +
      /* Rencana 53 */
      '<td id="tc_ti53_' + i + '" style="text-align:right;font-family:var(--mono);' +
        'font-size:11.5px;color:var(--t2);padding:8px 12px;min-width:130px">' + fmt(r53) + '</td>' +
      /* Total — selalu read-only, dihitung otomatis */
      '<td style="text-align:right;font-weight:700;font-family:var(--mono);' +
        'color:' + (hasVal ? 'var(--blue)' : 'var(--t3)') + ';' +
        'background:rgba(26,86,219,.05);padding:8px 12px;border-radius:4px;min-width:145px">' +
        (hasVal ? fmtM(tot) : '<span style="font-weight:400;color:var(--t3)">Otomatis</span>') +
      '</td>' +
      /* Status */
      '<td style="text-align:center;white-space:nowrap;padding:8px 12px">' +
        '<span style="font-size:10px;font-weight:600;color:' + badgeColor + '">' +
          badgeTxt + '</span>' +
      '</td>' +
      /* Tombol Edit */
      '<td id="tc_act_' + i + '" style="text-align:center;padding:8px 10px">' +
        '<button onclick="startEditTarget(' + i + ')" ' +
          'style="padding:3px 10px;background:var(--blue-l);color:var(--blue);border:1px solid var(--blue);' +
          'border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap">' +
          '<i class="fas fa-pencil"></i> Edit</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  var cntEl = document.getElementById('targetManualCount');
  var totEl = document.getElementById('targetTotalDisplay');
  if (cntEl) cntEl.textContent = count + ' bulan tersimpan';
  if (totEl) totEl.textContent = fmtM(totalAll) +
    (count > 0 && count < 12 ? ' (sebagian otomatis)' : '');
}


/* ── Realisasi Bulanan per Upload FA Detail ──────────────────────────────── */

var MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni',
                 'Juli','Agustus','September','Oktober','November','Desember'];

/**
 * saveRealisasiBulanan — simpan ke localStorage dengan key terkunci
 * Key ini TIDAK dihapus oleh resetData() sehingga data aman meski file diganti
 */
async function saveRealisasiBulanan() {
  try {
    var rows = [];
    for (var i = 0; i < 12; i++) {
      var rb = APP.realisasiBulanan[i];
      if (!rb) continue;
      rows.push({
        bulan_idx:      i,
        nilai:          rb.nilai         || 0,
        nama_file:      rb.namaFile      || '',
        tanggal_update: rb.tanggalUpdate || '',
        updated_at:     new Date().toISOString(),
      });
    }
    if (rows.length === 0) return;
    await supaFetch('POST', 'realisasi_bulanan', {
      query: 'on_conflict=bulan_idx',
      body: rows,
      returning: false,
    });
  } catch(e) {
    console.warn('saveRealisasiBulanan error:', e.message);
    toast('error', 'Gagal Simpan Realisasi', e.message);
  }
}

/**
 * wireRealUpload — hubungkan event ke drop zone realisasi bulanan
 */
function wireRealUpload() {
  var fi = document.getElementById('realFileInput');
  if (fi) fi.addEventListener('change', function(){ handleRealFile(this.files); });

  var dz = document.getElementById('realDropZone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e){ e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function(){ dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e){
    e.preventDefault(); dz.classList.remove('drag-over');
    handleRealFile(e.dataTransfer.files);
  });
}

/**
 * handleRealFile — baca file FA Detail dan parse totalRealisasi + periode
 */
function handleRealFile(files) {
  if (!files || !files[0]) return;
  var f = files[0];
  if (!/\.(xlsx|xls)$/i.test(f.name)) {
    toast('error','Format Salah','Hanya .xlsx atau .xls yang didukung'); return;
  }

  var lbl  = document.getElementById('realUpbarLbl');
  var bar  = document.getElementById('realUpbarFill');
  var prog = document.getElementById('realUploadProgress');
  var prev = document.getElementById('realFilePreview');
  var span = document.getElementById('realFileName');
  var prd  = document.getElementById('realFilePeriode');
  var btn  = document.getElementById('btnSimpanReal');

  if (prog) prog.style.display = 'block';
  if (prev) prev.style.display = 'block';
  if (span) span.textContent = f.name;
  if (lbl)  lbl.textContent  = 'Membaca file...';
  if (bar)  bar.style.width  = '20%';
  if (btn)  btn.disabled = true;

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      if (bar) bar.style.width = '55%';
      if (lbl) lbl.textContent = 'Mengurai data realisasi...';

      var wb  = XLSX.read(e.target.result, { type:'binary', raw:false });
      var ws  = wb.Sheets[wb.SheetNames[0]];
      var raw = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null });

      // ── Deteksi periode dari baris header (baris 0-6) ──
      var bulanIdx = null, ta = '';
      var MONTH_MAP_ID = {
        januari:0,februari:1,maret:2,april:3,mei:4,juni:5,
        juli:6,agustus:7,september:8,oktober:9,november:10,desember:11
      };
      for (var ri = 0; ri < Math.min(7, raw.length); ri++) {
        var c0 = raw[ri][0] ? String(raw[ri][0]).trim() : '';
        // Cari "Periode Juni 2026" atau "Juni 2026"
        var mPrd = c0.match(/periode\s+([a-zA-Z]+)\s*(\d{4})/i) ||
                   c0.match(/([a-zA-Z]+)\s+(\d{4})/i);
        if (mPrd) {
          var bln = mPrd[1].toLowerCase();
          ta = mPrd[2] || '';
          if (MONTH_MAP_ID[bln] !== undefined) { bulanIdx = MONTH_MAP_ID[bln]; break; }
        }
        var taMch = c0.match(/TA\s*(\d{4})/i);
        if (taMch) ta = taMch[1];
      }

      if (bulanIdx === null) {
        // Minta user konfirmasi bulan
        var bInput = prompt(
          'Bulan tidak terdeteksi otomatis dari file.\nMasukkan nomor bulan (1=Jan, 2=Feb, ... 12=Des):',
          String(new Date().getMonth() + 1)
        );
        if (!bInput) { if (bar) bar.style.width='0'; return; }
        bulanIdx = parseInt(bInput, 10) - 1;
        if (isNaN(bulanIdx) || bulanIdx < 0 || bulanIdx > 11) {
          toast('error','Bulan Tidak Valid','Masukkan angka 1–12'); return;
        }
      }

      // ── Ambil realisasi PERIODE INI (col[23]) dari baris JUMLAH SELURUHNYA ──
      // Bukan s.d. periode (col[24]) — kita inginkan nilai per bulan berjalan
      var totalReal = 0;
      for (var rj = 0; rj < Math.min(15, raw.length); rj++) {
        var c0j = raw[rj][0] ? String(raw[rj][0]).trim() : '';
        if (c0j.toUpperCase().indexOf('JUMLAH SELURUHNYA') !== -1) {
          // col[23] = Realisasi Periode Ini (bulan berjalan saja)
          totalReal = parseFloat(raw[rj][23]) || 0;
          break;
        }
      }

      if (totalReal === 0) {
        // Fallback: jumlahkan col[23] semua baris akun (col[7] = 6 digit)
        for (var rk = 9; rk < raw.length; rk++) {
          var c7 = raw[rk][7] ? String(raw[rk][7]).trim().replace(/\.0$/, '') : '';
          if (/^\d{6}$/.test(c7)) {
            var pagu = parseFloat(raw[rk][16]) || 0;
            if (pagu > 0) {
              totalReal += parseFloat(raw[rk][23]) || 0;
            }
          }
        }
      }

      if (bar) bar.style.width = '100%';
      if (lbl) lbl.textContent = 'Selesai — realisasi ' + MONTHS_ID[bulanIdx] + ': ' + fmtM(totalReal);
      if (prd) prd.textContent = '→ ' + MONTHS_ID[bulanIdx] + ' ' + ta;

      APP.realParsed = {
        bulanIdx:    bulanIdx,
        nilai:       totalReal,
        namaFile:    f.name,
        tanggalUpdate: new Date().toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})
      };
      if (btn) btn.disabled = false;

    } catch(err) {
      toast('error','Gagal Parse', err.message);
      console.error(err);
    }
  };
  reader.readAsBinaryString(f);
}

/**
 * simpanRealisasiBulanan — simpan hasil parse ke APP.realisasiBulanan[bulanIdx]
 */
async function simpanRealisasiBulanan() {
  if (!APP.realParsed) {
    toast('error','Belum Ada Data','Upload file FA Detail terlebih dahulu'); return;
  }
  var p = APP.realParsed;
  var bulanNama = MONTHS_ID[p.bulanIdx];

  // Konfirmasi jika sudah ada data bulan ini
  var existing = APP.realisasiBulanan[p.bulanIdx];
  if (existing) {
    var ok = confirm(
      'Data realisasi ' + bulanNama + ' sudah ada (' + fmtM(existing.nilai) + ').\n' +
      'Timpa dengan data baru ' + fmtM(p.nilai) + '?'
    );
    if (!ok) return;
  }

  APP.realisasiBulanan[p.bulanIdx] = {
    nilai:         p.nilai,
    namaFile:      p.namaFile,
    tanggalUpdate: p.tanggalUpdate,
  };

  await saveRealisasiBulanan();
  renderRealisasiBulananTable();
  renderBulananChart();

  // Reset UI
  APP.realParsed = null;
  APP.realWb = null;
  var fi = document.getElementById('realFileInput');
  if (fi) fi.value = '';
  document.getElementById('realFilePreview').style.display = 'none';
  document.getElementById('realUploadProgress').style.display = 'none';
  document.getElementById('btnSimpanReal').disabled = true;

  toast('success','Realisasi Tersimpan',
    'Realisasi ' + bulanNama + ': ' + fmtM(p.nilai) + ' — Chart diperbarui.');
}

/**
 * deleteRealisasiBulan — hapus data satu bulan
 */
async function deleteRealisasiBulan(idx) {
  var nama = MONTHS_ID[idx];
  if (!confirm('Hapus data realisasi ' + nama + '?')) return;
  try {
    await supaFetch('DELETE', 'realisasi_bulanan', { query: 'bulan_idx=eq.' + idx });
    APP.realisasiBulanan[idx] = null;
    renderRealisasiBulananTable();
    renderBulananChart();
    toast('info','Dihapus','Realisasi ' + nama + ' dihapus.');
  } catch(e) {
    toast('error','Gagal Hapus', e.message);
  }
}

/**
 * clearAllRealisasiBulanan — hapus semua
 */
async function clearAllRealisasiBulanan() {
  var count = APP.realisasiBulanan.filter(function(v){ return v !== null; }).length;
  if (count === 0) { toast('info','Kosong','Tidak ada data realisasi'); return; }
  if (!confirm('Hapus semua ' + count + ' data realisasi bulanan?')) return;
  try {
    await supaFetch('DELETE', 'realisasi_bulanan', { query: 'id=gt.0' });
    APP.realisasiBulanan = [null,null,null,null,null,null,null,null,null,null,null,null];
    renderRealisasiBulananTable();
    renderBulananChart();
    toast('info','Semua Dihapus','Seluruh data realisasi bulanan telah dihapus.');
  } catch(e) {
    toast('error','Gagal Hapus', e.message);
  }
}

/**
 * renderRealisasiBulananTable — render tabel riwayat di halaman Pengaturan
 */
function renderRealisasiBulananTable() {
  var tbody  = document.getElementById('realBulBody');
  var badge  = document.getElementById('realBulBadge');
  var totEl  = document.getElementById('realBulTotal');
  if (!tbody) return;

  var count = 0, total = 0;
  APP.realisasiBulanan.forEach(function(v){ if (v !== null){ count++; total += v.nilai; } });
  if (badge) badge.textContent = count + ' bulan tersimpan';
  if (totEl) totEl.textContent = fmtM(total);

  if (count === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--t3)">' +
      '<i class="fas fa-chart-bar" style="font-size:20px;display:block;margin-bottom:8px"></i>' +
      'Belum ada data realisasi bulanan tersimpan</td></tr>';
    return;
  }

  tbody.innerHTML = MONTHS_ID.map(function(nama, i) {
    var v = APP.realisasiBulanan[i];
    if (!v) return ''; // Lewati bulan yang kosong
    return '<tr>' +
      '<td style="font-weight:600;color:var(--t1)">' + nama + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--teal)">' + fmtM(v.nilai) + '</td>' +
      '<td style="font-size:11px;color:var(--t3)">' + esc(v.namaFile || '-') + '</td>' +
      '<td style="font-size:11px;color:var(--t3)">' + (v.tanggalUpdate || '-') + '</td>' +
      '<td style="text-align:center">' +
        '<button onclick="deleteRealisasiBulan(' + i + ')" ' +
          'style="width:28px;height:28px;border-radius:var(--r1);background:var(--red-l);' +
          'color:var(--red);font-size:12px;display:inline-flex;align-items:center;' +
          'justify-content:center;cursor:pointer;border:none">' +
          '<i class="fas fa-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).filter(Boolean).join('');
}

/* ── Keyboard shortcuts ─────────────────────────────────────── */
function wireKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });
  document.getElementById('uploadModal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
}

/* ── Utility helpers ────────────────────────────────────────── */
/**
 * fmtRp — tampilkan nilai rupiah lengkap dengan pemisah ribuan
 * Contoh: 180438334000 → "Rp 180.438.334.000"
 */
function fmtM(n) {
  if (!n && n !== 0) return '-';
  n = Math.round(n);
  // Format penuh dengan pemisah titik gaya Indonesia
  return 'Rp ' + n.toLocaleString('id-ID');
}

function pctClass(p) {
  return p >= 80 ? 'pct-h' : p >= 50 ? 'pct-m' : p >= 20 ? 'pct-l' : 'pct-z';
}

function srcChip(s) {
  return s === 'rm'
    ? '<span class="src-rm">RM</span>'
    : '<span class="src-blu">BLU</span>';
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(type, title, msg, dur) {
  dur = dur || 4500;
  var icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  var box   = document.getElementById('toastBox');
  var id    = 'tk_' + Date.now();
  var el    = document.createElement('div');
  el.className = 'toast t-' + type;
  el.id = id;
  el.innerHTML =
    '<div class="toast-ic"><i class="fas ' + (icons[type] || 'fa-circle-info') + '"></i></div>' +
    '<div style="flex:1"><div class="toast-title">' + title + '</div>' +
    '<div class="toast-msg">' + msg + '</div></div>' +
    '<button class="toast-x" onclick="rmToast(\'' + id + '\')">✕</button>';
  box.appendChild(el);
  setTimeout(function () { rmToast(id); }, dur);
}

function rmToast(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.add('out');
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
}
