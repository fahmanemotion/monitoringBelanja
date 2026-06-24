/* ============================================================================
   SIPADU — Unit Tests
   ----------------------------------------------------------------------------
   Menguji fungsi-fungsi LOGIKA INTI dari index.js (fungsi ASLI, bukan salinan)
   dengan memuatnya di sandbox Node + stub minimal untuk API browser.

   Cara menjalankan (tanpa instalasi apa pun):
       node tests.js

   Keluaran: daftar ✓/✗ per pengujian + ringkasan. Exit code 1 bila ada gagal,
   sehingga cocok juga untuk CI / pre-commit hook.

   Fungsi yang diuji:
     - extractFiscalYear      (deteksi Tahun Anggaran dari header Excel)
     - validateUploadYear     (validasi tahun file vs selektor)
     - toCumulative           (kumulatif / kurva S)
     - perMonthRealYear       (realisasi per bulan: increment vs kumulatif)
     - cumRealYear            (realisasi kumulatif per tahun)
     - isRunningYear          (cek tahun berjalan)
     - fmtM / fmtJutaAsM      (format Rupiah & Miliar)
     - pctClass / srcChip / esc
     - yearOptions / emptyYearArr / getYearArr
     - addBlokir + deleteBlokir (REGRESSION: item terhapus tidak boleh muncul lagi)
   ========================================================================== */

'use strict';
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

/* ------------------------------------------------------------------ */
/* 1) Stub minimal untuk API browser yang dibutuhkan index.js          */
/* ------------------------------------------------------------------ */

// Element DOM tiruan — persisten per id agar nilai input bertahan antar panggilan
function makeEl() {
  return {
    value: '', textContent: '', innerHTML: '', className: '', disabled: false,
    style: {}, dataset: {},
    options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, remove() {}, setAttribute() {},
    getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, select() {}, getContext() { return {}; },
    insertBefore() {}, appendTo() {},
  };
}

const elementStore = {};
function getEl(id) {
  if (!elementStore[id]) elementStore[id] = makeEl();
  return elementStore[id];
}

// XLSX util seadanya (cukup untuk extractFiscalYear) ----------------------
function colName(c) { var s = ''; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
function colNum(s)  { var c = 0; for (var i = 0; i < s.length; i++) c = c * 26 + (s.charCodeAt(i) - 64); return c - 1; }
function decodeCell(a) { var m = a.match(/^([A-Z]+)(\d+)$/); return { c: colNum(m[1]), r: parseInt(m[2], 10) - 1 }; }

const XLSX_STUB = {
  utils: {
    encode_cell: function (o) { return colName(o.c) + (o.r + 1); },
    decode_cell: decodeCell,
    decode_range: function (ref) { var p = ref.split(':'); return { s: decodeCell(p[0]), e: decodeCell(p[1]) }; },
    sheet_to_json: function () { return []; },   // tidak dipakai di test
  },
  read: function () { return { SheetNames: [], Sheets: {} }; },
};

const sandbox = {
  console: console,
  Date: Date, Math: Math, JSON: JSON, parseInt: parseInt, parseFloat: parseFloat,
  isNaN: isNaN, String: String, Number: Number, Array: Array, Object: Object,
  setTimeout: function (fn) { return 0; },     // no-op timer
  clearTimeout: function () {},
  Promise: Promise,
  fetch: function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve(''); } }); },
  XLSX: XLSX_STUB,
  Chart: function () { return { destroy() {}, resize() {}, update() {} }; },
  navigator: { userAgent: 'node-test' },
  location: { href: '' },
  confirm: function () { return true; },
  alert: function () {},
  FileReader: function () {},
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  localStorage:   { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    addEventListener: function () {},          // cegah init DOMContentLoaded berjalan
    getElementById: function (id) { return getEl(id); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return makeEl(); },
    body: makeEl(),
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

/* ------------------------------------------------------------------ */
/* 2) Muat index.js ASLI ke dalam sandbox                              */
/* ------------------------------------------------------------------ */
const codePath = path.join(__dirname, 'index.js');
const code = fs.readFileSync(codePath, 'utf8');
vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { filename: 'index.js' });
} catch (e) {
  console.error('GAGAL memuat index.js ke sandbox:', e.message);
  process.exit(1);
}
const S = sandbox; // shortcut akses fungsi/variabel global index.js

/* ------------------------------------------------------------------ */
/* 3) Mini test-runner (tanpa dependency)                              */
/* ------------------------------------------------------------------ */
let passed = 0, failed = 0;
const failures = [];
const tasks = [];
function test(name, fn) { tasks.push({ name, fn }); }

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log('  \u2713 ' + msg); }
  else { failed++; failures.push(msg); console.log('  \u2717 ' + msg + '\n      diharapkan: ' + b + '\n      diterima : ' + a); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

async function run() {
  for (const t of tasks) {
    console.log('\n\u25B6 ' + t.name);
    try { await t.fn(); }
    catch (e) { failed++; failures.push(t.name + ' (exception)'); console.log('  \u2717 EXCEPTION: ' + e.message); }
  }
  console.log('\n' + '='.repeat(60));
  console.log('HASIL: ' + passed + ' lulus, ' + failed + ' gagal');
  if (failed) { console.log('GAGAL:\n - ' + failures.join('\n - ')); process.exit(1); }
  else console.log('Semua pengujian LULUS \u2705');
}

const CY  = new Date().getFullYear();          // tahun berjalan (dinamis)
const CYs = String(CY);
const PYs = String(CY - 1);                     // tahun lampau

/* ------------------------------------------------------------------ */
/* 4) PENGUJIAN                                                        */
/* ------------------------------------------------------------------ */

test('extractFiscalYear — baca TA langsung dari sel header', () => {
  const mk = (cells) => ({ '!ref': 'A1:T20', ...cells });
  eq(S.extractFiscalYear(mk({ A1: { v: 'LAPORAN REALISASI SP2D TA 2026' }, A3: { v: 'Periode Juni 2026' } })), '2026', 'judul di A1 (ter-merge) → 2026');
  eq(S.extractFiscalYear(mk({ F1: { v: 'LAPORAN REALISASI SP2D TA 2025' } })), '2025', 'judul di kolom tengah F1 → 2025');
  eq(S.extractFiscalYear(mk({ A1: { v: 'LAPORAN ANGGARAN T.A. 2024' } })), '2024', 'format "T.A. 2024" → 2024');
  eq(S.extractFiscalYear(mk({ A2: { v: 'Periode Maret 2023' } })), '2023', 'hanya baris Periode → 2023');
  eq(S.extractFiscalYear(mk({ A1: { v: 'LAPORAN REALISASI' } })), null, 'tanpa tahun → null');
  eq(S.extractFiscalYear(null), null, 'sheet null → null');
  eq(S.extractFiscalYear({}), null, 'sheet tanpa !ref → null');
});

test('validateUploadYear — fail-fast tahun file vs selektor', () => {
  const origToast = S.toast, origWarn = console.warn;
  S.toast = function () {};                      // bisukan toast
  console.warn = function () {};                 // bisukan log diagnostik [SIPADU]
  const wb = (year) => ({ SheetNames: ['s'], Sheets: { s: { '!ref': 'A1:T10', A1: { v: 'LAPORAN TA ' + year } } } });

  S.APP.viewYear = CYs;
  eq(S.validateUploadYear(wb(CY), 'SAKTI'), { ok: true, year: CYs }, 'tahun cocok → ok:true');

  S.APP.viewYear = PYs;
  eq(S.validateUploadYear(wb(CY), 'SAKTI').ok, false, 'tahun beda → ditolak (ok:false)');

  S.APP.viewYear = CYs;
  eq(S.validateUploadYear({ SheetNames: ['s'], Sheets: { s: { '!ref': 'A1:T5', A1: { v: 'LAPORAN' } } } }, 'SAKTI').ok, false, 'tahun tak ditemukan → ditolak');

  S.APP.viewYear = '';
  eq(S.validateUploadYear(wb(CY), 'SAKTI').ok, false, 'selektor kosong → ditolak');

  S.APP.viewYear = CYs;
  S.toast = origToast; console.warn = origWarn;
});

test('toCumulative — kumulatif berhenti di null pertama', () => {
  eq(S.toCumulative([1, 2, 3]), [1, 3, 6], 'tanpa null: [1,2,3] → [1,3,6]');
  eq(S.toCumulative([1, 2, null, 3]), [1, 3, null, null], 'null di tengah menghentikan');
  eq(S.toCumulative([0, 0, 0]), [0, 0, 0], 'semua nol → tetap nol');
});

test('isRunningYear — tahun berjalan', () => {
  ok(S.isRunningYear(CY), 'tahun berjalan → true');
  ok(S.isRunningYear(CYs), 'tahun berjalan (string) → true');
  ok(!S.isRunningYear(CY - 1), 'tahun lampau → false');
});

test('perMonthRealYear & cumRealYear — increment (berjalan) vs kumulatif (lampau)', () => {
  S.APP.meta.ta = CYs;
  // Tahun berjalan: nilai tersimpan = Realisasi Periode Ini (increment)
  const cur = S.emptyYearArr();
  cur[0] = { nilai: 2e6 }; cur[1] = { nilai: 3e6 }; cur[2] = { nilai: 5e6 };
  S.APP.realisasiByYear[CYs] = cur;
  eq(S.perMonthRealYear(CYs, 0, 0, 0).slice(0, 4), [2, 3, 5, null], 'berjalan: per bulan = nilai apa adanya');
  eq(S.cumRealYear(CYs, 0, 0, 0).slice(0, 4), [2, 5, 10, null], 'berjalan: kumulatif = penjumlahan');

  // Tahun lampau: nilai tersimpan = Realisasi s.d. Periode (kumulatif)
  const past = S.emptyYearArr();
  past[0] = { nilai: 2e6 }; past[1] = { nilai: 5e6 }; past[2] = { nilai: 10e6 };
  S.APP.realisasiByYear[PYs] = past;
  eq(S.perMonthRealYear(PYs, 0, 0, 0).slice(0, 4), [2, 3, 5, null], 'lampau: per bulan = selisih kumulatif');
  eq(S.cumRealYear(PYs, 0, 0, 0).slice(0, 4), [2, 5, 10, null], 'lampau: kumulatif = nilai apa adanya');

  // Tahun tanpa data → semua null
  S.APP.realisasiByYear['1999'] = S.emptyYearArr();
  eq(S.perMonthRealYear('1999', 0, 0, 0).every(v => v === null), true, 'tahun kosong → semua null');
});

test('fmtM — format Rupiah penuh', () => {
  eq(S.fmtM(216000), 'Rp 216.000', '216000 → Rp 216.000');
  eq(S.fmtM(0), 'Rp 0', '0 → Rp 0');
  eq(S.fmtM(null), '-', 'null → -');
});

test('fmtJutaAsM — tampil dalam Miliar (M)', () => {
  eq(S.fmtJutaAsM(24000), 'Rp 24 M', '24000 juta → Rp 24 M');
  eq(S.fmtJutaAsM(1500), 'Rp 1,5 M', '1500 juta → Rp 1,5 M');
  eq(S.fmtJutaAsM(null), '', 'null → string kosong');
});

test('pctClass — kelas warna berdasarkan persentase', () => {
  eq(S.pctClass(100), 'pct-h', '100% → pct-h');
  eq(S.pctClass(80), 'pct-h', '80% → pct-h');
  eq(S.pctClass(65), 'pct-m', '65% → pct-m');
  eq(S.pctClass(30), 'pct-l', '30% → pct-l');
  eq(S.pctClass(0), 'pct-z', '0% → pct-z');
});

test('srcChip & esc', () => {
  ok(/RM/.test(S.srcChip('rm')), "srcChip('rm') memuat 'RM'");
  ok(/BLU/.test(S.srcChip('blu')), "srcChip('blu') memuat 'BLU'");
  eq(S.esc('<b>"x"&'), '&lt;b&gt;&quot;x&quot;&amp;', 'esc meng-escape < > " &');
  eq(S.esc(''), '', 'esc string kosong → kosong');
});

test('yearOptions & emptyYearArr', () => {
  const y = S.yearOptions();
  eq(y.length, 3, '3 opsi tahun');
  eq(y, [CYs, String(CY - 1), String(CY - 2)], 'berjalan + 2 tahun ke belakang');
  const e = S.emptyYearArr();
  eq(e.length, 12, '12 slot bulan');
  eq(e.every(v => v === null), true, 'semua slot null');
});

test('REGRESSION blokir — item yang dihapus TIDAK muncul lagi setelah tambah ulang', async () => {
  // Isolasi: bisukan render & toast, mock supaFetch
  const orig = { rbt: S.renderBlokirTable, rk: S.renderKPIs, toast: S.toast, supa: S.supaFetch };
  S.renderBlokirTable = function () {};
  S.renderKPIs = function () {};
  S.toast = function () {};
  let idCounter = 0;
  S.supaFetch = function (method, table, opts) {
    if (method === 'POST' && table === 'blokir') {
      idCounter++;
      const b = opts.body;
      return Promise.resolve([{ id: idCounter, uraian: b.uraian, nilai: b.nilai, sumber: b.sumber }]);
    }
    return Promise.resolve([]);                 // DELETE dll.
  };

  // Siapkan state tahun
  S.APP.viewOnly = false;
  S.APP.viewYear = CYs;
  S.APP.meta.ta = CYs;
  S.APP.blokirByYear = {}; S.APP.blokirByYear[CYs] = [];
  S.APP.blokir = S.APP.blokirByYear[CYs];

  function setInput(uraian, nilai, sumber) {
    getEl('blokirUraian').value = uraian;
    getEl('blokirNilai').value  = String(nilai);
    getEl('blokirSumber').value = sumber;
  }

  setInput('Blokir A', 100, 'rm'); await S.addBlokir();
  setInput('Blokir B', 200, 'blu'); await S.addBlokir();
  eq(S.APP.blokir.map(b => b.id), [1, 2], 'setelah 2x tambah → id [1,2]');
  ok(S.APP.blokir === S.APP.blokirByYear[CYs], 'APP.blokir & blokirByYear referensi sama');

  await S.deleteBlokir(1);                       // hapus item id 1
  eq(S.APP.blokir.map(b => b.id), [2], 'setelah hapus id1 → tersisa [2]');
  ok(S.APP.blokir === S.APP.blokirByYear[CYs], 'referensi tetap sama setelah hapus');

  setInput('Blokir C', 300, 'rm'); await S.addBlokir();   // tambah ulang
  eq(S.APP.blokir.map(b => b.id), [2, 3], 'setelah tambah lagi → [2,3] — id1 TIDAK muncul lagi');

  // Pulihkan
  S.renderBlokirTable = orig.rbt; S.renderKPIs = orig.rk; S.toast = orig.toast; S.supaFetch = orig.supa;
});

test('kodeToJenis — klasifikasi jenis belanja dari kode akun', () => {
  eq(S.kodeToJenis('511111'), 'pegawai', '51xxxx → pegawai');
  eq(S.kodeToJenis('521211'), 'barang', '52xxxx → barang');
  eq(S.kodeToJenis('532111'), 'modal', '53xxxx → modal (Belanja Modal)');
  eq(S.kodeToJenis('533121'), 'modal', '533121 → modal');
  eq(S.kodeToJenis('525112'), 'barang', '525xxx (BLU) → barang');
  eq(S.kodeToJenis(''), 'barang', 'kosong → barang (default aman)');
  eq(S.kodeToJenis(532111), 'modal', 'angka 532111 → modal (tahan tipe number)');
});

test('kodeToSumber — klasifikasi sumber dana dari kode akun (525/537 = BLU)', () => {
  eq(S.kodeToSumber('537111'), 'blu', '537xxx → BLU (Belanja Modal BLU)');
  eq(S.kodeToSumber('525112'), 'blu', '525xxx → BLU (Belanja Barang BLU)');
  eq(S.kodeToSumber('531111'), 'rm', '531xxx → RM (Belanja Modal RM)');
  eq(S.kodeToSumber('532111'), 'rm', '532xxx → RM');
  eq(S.kodeToSumber('534111'), 'rm', '534xxx → RM');
  eq(S.kodeToSumber('521211'), 'rm', '521xxx → RM (Belanja Barang RM)');
  eq(S.kodeToSumber('511111'), 'rm', '511xxx → RM (Belanja Pegawai)');
  eq(S.kodeToSumber(537111), 'blu', 'angka 537111 → BLU (tahan tipe number)');
  eq(S.kodeToSumber(''), 'rm', 'kosong → RM (default)');
});

test('kombinasi jenis × sumber — siap untuk filter berlapis', () => {
  // Belanja Modal: 537 = BLU, sisanya RM
  eq([S.kodeToJenis('537111'), S.kodeToSumber('537111')], ['modal', 'blu'], '537 → modal + BLU');
  eq([S.kodeToJenis('531111'), S.kodeToSumber('531111')], ['modal', 'rm'], '531 → modal + RM');
  // Belanja Barang: 525 = BLU, 521 = RM
  eq([S.kodeToJenis('525111'), S.kodeToSumber('525111')], ['barang', 'blu'], '525 → barang + BLU');
  eq([S.kodeToJenis('521111'), S.kodeToSumber('521111')], ['barang', 'rm'], '521 → barang + RM');
});

test('applyKeuFilters — filter Jenis Belanja & Sumber Dana (Modul Keuangan)', () => {
  const origRender = S.renderKeuTable;
  S.renderKeuTable = function () {};
  // Data uji: campuran jenis & sumber berdasarkan kode akun
  S.APP.data = [
    { akun_kode: '511111', prog_kode: '', kro_kode: '', ro_full: '', akun_nama: 'Gaji', realisasi: 10, details: [] },     // pegawai, RM
    { akun_kode: '521211', prog_kode: '', kro_kode: '', ro_full: '', akun_nama: 'ATK', realisasi: 0, details: [] },       // barang, RM
    { akun_kode: '525112', prog_kode: '', kro_kode: '', ro_full: '', akun_nama: 'Barang BLU', realisasi: 5, details: [] },// barang, BLU
    { akun_kode: '532111', prog_kode: '', kro_kode: '', ro_full: '', akun_nama: 'Peralatan', realisasi: 7, details: [] }, // modal, RM
    { akun_kode: '537111', prog_kode: '', kro_kode: '', ro_full: '', akun_nama: 'Modal BLU', realisasi: 0, details: [] }, // modal, BLU
  ];
  const reset = () => ['kfProg','kfKRO','kfRO','kfAkun','kfDetail','kfSumber','kfJenis','kfStatus','keuQ']
    .forEach(id => { getEl(id).value = ''; });

  reset(); getEl('kfJenis').value = 'modal'; S.applyKeuFilters();
  eq(S.APP.keuFiltered.map(r => r.akun_kode).sort(), ['532111', '537111'], 'Jenis=Modal → hanya 53x');

  reset(); getEl('kfJenis').value = 'modal'; getEl('kfSumber').value = 'blu'; S.applyKeuFilters();
  eq(S.APP.keuFiltered.map(r => r.akun_kode), ['537111'], 'Modal + BLU → hanya 537xxx');

  reset(); getEl('kfSumber').value = 'blu'; S.applyKeuFilters();
  eq(S.APP.keuFiltered.map(r => r.akun_kode).sort(), ['525112', '537111'], 'Sumber=BLU → 525 & 537');

  reset(); getEl('kfJenis').value = 'pegawai'; S.applyKeuFilters();
  eq(S.APP.keuFiltered.map(r => r.akun_kode), ['511111'], 'Jenis=Pegawai → hanya 51x');

  S.renderKeuTable = origRender;
});

test('populateYearSelectors — tahun berdata tetap muncul (anti-hilang)', () => {
  // Tahun di LUAR jendela 3-tahun tapi punya data → harus tetap selectable
  S.APP.dataByYear = { '2020': [{ pagu: 1 }] };
  S.APP.blokirByYear = {}; S.APP.targetByYear = {}; S.APP.realisasiByYear = {};
  S.APP.viewYear = '2020';
  S.populateYearSelectors();
  eq(S.APP.viewYear, '2020', 'viewYear berdata tetap dipertahankan (tidak direset)');
  ok(/2020/.test(getEl('taSelect').innerHTML), 'dropdown taSelect memuat opsi 2020');
  // Bersihkan agar tidak mengganggu test lain
  S.APP.dataByYear = {};
});

test('saveSatkerName — tulis anti-duplikat (DELETE lalu INSERT) & persist', async () => {
  const orig = { toast: S.toast, supa: S.supaFetch, org: S.updateOrgLabel };
  S.toast = function () {}; S.updateOrgLabel = function () {};
  const calls = [];
  S.supaFetch = function (method, table, opts) {
    calls.push({ method, table, query: (opts && opts.query) || '', body: opts && opts.body });
    return Promise.resolve([]);
  };
  S.APP.viewOnly = false;
  getEl('satkerNameInput').value = 'POLITEKNIK ILMU PELAYARAN MAKASSAR';
  await S.saveSatkerName();

  const del = calls.find(c => c.method === 'DELETE' && c.table === 'metadata');
  const ins = calls.find(c => c.method === 'POST' && c.table === 'metadata');
  ok(del && /key=eq\.satker/.test(del.query), 'menghapus baris key=satker dulu (anti-duplikat)');
  ok(ins && ins.body && ins.body.key === 'satker', 'lalu insert satu baris key=satker');
  eq(ins.body.value, 'POLITEKNIK ILMU PELAYARAN MAKASSAR', 'nilai yang disimpan benar');
  eq(S.APP.meta.satker, 'POLITEKNIK ILMU PELAYARAN MAKASSAR', 'APP.meta.satker diperbarui');
  // urutan: DELETE sebelum POST
  ok(calls.indexOf(del) < calls.indexOf(ins), 'DELETE dieksekusi sebelum INSERT');

  S.toast = orig.toast; S.supaFetch = orig.supa; S.updateOrgLabel = orig.org;
});

test('renderKeuKPIs — jumlah Pagu/Realisasi/Sisa dari data terfilter', () => {
  S.APP.data = [{}, {}, {}];                       // ada data (guard lolos)
  S.APP.keuFiltered = [
    { pagu: 100, realisasi: 30, sisa: 70 },
    { pagu: 200, realisasi: 50, sisa: 150 },
  ];
  getEl('keuKpiRow').innerHTML = '';
  S.renderKeuKPIs();
  var h = getEl('keuKpiRow').innerHTML;
  ok(/Total Pagu/.test(h) && /Realisasi/.test(h) && /Sisa Anggaran/.test(h), 'tiga kartu tampil');
  ok(h.indexOf('26.67%') !== -1, 'persen realisasi = 80/300 = 26.67%');
  ok(h.indexOf('73.33%') !== -1, 'persen sisa = 220/300 = 73.33%');
  ok(/\(terfilter\)/.test(h), 'menandai terfilter (keuFiltered < data)');
  // Bila tak ada data → kartu Rp 0 (rows kosong)
  S.APP.data = [];
  S.renderKeuKPIs();
  ok(getEl('keuKpiRow').innerHTML.indexOf('0.00%') !== -1, 'data kosong → 0.00%');
});

test('supaFetchAll — pagination mengambil SEMUA baris (anti-terpotong 1000)', async () => {
  const origSupa = S.supaFetch;
  // Simulasikan tabel berisi 1594 baris; server membatasi 1000 per request
  const TOTAL = 1594, CAP = 1000;
  const calls = [];
  S.supaFetch = function (method, table, opts) {
    const q = (opts && opts.query) || '';
    const lim = parseInt((q.match(/limit=(\d+)/) || [])[1] || '0', 10);
    const off = parseInt((q.match(/offset=(\d+)/) || [])[1] || '0', 10);
    calls.push({ lim, off });
    const want = Math.min(lim, CAP);                 // server cap 1000/req
    const remaining = Math.max(0, TOTAL - off);
    const n = Math.min(want, remaining);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ id: off + i + 1 });
    return Promise.resolve(rows);
  };
  const all = await S.supaFetchAll('sakti_data', 'select=*&order=id');
  eq(all.length, TOTAL, 'mengambil seluruh 1594 baris (bukan 1000)');
  ok(calls.length >= 2, 'melakukan lebih dari 1 request (pagination berjalan)');
  eq(all[0].id, 1, 'baris pertama benar');
  eq(all[TOTAL - 1].id, TOTAL, 'baris terakhir ikut terambil');
  S.supaFetch = origSupa;
});

test('saktiRowYear — KETAT: hanya kolom ta, orphan dikecualikan (anti-gelembung total)', () => {
  eq(S.saktiRowYear({ ta: '2024', periode: 'Mei 2026' }), '2024', 'kolom ta dipakai apa adanya');
  eq(S.saktiRowYear({ ta: 2025, periode: '' }), '2025', 'ta number → string');
  eq(S.saktiRowYear({ ta: null, periode: 'Mei 2024' }), '', 'ta kosong → "" (orphan, TIDAK dilempar ke 2024)');
  eq(S.saktiRowYear({ ta: '', periode: 'Maret 2023' }), '', 'ta string kosong → "" (orphan)');
  eq(S.saktiRowYear({ ta: '  ', periode: '2026' }), '', 'ta spasi → "" (orphan)');
});

test('blockIfViewOnly — penjaga read-only', () => {
  const origToast = S.toast; S.toast = function () {};
  S.APP.viewOnly = true;
  ok(S.blockIfViewOnly() === true, 'viewOnly=true → diblokir (true)');
  S.APP.viewOnly = false;
  ok(S.blockIfViewOnly() === false, 'viewOnly=false → lolos (false)');
  S.toast = origToast;
});

test('computeSummary — sisa per bulan = pagu − realisasi KUMULATIF (regresi bug)', () => {
  // Siapkan state minimal: 1 baris, pagu 1.000, realisasi setahun 300
  // (realisasi_lalu 250 s.d. bulan lalu + realisasi_bulan 50 bulan ini).
  S.APP.data = [{
    pagu: 1000, realisasi: 300, realisasi_lalu: 250, realisasi_bulan: 50,
    sumber: 'RM',
  }];
  S.APP.blokir = [];
  S.APP.realisasiBulanan = [null,null,null,null,null,null,null,null,null,null,null,null];
  S.APP.meta.periode = 'Juni 2026';   // curM = 5 (Juni)

  // Gabungan (semua bulan): sisa = 1000 − 300 = 700
  S.APP.viewMonth = -1;
  var g = S.computeSummary('gabungan');
  eq(g.sisa, 700, 'Gabungan: sisa = pagu − total realisasi = 700');
  eq(g.paguEfektif, g.real + g.sisa, 'Gabungan: invarian pagu = realisasi + sisa');

  // Bulan berjalan (Juni): kumulatif s.d. Juni ≈ total → sisa = 700 (konsisten dgn Gabungan)
  S.APP.viewMonth = 5;
  var jun = S.computeSummary('gabungan');
  eq(jun.real, 300, 'Juni: realisasi kumulatif s.d. Juni = 300');
  eq(jun.sisa, 700, 'Juni: sisa = 700 (sama dengan Gabungan)');

  // Bulan lebih awal (Maret = index 2): kumulatif 3 bulan × (250/5=50) = 150 → sisa 850
  S.APP.viewMonth = 2;
  var mar = S.computeSummary('gabungan');
  eq(mar.real, 150, 'Maret: realisasi kumulatif s.d. Maret = 150');
  eq(mar.sisa, 850, 'Maret: sisa = 1000 − 150 = 850');
  eq(mar.paguEfektif, mar.real + mar.sisa, 'Maret: invarian pagu = realisasi + sisa');

  // Sisa harus MENGECIL seiring bulan maju (lebih banyak terserap)
  ok(mar.sisa > jun.sisa, 'Sisa Maret (850) > Sisa Juni (700) — makin maju makin kecil');

  // reset
  S.APP.viewMonth = -1; S.APP.data = []; S.APP.blokir = [];
});

test('keuRealOf — filter bulan keuangan (s.d. bulan) konsisten dengan dashboard', () => {
  S.APP.meta.periode = 'Juni 2026';   // curM = 5 (Juni)
  S.APP.realisasiBulanan = [null,null,null,null,null,null,null,null,null,null,null,null];
  S.APP.data = [{ pagu: 1000, realisasi: 300, realisasi_lalu: 250, realisasi_bulan: 50, sisa: 700 }];
  var r = S.APP.data[0];

  // s.d. Juni (terkini) → nilai penuh
  S.APP.keuBulan = '';
  var a = S.keuRealOf(r);
  eq(a.real, 300, "s.d. Juni → realisasi penuh 300");
  eq(a.sisa, 700, "s.d. Juni → sisa 700");
  eq(a.ratio, 1, "s.d. Juni → ratio 1");

  // s.d. Maret (index 2) → kumulatif 150 (estimasi merata, SAMA dgn computeSummary dashboard)
  S.APP.keuBulan = '2';
  var m = S.keuRealOf(r);
  eq(m.real, 150, "s.d. Maret → 150 (estimasi merata seperti dashboard)");
  eq(m.sisa, 850, "s.d. Maret → sisa = 1000 − 150 = 850");
  eq(m.real + m.sisa, 1000, "invarian pagu = real + sisa");

  // s.d. Januari (index 0) → 1 bulan × 50 = 50
  S.APP.keuBulan = '0';
  var j = S.keuRealOf(r);
  eq(j.real, 50, "s.d. Januari → 50");
  ok(j.real < m.real, "Januari < Maret (makin awal makin kecil)");

  S.APP.keuBulan = ''; S.APP.data = [];
});

run();
