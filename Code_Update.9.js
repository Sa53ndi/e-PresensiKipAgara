/**
 * =========================================================================================
 * SISTEM e-PRESENSI ASN KOMISI INDEPENDEN PEMILIHAN (KIP) KABUPATEN ACEH TENGGARA
 * Backend: Google Apps Script (Code.gs)
 * Database: Google Sheets
 * Regulasi Potongan: Keputusan KPU Nomor 1090 Tahun 2025 (Tukin/TPP ASN KPU)
 * =========================================================================================
 */

// -----------------------------------------------------------------------------
// KONFIGURASI GLOBAL SISTEM & GEOFENCING KANTOR
// -----------------------------------------------------------------------------
const CONFIG = {
  // Nama Instansi Resmi
  INSTANSI: "Komisi Independen Pemilihan (KIP) Kabupaten Aceh Tenggara",
  KOTA: "Kutacane, Aceh Tenggara",
  TIMEZONE: "Asia/Jakarta", // Waktu Indonesia Barat (WIB)

  // Koordinat Kantor KIP Kabupaten Aceh Tenggara (Jalan Pahlawan, No. 28.A, Desa Perapat Timur, Kutacane)
  OFFICE_LAT: 3.477984,
  OFFICE_LON: 97.820791,
  RADIUS_METER: 30, // Radius standar Hadir di Kantor (30 meter)
  RADIUS_HADIR: 30,
  RADIUS_DINAS_LUAR: 50000,
  RADIUS_WFH: 50000,
  RADIUS_CUTI: 50000,
  RADIUS_SAKIT: 12000,

  // Aturan Jam Kerja ASN KIP (WIB)
  JAM_MASUK_STANDAR: "07:30:00",  // Batas toleransi mulai terhitung keterlambatan (TL)
  JAM_PULANG_STANDAR: "16:00:00", // Batas toleransi pulang sebelum waktunya (PSW)
  JAM_PULANG_JUMAT: "16:30:00",   // Khusus hari Jumat jika berlaku 5 hari kerja
  JAM_BATAS_PULANG: "18:00:00",   // Batas waktu akhir klik Presensi Jam Pulang (18.00 WIB = ditutup)
  TOTAL_MENIT_KERJA_HARIAN: 450,  // 7.5 jam efektif kerja = 450 menit (di luar istirahat)
  KOMPENSASI_TELAT_MENIT: 15,     // Batas Kompensasi Keterlambatan 15 menit dari Jam Masuk

  // Nama Sheet Database
  SHEET_PEGAWAI: "Pegawai",
  SHEET_ABSENSI: "Absensi",
  SHEET_IZIN: "Pengajuan_Izin",
  SHEET_TUKIN: "Aturan_Tukin",
  SHEET_PENGATURAN: "Pengaturan_Sistem",
  SHEET_PERANGKAT: "Perangkat_Terdaftar",

  // Icon / Favicon Resmi Lembaga pada Tab & Link hasil Deploy
  DEFAULT_FAVICON_URL: "https://i.ibb.co.com/cShV8bvS/KIP-AGARA.png",

  // Lapisan Keamanan Jaringan Wi-Fi Satker & Anti-Fake GPS Multi-Lapis
  WIFI_KANTOR_MODE: 1,
  WIFI_KANTOR_NAMA: "Wi-Fi Kantor KIP Aceh Tenggara",
  WIFI_KANTOR_IPS: "",
  FAKE_GPS_CHECK_MODE: 1
};

/**
 * Endpoint Utama Web App (Melayani antarmuka frontend HTML)
 */
function doGet(e) {
  var html = HtmlService.createHtmlOutputFromFile("Index").getContent();
  var execUrl = "";
  try {
    execUrl = ScriptApp.getService().getUrl() || "";
  } catch (err) {
    execUrl = "";
  }

  var presetNip = "";
  try {
    if (e && e.parameter && e.parameter.nip) {
      var nipCandidate = String(e.parameter.nip).replace(/[\s-]+/g, "").trim();
      if (/^\d{18}$/.test(nipCandidate)) {
        presetNip = nipCandidate;
      }
    }
  } catch (pErr) {
    presetNip = "";
  }

  var faviconUrl = CONFIG.DEFAULT_FAVICON_URL;
  try {
    var customLogo = PropertiesService.getScriptProperties().getProperty("CUSTOM_LOGO_URL");
    if (customLogo && /^https?:\/\//i.test(String(customLogo).trim())) {
      faviconUrl = String(customLogo).trim();
    }
  } catch (favErr) {}

  html = html.replace('"__GAS_EXEC_URL_VAL__"', JSON.stringify(execUrl));
  html = html.replace('"__GAS_PRESET_NIP_VAL__"', JSON.stringify(presetNip));
  html = html.replace(/__GAS_FAVICON_URL_VAL__/g, faviconUrl);

  var out = HtmlService.createHtmlOutput(html)
    .setTitle("e-Presensi ASN KIP Kabupaten Aceh Tenggara")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  try {
    if (faviconUrl && typeof out.setFaviconUrl === "function") {
      out.setFaviconUrl(faviconUrl);
    }
  } catch (setFavErr) {}

  return out;
}

/**
 * Endpoint Fallback POST (Mengatasi kegagalan google.script.run pada Chrome multi-akun / iframe)
 * Mendukung seluruh aksi autentikasi & operasional presensi secara aman.
 */
function doPost(e) {
  var output = { success: false, message: "Permintaan tidak valid." };
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    if (String(raw).length > 5 * 1024 * 1024) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: "Ukuran payload melebihi batas aman." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var body = JSON.parse(raw);
    var action = body && body.action ? String(body.action).trim() : "";

    if (action === "loginPegawai") {
      output = loginPegawai(body.nip, body.pin, body.device);
    } else if (action === "loginAdmin") {
      output = loginAdmin(body.username, body.password);
    } else if (action === "getValidasiNIP") {
      output = getValidasiNIP(body.nip);
    } else if (action === "getAppConfig") {
      output = getAppConfig();
    } else if (action === "checkDatabaseHealth") {
      output = checkDatabaseHealth();
    } else if (action === "simpanAbsenMasuk") {
      output = simpanAbsenMasuk(body.payload || body);
    } else if (action === "simpanOpsiKompensasiTelat") {
      output = simpanOpsiKompensasiTelat(body.payload || body);
    } else if (action === "simpanAbsenPulang") {
      output = simpanAbsenPulang(body.payload || body);
    } else if (action === "simpanPengajuanIzin") {
      output = simpanPengajuanIzin(body.payload || body);
    } else if (action === "simpanLkhWfh") {
      output = simpanLkhWfh(body.payload || body);
    } else if (action === "getPengaturanRadius") {
      output = getPengaturanRadius();
    } else if (action === "simpanPengaturanRadius") {
      output = simpanPengaturanRadius(body.payload || body);
    } else if (action === "getDaftarVerifikasiApproval") {
      output = getDaftarVerifikasiApproval(body.filterStatus, body.filterTipe, body.requesterRole);
    } else if (action === "verifikasiApprovalDokumen") {
      output = verifikasiApprovalDokumen(body.payload || body);
    } else if (action === "getDaftarPerangkatAdmin") {
      output = getDaftarPerangkatAdmin(body.requesterRole);
    } else if (action === "resetPerangkatPegawai") {
      output = resetPerangkatPegawai(body.payload || body);
    } else if (action === "perbaikiErrorSpreadsheet") {
      output = perbaikiErrorSpreadsheet(body.requesterRole);
    } else if (action === "getRekapAbsensi") {
      output = getRekapAbsensi(body.nip);
    } else if (action === "getRekapKolektif") {
      output = getRekapKolektif(body.periodeBulan, body.nipFilter, body.requesterRole);
    } else if (action === "simpanLogoLembaga") {
      output = simpanLogoLembaga(body.logoInput, body.requesterRole);
    } else {
      output = { success: false, message: "Aksi API tidak dikenal." };
    }
  } catch (err) {
    output = { success: false, message: "Kesalahan server doPost: " + err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Menyertakan file parsial (CSS / JS) ke dalam HTML jika dipecah
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// -----------------------------------------------------------------------------
// MODUL KEAMANAN & VALIDASI INPUT (ANTI SQL INJECTION, XSS, & FORMULA INJECTION)
// -----------------------------------------------------------------------------

/**
 * Mendeteksi pola berbahaya (SQL Injection, HTML/Script XSS, command chars)
 */
function containsDangerPayload(val) {
  if (val === null || val === undefined) return false;
  var str = String(val);
  var patterns = [
    /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|EXEC|EXECUTE)\b\s+)/i,
    /(\bOR\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
    /(\bAND\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
    /(--|\/\*|\*\/|;\s*(SELECT|DROP|DELETE|INSERT|UPDATE))/i,
    /(\b(SLEEP|BENCHMARK|WAITFOR\s+DELAY)\s*\()/i,
    /(<\s*script\b|<\/\s*script\s*>|javascript\s*:|on(error|load|click|mouseover)\s*=)/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(str)) return true;
  }
  return false;
}

/**
 * Mencegah Spreadsheet Formula Injection (=, +, -, @ di awal sel) & XSS
 */
function sanitizeTextForSheet(val, maxLen) {
  var limit = maxLen || 500;
  var str = String(val === null || val === undefined ? "" : val)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
  if (str.length > limit) {
    str = str.substring(0, limit);
  }
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return str;
}

/**
 * Normalisasi NIP menjadi deretan angka bersih (menghilangkan spasi/tanda petik/notasi)
 */
function normalizeNipValue(val) {
  return String(val === null || val === undefined ? "" : val)
    .replace(/^'+/, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Validasi ketat NIP Pegawai ASN (Wajib 18 digit angka murni, bebas injeksi)
 */
function validateNip(rawNip) {
  var str = String(rawNip === null || rawNip === undefined ? "" : rawNip).trim();
  if (!str) {
    return { valid: false, value: "", message: "NIP wajib diisi!" };
  }
  if (containsDangerPayload(str) || /['"`;\\<>]/.test(str)) {
    return {
      valid: false,
      value: "",
      message: "Input NIP mengandung karakter tidak diizinkan (ditolak oleh validasi keamanan)."
    };
  }
  var clean = str.replace(/[\s-]+/g, "");
  if (!/^\d{18}$/.test(clean)) {
    return {
      valid: false,
      value: "",
      message: "Format NIP tidak valid! NIP harus berupa 18 digit angka."
    };
  }
  return { valid: true, value: clean, message: "" };
}

/**
 * Validasi ketat PIN Presensi (4-12 digit angka murni, bebas injeksi)
 */
function validatePin(rawPin) {
  var str = String(rawPin === null || rawPin === undefined ? "" : rawPin).trim();
  if (!str) {
    return { valid: false, value: "", message: "PIN Presensi wajib diisi!" };
  }
  if (containsDangerPayload(str) || /['"`;\\<>]/.test(str)) {
    return {
      valid: false,
      value: "",
      message: "Input PIN mengandung karakter tidak diizinkan (ditolak oleh validasi keamanan)."
    };
  }
  if (!/^\d{4,12}$/.test(str)) {
    return {
      valid: false,
      value: "",
      message: "Format PIN tidak valid! PIN harus berupa 4 hingga 12 digit angka."
    };
  }
  return { valid: true, value: str, message: "" };
}

/**
 * Validasi ketat Username & Password Admin (menolak pola SQL Injection / XSS)
 */
function validateAdminInput(rawUser, rawPass) {
  var userStr = String(rawUser === null || rawUser === undefined ? "" : rawUser).trim();
  var passStr = String(rawPass === null || rawPass === undefined ? "" : rawPass).trim();

  if (!userStr || !passStr) {
    return { valid: false, message: "Username dan Password Admin wajib diisi!" };
  }
  if (containsDangerPayload(userStr) || containsDangerPayload(passStr) || /['"`;\\<>]/.test(userStr) || /['"`;\\<>]/.test(passStr)) {
    return {
      valid: false,
      message: "Kredensial mengandung karakter atau pola tidak valid (ditolak oleh validasi keamanan)."
    };
  }
  var cleanUser = userStr.toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(cleanUser)) {
    return {
      valid: false,
      message: "Format Username Admin tidak valid (gunakan 3-40 karakter huruf/angka/titik/garis bawah)."
    };
  }
  if (passStr.length < 4 || passStr.length > 100) {
    return {
      valid: false,
      message: "Panjang Password Admin tidak valid."
    };
  }
  return { valid: true, username: cleanUser, password: passStr, message: "" };
}

/**
 * Pembatas percobaan login gagal sementara berbasis CacheService
 */
function checkLoginRateLimit(key) {
  try {
    var cache = CacheService.getScriptCache();
    var countStr = cache.get("LOGIN_FAIL_" + key);
    var count = countStr ? parseInt(countStr, 10) : 0;
    if (!isNaN(count) && count >= 10) {
      return {
        allowed: false,
        message: "Terlalu banyak percobaan login gagal. Silakan tunggu 5 menit sebelum mencoba lagi."
      };
    }
  } catch (e) {}
  return { allowed: true };
}

function recordLoginFailure(key) {
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = "LOGIN_FAIL_" + key;
    var countStr = cache.get(cacheKey);
    var count = countStr ? parseInt(countStr, 10) : 0;
    cache.put(cacheKey, String((isNaN(count) ? 0 : count) + 1), 300);
  } catch (e) {}
}

function resetLoginFailure(key) {
  try {
    CacheService.getScriptCache().remove("LOGIN_FAIL_" + key);
  } catch (e) {}
}

// -----------------------------------------------------------------------------
// KONEKSI DATABASE GOOGLE SHEETS & AUTO-PROVISIONING
// -----------------------------------------------------------------------------

/**
 * Mendapatkan referensi Spreadsheet aktif.
 * Jika dijalankan sebagai standalone script (getActiveSpreadsheet() == null),
 * otomatis membuka atau membuat Spreadsheet database baru dan menyimpan ID-nya di ScriptProperties.
 */
function getSpreadsheet() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }

  if (ss) {
    return ss;
  }

  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty("SPREADSHEET_ID");
  if (savedId) {
    try {
      ss = SpreadsheetApp.openById(savedId);
      if (ss) {
        // Verifikasi Spreadsheet dapat dibaca dan tidak rusak
        ss.getName();
        return ss;
      }
    } catch (e) {
      Logger.log("Gagal membuka Spreadsheet tersimpan (" + savedId + "): " + e);
      ss = null;
    }
  }

  // Fallback otomatis untuk Standalone Script agar setupDatabase() tidak pernah gagal
  ss = SpreadsheetApp.create("DATABASE e-PRESENSI ASN KIP AGARA 2026");
  props.setProperty("SPREADSHEET_ID", ss.getId());
  Logger.log("Spreadsheet baru berhasil dibuat otomatis: " + ss.getUrl());
  return ss;
}

/**
 * Memastikan seluruh sheet database terhubung & terinisialisasi sebelum otentikasi/transaksi
 */
function ensureDatabaseReady() {
  var ss = getSpreadsheet();
  if (!ss) {
    throw new Error("Koneksi ke database Google Sheets gagal dibuat.");
  }
  var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
  var sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
  var sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);
  var sheetTukin = ss.getSheetByName(CONFIG.SHEET_TUKIN);
  var sheetPengaturan = ss.getSheetByName(CONFIG.SHEET_PENGATURAN);
  var sheetPerangkat = ss.getSheetByName(CONFIG.SHEET_PERANGKAT);

  if (
    !sheetPegawai ||
    sheetPegawai.getLastRow() <= 1 ||
    sheetPegawai.getLastColumn() < 13 ||
    !sheetAbsensi ||
    sheetAbsensi.getLastColumn() < 37 ||
    !sheetIzin ||
    !sheetTukin ||
    !sheetPengaturan ||
    !sheetPerangkat
  ) {
    setupDatabase();
  }
  return ss;
}

/**
 * Pengecekan kesehatan koneksi database (untuk diagnostik)
 */
function checkDatabaseHealth() {
  try {
    var ss = ensureDatabaseReady();
    var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
    var totalPegawai = sheetPegawai ? Math.max(0, sheetPegawai.getLastRow() - 1) : 0;
    return {
      success: true,
      connected: true,
      spreadsheetName: ss.getName(),
      totalPegawai: totalPegawai,
      message: "Koneksi database Google Sheets aktif (" + totalPegawai + " data ASN terdaftar)."
    };
  } catch (err) {
    return {
      success: false,
      connected: false,
      message: "Koneksi database gagal: " + err.toString()
    };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 1. FUNGSI SETUP DATABASE OTOMATIS
 * Membuat seluruh sheet, kolom header berformat resmi, serta data awal (seeding)
 * Termasuk tabel aturan potongan Tukin Keputusan KPU Nomor 1090 Tahun 2025.
 * -----------------------------------------------------------------------------
 */
function setupDatabase() {
  try {
    var ss = getSpreadsheet();
    if (!ss) {
      throw new Error("Spreadsheet tidak dapat diakses atau dibuat.");
    }

    // 1. SETUP SHEET "Pegawai" (13 Kolom termasuk Pengikatan Perangkat Android/iOS Anti-Titip)
    var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
    if (!sheetPegawai) {
      sheetPegawai = ss.insertSheet(CONFIG.SHEET_PEGAWAI);
    }
    var headersPegawai = [
      "NIP",
      "Nama",
      "Jabatan",
      "Unit_Kerja",
      "Status",
      "Pangkat_Gol",
      "PIN",
      "Foto_Profil",
      "Device_ID",
      "Platform_Perangkat",
      "Info_Perangkat",
      "Device_Fingerprint",
      "Terakhir_Login_Perangkat"
    ];
    if (sheetPegawai.getLastRow() === 0) {
      formatHeaderRow(sheetPegawai, headersPegawai);

      // Paksa format Teks (@) untuk NIP 18-digit, PIN, & Device_ID agar tidak terpotong pembulatan angka Sheets
      sheetPegawai.getRange("A2:A500").setNumberFormat("@");
      sheetPegawai.getRange("G2:G500").setNumberFormat("@");
      sheetPegawai.getRange("I2:M500").setNumberFormat("@");

      // Sample Data Pegawai KIP Agara Resmi (Lengkap dengan Pangkat, PIN, Foto, & Kolom Perangkat)
      var samplePegawai = [
        ["197804032007011002", "Anwar Sandi", "Kasubbag Keuangan, Umum & Logistik", "Subbagian Keuangan, Umum & Logistik", "Aktif", "Penata (III/c)", "110202", "https://i.ibb.co.com/JWKv7Fmj/4x6.png", "", "", "", "", ""],
        ["198012022007011002", "Andi Afandi", "Kasubbag Partisipasi Hubungan Masyarakat dan SDM", "Subbagian Hupmas & SDM", "Aktif", "Pembina  (IV/a)", "110203", "https://i.ibb.co.com/1fk2MvLr/2-Copy.jpg", "", "", "", "", ""],
        ["197705142002121003", "Sufli Hadi", "Sekretaris KIP Kabupaten Aceh Tenggara", "Sekretariat KIP Agara", "Aktif", "Pembina TK I (IV/b)", "110201", "https://i.ibb.co.com/0pynRR9x/1-Copy.jpg", "", "", "", "", ""],
        ["198012232009122003", "Rifa Mainur", "Kasubbag Perencanaan, Data dan Informasi", "Subbagian Perencanaan & Data", "Aktif", "Penata TK I  (III/d)", "110204", "https://i.ibb.co.com/mVPpfpTP/3-Copy.jpg", "", "", "", "", ""],
        ["198611302005041001", "Mahyuddin", "Kasubbag Teknis Penyelenggaraan Pemilu dan Hukum", "Subbagian Teknis & Hukum", "Aktif", "Penata TK I  (III/d)", "110205", "https://i.ibb.co.com/zhhJXJZh/4-Copy.jpg", "", "", "", "", ""],
        ["198510192025211014", "Anwar", "Pengadministrasi Perkantoran", "Subbagian Keuangan, Umum & Logistik", "Aktif", "Golongan. V", "110224", "https://i.ibb.co.com/5hzt2R3q/22-Copy.jpg", "", "", "", "", ""]
      ];
      sheetPegawai.getRange(2, 1, samplePegawai.length, samplePegawai[0].length).setValues(samplePegawai);
    } else {
      // Migrasi aman jika sheet Pegawai lama hanya punya 5 atau 8 kolom
      try {
        sheetPegawai.getRange("A2:A500").setNumberFormat("@");
        sheetPegawai.getRange("G2:G500").setNumberFormat("@");
        sheetPegawai.getRange("I2:M500").setNumberFormat("@");
        var lastCol = sheetPegawai.getLastColumn();
        if (lastCol < 8) {
          formatHeaderRow(sheetPegawai, headersPegawai);
        } else if (lastCol < headersPegawai.length) {
          var startColPeg = Math.max(1, lastCol + 1);
          var missingPegHeaders = headersPegawai.slice(startColPeg - 1);
          if (missingPegHeaders.length > 0) {
            sheetPegawai.getRange(1, startColPeg, 1, missingPegHeaders.length)
              .setValues([missingPegHeaders])
              .setBackground("#1B365D")
              .setFontColor("#FFFFFF")
              .setFontWeight("bold")
              .setHorizontalAlignment("center");
          }
        }
        var existingRows = sheetPegawai.getDataRange().getDisplayValues();
        var knownNipMap = {
          "Anwar Sandi": "197804032007011002",
          "Andi Afandi": "198012022007011002",
          "Sufli Hadi": "197705142002121003",
          "Rifa Mainur": "198012232009122003",
          "Mahyuddin": "198611302005041001",
          "Anwar": "198510192025211014"
        };
        for (var r = 1; r < existingRows.length; r++) {
          var cellNip = String(existingRows[r][0] || "").trim();
          var cellNama = String(existingRows[r][1] || "").trim();
          if (cellNip.indexOf("E+") !== -1 || cellNip.indexOf("e+") !== -1 || /000$/.test(cellNip)) {
            for (var keyName in knownNipMap) {
              if (cellNama.indexOf(keyName) !== -1) {
                sheetPegawai.getRange(r + 1, 1).setNumberFormat("@").setValue(knownNipMap[keyName]);
                break;
              }
            }
          }
          if (!String(existingRows[r][6] || "").trim()) {
            sheetPegawai.getRange(r + 1, 7).setNumberFormat("@").setValue("123456");
          }
        }
      } catch (migErr) {
        Logger.log("Migrasi kolom Pegawai dilewati: " + migErr);
      }
    }

    // 2. SETUP SHEET "Absensi" (37 Kolom termasuk Approval, LKH, Perangkat, Kompensasi, Batas Pulang, Wi-Fi Satker, Anti-Fake GPS & Kode Potongan Tukin)
    var sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (!sheetAbsensi) {
      sheetAbsensi = ss.insertSheet(CONFIG.SHEET_ABSENSI);
    }
    var headersAbsensi = [
      "ID_Absen",
      "NIP",
      "Nama",
      "Tanggal",
      "Jam_Masuk",
      "Status_Kehadiran",
      "Latitude_Masuk",
      "Longitude_Masuk",
      "Foto_Masuk",
      "Jam_Pulang",
      "Latitude_Pulang",
      "Longitude_Pulang",
      "Foto_Pulang",
      "Jumlah Jam Kerja",
      "Kekurangan Jam Kerja",
      "Potongan Jam Kerja",
      "Dokumen_Pendukung",
      "Laporan_Kinerja_Harian",
      "URL_LKH_WFH",
      "Catatan_LKH_WFH",
      "Status_Approval",
      "Catatan_Approval",
      "Diverifikasi_Oleh",
      "Device_ID_Masuk",
      "Device_ID_Pulang",
      "Platform_Perangkat",
      "Menit_Terlambat",
      "Opsi_Kompensasi_Telat",
      "Jam_Pulang_Wajib_Kompensasi",
      "Status_Kompensasi_Telat",
      "Batas_Waktu_Pulang",
      "Status_Batas_Pulang",
      "IP_Publik_Presensi",
      "Status_Jaringan_WiFi",
      "Skor_Validasi_GPS",
      "Status_Keamanan_Lokasi",
      "Kode_Potongan_Tukin"
    ];
    if (sheetAbsensi.getLastRow() === 0) {
      formatHeaderRow(sheetAbsensi, headersAbsensi);
      sheetAbsensi.getRange("B2:B1000").setNumberFormat("@");
      sheetAbsensi.getRange("D2:E1000").setNumberFormat("@");
      sheetAbsensi.getRange("J2:J1000").setNumberFormat("@");
      sheetAbsensi.getRange("P2:P1000").setNumberFormat("@");
      sheetAbsensi.getRange("X2:AK1000").setNumberFormat("@");
    } else {
      try {
        sheetAbsensi.getRange("P2:P1000").setNumberFormat("@");
        sheetAbsensi.getRange("X2:AK1000").setNumberFormat("@");
      } catch (fmtErr) {}
      if (sheetAbsensi.getLastColumn() < headersAbsensi.length) {
        try {
          var startColAbs = Math.max(1, sheetAbsensi.getLastColumn() + 1);
          var missingAbsHeaders = headersAbsensi.slice(startColAbs - 1);
          if (missingAbsHeaders.length > 0) {
            sheetAbsensi.getRange(1, startColAbs, 1, missingAbsHeaders.length)
              .setValues([missingAbsHeaders])
              .setBackground("#1B365D")
              .setFontColor("#FFFFFF")
              .setFontWeight("bold")
              .setHorizontalAlignment("center");
          }
        } catch (absMigErr) {
          Logger.log("Migrasi header Absensi dilewati: " + absMigErr);
        }
      }
    }

    // 3. SETUP SHEET "Pengajuan_Izin" (14 Kolom termasuk URL & Verifikasi Approval)
    var sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);
    if (!sheetIzin) {
      sheetIzin = ss.insertSheet(CONFIG.SHEET_IZIN);
    }
    var headersIzin = [
      "ID_Izin",
      "NIP",
      "Nama",
      "Jenis_Izin",
      "Tanggal_Mulai",
      "Tanggal_Selesai",
      "Keterangan",
      "Bukti_Dokumen",
      "Status_Validasi",
      "Waktu_Pengajuan",
      "URL_Dokumen",
      "Diverifikasi_Oleh",
      "Catatan_Verifikasi",
      "Waktu_Verifikasi"
    ];
    if (sheetIzin.getLastRow() === 0) {
      formatHeaderRow(sheetIzin, headersIzin);
      sheetIzin.getRange("B2:B1000").setNumberFormat("@");
    } else if (sheetIzin.getLastColumn() < headersIzin.length) {
      try {
        var startColIzin = Math.max(1, sheetIzin.getLastColumn() + 1);
        var missingIzinHeaders = headersIzin.slice(startColIzin - 1);
        if (missingIzinHeaders.length > 0) {
          sheetIzin.getRange(1, startColIzin, 1, missingIzinHeaders.length)
            .setValues([missingIzinHeaders])
            .setBackground("#1B365D")
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");
        }
      } catch (izinMigErr) {
        Logger.log("Migrasi header Pengajuan_Izin dilewati: " + izinMigErr);
      }
    }

    // 4. SETUP SHEET "Aturan_Tukin" (Keputusan KPU Nomor 1090 Tahun 2025 + Kompensasi 15 Menit + Batas Waktu Pulang 18:00 WIB)
    var sheetTukin = ss.getSheetByName(CONFIG.SHEET_TUKIN);
    if (!sheetTukin) {
      sheetTukin = ss.insertSheet(CONFIG.SHEET_TUKIN);
    }
    var kompRowTukin = [
      "KOMP",
      "Kompensasi & Penggantian Keterlambatan",
      "Penggantian Jam Keterlambatan (Maks. Pulang 18:00 WIB)",
      1,
      120,
      "0.00%*",
      "Kebijakan Satker KIP Agara / Kep. KPU No. 1090 Tahun 2025",
      "Jika memilih 'Mengganti Jam Keterlambatan' setelah 16:00 WIB (<= 18:00 WIB) dan terpenuhi, potongan keterlambatan (TL) menjadi 0.00%. Toleransi kompensasi standar 15 menit; jika waktu penggantian melewati 18:00 WIB dikenakan TL 4 (1.50%)."
    ];
    var batasPulangRowTukin = [
      "BATAS_PULANG",
      "Batas Waktu Pulang",
      "Batas Akhir Klik Presensi Jam Pulang Pukul 18:00 WIB",
      0,
      0,
      "Ditutup*",
      "Kebijakan Satker KIP Agara / Kep. KPU No. 1090 Tahun 2025",
      "Klik Absen Pulang dilayani paling lambat pukul 18:00:00 WIB. Jika durasi keterlambatan melebihi batas penggantian hingga 18:00:00 WIB (>120 menit), otomatis dianggap TL 4 (1.50%)."
    ];
    var wifiFakeGpsRowTukin = [
      "WIFI_GPS",
      "Keamanan Lokasi",
      "Wajib Wi-Fi Satker KIP Agara (Hadir) & Anti-Fake GPS",
      0,
      0,
      "Diblokir*",
      "Kebijakan Keamanan Presensi Satker KIP Agara",
      "Presensi Hadir di Kantor wajib terhubung ke jaringan Wi-Fi resmi Satker dan bebas dari aplikasi Fake GPS / manipulasi koordinat."
    ];
    var tl1RowTukin = ["TL 1", "Keterlambatan", "Terlambat 1 s.d. 30 menit", 1, 30, "0.50%", "Keputusan KPU No. 1090 Tahun 2025", "Masuk pukul 07:31 - 08:00 WIB (berlaku jika memilih Cepat Pulang / gagal mengganti keterlambatan)"];
    var tl4RowTukin = ["TL 4", "Keterlambatan", "Terlambat > 90 Menit / Lewat Batas Penggantian 18:00 WIB / Tidak Absen", 91, 9999, "1.50%", "Keputusan KPU No. 1090 Tahun 2025", "Masuk setelah 09:00 WIB (tanpa ganti jam), atau durasi terlambat melewati batas penggantian 18:00 WIB (wajib TL 4)"];

    if (sheetTukin.getLastRow() === 0) {
      var headersTukin = [
        "Kode",
        "Kategori_Pelanggaran",
        "Deskripsi_Keterlambatan_Ketidakhadiran",
        "Min_Menit",
        "Max_Menit",
        "Persentase_Potongan",
        "Dasar_Hukum",
        "Keterangan_Aturan"
      ];
      formatHeaderRow(sheetTukin, headersTukin);

      var aturanKpu1090 = [
        // Kompensasi & Penggantian Keterlambatan, Batas Waktu Pulang 18:00 WIB, & Keamanan Wi-Fi/Anti-Fake GPS
        kompRowTukin,
        batasPulangRowTukin,
        wifiFakeGpsRowTukin,
        // Keterlambatan Masuk Kerja (TL)
        tl1RowTukin,
        ["TL 2", "Keterlambatan", "Terlambat 31 s.d. 60 menit", 31, 60, "1.00%", "Keputusan KPU No. 1090 Tahun 2025", "Masuk pukul 08:01 - 08:30 WIB (berlaku jika memilih Cepat Pulang / gagal mengganti keterlambatan)"],
        ["TL 3", "Keterlambatan", "Terlambat 61 s.d. 90 menit", 61, 90, "1.25%", "Keputusan KPU No. 1090 Tahun 2025", "Masuk pukul 08:31 - 09:00 WIB (berlaku jika memilih Cepat Pulang / gagal mengganti keterlambatan)"],
        tl4RowTukin,

        // Pulang Sebelum Waktunya (PSW)
        ["PSW 1", "Pulang Cepat", "Pulang Sebelum Waktu 1 s.d. 30 menit", 1, 30, "0.50%", "Keputusan KPU No. 1090 Tahun 2025", "Pulang pukul 15:30 - 15:59 WIB (khusus Pulang Cepat sebelum waktu 16:00 WIB)"],
        ["PSW 2", "Pulang Cepat", "Pulang Sebelum Waktu 31 s.d. 60 menit", 31, 60, "1.00%", "Keputusan KPU No. 1090 Tahun 2025", "Pulang pukul 15:00 - 15:29 WIB"],
        ["PSW 3", "Pulang Cepat", "Pulang Sebelum Waktu 61 s.d. 90 menit", 61, 90, "1.25%", "Keputusan KPU No. 1090 Tahun 2025", "Pulang pukul 14:30 - 14:59 WIB"],
        ["PSW 4", "Pulang Cepat", "Pulang Sebelum Waktu > 90 menit / Tidak Absen Pulang", 91, 9999, "1.50%", "Keputusan KPU No. 1090 Tahun 2025", "Pulang sebelum 14:30 WIB atau lupa absen pulang"],

        // Ketidakhadiran & Ketentuan Izin Khusus
        ["TK", "Ketidakhadiran", "Tidak Hadir Tanpa Alasan Sah (Alpa)", 0, 0, "3.00%", "Keputusan KPU No. 1090 Tahun 2025", "Potongan harian kumulatif per hari kerja"],
        ["IZIN", "Pengajuan Izin", "Izin Kepentingan Pribadi (Disetujui / Bukti Ditolak)", 0, 0, "1.50%", "Keputusan KPU No. 1090 Tahun 2025", "Izin non-dinas atau dokumen pembuktian ditolak Pimpinan/Kasubbag"],
        ["SAKIT", "Pengajuan Izin", "Sakit dengan Surat Keterangan Dokter", 0, 0, "0.00%", "Keputusan KPU No. 1090 Tahun 2025", "Dilampiri bukti surat dokter sah & disetujui"],
        ["CUTI", "Pengajuan Izin", "Cuti Tahunan / Bersalin / Alasan Penting", 0, 0, "0.00%", "Keputusan KPU No. 1090 Tahun 2025", "Sesuai surat keputusan hak cuti ASN"],
        ["DL", "Kedinasan", "Dinas Luar / Monitoring Tahapan Pilkada / Pemilu", 0, 0, "0.00%", "Keputusan KPU No. 1090 Tahun 2025", "Dilengkapi Surat Perintah Tugas (SPT)"],
        ["WFH", "Kedinasan", "Work From Home (Penugasan Resmi)", 0, 0, "0.00%", "Keputusan KPU No. 1090 Tahun 2025", "Wajib mengisi Laporan Kinerja Harian (LKH)"]
      ];
      sheetTukin.getRange(2, 1, aturanKpu1090.length, aturanKpu1090[0].length).setValues(aturanKpu1090);
    } else {
      try {
        var tkRows = sheetTukin.getDataRange().getValues();
        var hasKompRow = false;
        var hasBatasPulangRow = false;
        var hasWifiGpsRow = false;
        for (var tkIdx = 1; tkIdx < tkRows.length; tkIdx++) {
          var tkKode = String(tkRows[tkIdx][0] || "").trim().toUpperCase();
          if (tkKode === "KOMP") {
            hasKompRow = true;
            sheetTukin.getRange(tkIdx + 1, 1, 1, kompRowTukin.length).setValues([kompRowTukin]);
          } else if (tkKode === "BATAS_PULANG") {
            hasBatasPulangRow = true;
            sheetTukin.getRange(tkIdx + 1, 1, 1, batasPulangRowTukin.length).setValues([batasPulangRowTukin]);
          } else if (tkKode === "WIFI_GPS") {
            hasWifiGpsRow = true;
          } else if (tkKode === "TL 1") {
            sheetTukin.getRange(tkIdx + 1, 1, 1, tl1RowTukin.length).setValues([tl1RowTukin]);
          } else if (tkKode === "TL 4") {
            sheetTukin.getRange(tkIdx + 1, 1, 1, tl4RowTukin.length).setValues([tl4RowTukin]);
          }
        }
        if (!hasKompRow) {
          sheetTukin.appendRow(kompRowTukin);
        }
        if (!hasBatasPulangRow) {
          sheetTukin.appendRow(batasPulangRowTukin);
        }
        if (!hasWifiGpsRow) {
          sheetTukin.appendRow(wifiFakeGpsRowTukin);
        }
      } catch (tkErr) {}
    }

    // 5. SETUP SHEET "Pengaturan_Sistem" (Radius Dinamis, Anti-Titip, Kompensasi, Batas Pulang, Wi-Fi Satker & Anti-Fake GPS)
    var sheetPengaturan = ss.getSheetByName(CONFIG.SHEET_PENGATURAN);
    if (!sheetPengaturan) {
      sheetPengaturan = ss.insertSheet(CONFIG.SHEET_PENGATURAN);
    }
    var jamBatasPulangRow = ["JAM_BATAS_PULANG", CONFIG.JAM_BATAS_PULANG || "18:00:00", "Batas Waktu Akhir Klik Presensi Jam Pulang (WIB)", "-", "Sistem Default"];
    var wifiModeRow = ["WIFI_KANTOR_MODE", CONFIG.WIFI_KANTOR_MODE !== undefined ? CONFIG.WIFI_KANTOR_MODE : 1, "Wajib Jaringan Wi-Fi Satker saat Hadir di Kantor (1=Aktif Ketat, 0=Nonaktif)", "-", "Sistem Default"];
    var wifiNamaRow = ["WIFI_KANTOR_NAMA", CONFIG.WIFI_KANTOR_NAMA || "Wi-Fi Kantor KIP Aceh Tenggara", "Nama SSID / Jaringan Wi-Fi Resmi Satker", "-", "Sistem Default"];
    var wifiIpsRow = ["WIFI_KANTOR_IPS", CONFIG.WIFI_KANTOR_IPS || "", "Daftar IP Publik / Prefix CIDR Wi-Fi Satker (pisah koma)", "-", "Sistem Default"];
    var fakeGpsModeRow = ["FAKE_GPS_CHECK_MODE", CONFIG.FAKE_GPS_CHECK_MODE !== undefined ? CONFIG.FAKE_GPS_CHECK_MODE : 1, "Deteksi Anomali Fake GPS Multi-Lapis (1=Aktif, 0=Nonaktif)", "-", "Sistem Default"];

    if (sheetPengaturan.getLastRow() === 0) {
      var headersPengaturan = ["Kunci_Pengaturan", "Nilai_Meter", "Label_Tipe_Kehadiran", "Terakhir_Diubah", "Diubah_Oleh"];
      formatHeaderRow(sheetPengaturan, headersPengaturan);
      var defaultRadiusRows = [
        ["RADIUS_HADIR", CONFIG.RADIUS_HADIR || 30, "Hadir di Kantor", "-", "Sistem Default"],
        ["RADIUS_DINAS_LUAR", CONFIG.RADIUS_DINAS_LUAR || 50000, "Dinas Luar / Tahapan Pemilu/Pilkada", "-", "Sistem Default"],
        ["RADIUS_WFH", CONFIG.RADIUS_WFH || 50000, "Work From Home (WFH)", "-", "Sistem Default"],
        ["RADIUS_CUTI", CONFIG.RADIUS_CUTI || 50000, "Cuti Tahunan / Bersalin / Alasan Penting", "-", "Sistem Default"],
        ["RADIUS_SAKIT", CONFIG.RADIUS_SAKIT || 12000, "Sakit (Surat Keterangan Dokter)", "-", "Sistem Default"],
        ["ANTI_TITIP_DEVICE_MODE", 1, "Kunci 1 Perangkat Android/iOS per NIP (1=Aktif Ketat, 0=Nonaktif)", "-", "Sistem Default"],
        ["KOMPENSASI_TELAT_MENIT", CONFIG.KOMPENSASI_TELAT_MENIT || 15, "Batas Kompensasi Keterlambatan (Menit)", "-", "Sistem Default"],
        jamBatasPulangRow,
        wifiModeRow,
        wifiNamaRow,
        wifiIpsRow,
        fakeGpsModeRow
      ];
      sheetPengaturan.getRange(2, 1, defaultRadiusRows.length, defaultRadiusRows[0].length).setValues(defaultRadiusRows);
      sheetPengaturan.getRange(9, 2).setNumberFormat("@").setValue(CONFIG.JAM_BATAS_PULANG || "18:00:00");
      sheetPengaturan.getRange(11, 2).setNumberFormat("@").setValue(CONFIG.WIFI_KANTOR_NAMA || "Wi-Fi Kantor KIP Aceh Tenggara");
      sheetPengaturan.getRange(12, 2).setNumberFormat("@").setValue(CONFIG.WIFI_KANTOR_IPS || "");
    } else {
      try {
        var existingSettings = sheetPengaturan.getDataRange().getValues();
        var existingKeysMap = {};
        for (var stIdx = 1; stIdx < existingSettings.length; stIdx++) {
          var stKey = String(existingSettings[stIdx][0] || "").trim().toUpperCase();
          if (stKey) existingKeysMap[stKey] = true;
        }
        if (!existingKeysMap["ANTI_TITIP_DEVICE_MODE"]) {
          sheetPengaturan.appendRow(["ANTI_TITIP_DEVICE_MODE", 1, "Kunci 1 Perangkat Android/iOS per NIP (1=Aktif Ketat, 0=Nonaktif)", "-", "Sistem Default"]);
        }
        if (!existingKeysMap["KOMPENSASI_TELAT_MENIT"]) {
          sheetPengaturan.appendRow(["KOMPENSASI_TELAT_MENIT", CONFIG.KOMPENSASI_TELAT_MENIT || 15, "Batas Kompensasi Keterlambatan (Menit)", "-", "Sistem Default"]);
        }
        if (!existingKeysMap["JAM_BATAS_PULANG"]) {
          sheetPengaturan.appendRow(jamBatasPulangRow);
          sheetPengaturan.getRange(sheetPengaturan.getLastRow(), 2).setNumberFormat("@").setValue(CONFIG.JAM_BATAS_PULANG || "18:00:00");
        }
        if (!existingKeysMap["WIFI_KANTOR_MODE"]) {
          sheetPengaturan.appendRow(wifiModeRow);
        }
        if (!existingKeysMap["WIFI_KANTOR_NAMA"]) {
          sheetPengaturan.appendRow(wifiNamaRow);
          sheetPengaturan.getRange(sheetPengaturan.getLastRow(), 2).setNumberFormat("@").setValue(CONFIG.WIFI_KANTOR_NAMA || "Wi-Fi Kantor KIP Aceh Tenggara");
        }
        if (!existingKeysMap["WIFI_KANTOR_IPS"]) {
          sheetPengaturan.appendRow(wifiIpsRow);
          sheetPengaturan.getRange(sheetPengaturan.getLastRow(), 2).setNumberFormat("@").setValue(CONFIG.WIFI_KANTOR_IPS || "");
        }
        if (!existingKeysMap["FAKE_GPS_CHECK_MODE"]) {
          sheetPengaturan.appendRow(fakeGpsModeRow);
        }
      } catch (stErr) {}
    }

    // 6. SETUP SHEET "Perangkat_Terdaftar" (Registry & Audit Log Anti-Titip Presensi)
    var sheetPerangkat = ss.getSheetByName(CONFIG.SHEET_PERANGKAT);
    if (!sheetPerangkat) {
      sheetPerangkat = ss.insertSheet(CONFIG.SHEET_PERANGKAT);
    }
    var headersPerangkat = [
      "ID_Log",
      "Waktu",
      "NIP",
      "Nama",
      "Device_ID",
      "Platform",
      "Info_Perangkat",
      "Device_Fingerprint",
      "Aksi",
      "Status_Keamanan",
      "Keterangan"
    ];
    if (sheetPerangkat.getLastRow() === 0) {
      formatHeaderRow(sheetPerangkat, headersPerangkat);
      sheetPerangkat.getRange("C2:C1000").setNumberFormat("@");
      sheetPerangkat.getRange("E2:E1000").setNumberFormat("@");
    } else if (sheetPerangkat.getLastColumn() < headersPerangkat.length) {
      try {
        var startColDev = Math.max(1, sheetPerangkat.getLastColumn() + 1);
        var missingDevHeaders = headersPerangkat.slice(startColDev - 1);
        if (missingDevHeaders.length > 0) {
          sheetPerangkat.getRange(1, startColDev, 1, missingDevHeaders.length)
            .setValues([missingDevHeaders])
            .setBackground("#1B365D")
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");
        }
      } catch (devMigErr) {}
    }

    // Perbaiki otomatis sel #ERROR! pada kolom Foto_Masuk, Foto_Pulang, dan Bukti Dokumen
    try {
      repairSpreadsheetFormulaErrors(ss);
    } catch (repErr) {
      Logger.log("Info repairSpreadsheetFormulaErrors: " + repErr);
    }

    SpreadsheetApp.flush();
    Logger.log("setupDatabase() berhasil dijalankan pada Spreadsheet: " + ss.getUrl());

    return {
      success: true,
      spreadsheetUrl: ss.getUrl(),
      message: "Struktur Database Google Sheets KIP Agara & Aturan Tukin Keputusan KPU No. 1090/2025 berhasil dibuat dan disinkronkan secara lengkap!"
    };
  } catch (err) {
    Logger.log("Error setupDatabase(): " + err.toString());
    return {
      success: false,
      message: "Gagal menjalankan setupDatabase: " + err.toString()
    };
  }
}

/**
 * Helper untuk memberikan format styling resmi pada baris header sheet
 * Menggunakan operasi batch & satu pemanggilan lebar kolom agar bebas timeout/error Sheets RPC
 */
function formatHeaderRow(sheet, headers) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  range
    .setValues([headers])
    .setBackground("#1B365D")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  try {
    sheet.setColumnWidths(1, headers.length, 165);
  } catch (e) {
    // Abaikan jika ukuran kolom default sudah cukup
  }
}

/**
 * Helper untuk normalisasi tanggal ke format string YYYY-MM-DD
 * Menangani objek Date Google Sheets, string ISO, maupun format tanggal lokal.
 */
function normalizeDateStr(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, "yyyy-MM-dd");
  }
  const str = String(val).trim();
  if (str.length >= 10 && str.match(/^\d{4}-\d{2}-\d{2}/)) {
    return str.substring(0, 10);
  }
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
    }
  } catch (e) {}
  return str.substring(0, 10);
}

/**
 * Helper untuk normalisasi jam ke format string HH:mm:ss (Jam, Menit, Detik)
 * Menangani objek Date otomatis dari Google Sheets agar tidak muncul string panjang.
 */
function formatJamWIB(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, "HH:mm:ss");
  }
  const str = String(val).trim();
  const match = str.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  if (match) {
    const hh = String(match[1]).padStart(2, "0");
    const mm = String(match[2]).padStart(2, "0");
    const ss = String(match[3] || "00").padStart(2, "0");
    return hh + ":" + mm + ":" + ss;
  }
  return str;
}

/**
 * Helper internal: mengambil data pegawai termasuk PIN untuk verifikasi login di server
 * Menggunakan getDisplayValues() & normalisasi spasi agar NIP 18-digit selalu akurat
 */
function getPegawaiWithPin(cleanNip) {
  const targetNip = normalizeNipValue(cleanNip);
  if (!targetNip) return null;

  const ss = ensureDatabaseReady();
  let sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
  if (!sheetPegawai) return null;

  const dataPegawai = sheetPegawai.getDataRange().getDisplayValues();
  for (let i = 1; i < dataPegawai.length; i++) {
    const rowNip = normalizeNipValue(dataPegawai[i][0]);
    if (rowNip === targetNip) {
      return {
        rowIndex: i + 1,
        nip: rowNip,
        nama: String(dataPegawai[i][1] || ""),
        jabatan: String(dataPegawai[i][2] || ""),
        unitKerja: String(dataPegawai[i][3] || ""),
        status: String(dataPegawai[i][4] || "Aktif"),
        pangkatGolongan: dataPegawai[i][5] ? String(dataPegawai[i][5]) : "Penata Muda (III/a)",
        pin: dataPegawai[i][6] ? String(dataPegawai[i][6]).replace(/^'+/, "").trim() : "123456",
        fotoProfil: dataPegawai[i][7] ? String(dataPegawai[i][7]).trim() : "",
        deviceId: dataPegawai[i][8] ? String(dataPegawai[i][8]).trim() : "",
        devicePlatform: dataPegawai[i][9] ? String(dataPegawai[i][9]).trim() : "",
        deviceInfo: dataPegawai[i][10] ? String(dataPegawai[i][10]).trim() : "",
        deviceFingerprint: dataPegawai[i][11] ? String(dataPegawai[i][11]).trim() : "",
        lastDeviceLogin: dataPegawai[i][12] ? String(dataPegawai[i][12]).trim() : ""
      };
    }
  }
  return null;
}

/**
 * -----------------------------------------------------------------------------
 * MODUL PENGIKATAN PERANGKAT ANDROID/iOS (ANTI-TITIP PRESENSI / BUDDY PUNCHING)
 * -----------------------------------------------------------------------------
 */
function getAntiTitipMode(ssOpt) {
  try {
    var ss = ssOpt || ensureDatabaseReady();
    var sheetPengaturan = ss ? ss.getSheetByName(CONFIG.SHEET_PENGATURAN) : null;
    if (sheetPengaturan && sheetPengaturan.getLastRow() > 1) {
      var rows = sheetPengaturan.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || "").trim().toUpperCase() === "ANTI_TITIP_DEVICE_MODE") {
          return String(rows[i][1]).trim() !== "0";
        }
      }
    }
  } catch (e) {}
  return true;
}

function normalizeDevicePayload(rawDevice) {
  if (!rawDevice || typeof rawDevice !== "object") {
    return { valid: false, message: "Identitas perangkat Android/iOS tidak terdeteksi. Muat ulang aplikasi dari browser HP Anda." };
  }
  var deviceId = String(rawDevice.deviceId || "").replace(/[^A-Za-z0-9_-]/g, "").trim();
  if (!deviceId || !/^DEV-[A-Z0-9-]{6,64}$/.test(deviceId) || containsDangerPayload(deviceId)) {
    return { valid: false, message: "Format ID Perangkat tidak valid. Pastikan akses aplikasi melalui browser resmi HP Android/iOS Anda." };
  }

  var rawPlat = String(rawDevice.devicePlatform || rawDevice.platform || "").trim();
  var platform = "Desktop";
  if (/android/i.test(rawPlat) || deviceId.indexOf("DEV-ANDROID-") === 0) platform = "Android";
  else if (/ios|iphone|ipad/i.test(rawPlat) || deviceId.indexOf("DEV-IOS-") === 0) platform = "iOS";

  var deviceInfo = sanitizeTextForSheet(rawDevice.deviceInfo || (platform + " Device"), 140);
  var fingerprint = String(rawDevice.deviceFingerprint || rawDevice.fingerprint || "").replace(/[^A-Za-z0-9_-]/g, "").substring(0, 64);

  return {
    valid: true,
    deviceId: deviceId,
    platform: platform,
    deviceInfo: deviceInfo,
    fingerprint: fingerprint
  };
}

function catatLogPerangkat(ss, logObj) {
  try {
    if (!ss) return;
    var sheetDev = ss.getSheetByName(CONFIG.SHEET_PERANGKAT);
    if (!sheetDev) return;
    var nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    var idLog = "DEVLOG-" + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyyMMddHHmmss") + "-" + Math.floor(100 + Math.random() * 900);
    sheetDev.appendRow([
      idLog,
      nowStr,
      String(logObj.nip || ""),
      sanitizeTextForSheet(logObj.nama || "-", 80),
      String(logObj.deviceId || "-"),
      String(logObj.platform || "-"),
      sanitizeTextForSheet(logObj.deviceInfo || "-", 140),
      String(logObj.fingerprint || "-"),
      String(logObj.aksi || "INFO"),
      String(logObj.statusKeamanan || "AMAN"),
      sanitizeTextForSheet(logObj.keterangan || "-", 240)
    ]);
    var lr = sheetDev.getLastRow();
    sheetDev.getRange(lr, 3).setNumberFormat("@");
    sheetDev.getRange(lr, 5).setNumberFormat("@");
  } catch (logErr) {
    Logger.log("Peringatan catatLogPerangkat: " + logErr);
  }
}

function verifikasiDanIkatPerangkat(ss, cleanNip, namaPegawai, rawDevice, konteksAksi) {
  var devCheck = normalizeDevicePayload(rawDevice);
  if (!devCheck.valid) {
    return { success: false, blockedByDevice: true, message: devCheck.message };
  }

  var strictMode = getAntiTitipMode(ss);
  var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
  if (!sheetPegawai || sheetPegawai.getLastRow() <= 1) {
    return { success: false, message: "Sheet Pegawai tidak ditemukan." };
  }

  var rows = sheetPegawai.getDataRange().getDisplayValues();
  var targetRowIdx = -1;
  var registeredDeviceId = "";
  var registeredPlatform = "";
  var registeredInfo = "";

  for (var i = 1; i < rows.length; i++) {
    var rowNip = normalizeNipValue(rows[i][0]);
    var rowDevId = String(rows[i][8] || "").trim();

    if (rowNip === cleanNip) {
      targetRowIdx = i + 1;
      registeredDeviceId = rowDevId;
      registeredPlatform = String(rows[i][9] || "").trim();
      registeredInfo = String(rows[i][10] || "").trim();
    } else if (strictMode && rowDevId && rowDevId === devCheck.deviceId) {
      // BLOKIR VECTOR 1: Satu HP mencoba dipakai oleh NIP pegawai lain (Titip Presensi ke HP teman)
      var ownerNama = String(rows[i][1] || "Pegawai Lain").trim();
      var pesanTitip = "AKSES DITOLAK (ANTI-TITIP PRESENSI): Perangkat " + devCheck.platform + " ini (" + devCheck.deviceId + ") sudah terdaftar milik " + ownerNama + " (NIP: " + rowNip + "). Satu HP tidak boleh digunakan untuk menitip presensi pegawai lain! Hubungi Admin Satker jika perlu reset perangkat.";
      catatLogPerangkat(ss, {
        nip: cleanNip,
        nama: namaPegawai,
        deviceId: devCheck.deviceId,
        platform: devCheck.platform,
        deviceInfo: devCheck.deviceInfo,
        fingerprint: devCheck.fingerprint,
        aksi: "DITOLAK_TITIP_PERANGKAT",
        statusKeamanan: "DIBLOKIR",
        keterangan: "Perangkat sudah terikat milik NIP " + rowNip + " (" + ownerNama + ") saat " + konteksAksi
      });
      return { success: false, blockedByDevice: true, message: pesanTitip };
    }
  }

  if (targetRowIdx === -1) {
    return { success: false, message: "Data pegawai tidak ditemukan." };
  }

  if (strictMode && registeredDeviceId && registeredDeviceId !== devCheck.deviceId) {
    // BLOKIR VECTOR 2: Akun pegawai sudah terikat pada HP A, mencoba login/absen dari HP B
    var pesanBeda = "PERANGKAT TIDAK DIKENALI (ANTI-TITIP PRESENSI): Akun NIP " + cleanNip + " sudah dikunci pada perangkat " + (registeredPlatform || "HP Terdaftar") + " (" + registeredDeviceId + (registeredInfo ? " - " + registeredInfo : "") + "). Anda tidak dapat melakukan presensi menggunakan perangkat lain (" + devCheck.deviceId + "). Gunakan HP Anda sendiri atau minta Admin Satker melakukan Reset Perangkat.";
    catatLogPerangkat(ss, {
      nip: cleanNip,
      nama: namaPegawai,
      deviceId: devCheck.deviceId,
      platform: devCheck.platform,
      deviceInfo: devCheck.deviceInfo,
      fingerprint: devCheck.fingerprint,
      aksi: "DITOLAK_PERANGKAT_BERBEDA",
      statusKeamanan: "DIBLOKIR",
      keterangan: "Akun terikat ke " + registeredDeviceId + ", dicoba dari " + devCheck.deviceId + " saat " + konteksAksi
    });
    return { success: false, blockedByDevice: true, message: pesanBeda };
  }

  var nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  var newlyBound = false;

  if (!registeredDeviceId) {
    newlyBound = true;
    sheetPegawai.getRange(targetRowIdx, 9, 1, 5).setValues([[
      devCheck.deviceId,
      devCheck.platform,
      devCheck.deviceInfo,
      devCheck.fingerprint,
      nowStr
    ]]);
    sheetPegawai.getRange(targetRowIdx, 9, 1, 5).setNumberFormat("@");
    catatLogPerangkat(ss, {
      nip: cleanNip,
      nama: namaPegawai,
      deviceId: devCheck.deviceId,
      platform: devCheck.platform,
      deviceInfo: devCheck.deviceInfo,
      fingerprint: devCheck.fingerprint,
      aksi: "REGISTRASI_BARU",
      statusKeamanan: "AMAN",
      keterangan: "Perangkat " + devCheck.platform + " resmi diikat pertama kali untuk NIP " + cleanNip
    });
  } else {
    sheetPegawai.getRange(targetRowIdx, 10, 1, 4).setValues([[
      devCheck.platform,
      devCheck.deviceInfo,
      devCheck.fingerprint,
      nowStr
    ]]);
    if (konteksAksi === "ABSEN_MASUK" || konteksAksi === "ABSEN_PULANG") {
      catatLogPerangkat(ss, {
        nip: cleanNip,
        nama: namaPegawai,
        deviceId: devCheck.deviceId,
        platform: devCheck.platform,
        deviceInfo: devCheck.deviceInfo,
        fingerprint: devCheck.fingerprint,
        aksi: konteksAksi,
        statusKeamanan: "AMAN",
        keterangan: "Verifikasi perangkat " + devCheck.platform + " valid saat " + konteksAksi
      });
    }
  }

  return {
    success: true,
    newlyBound: newlyBound,
    deviceId: devCheck.deviceId,
    platform: devCheck.platform,
    deviceInfo: devCheck.deviceInfo,
    fingerprint: devCheck.fingerprint
  };
}

/**
 * Normalisasi status kehadiran dan penentuan radius geofencing dinamis per tipe kehadiran
 */
function normalizeStatusKehadiran(rawStatus) {
  var s = String(rawStatus || "").trim();
  if (s === "Dinas Luar" || s === "DL" || s === "Dinas Luar/Monitoring Tahapan") return "Dinas Luar";
  if (s === "WFH" || s === "Work From Home") return "WFH";
  if (s === "Cuti" || s === "Cuti Tahunan" || s === "Cuti Bersalin" || s === "Cuti Alasan Penting") return "Cuti";
  if (s === "Sakit") return "Sakit";
  if (s === "Izin Kepentingan Pribadi" || s === "Izin Pribadi") return "Izin Kepentingan Pribadi";
  return "Hadir";
}

function getKategoriFromJenisIzin(jenisIzin) {
  var j = String(jenisIzin || "").trim();
  if (j === "Dinas Luar") return "Dinas Luar";
  if (j === "Sakit") return "Sakit";
  if (j === "Cuti Tahunan" || j === "Cuti Bersalin" || j === "Cuti Alasan Penting" || j === "Cuti") return "Cuti";
  return j;
}

function normalizeStatusApproval(rawVal) {
  var s = String(rawVal || "").trim();
  var lower = s.toLowerCase();
  if (lower.indexOf("disetujui") !== -1) return "Disetujui";
  if (lower.indexOf("ditolak") !== -1) return "Ditolak";
  return "Menunggu Validasi";
}

function getRadiusConfigMap(ssOpt) {
  var defaults = {
    "Hadir": CONFIG.RADIUS_HADIR || 30,
    "Dinas Luar": CONFIG.RADIUS_DINAS_LUAR || 50000,
    "WFH": CONFIG.RADIUS_WFH || 50000,
    "Cuti": CONFIG.RADIUS_CUTI || 50000,
    "Sakit": CONFIG.RADIUS_SAKIT || 12000
  };
  try {
    var ss = ssOpt || ensureDatabaseReady();
    var sheetPengaturan = ss ? ss.getSheetByName(CONFIG.SHEET_PENGATURAN) : null;
    if (sheetPengaturan && sheetPengaturan.getLastRow() > 1) {
      var rows = sheetPengaturan.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var key = String(rows[i][0] || "").trim().toUpperCase();
        var num = parseInt(rows[i][1], 10);
        if (isNaN(num) || num <= 0) continue;
        if (key === "RADIUS_HADIR") defaults["Hadir"] = num;
        else if (key === "RADIUS_DINAS_LUAR") defaults["Dinas Luar"] = num;
        else if (key === "RADIUS_WFH") defaults["WFH"] = num;
        else if (key === "RADIUS_CUTI") defaults["Cuti"] = num;
        else if (key === "RADIUS_SAKIT") defaults["Sakit"] = num;
      }
    }
  } catch (e) {}
  return defaults;
}

function getMaxRadiusByStatus(statusKehadiran, ssOpt) {
  var norm = normalizeStatusKehadiran(statusKehadiran);
  var map = getRadiusConfigMap(ssOpt);
  if (map[norm]) return map[norm];
  return map["Hadir"] || CONFIG.RADIUS_HADIR || 30;
}

/**
 * -----------------------------------------------------------------------------
 * MODUL KEAMANAN JARINGAN WI-FI SATKER KIP AGARA & ANTI-FAKE GPS MULTI-LAPIS
 * -----------------------------------------------------------------------------
 */
function getWifiConfig(ssOpt) {
  var cfg = {
    wifiMode: CONFIG.WIFI_KANTOR_MODE !== 0,
    wifiNama: CONFIG.WIFI_KANTOR_NAMA || "Wi-Fi Kantor KIP Aceh Tenggara",
    allowedIps: String(CONFIG.WIFI_KANTOR_IPS || "").trim(),
    fakeGpsCheckMode: CONFIG.FAKE_GPS_CHECK_MODE !== 0
  };
  try {
    var ss = ssOpt || ensureDatabaseReady();
    var sheetPengaturan = ss ? ss.getSheetByName(CONFIG.SHEET_PENGATURAN) : null;
    if (sheetPengaturan && sheetPengaturan.getLastRow() > 1) {
      var rows = sheetPengaturan.getDataRange().getDisplayValues();
      for (var i = 1; i < rows.length; i++) {
        var key = String(rows[i][0] || "").trim().toUpperCase();
        var val = String(rows[i][1] !== undefined ? rows[i][1] : "").trim();
        if (key === "WIFI_KANTOR_MODE") cfg.wifiMode = (val !== "0" && val.toLowerCase() !== "false");
        else if (key === "WIFI_KANTOR_NAMA" && val) cfg.wifiNama = val;
        else if (key === "WIFI_KANTOR_IPS") cfg.allowedIps = val;
        else if (key === "FAKE_GPS_CHECK_MODE") cfg.fakeGpsCheckMode = (val !== "0" && val.toLowerCase() !== "false");
      }
    }
  } catch (e) {}
  return cfg;
}

function ipv4ToInt(ipStr) {
  var parts = String(ipStr || "").trim().split(".");
  if (parts.length !== 4) return null;
  var out = 0;
  for (var i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    var octet = parseInt(parts[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    out = ((out << 8) | octet) >>> 0;
  }
  return out;
}

function isIpMatchWhitelist(clientIp, whitelistStr) {
  var cleanIp = String(clientIp || "").trim().toLowerCase();
  var rawList = String(whitelistStr || "").trim();
  if (!rawList) return true; // Tidak ada IP terikat -> gunakan cek tipe jaringan & GPS
  if (!cleanIp) return false;

  var tokens = rawList.split(/[,\n;]+/);
  for (var i = 0; i < tokens.length; i++) {
    var pat = String(tokens[i] || "").trim().toLowerCase();
    if (!pat) continue;
    if (pat === "*" || pat === "0.0.0.0/0") return true;
    if (pat === cleanIp) return true;

    // Wildcard trailing * (contoh: 103.10.20.* atau 103.10.*)
    if (pat.indexOf("*") !== -1) {
      var prefix = pat.split("*")[0];
      if (prefix && cleanIp.indexOf(prefix) === 0) return true;
    }

    // Prefix dot (contoh: 103.10.20.)
    if (pat.slice(-1) === "." && cleanIp.indexOf(pat) === 0) {
      return true;
    }

    // CIDR IPv4 (contoh: 103.10.20.0/24)
    if (pat.indexOf("/") !== -1) {
      var cidrParts = pat.split("/");
      var netInt = ipv4ToInt(cidrParts[0]);
      var ipInt = ipv4ToInt(cleanIp);
      var maskBits = parseInt(cidrParts[1], 10);
      if (netInt !== null && ipInt !== null && !isNaN(maskBits) && maskBits >= 8 && maskBits <= 32) {
        var mask = maskBits === 32 ? 0xffffffff : ((0xffffffff << (32 - maskBits)) >>> 0);
        if ((netInt & mask) === (ipInt & mask)) return true;
      }
    }
  }
  return false;
}

function verifikasiJaringanDanAntiFakeGps(ss, cleanNip, namaPegawai, tipeKehadiran, networkPayload, gpsSecPayload, konteksAksi) {
  var wifiCfg = getWifiConfig(ss);
  var netIn = (networkPayload && typeof networkPayload === "object") ? networkPayload : {};
  var gpsIn = (gpsSecPayload && typeof gpsSecPayload === "object") ? gpsSecPayload : {};

  var rawIp = String(netIn.publicIp || netIn.ip || "").replace(/[^0-9a-fA-F.:]/g, "").trim().substring(0, 64);
  var connType = String(netIn.connectionType || netIn.type || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "").trim();
  var effType = String(netIn.effectiveType || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").trim();

  var isSimulatedFallback = Boolean(gpsIn.isSimulatedFallback);
  var gpsAccuracy = (typeof gpsIn.accuracy === "number" && !isNaN(gpsIn.accuracy)) ? Number(gpsIn.accuracy) : null;
  var teleportSpeed = (typeof gpsIn.teleportSpeedMps === "number" && !isNaN(gpsIn.teleportSpeedMps)) ? Number(gpsIn.teleportSpeedMps) : 0;
  var clientScore = (typeof gpsIn.suspicionScore === "number" && !isNaN(gpsIn.suspicionScore)) ? Number(gpsIn.suspicionScore) : 0;
  var zeroJitterMock = Boolean(gpsIn.zeroJitterMock);
  var impossibleAccuracy = Boolean(gpsIn.impossibleAccuracy) || (!isSimulatedFallback && gpsAccuracy !== null && gpsAccuracy >= 0 && gpsAccuracy < 1.0);
  var timestampAnomaly = Boolean(gpsIn.timestampAnomaly);
  var rawFlags = Array.isArray(gpsIn.flags) ? gpsIn.flags.map(function(f) { return sanitizeTextForSheet(f, 80); }).slice(0, 8) : [];

  var serverScore = Math.max(0, Math.min(100, Math.round(clientScore)));
  if (impossibleAccuracy) serverScore = Math.max(serverScore, 75);
  if (teleportSpeed > 80) serverScore = Math.max(serverScore, 80);
  if (zeroJitterMock) serverScore = Math.max(serverScore, 65);
  if (timestampAnomaly) serverScore = Math.max(serverScore, 60);
  if (gpsIn.isSuspectedFakeGps === true) serverScore = Math.max(serverScore, 75);

  var isFakeGpsBlocked = !isSimulatedFallback && wifiCfg.fakeGpsCheckMode && serverScore >= 60;
  if (isFakeGpsBlocked) {
    var alasanList = rawFlags.length > 0 ? rawFlags.slice() : [];
    if (impossibleAccuracy && alasanList.indexOf("Akurasi GPS tidak wajar (< 1m)") === -1) alasanList.push("Akurasi GPS tidak wajar (< 1m)");
    if (teleportSpeed > 80 && alasanList.indexOf("Perpindahan lokasi teleportasi") === -1) alasanList.push("Perpindahan lokasi teleportasi (" + Math.round(teleportSpeed) + " m/dtk)");
    if (zeroJitterMock && alasanList.indexOf("Koordinat statis identik (Mock Location)") === -1) alasanList.push("Koordinat statis identik (Mock Location)");
    var detailAlasan = alasanList.length > 0 ? alasanList.join("; ") : ("Skor anomali GPS " + serverScore + "/100");

    catatLogPerangkat(ss, {
      nip: cleanNip,
      nama: namaPegawai,
      deviceId: rawIp || "-",
      platform: connType || "-",
      deviceInfo: "Fake GPS Detector",
      fingerprint: "SCORE_" + serverScore,
      aksi: "DITOLAK_FAKE_GPS",
      statusKeamanan: "DIBLOKIR",
      keterangan: "Deteksi Fake GPS saat " + konteksAksi + " (" + tipeKehadiran + "): " + detailAlasan
    });

    return {
      success: false,
      blockedByFakeGps: true,
      message: "AKSES PRESENSI DITOLAK (DETEKSI FAKE GPS): Sistem mendeteksi indikasi manipulasi lokasi / aplikasi Fake GPS (" + detailAlasan + "). Nonaktifkan Fake GPS, aktifkan GPS akurasi tinggi asli perangkat, lalu muat ulang halaman."
    };
  }

  // Lapisan Validasi Jaringan Wi-Fi Satker (ketat untuk Hadir di Kantor)
  var statusJaringanText = "Di Luar Kantor (" + tipeKehadiran + ")";
  if (tipeKehadiran === "Hadir" && wifiCfg.wifiMode) {
    if (connType === "cellular") {
      catatLogPerangkat(ss, {
        nip: cleanNip,
        nama: namaPegawai,
        deviceId: rawIp || "-",
        platform: "cellular",
        deviceInfo: effType || "Data Seluler",
        fingerprint: "-",
        aksi: "DITOLAK_NON_WIFI_KANTOR",
        statusKeamanan: "DIBLOKIR",
        keterangan: "Mencoba Hadir di Kantor memakai Data Seluler saat " + konteksAksi
      });
      return {
        success: false,
        blockedByNetwork: true,
        message: "AKSES PRESENSI DITOLAK (WAJIB WI-FI SATKER): Anda terdeteksi menggunakan jaringan Data Seluler" + (effType ? " (" + effType.toUpperCase() + ")" : "") + ". Untuk presensi Hadir di Kantor, Anda WAJIB tersambung ke jaringan " + wifiCfg.wifiNama + "!"
      };
    }

    if (wifiCfg.allowedIps) {
      if (!rawIp) {
        catatLogPerangkat(ss, {
          nip: cleanNip,
          nama: namaPegawai,
          deviceId: "-",
          platform: connType || "unknown",
          deviceInfo: "IP Publik Tidak Terdeteksi",
          fingerprint: "-",
          aksi: "DITOLAK_NON_WIFI_KANTOR",
          statusKeamanan: "DIBLOKIR",
          keterangan: "IP Publik Wi-Fi tidak terdeteksi saat " + konteksAksi + " (Whitelist: " + wifiCfg.allowedIps + ")"
        });
        return {
          success: false,
          blockedByNetwork: true,
          message: "AKSES PRESENSI DITOLAK (VERIFIKASI WI-FI SATKER GAGAL): Alamat IP jaringan Anda tidak dapat diverifikasi. Pastikan perangkat tersambung ke " + wifiCfg.wifiNama + " dengan koneksi internet aktif lalu klik 'Cek Ulang Wi-Fi'."
        };
      }
      if (!isIpMatchWhitelist(rawIp, wifiCfg.allowedIps)) {
        catatLogPerangkat(ss, {
          nip: cleanNip,
          nama: namaPegawai,
          deviceId: rawIp,
          platform: connType || "unknown",
          deviceInfo: "IP Luar Satker",
          fingerprint: "-",
          aksi: "DITOLAK_NON_WIFI_KANTOR",
          statusKeamanan: "DIBLOKIR",
          keterangan: "IP " + rawIp + " tidak cocok dengan whitelist " + wifiCfg.allowedIps + " saat " + konteksAksi
        });
        return {
          success: false,
          blockedByNetwork: true,
          message: "AKSES PRESENSI DITOLAK (BUKAN WI-FI SATKER KIP AGARA): Jaringan Anda saat ini (IP: " + rawIp + ") bukan merupakan jaringan resmi '" + wifiCfg.wifiNama + "'. Harap hubungkan HP Anda ke Wi-Fi Kantor KIP Aceh Tenggara terlebih dahulu!"
        };
      }
      statusJaringanText = "Terverifikasi " + wifiCfg.wifiNama + " (" + rawIp + ")";
    } else {
      statusJaringanText = "Sesuai (" + (connType === "wifi" ? "Wi-Fi" : "Non-Seluler") + (rawIp ? " " + rawIp : "") + ")";
    }
  } else if (tipeKehadiran === "Hadir") {
    statusJaringanText = "Validasi Wi-Fi Longgar" + (rawIp ? " (" + rawIp + ")" : "");
  } else if (rawIp) {
    statusJaringanText = "Non-Kantor (" + tipeKehadiran + " | " + rawIp + ")";
  }

  var skorAman = Math.max(0, 100 - serverScore);
  var skorLabel = skorAman + "/100" + (gpsAccuracy !== null ? (" (±" + Math.round(gpsAccuracy) + "m)") : "");
  var statusKeamananLokasi = (tipeKehadiran === "Hadir")
    ? ("AMAN (Wi-Fi Satker & GPS Valid)")
    : ("AMAN (GPS Valid - " + tipeKehadiran + ")");

  return {
    success: true,
    publicIp: rawIp || (connType ? connType.toUpperCase() : "Tidak Terdeteksi"),
    statusJaringan: statusJaringanText,
    skorGps: skorLabel,
    statusKeamananLokasi: statusKeamananLokasi,
    wifiConfig: wifiCfg
  };
}

function getIzinHariIniMap(ss, cleanNip, todayStr) {
  var result = {};
  if (!ss) return result;
  var sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);
  if (!sheetIzin || sheetIzin.getLastRow() <= 1) return result;

  var vals = sheetIzin.getDataRange().getValues();
  var disp = sheetIzin.getDataRange().getDisplayValues();
  for (var i = 1; i < vals.length; i++) {
    var rowNip = normalizeNipValue(disp[i][1] || vals[i][1]);
    if (rowNip !== cleanNip) continue;

    var tglMulai = normalizeDateStr(vals[i][4]);
    var tglSelesai = normalizeDateStr(vals[i][5]);
    if (!tglMulai || !tglSelesai) continue;
    if (todayStr < tglMulai || todayStr > tglSelesai) continue;

    var jenis = String(disp[i][3] || vals[i][3] || "").trim();
    var kategori = getKategoriFromJenisIzin(jenis);
    var ket = String(disp[i][6] || vals[i][6] || "").trim();
    var bukti = String(disp[i][7] || vals[i][7] || "").trim();
    var rawStatus = String(disp[i][8] || vals[i][8] || "").trim();
    var statusApproval = normalizeStatusApproval(rawStatus);
    var urlDok = String(disp[i][10] || vals[i][10] || "").trim();
    var diverifikasiOleh = String(disp[i][11] || vals[i][11] || "").trim();
    var catatanVerifikasi = String(disp[i][12] || vals[i][12] || "").trim();
    var waktuVerifikasi = String(disp[i][13] || vals[i][13] || "").trim();

    if (ket && bukti && bukti !== "Tidak Ada Lampiran") {
      result[kategori] = {
        idIzin: String(vals[i][0] || ""),
        jenisIzin: jenis,
        kategori: kategori,
        tglMulai: tglMulai,
        tglSelesai: tglSelesai,
        keterangan: ket,
        buktiDokumen: bukti,
        urlDokumen: urlDok,
        statusValidasi: rawStatus,
        statusApproval: statusApproval,
        diverifikasiOleh: diverifikasiOleh,
        catatanVerifikasi: catatanVerifikasi,
        waktuVerifikasi: waktuVerifikasi,
        waktuPengajuan: String(disp[i][9] || vals[i][9] || "")
      };
    }
  }
  return result;
}

function getRiwayatApprovalPegawai(ss, cleanNip) {
  var list = [];
  if (!ss) return list;

  var sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);
  if (sheetIzin && sheetIzin.getLastRow() > 1) {
    var iv = sheetIzin.getDataRange().getValues();
    var idisp = sheetIzin.getDataRange().getDisplayValues();
    for (var i = iv.length - 1; i >= 1; i--) {
      var rNip = normalizeNipValue(idisp[i][1] || iv[i][1]);
      if (rNip !== cleanNip) continue;
      var jenis = String(idisp[i][3] || iv[i][3] || "").trim();
      var kategori = getKategoriFromJenisIzin(jenis);
      if (kategori !== "Sakit" && kategori !== "Cuti" && kategori !== "Dinas Luar") continue;

      var statusApproval = normalizeStatusApproval(idisp[i][8] || iv[i][8]);
      list.push({
        sumber: "IZIN",
        idRef: String(iv[i][0] || ""),
        jenis: jenis,
        kategori: kategori,
        tanggal: normalizeDateStr(iv[i][4]) + " s.d. " + normalizeDateStr(iv[i][5]),
        tglMulai: normalizeDateStr(iv[i][4]),
        tglSelesai: normalizeDateStr(iv[i][5]),
        keterangan: String(idisp[i][6] || iv[i][6] || ""),
        dokumenUrl: String(idisp[i][10] || iv[i][10] || ""),
        statusApproval: statusApproval,
        catatanApproval: String(idisp[i][12] || iv[i][12] || ""),
        diverifikasiOleh: String(idisp[i][11] || iv[i][11] || ""),
        waktuVerifikasi: String(idisp[i][13] || iv[i][13] || ""),
        dampakTukin: statusApproval === "Ditolak" ? "1.50% (Izin Kepentingan Pribadi)" : "0.00%"
      });
    }
  }

  var sheetAbs = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
  if (sheetAbs && sheetAbs.getLastRow() > 1) {
    var av = sheetAbs.getDataRange().getValues();
    var ad = sheetAbs.getDataRange().getDisplayValues();
    for (var j = av.length - 1; j >= 1; j--) {
      var aNip = normalizeNipValue(ad[j][1] || av[j][1]);
      if (aNip !== cleanNip) continue;
      var statusK = String(ad[j][5] || av[j][5] || "").trim();
      var catApproval = String(ad[j][21] || av[j][21] || "").trim();
      var isWfhEntry = (statusK === "WFH" || catApproval.indexOf("WFH") !== -1);
      if (!isWfhEntry) continue;

      var stApp = normalizeStatusApproval(ad[j][20] || av[j][20] || "Menunggu Validasi");
      list.push({
        sumber: "WFH",
        idRef: String(av[j][0] || ""),
        jenis: "Work From Home (WFH)",
        kategori: "WFH",
        tanggal: normalizeDateStr(av[j][3]),
        tglMulai: normalizeDateStr(av[j][3]),
        tglSelesai: normalizeDateStr(av[j][3]),
        keterangan: String(ad[j][19] || av[j][19] || "Presensi & LKH WFH"),
        dokumenUrl: String(ad[j][18] || av[j][18] || ""),
        statusApproval: stApp,
        catatanApproval: catApproval,
        diverifikasiOleh: String(ad[j][22] || av[j][22] || ""),
        waktuVerifikasi: "",
        dampakTukin: stApp === "Ditolak" ? "1.50% (Izin Kepentingan Pribadi)" : "0.00%"
      });
    }
  }
  return list.slice(0, 15);
}

/**
 * -----------------------------------------------------------------------------
 * 2. VALIDASI NIP & CEK STATUS KEHADIRAN HARI INI
 * -----------------------------------------------------------------------------
 */
function getValidasiNIP(nipInput) {
  try {
    const nipCheck = validateNip(nipInput);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;

    const ss = ensureDatabaseReady();
    let sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
    if (!sheetPegawai) {
      return { success: false, message: "Sheet Pegawai belum dibuat. Silakan jalankan setupDatabase() terlebih dahulu." };
    }

    const dataPegawai = sheetPegawai.getDataRange().getDisplayValues();
    let pegawaiDitemukan = null;

    for (let i = 1; i < dataPegawai.length; i++) {
      const rowNip = normalizeNipValue(dataPegawai[i][0]);
      if (rowNip === cleanNip) {
        pegawaiDitemukan = {
          nip: rowNip,
          nama: String(dataPegawai[i][1] || ""),
          jabatan: String(dataPegawai[i][2] || ""),
          unitKerja: String(dataPegawai[i][3] || ""),
          status: String(dataPegawai[i][4] || "Aktif"),
          pangkatGolongan: dataPegawai[i][5] ? String(dataPegawai[i][5]) : "Penata Muda (III/a)",
          fotoProfil: dataPegawai[i][7] ? String(dataPegawai[i][7]).trim() : "",
          deviceId: dataPegawai[i][8] ? String(dataPegawai[i][8]).trim() : "",
          devicePlatform: dataPegawai[i][9] ? String(dataPegawai[i][9]).trim() : "",
          deviceInfo: dataPegawai[i][10] ? String(dataPegawai[i][10]).trim() : ""
        };
        break;
      }
    }

    if (!pegawaiDitemukan) {
      return {
        success: false,
        message: "NIP tidak ditemukan dalam database ASN KIP Aceh Tenggara. Pastikan NIP telah terdaftar."
      };
    }

    if (pegawaiDitemukan.status !== "Aktif") {
      return {
        success: false,
        message: "Status kepegawaian Anda saat ini tidak aktif (" + pegawaiDitemukan.status + "). Hubungi Subbagian Hukum & SDM."
      };
    }

    // Periksa status absensi hari ini (Waktu Server WIB)
    const todayStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
    const serverTimeStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");

    const sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    let statusAbsen = "BELUM_ABSEN"; // Options: 'BELUM_ABSEN', 'SUDAH_MASUK', 'SUDAH_LENGKAP'
    let dataAbsenHariIni = null;
    let lkhUploaded = false;
    let lkhInfo = "";

    const kompensasiMenitCfg = getKompensasiTelatMenit(ss);
    const jamBatasPulang = getJamBatasPulangWib(ss);
    const batasPulangInfo = hitungInfoBatasPulang(serverTimeStr, jamBatasPulang);

    if (sheetAbsensi && sheetAbsensi.getLastRow() > 1) {
      const dataAbsen = sheetAbsensi.getDataRange().getValues();
      const displayAbsen = sheetAbsensi.getDataRange().getDisplayValues();
      for (let j = 1; j < dataAbsen.length; j++) {
        const rowNip = normalizeNipValue(displayAbsen[j][1] || dataAbsen[j][1]);
        const rowTanggal = normalizeDateStr(dataAbsen[j][3]);

        if (rowNip === cleanNip && rowTanggal === todayStr) {
          const synced = sinkronkanBarisAbsensiHadir(sheetAbsensi, j + 1, dataAbsen[j], displayAbsen[j], kompensasiMenitCfg, jamBatasPulang);
          const jamMasuk = synced.jamMasuk;
          const jamPulang = synced.jamPulang;
          const rawLkh = String(displayAbsen[j][17] || dataAbsen[j][17] || "").trim();
          const urlLkh = String(displayAbsen[j][18] || dataAbsen[j][18] || "").trim();
          lkhUploaded = Boolean(rawLkh || urlLkh);
          lkhInfo = rawLkh || (urlLkh ? "LKH Terunggah" : "");

          const statusKehadiranRow = String(displayAbsen[j][5] || dataAbsen[j][5] || "");
          const infoKompRow = synced.infoKompensasi || hitungInfoKompensasiTelat(jamMasuk, statusKehadiranRow, synced.opsiKompensasi, jamPulang, kompensasiMenitCfg, jamBatasPulang);
          const jamBatasPulangRow = formatJamWIB(displayAbsen[j][30] || dataAbsen[j][30]) || jamBatasPulang;
          const statusBatasPulangRow = String(displayAbsen[j][31] || dataAbsen[j][31] || "").trim();

          dataAbsenHariIni = {
            idAbsen: String(dataAbsen[j][0] || ""),
            tanggal: String(rowTanggal || ""),
            jamMasuk: String(jamMasuk || ""),
            jamPulang: String(jamPulang || ""),
            statusKehadiran: statusKehadiranRow,
            jumlahJamKerja: synced.jumlahJamKerja || "-",
            kekuranganJamKerja: synced.kekuranganJamKerja || "-",
            potonganTukin: synced.potonganStr || "0.00%",
            kodePotonganTukin: synced.kodeTukin || "-",
            dokumenPendukung: String(displayAbsen[j][16] || dataAbsen[j][16] || ""),
            lkhUploaded: lkhUploaded,
            lkhInfo: lkhInfo,
            urlLkh: urlLkh,
            statusApproval: String(displayAbsen[j][20] || dataAbsen[j][20] || ""),
            catatanApproval: String(displayAbsen[j][21] || dataAbsen[j][21] || ""),
            diverifikasiOleh: String(displayAbsen[j][22] || dataAbsen[j][22] || ""),
            menitTerlambat: synced.teksTerlambat || infoKompRow.teksTerlambat || "0 Menit",
            opsiKompensasi: synced.opsiKompensasi || infoKompRow.opsiKompensasi,
            jamPulangKompensasi: synced.jamPulangKompensasi || infoKompRow.jamPulangWajib,
            statusKompensasi: synced.statusKompensasi || infoKompRow.statusKompensasi,
            kompensasiInfo: infoKompRow,
            batasWaktuPulang: jamBatasPulangRow,
            statusBatasPulang: statusBatasPulangRow
          };

          if (jamMasuk && !jamPulang) {
            statusAbsen = "SUDAH_MASUK";
          } else if (jamMasuk && jamPulang) {
            statusAbsen = "SUDAH_LENGKAP";
          }
          break;
        }
      }
    }

    const radiusConfig = getRadiusConfigMap(ss);
    const wifiConfig = getWifiConfig(ss);
    const kompensasiTelatMenit = kompensasiMenitCfg;
    const izinHariIni = getIzinHariIniMap(ss, cleanNip, todayStr);
    const riwayatApproval = getRiwayatApprovalPegawai(ss, cleanNip);
    const activeRadiusMeter = dataAbsenHariIni
      ? getMaxRadiusByStatus(dataAbsenHariIni.statusKehadiran, ss)
      : (radiusConfig["Hadir"] || CONFIG.RADIUS_METER);

    return {
      success: true,
      pegawai: pegawaiDitemukan,
      statusAbsen: statusAbsen,
      isSudahMasuk: statusAbsen === "SUDAH_MASUK" || statusAbsen === "SUDAH_LENGKAP",
      isSudahPulang: statusAbsen === "SUDAH_LENGKAP",
      isSelesaiHariIni: statusAbsen === "SUDAH_LENGKAP",
      dataAbsen: dataAbsenHariIni,
      izinHariIni: izinHariIni,
      riwayatApproval: riwayatApproval,
      lkhUploaded: lkhUploaded,
      lkhInfo: lkhInfo,
      activeRadiusMeter: activeRadiusMeter,
      radiusConfig: radiusConfig,
      wifiConfig: wifiConfig,
      kompensasiTelatMenit: kompensasiTelatMenit,
      jamBatasPulang: jamBatasPulang,
      batasPulangInfo: batasPulangInfo,
      antiTitipMode: getAntiTitipMode(ss),
      tanggalHariIni: todayStr,
      serverTime: serverTimeStr,
      officeConfig: {
        latitude: CONFIG.OFFICE_LAT,
        longitude: CONFIG.OFFICE_LON,
        radiusMeter: radiusConfig["Hadir"] || CONFIG.RADIUS_METER,
        jamMasukStandar: CONFIG.JAM_MASUK_STANDAR,
        jamPulangStandar: CONFIG.JAM_PULANG_STANDAR,
        jamBatasPulang: jamBatasPulang,
        kompensasiTelatMenit: kompensasiTelatMenit,
        wifiConfig: wifiConfig,
        instansi: CONFIG.INSTANSI,
        kota: CONFIG.KOTA
      }
    };
  } catch (error) {
    return { success: false, message: "Terjadi kesalahan server: " + error.toString() };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 3. LOGIKA PERHITUNGAN TUKIN / TPP KEPUTUSAN KPU NOMOR 1090 TAHUN 2025
 * Menghitung menit keterlambatan (TL) & pulang cepat (PSW) serta total potongan.
 * -----------------------------------------------------------------------------
 */
function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const clean = String(timeStr).replace(/\./g, ":").trim();
  const parts = clean.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
  if (isNaN(h) || isNaN(m)) return null;
  return h * 3600 + m * 60 + (isNaN(s) ? 0 : s);
}

function formatDetikKeTeksWaktu(totalDetik) {
  if (!totalDetik || totalDetik <= 0) return "0 Jam 0 Menit 0 Detik";
  const h = Math.floor(totalDetik / 3600);
  const rem = totalDetik % 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  return h + " Jam " + m + " Menit " + s + " Detik";
}

function formatSecondsToTimeStr(totalSeconds) {
  var clamped = Math.max(0, Math.min(86399, Math.round(Number(totalSeconds) || 0)));
  var h = Math.floor(clamped / 3600);
  var rem = clamped % 3600;
  var m = Math.floor(rem / 60);
  var s = rem % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function getKompensasiTelatMenit(ssOpt) {
  var defVal = Number(CONFIG.KOMPENSASI_TELAT_MENIT);
  if (isNaN(defVal) || defVal < 0) defVal = 15;
  try {
    var ss = ssOpt || ensureDatabaseReady();
    var sheetPengaturan = ss ? ss.getSheetByName(CONFIG.SHEET_PENGATURAN) : null;
    if (sheetPengaturan && sheetPengaturan.getLastRow() > 1) {
      var rows = sheetPengaturan.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || "").trim().toUpperCase() === "KOMPENSASI_TELAT_MENIT") {
          var num = parseInt(rows[i][1], 10);
          if (!isNaN(num) && num >= 0 && num <= 60) return num;
        }
      }
    }
  } catch (e) {}
  return defVal;
}

function getJamBatasPulangWib(ssOpt) {
  var defStr = String(CONFIG.JAM_BATAS_PULANG || "18:00:00").trim();
  try {
    var ss = ssOpt || ensureDatabaseReady();
    var sheetPengaturan = ss ? ss.getSheetByName(CONFIG.SHEET_PENGATURAN) : null;
    if (sheetPengaturan && sheetPengaturan.getLastRow() > 1) {
      var rows = sheetPengaturan.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || "").trim().toUpperCase() === "JAM_BATAS_PULANG") {
          var formatted = formatJamWIB(rows[i][1]);
          if (formatted && /^\d{2}:\d{2}:\d{2}$/.test(formatted)) {
            return formatted;
          }
        }
      }
    }
  } catch (e) {}
  return defStr;
}

function hitungInfoBatasPulang(serverTimeStr, jamBatasOpt) {
  var jamBatasPulang = String(jamBatasOpt || CONFIG.JAM_BATAS_PULANG || "18:00:00").trim();
  var secBatas = parseTimeToSeconds(jamBatasPulang);
  var secNow = parseTimeToSeconds(serverTimeStr);
  var isLewatBatas = (secNow !== null && secBatas !== null && secNow > secBatas);
  var sisaDetik = (secNow !== null && secBatas !== null && !isLewatBatas) ? Math.max(0, secBatas - secNow) : 0;
  var jamBatasShort = jamBatasPulang.substring(0, 5);
  var statusBatasPulang = isLewatBatas
    ? ("Ditutup (Lewat " + jamBatasShort + " WIB)")
    : ("Aktif (s.d. " + jamBatasShort + " WIB)");
  return {
    jamBatasPulang: jamBatasPulang,
    jamBatasShort: jamBatasShort,
    serverTime: serverTimeStr || "",
    isLewatBatas: isLewatBatas,
    sisaDetik: sisaDetik,
    teksSisaWaktu: isLewatBatas ? "0 Jam 0 Menit 0 Detik" : formatDetikKeTeksWaktu(sisaDetik),
    statusBatasPulang: statusBatasPulang
  };
}

function normalizeOpsiKompensasi(rawOpsi) {
  var s = String(rawOpsi || "").trim().toLowerCase();
  if (!s) return "";
  if (s.indexOf("melebihi") !== -1 || s.indexOf("tl 4") !== -1 || s.indexOf("batas 18") !== -1) return "Terlambat > Batas 18:00 WIB (TL 4)";
  if (s.indexOf("ganti") !== -1 || s.indexOf("kompensasi") !== -1) return "Mengganti Jam Keterlambatan";
  if (s.indexOf("cepat") !== -1 || s.indexOf("pulang") !== -1) return "Cepat Pulang";
  if (s.indexOf("menunggu") !== -1) return "Menunggu Pilihan";
  if (s.indexOf("tepat") !== -1) return "Tepat Waktu";
  return String(rawOpsi).trim();
}

function parsePotonganPersenNum(dispVal, rawVal) {
  var s = String(dispVal || rawVal || "").trim();
  if (s.indexOf("%") !== -1) {
    var m = s.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);
    if (m && m[1]) {
      var n = parseFloat(m[1].replace(",", "."));
      return isNaN(n) ? 0 : n;
    }
  }
  if (typeof rawVal === "number" && !isNaN(rawVal)) {
    // Google Sheets mengonversi teks "0.50%" menjadi numerik 0.005 jika format sel belum "@"
    if (rawVal > 0 && rawVal < 0.1) return Number((rawVal * 100).toFixed(2));
    return Number(rawVal.toFixed(2));
  }
  var parsed = parseFloat(s.replace("%", "").replace(",", ".").trim());
  return isNaN(parsed) ? 0 : parsed;
}

function formatTampilanPotonganTukin(potonganTL, kodeTL, potonganPSW, kodePSW) {
  var totNum = Number((Number(potonganTL || 0) + Number(potonganPSW || 0)).toFixed(2));
  var totalStr = totNum.toFixed(2) + "%";
  var codes = [];
  if (Number(potonganTL || 0) > 0 && kodeTL && kodeTL !== "-") codes.push(kodeTL);
  if (Number(potonganPSW || 0) > 0 && kodePSW && kodePSW !== "-") codes.push(kodePSW);
  if (codes.length === 0) {
    return {
      totalPersenStr: "0.00%",
      displayText: "0.00%",
      kodeText: (kodeTL && kodeTL.indexOf("KOMPENSASI") === 0) ? kodeTL : "TEPAT_WAKTU"
    };
  }
  return {
    totalPersenStr: totalStr,
    displayText: totalStr + " (" + codes.join(" + ") + ")",
    kodeText: codes.join(" + ")
  };
}

function hitungInfoKompensasiTelat(jamMasukStr, statusKehadiran, opsiKompensasi, jamPulangStr, batasMenitOpt, jamBatasPulangOpt) {
  var normStatus = normalizeStatusKehadiran(statusKehadiran);
  var batasMenit = (typeof batasMenitOpt === "number" && !isNaN(batasMenitOpt) && batasMenitOpt >= 0)
    ? batasMenitOpt
    : (CONFIG.KOMPENSASI_TELAT_MENIT || 15);
  var jamMasukStd = CONFIG.JAM_MASUK_STANDAR || "07:30:00";
  var jamPulangStd = CONFIG.JAM_PULANG_STANDAR || "16:00:00";
  var jamBatasPulang = formatJamWIB(jamBatasPulangOpt || CONFIG.JAM_BATAS_PULANG || "18:00:00") || "18:00:00";
  var jamBatasShort = jamBatasPulang.substring(0, 5);
  var secMasukStd = parseTimeToSeconds(jamMasukStd);
  var secPulangStd = parseTimeToSeconds(jamPulangStd);
  var secBatasPulang = parseTimeToSeconds(jamBatasPulang);
  var secMasuk = parseTimeToSeconds(jamMasukStr);
  var secPulang = parseTimeToSeconds(jamPulangStr);
  var maxDetikPenggantian = (secBatasPulang !== null && secPulangStd !== null && secBatasPulang > secPulangStd)
    ? (secBatasPulang - secPulangStd)
    : 7200;

  if (normStatus !== "Hadir" || secMasuk === null || secMasuk <= secMasukStd) {
    return {
      isTerlambat: false,
      dalamBatasKompensasi: false,
      bisaDiganti: false,
      melebihiBatasPenggantian: false,
      batasKompensasiMenit: batasMenit,
      maxPenggantianMenit: Math.floor(maxDetikPenggantian / 60),
      jamBatasPulang: jamBatasPulang,
      detikTerlambat: 0,
      menitTerlambat: 0,
      teksTerlambat: "0 Menit (Tepat Waktu)",
      jamMasuk: jamMasukStr || "",
      jamMasukStandar: jamMasukStd,
      jamPulangNormal: jamPulangStd,
      jamPulangKompensasi: jamPulangStd,
      jamPulangWajib: jamPulangStd,
      opsiKompensasi: "Tepat Waktu",
      statusKompensasi: "Tepat Waktu"
    };
  }

  var detikTerlambat = secMasuk - secMasukStd;
  var menitTerlambat = Math.floor(detikTerlambat / 60);
  if (detikTerlambat % 60 > 0) menitTerlambat += 1;
  var dalamBatasKompensasi = (menitTerlambat > 0 && menitTerlambat <= batasMenit);

  // Target penggantian jam keterlambatan dihitung presisi dari 16:00:00 + durasi keterlambatan
  var secPulangKompensasi = secPulangStd + detikTerlambat;
  var jamPulangKomp = formatSecondsToTimeStr(secPulangKompensasi);

  // Jika waktu penggantian melewati batas akhir presensi pulang (default 18:00:00 WIB), penggantian TIDAK dapat dilakukan -> wajib TL 4
  var melebihiBatasPenggantian = (secBatasPulang !== null && secPulangKompensasi > secBatasPulang);
  var bisaDiganti = !melebihiBatasPenggantian;

  var opsiNorm = normalizeOpsiKompensasi(opsiKompensasi) || (melebihiBatasPenggantian ? ("Terlambat > Batas " + jamBatasShort + " WIB (TL 4)") : "Menunggu Pilihan");

  // Jika pegawai bekerja memenuhi waktu penggantian (secPulang >= 16:00 + telat) pada rentang <= 18:00 WIB dan tidak memilih "Cepat Pulang",
  // maka secara faktual keterlambatan sudah diganti -> bebas potongan TL (0.00%).
  if (bisaDiganti && secPulang !== null && opsiNorm !== "Cepat Pulang" && secPulang >= secPulangKompensasi) {
    opsiNorm = "Mengganti Jam Keterlambatan";
  }

  var jamPulangWajib = (bisaDiganti && opsiNorm === "Mengganti Jam Keterlambatan") ? jamPulangKomp : jamPulangStd;

  var statusKomp = "Menunggu Pilihan";
  if (melebihiBatasPenggantian) {
    statusKomp = "Melebihi Batas Penggantian " + jamBatasShort + " WIB (TL 4)";
  } else if (opsiNorm === "Mengganti Jam Keterlambatan") {
    if (secPulang !== null) {
      if (secPulang >= secPulangKompensasi) {
        statusKomp = "Terpenuhi (Keterlambatan Diganti 0%)";
      } else {
        statusKomp = "Gagal Penuhi Penggantian (Pulang < " + jamPulangKomp + " WIB)";
      }
    } else {
      statusKomp = "Menunggu Pulang (Target " + jamPulangKomp + " WIB)";
    }
  } else if (opsiNorm === "Cepat Pulang") {
    statusKomp = "Tidak Diganti (Cepat Pulang)";
  }

  return {
    isTerlambat: true,
    dalamBatasKompensasi: dalamBatasKompensasi,
    bisaDiganti: bisaDiganti,
    melebihiBatasPenggantian: melebihiBatasPenggantian,
    batasKompensasiMenit: batasMenit,
    maxPenggantianMenit: Math.floor(maxDetikPenggantian / 60),
    jamBatasPulang: jamBatasPulang,
    detikTerlambat: detikTerlambat,
    menitTerlambat: menitTerlambat,
    teksTerlambat: formatDetikKeTeksWaktu(detikTerlambat),
    jamMasuk: jamMasukStr || "",
    jamMasukStandar: jamMasukStd,
    jamPulangNormal: jamPulangStd,
    jamPulangKompensasi: jamPulangKomp,
    jamPulangWajib: jamPulangWajib,
    opsiKompensasi: opsiNorm,
    statusKompensasi: statusKomp
  };
}

function hitungTukinKPU1090(jamMasukStr, jamPulangStr, statusKehadiran, statusApproval, kompensasiOpt) {
  const secMasuk = parseTimeToSeconds(jamMasukStr);
  const secPulang = parseTimeToSeconds(jamPulangStr);
  const normStatus = normalizeStatusKehadiran(statusKehadiran);
  const normApproval = String(statusApproval || "").toLowerCase();

  // Jika ditolak Pimpinan/Kasubbag atau Izin Kepentingan Pribadi -> 1.50% Sesuai Kep. KPU 1090/2025
  if (normApproval.indexOf("ditolak") !== -1 || normStatus === "Izin Kepentingan Pribadi") {
    const totalKerjaIzin = (secMasuk !== null && secPulang !== null && secPulang >= secMasuk)
      ? formatDetikKeTeksWaktu(secPulang - secMasuk)
      : "0 Jam 0 Menit 0 Detik";

    return {
      menitKeterlambatan: 0,
      menitPulangCepat: 0,
      totalJamKerja: totalKerjaIzin,
      kekuranganJamKerja: "Ditolak -> Izin Kepentingan Pribadi (1.50%)",
      kodeTL: "IZIN",
      kodePSW: "-",
      potonganTL: 1.50,
      potonganPSW: 0,
      totalPotonganPersen: "1.50%",
      potonganDisplayText: "1.50% (IZIN)",
      kodePelanggaran: "IZIN_PRIBADI_1_5",
      opsiKompensasi: "-",
      statusKompensasi: "-",
      jamPulangWajib: "-",
      ringkasan: "Dokumen Ditolak / Izin Kepentingan Pribadi (Potongan Tukin 1.50%)"
    };
  }

  // Jika Dinas Luar, Cuti, Sakit, atau WFH sah -> 0% Potongan
  if (normStatus === "Dinas Luar" || normStatus === "Cuti" || normStatus === "Sakit" || normStatus === "WFH") {
    const totalKerja = (secMasuk !== null && secPulang !== null && secPulang >= secMasuk)
      ? formatDetikKeTeksWaktu(secPulang - secMasuk)
      : "7 Jam 30 Menit 0 Detik";

    return {
      menitKeterlambatan: 0,
      menitPulangCepat: 0,
      totalJamKerja: totalKerja,
      kekuranganJamKerja: "0 Jam 0 Menit 0 Detik (Bebas Potongan)",
      kodeTL: "-",
      kodePSW: "-",
      potonganTL: 0,
      potonganPSW: 0,
      totalPotonganPersen: "0.00%",
      potonganDisplayText: "0.00%",
      kodePelanggaran: normStatus.toUpperCase(),
      opsiKompensasi: "-",
      statusKompensasi: "-",
      jamPulangWajib: "-",
      ringkasan: normStatus + " (Bebas Potongan Tukin Sesuai Ketentuan)"
    };
  }

  // Standar Jam Kerja ASN KIP Agara: Masuk 07:30:00 (27.000 detik), Pulang 16:00:00 (57.600 detik), Batas Akhir 18:00:00 (64.800 detik)
  const standarPulangSec = parseTimeToSeconds(CONFIG.JAM_PULANG_STANDAR || "16:00:00");
  const batasMenitKomp = (kompensasiOpt && typeof kompensasiOpt.batasMenit === "number")
    ? kompensasiOpt.batasMenit
    : (CONFIG.KOMPENSASI_TELAT_MENIT || 15);
  const jamBatasPulang = (kompensasiOpt && kompensasiOpt.jamBatasPulang)
    ? kompensasiOpt.jamBatasPulang
    : (CONFIG.JAM_BATAS_PULANG || "18:00:00");
  const opsiKompRaw = kompensasiOpt && kompensasiOpt.opsi ? kompensasiOpt.opsi : "";
  const infoKomp = hitungInfoKompensasiTelat(jamMasukStr, normStatus, opsiKompRaw, jamPulangStr, batasMenitKomp, jamBatasPulang);
  const pilihGantiJam = infoKomp.isTerlambat && infoKomp.bisaDiganti && infoKomp.opsiKompensasi === "Mengganti Jam Keterlambatan";
  const targetPulangKompSec = parseTimeToSeconds(infoKomp.jamPulangKompensasi) || standarPulangSec;

  // 1. Evaluasi Keterlambatan Masuk (TL) & Aturan Penggantian Keterlambatan (s.d. Batas 18:00 WIB)
  let menitKeterlambatan = infoKomp.menitTerlambat;
  let kodeTL = "-";
  let potonganTL = 0.0;

  if (infoKomp.melebihiBatasPenggantian) {
    // Waktu terlambat lebih besar daripada batas waktu penggantian hingga 18:00 WIB -> WAJIB TL 4 (1.50%)
    kodeTL = "TL 4";
    potonganTL = 1.50;
  } else if (menitKeterlambatan >= 1 && menitKeterlambatan <= 30) {
    kodeTL = "TL 1";
    potonganTL = 0.50;
  } else if (menitKeterlambatan >= 31 && menitKeterlambatan <= 60) {
    kodeTL = "TL 2";
    potonganTL = 1.00;
  } else if (menitKeterlambatan >= 61 && menitKeterlambatan <= 90) {
    kodeTL = "TL 3";
    potonganTL = 1.25;
  } else if (menitKeterlambatan > 90) {
    kodeTL = "TL 4";
    potonganTL = 1.50;
  }

  // Jika memilih/melakukan penggantian jam keterlambatan dalam batas waktu <= 18:00 WIB:
  // - Saat Masuk (belum pulang): sementara 0% (menunggu pemenuhan jam pulang target)
  // - Saat Pulang & target terpenuhi (secPulang >= 16:00:00 + detikTerlambat): keterlambatan telah diganti -> TL menjadi 0.00%
  if (pilihGantiJam) {
    if (secPulang === null) {
      kodeTL = "KOMPENSASI";
      potonganTL = 0.0;
    } else if (secPulang >= targetPulangKompSec) {
      kodeTL = "KOMPENSASI (0%)";
      potonganTL = 0.0;
    }
  }

  // 2. Evaluasi Pulang Cepat (PSW) — Terpisah jelas dari TL ("pulang sebelum waktu" < 16:00:00 WIB)
  let menitPulangCepat = 0;
  let kodePSW = "-";
  let potonganPSW = 0.0;

  if (secPulang !== null && secPulang < standarPulangSec) {
    const selisihDetikPSW = standarPulangSec - secPulang;
    menitPulangCepat = Math.floor(selisihDetikPSW / 60);
    if (selisihDetikPSW % 60 > 0) menitPulangCepat += 1;

    if (menitPulangCepat >= 1 && menitPulangCepat <= 30) {
      kodePSW = "PSW 1";
      potonganPSW = 0.50;
    } else if (menitPulangCepat >= 31 && menitPulangCepat <= 60) {
      kodePSW = "PSW 2";
      potonganPSW = 1.00;
    } else if (menitPulangCepat >= 61 && menitPulangCepat <= 90) {
      kodePSW = "PSW 3";
      potonganPSW = 1.25;
    } else if (menitPulangCepat > 90) {
      kodePSW = "PSW 4";
      potonganPSW = 1.50;
    }
  }

  // 3. Durasi Total Jam Kerja & Kekurangan Jam Kerja
  let totalDetikKerja = 0;
  let teksJamKerja = "-";
  let teksKekurangan = "-";

  if (secMasuk !== null && secPulang !== null && secPulang >= secMasuk) {
    totalDetikKerja = secPulang - secMasuk;
    teksJamKerja = formatDetikKeTeksWaktu(totalDetikKerja);

    const targetDetik = (CONFIG.TOTAL_MENIT_KERJA_HARIAN || 450) * 60;
    const defisitDetik = Math.max(0, targetDetik - totalDetikKerja);
    if (pilihGantiJam && secPulang >= targetPulangKompSec) {
      teksKekurangan = "0 Jam 0 Menit 0 Detik (Keterlambatan Diganti 0%)";
    } else if (pilihGantiJam && secPulang < targetPulangKompSec) {
      teksKekurangan = formatDetikKeTeksWaktu(targetPulangKompSec - secPulang) + " (Kurang Ganti Telat)";
    } else if (infoKomp.melebihiBatasPenggantian) {
      teksKekurangan = infoKomp.teksTerlambat + " (TL 4 > Batas " + jamBatasPulang.substring(0, 5) + " WIB)";
    } else {
      teksKekurangan = defisitDetik > 0
        ? formatDetikKeTeksWaktu(defisitDetik)
        : "0 Jam 0 Menit 0 Detik (Terpenuhi)";
    }
  } else if (infoKomp.melebihiBatasPenggantian) {
    teksKekurangan = infoKomp.teksTerlambat + " (TL 4 > Batas " + jamBatasPulang.substring(0, 5) + " WIB)";
  } else if (pilihGantiJam) {
    teksKekurangan = "Wajib ganti +" + infoKomp.teksTerlambat + " (Pulang >= " + infoKomp.jamPulangKompensasi + " WIB)";
  } else if (infoKomp.isTerlambat) {
    teksKekurangan = infoKomp.teksTerlambat + " (" + kodeTL + ")";
  }

  const fmtPot = formatTampilanPotonganTukin(potonganTL, kodeTL, potonganPSW, kodePSW);

  return {
    menitKeterlambatan: menitKeterlambatan,
    detikTerlambat: infoKomp.detikTerlambat,
    teksTerlambat: infoKomp.teksTerlambat,
    menitPulangCepat: menitPulangCepat,
    kodeTL: kodeTL,
    kodePSW: kodePSW,
    potonganTL: potonganTL,
    potonganPSW: potonganPSW,
    totalJamKerja: teksJamKerja,
    kekuranganJamKerja: teksKekurangan,
    totalPotonganPersen: fmtPot.totalPersenStr,
    potonganDisplayText: fmtPot.displayText,
    kodePelanggaran: fmtPot.kodeText,
    opsiKompensasi: infoKomp.opsiKompensasi,
    statusKompensasi: infoKomp.statusKompensasi,
    jamPulangWajib: infoKomp.jamPulangWajib,
    infoKompensasi: infoKomp,
    ringkasan: "Potongan Masuk (" + kodeTL + ": " + potonganTL.toFixed(2) + "%) + Pulang (" + kodePSW + ": " + potonganPSW.toFixed(2) + "%)"
  };
}

function sinkronkanBarisAbsensiHadir(sheetAbsensi, rowIdx1, rowVals, dispVals, batasMenitCfg, jamBatasPulangCfg) {
  var statusKehadiran = normalizeStatusKehadiran((dispVals && dispVals[5]) || (rowVals && rowVals[5]) || "Hadir");
  var statusApproval = String((dispVals && dispVals[20]) || (rowVals && rowVals[20]) || "").trim();
  var jamMasuk = formatJamWIB((rowVals && rowVals[4]) || (dispVals && dispVals[4]));
  var jamPulang = formatJamWIB((rowVals && rowVals[9]) || (dispVals && dispVals[9]));
  var curJamKerja = String((dispVals && dispVals[13]) || (rowVals && rowVals[13]) || "-").trim();
  var curKekurangan = String((dispVals && dispVals[14]) || (rowVals && rowVals[14]) || "-").trim();
  var curPotDisp = String((dispVals && dispVals[15]) || (rowVals && rowVals[15]) || "").trim();
  var curPotRaw = rowVals ? rowVals[15] : "";
  var curOpsiKomp = String((dispVals && dispVals[27]) || (rowVals && rowVals[27]) || "").trim();
  var curJamWajib = String((dispVals && dispVals[28]) || (rowVals && rowVals[28]) || "").trim();
  var curStatusKomp = String((dispVals && dispVals[29]) || (rowVals && rowVals[29]) || "").trim();
  var curTeksTelat = String((dispVals && dispVals[26]) || (rowVals && rowVals[26]) || "").trim();
  var curKodeTukin = String((dispVals && dispVals[36]) || (rowVals && rowVals[36]) || "").trim();

  var isRejected = statusApproval.toLowerCase().indexOf("ditolak") !== -1;
  if (statusKehadiran !== "Hadir" || isRejected || !jamMasuk) {
    var potNumNonHadir = parsePotonganPersenNum(curPotDisp, curPotRaw);
    return {
      jamMasuk: jamMasuk,
      jamPulang: jamPulang,
      jumlahJamKerja: curJamKerja,
      kekuranganJamKerja: curKekurangan,
      potonganStr: curPotDisp || (potNumNonHadir.toFixed(2) + "%"),
      potonganNum: potNumNonHadir,
      kodeTukin: curKodeTukin || "-",
      opsiKompensasi: curOpsiKomp || "-",
      jamPulangKompensasi: curJamWajib || "-",
      statusKompensasi: curStatusKomp || "-",
      teksTerlambat: curTeksTelat || "0 Menit",
      infoKompensasi: hitungInfoKompensasiTelat(jamMasuk, statusKehadiran, curOpsiKomp, jamPulang, batasMenitCfg, jamBatasPulangCfg),
      updated: false
    };
  }

  var kalk = hitungTukinKPU1090(jamMasuk, jamPulang || null, "Hadir", statusApproval, {
    opsi: curOpsiKomp,
    batasMenit: batasMenitCfg,
    jamBatasPulang: jamBatasPulangCfg
  });
  var infoKomp = kalk.infoKompensasi;
  var targetPotText = kalk.potonganDisplayText || kalk.totalPotonganPersen;
  var targetKodeTukin = kalk.kodePelanggaran || "-";
  var targetJamKerja = jamPulang ? kalk.totalJamKerja : (curJamKerja || "-");
  var targetKekurangan = (jamPulang || infoKomp.isTerlambat) ? (kalk.kekuranganJamKerja || "-") : (curKekurangan || "-");

  var needsSync = (
    curPotDisp !== targetPotText ||
    typeof curPotRaw === "number" ||
    curOpsiKomp !== infoKomp.opsiKompensasi ||
    curStatusKomp !== infoKomp.statusKompensasi ||
    curJamWajib !== infoKomp.jamPulangWajib ||
    curKodeTukin !== targetKodeTukin ||
    (jamPulang && curJamKerja !== targetJamKerja) ||
    curKekurangan !== targetKekurangan
  );

  if (needsSync && sheetAbsensi && rowIdx1 > 1) {
    try {
      if (jamPulang) sheetAbsensi.getRange(rowIdx1, 14).setValue(targetJamKerja);
      sheetAbsensi.getRange(rowIdx1, 15).setValue(targetKekurangan);
      sheetAbsensi.getRange(rowIdx1, 16).setNumberFormat("@").setValue(targetPotText);
      sheetAbsensi.getRange(rowIdx1, 27).setNumberFormat("@").setValue(infoKomp.teksTerlambat || "0 Menit");
      sheetAbsensi.getRange(rowIdx1, 28).setNumberFormat("@").setValue(infoKomp.opsiKompensasi);
      sheetAbsensi.getRange(rowIdx1, 29).setNumberFormat("@").setValue(infoKomp.jamPulangWajib);
      sheetAbsensi.getRange(rowIdx1, 30).setNumberFormat("@").setValue(infoKomp.statusKompensasi);
      if (sheetAbsensi.getLastColumn() >= 37) {
        sheetAbsensi.getRange(rowIdx1, 37).setNumberFormat("@").setValue(targetKodeTukin);
      }
    } catch (syncErr) {}
  }

  return {
    jamMasuk: jamMasuk,
    jamPulang: jamPulang,
    jumlahJamKerja: targetJamKerja,
    kekuranganJamKerja: targetKekurangan,
    potonganStr: targetPotText,
    potonganNum: Number((Number(kalk.potonganTL || 0) + Number(kalk.potonganPSW || 0)).toFixed(2)),
    kodeTukin: targetKodeTukin,
    opsiKompensasi: infoKomp.opsiKompensasi,
    jamPulangKompensasi: infoKomp.jamPulangWajib,
    statusKompensasi: infoKomp.statusKompensasi,
    teksTerlambat: infoKomp.teksTerlambat || "0 Menit",
    infoKompensasi: infoKomp,
    updated: needsSync
  };
}

/**
 * -----------------------------------------------------------------------------
 * 4. HITUNG JARAK GEOFENCING GPS (HAVERSINE FORMULA)
 * -----------------------------------------------------------------------------
 */
function hitungJarakMeter(lat1, lon1, lat2, lon2) {
  const parseCoord = (c) => parseFloat(String(c).replace(",", ".").trim());
  const cLat1 = parseCoord(lat1);
  const cLon1 = parseCoord(lon1);
  const cLat2 = parseCoord(lat2);
  const cLon2 = parseCoord(lon2);

  if (isNaN(cLat1) || isNaN(cLon1) || isNaN(cLat2) || isNaN(cLon2)) {
    return 999999;
  }

  const R = 6371e3; // Radius bumi dalam meter
  const phi1 = (cLat1 * Math.PI) / 180;
  const phi2 = (cLat2 * Math.PI) / 180;
  const dPhi = ((cLat2 - cLat1) * Math.PI) / 180;
  const dLam = ((cLon2 - cLon1) * Math.PI) / 180;

  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(dLam / 2) * Math.sin(dLam / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * -----------------------------------------------------------------------------
 * HELPER ANTI #ERROR! GOOGLE SHEETS: RICH TEXT HYPERLINK & PEMULIHAN FORMULA
 * Menggunakan RichTextValue agar klik tautan aktif di SEMUA locale (ID ; maupun EN ,)
 * -----------------------------------------------------------------------------
 */
function setCellLinkOrText(sheet, rowIndex, colIndex, labelText, url) {
  if (!sheet || !rowIndex || !colIndex) return;
  var range = sheet.getRange(rowIndex, colIndex);
  var cleanLabel = String(labelText || "Lihat File").replace(/[\r\n]+/g, " ").trim();
  var cleanUrl = String(url || "").trim();

  if (cleanUrl && /^https?:\/\//i.test(cleanUrl)) {
    try {
      if (typeof SpreadsheetApp !== "undefined" && typeof SpreadsheetApp.newRichTextValue === "function") {
        var richText = SpreadsheetApp.newRichTextValue()
          .setText(cleanLabel)
          .setLinkUrl(cleanUrl)
          .build();
        range.setRichTextValue(richText);
        return;
      }
    } catch (rtErr) {
      Logger.log("RichText fallback ke URL teks: " + rtErr);
    }
    range.setValue(cleanUrl);
    return;
  }
  range.setValue(cleanLabel);
}

function extractHyperlinkParts(formulaStr) {
  var f = String(formulaStr || "").trim();
  var m = f.match(/^=\s*HYPERLINK\s*\(\s*"([^"]+)"\s*[,;]\s*"([^"]*)"\s*\)$/i);
  if (m && m[1]) {
    return {
      url: m[1].trim(),
      label: (m[2] || "Lihat File").replace(/[^\w\s.\-:\/]/g, "").trim() || "Lihat File"
    };
  }
  return null;
}

function repairSpreadsheetFormulaErrors(ssOpt) {
  var ss = ssOpt || ensureDatabaseReady();
  if (!ss) return 0;
  var fixedCount = 0;

  var scanSheetCols = [
    { sheetName: CONFIG.SHEET_ABSENSI, cols: [9, 13, 17, 18], urlColMap: { 18: 19 } },
    { sheetName: CONFIG.SHEET_IZIN, cols: [8], urlColMap: { 8: 11 } }
  ];

  for (var sIdx = 0; sIdx < scanSheetCols.length; sIdx++) {
    var cfg = scanSheetCols[sIdx];
    var sheet = ss.getSheetByName(cfg.sheetName);
    if (!sheet || sheet.getLastRow() <= 1) continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var formulas = typeof dataRange.getFormulas === "function" ? dataRange.getFormulas() : [];
    var dispVals = dataRange.getDisplayValues();

    for (var r = 0; r < dispVals.length; r++) {
      for (var cIdx = 0; cIdx < cfg.cols.length; cIdx++) {
        var col1 = cfg.cols[cIdx];
        if (col1 > lastCol) continue;
        var cellFormula = (formulas[r] && formulas[r][col1 - 1]) ? String(formulas[r][col1 - 1]) : "";
        var cellDisp = String((dispVals[r] && dispVals[r][col1 - 1]) || "").trim();

        var isFormulaHyperlink = cellFormula.toUpperCase().indexOf("=HYPERLINK(") === 0;
        var isSheetError = /^#(ERROR|VALUE|NAME|REF|N\/A|DIV\/0)!?/i.test(cellDisp);
        if (!isFormulaHyperlink && !isSheetError) continue;

        var parsed = extractHyperlinkParts(cellFormula);
        if (parsed && parsed.url) {
          setCellLinkOrText(sheet, r + 2, col1, parsed.label, parsed.url);
          var urlCol = cfg.urlColMap && cfg.urlColMap[col1];
          if (urlCol && urlCol <= lastCol) {
            var curUrlVal = String((dispVals[r] && dispVals[r][urlCol - 1]) || "").trim();
            if (!curUrlVal) {
              sheet.getRange(r + 2, urlCol).setValue(parsed.url);
            }
          }
          fixedCount++;
        } else if (isSheetError) {
          var fallbackLabel = (col1 === 9) ? "Foto Masuk (Tersimpan)" : ((col1 === 13) ? "Foto Pulang (Tersimpan)" : "Dokumen Tersimpan");
          sheet.getRange(r + 2, col1).setValue(fallbackLabel);
          fixedCount++;
        }
      }
    }
  }
  return fixedCount;
}

function perbaikiErrorSpreadsheet(requesterRole) {
  try {
    if (requesterRole !== "admin") {
      return { success: false, message: "Akses ditolak! Hanya Admin Satker yang dapat memperbaiki data Spreadsheet." };
    }
    var ss = ensureDatabaseReady();
    var countFormula = repairSpreadsheetFormulaErrors(ss);
    var countTukinSync = 0;

    var sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (sheetAbsensi && sheetAbsensi.getLastRow() > 1) {
      var kompensasiMenitCfg = getKompensasiTelatMenit(ss);
      var jamBatasPulang = getJamBatasPulangWib(ss);
      sheetAbsensi.getRange("P2:P1000").setNumberFormat("@");
      var av = sheetAbsensi.getDataRange().getValues();
      var ad = sheetAbsensi.getDataRange().getDisplayValues();
      for (var i = 1; i < av.length; i++) {
        var synced = sinkronkanBarisAbsensiHadir(sheetAbsensi, i + 1, av[i], ad[i], kompensasiMenitCfg, jamBatasPulang);
        if (synced.updated) countTukinSync++;
      }
    }

    SpreadsheetApp.flush();
    var totalFixed = countFormula + countTukinSync;
    return {
      success: true,
      fixedCount: totalFixed,
      fixedFormulaCount: countFormula,
      fixedTukinCount: countTukinSync,
      message: totalFixed > 0
        ? "Berhasil menyinkronkan Spreadsheet: " + countFormula + " sel #Error!/Hyperlink & " + countTukinSync + " baris perhitungan Tukin/Kompensasi pada Sheet Absensi!"
        : "Tidak ditemukan sel #Error! maupun ketidaksesuaian perhitungan Tukin — seluruh data Sheet Absensi & Pengajuan_Izin sudah bersih dan sinkron."
    };
  } catch (err) {
    return { success: false, message: "Gagal memperbaiki Spreadsheet: " + err.toString() };
  }
}

/**
 * -----------------------------------------------------------------------------
 * HELPER: SIMPAN FOTO KE GOOGLE DRIVE (BEBAS #ERROR! DI SEMUA LOCALE SHEETS)
 * -----------------------------------------------------------------------------
 */
function simpanFotoKeDrive(base64Data, namaFile, idAbsen, tipe) {
  try {
    if (!base64Data || String(base64Data).indexOf("data:image/") !== 0) {
      return {
        success: true,
        driveUrl: "",
        labelText: "Foto " + tipe + " (Lokal)",
        cellValue: "Foto " + tipe + " (Lokal)"
      };
    }

    const folderName = "Foto_Presensi_KIP_Agara";
    const folders = DriveApp.getFoldersByName(folderName);
    let folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
      try {
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (eShare) {}
    }

    const parts = String(base64Data).split(",");
    if (parts.length < 2 || !parts[1]) {
      return {
        success: false,
        driveUrl: "",
        labelText: "Foto " + tipe + " (Data kosong)",
        cellValue: "Foto " + tipe + " (Data kosong)"
      };
    }
    const header = parts[0];
    const cleanBase64 = parts[1].replace(/\s+/g, "");
    let contentType = "image/jpeg";
    const mimeMatch = header.match(/:(image\/[a-zA-Z0-9.+-]+);/);
    if (mimeMatch) contentType = mimeMatch[1];

    const decoded = Utilities.base64Decode(cleanBase64);
    const fileName = idAbsen + "_" + tipe + ".jpg";
    const blob = Utilities.newBlob(decoded, contentType, fileName);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (fShare) {}

    const driveUrl = file.getUrl();
    const labelText = "Foto " + tipe + ".jpg";

    return {
      success: true,
      fileId: file.getId(),
      driveUrl: driveUrl,
      labelText: labelText,
      cellValue: labelText
    };
  } catch (err) {
    Logger.log("Peringatan simpan ke Drive: " + err.toString());
    return {
      success: false,
      driveUrl: "",
      labelText: "Foto lokal tersimpan",
      cellValue: "Foto lokal tersimpan"
    };
  }
}

/**
 * -----------------------------------------------------------------------------
 * HELPER: SIMPAN DOKUMEN BUKTI / LKH (FOTO ATAU PDF) KE GOOGLE DRIVE
 * -----------------------------------------------------------------------------
 */
function simpanDokumenKeDrive(base64Data, rawFileName, prefixId, folderName) {
  try {
    var strData = String(base64Data || "");
    var matchMime = strData.match(/^data:(image\/[a-zA-Z0-9.+-]+|application\/pdf);base64,(.+)$/);
    if (!matchMime) {
      return { success: false, message: "Format dokumen harus berupa Foto (JPG/PNG) atau PDF." };
    }
    var contentType = matchMime[1];
    var cleanBase64 = matchMime[2].replace(/\s+/g, "");
    var decoded = Utilities.base64Decode(cleanBase64);
    if (decoded.length > 5 * 1024 * 1024) {
      return { success: false, message: "Ukuran file maksimal 5 MB." };
    }

    var targetFolderName = folderName || "Dokumen_Izin_KIP_Agara";
    var folders = DriveApp.getFoldersByName(targetFolderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(targetFolderName);
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {}

    var ext = contentType === "application/pdf" ? "pdf" : (contentType.split("/")[1] || "jpg").replace("jpeg", "jpg");
    var safeBaseName = String(rawFileName || (prefixId + "." + ext))
      .replace(/["'<>\\/:*?|\x00-\x1f]/g, "_")
      .trim()
      .substring(0, 80);
    if (!safeBaseName) safeBaseName = prefixId + "." + ext;

    var blob = Utilities.newBlob(decoded, contentType, prefixId + "_" + safeBaseName);
    var file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (fileShareErr) {}

    var driveUrl = file.getUrl();
    var labelText = "Dokumen: " + safeBaseName;
    return {
      success: true,
      fileId: file.getId(),
      driveUrl: driveUrl,
      fileName: safeBaseName,
      labelText: labelText,
      cellValue: labelText
    };
  } catch (err) {
    Logger.log("Gagal simpan dokumen ke Drive: " + err.toString());
    return {
      success: false,
      message: "Gagal mengunggah dokumen ke Google Drive: " + err.toString()
    };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 5. SIMPAN ABSEN MASUK
 * -----------------------------------------------------------------------------
 */
function simpanAbsenMasuk(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const dataIn = payload || {};
    const nip = dataIn.nip;
    const latitude = dataIn.latitude;
    const longitude = dataIn.longitude;
    const fotoBase64 = dataIn.fotoBase64;
    const statusKehadiran = dataIn.statusKehadiran;

    const nipCheck = validateNip(nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;

    if (latitude === undefined || longitude === undefined || !fotoBase64) {
      return { success: false, message: "Data absensi tidak lengkap (Koordinat GPS atau Foto Swafoto belum ada)." };
    }

    const ss = ensureDatabaseReady();
    const tipeKehadiran = normalizeStatusKehadiran(statusKehadiran);
    const maxRadiusAllowed = getMaxRadiusByStatus(tipeKehadiran, ss);

    const parseCoord = (c) => parseFloat(String(c).replace(",", ".").trim());
    const userLat = parseCoord(latitude);
    const userLon = parseCoord(longitude);

    if (isNaN(userLat) || isNaN(userLon) || userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
      return { success: false, message: "Koordinat GPS tidak valid. Harap aktifkan GPS perangkat Anda." };
    }

    const jarak = hitungJarakMeter(userLat, userLon, CONFIG.OFFICE_LAT, CONFIG.OFFICE_LON);
    if (jarak > maxRadiusAllowed) {
      return {
        success: false,
        message: "Presensi Masuk DITOLAK! Posisi Anda berada di luar radius yang diizinkan untuk status " + tipeKehadiran + " (Jarak Anda: " + jarak + " meter, Batas Maksimal: " + maxRadiusAllowed + " meter)."
      };
    }

    const now = new Date();
    const todayStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd");
    const serverTimeStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm:ss");

    let sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);

    // Validasi wajib Form Izin / Dokumen Pembuktian untuk Dinas Luar, Cuti, dan Sakit
    let buktiIzinHariIni = "";
    let urlBuktiIzin = "";
    let statusApprovalAwal = tipeKehadiran === "Hadir" ? "Otomatis (Hadir)" : "Menunggu Validasi";
    let catatanApprovalAwal = "";
    let diverifikasiOlehAwal = "";

    if (tipeKehadiran === "Dinas Luar" || tipeKehadiran === "Cuti" || tipeKehadiran === "Sakit") {
      const izinMap = getIzinHariIniMap(ss, cleanNip, todayStr);
      const izinMatch = izinMap[tipeKehadiran];
      if (!izinMatch) {
        const syaratText = tipeKehadiran === "Sakit"
          ? "Keterangan dan mengupload Surat Keterangan Dokter (Foto/PDF)"
          : "Keterangan dan mengupload Dokumen Pembuktian (Foto/PDF)";
        return {
          success: false,
          requireIzinForm: true,
          message: "Presensi Masuk " + tipeKehadiran + " DITOLAK! Anda WAJIB melengkapi " + syaratText + " di Form Izin / DL terlebih dahulu."
        };
      }
      buktiIzinHariIni = izinMatch.buktiDokumen || izinMatch.idIzin;
      urlBuktiIzin = izinMatch.urlDokumen || "";
      statusApprovalAwal = izinMatch.statusApproval || "Menunggu Validasi";
      catatanApprovalAwal = izinMatch.catatanVerifikasi || "";
      diverifikasiOlehAwal = izinMatch.diverifikasiOleh || "";
    }

    if (sheetAbsensi.getLastRow() > 1) {
      const dataAbsen = sheetAbsensi.getDataRange().getValues();
      const displayAbsen = sheetAbsensi.getDataRange().getDisplayValues();
      for (let i = 1; i < dataAbsen.length; i++) {
        const rowNip = normalizeNipValue(displayAbsen[i][1] || dataAbsen[i][1]);
        const rowTanggal = normalizeDateStr(dataAbsen[i][3]);

        if (rowNip === cleanNip && rowTanggal === todayStr) {
          const jamMasukExist = formatJamWIB(dataAbsen[i][4]);
          const jamPulangExist = formatJamWIB(dataAbsen[i][9]);

          if (jamMasukExist && !jamPulangExist) {
            return {
              success: false,
              message: "PERINGATAN: Anda sudah melakukan Absen Masuk hari ini pada pukul " + jamMasukExist + " WIB. Tombol Anda telah dialihkan ke 'Absen Pulang'. Presensi Masuk tidak dapat dilakukan 2 kali!"
            };
          } else if (jamMasukExist && jamPulangExist) {
            return {
              success: false,
              message: "PERINGATAN: Presensi Anda hari ini SUDAH LENGKAP (Masuk: " + jamMasukExist + " WIB, Pulang: " + jamPulangExist + " WIB). Anda tidak dapat melakukan presensi lagi hari ini!"
            };
          }
        }
      }
    }

    const validasiNip = getValidasiNIP(cleanNip);
    if (!validasiNip.success) {
      return validasiNip;
    }
    const namaPegawai = validasiNip.pegawai.nama;

    // Verifikasi Perangkat Android/iOS Anti-Titip Presensi saat Absen Masuk
    const devCheckMasuk = verifikasiDanIkatPerangkat(ss, cleanNip, namaPegawai, dataIn.device, "ABSEN_MASUK");
    if (!devCheckMasuk.success) {
      return devCheckMasuk;
    }

    // Verifikasi Jaringan Wi-Fi Satker KIP Agara & Anti-Fake GPS Multi-Lapis
    const netCheckMasuk = verifikasiJaringanDanAntiFakeGps(
      ss,
      cleanNip,
      namaPegawai,
      tipeKehadiran,
      dataIn.network,
      dataIn.gpsSecurity,
      "ABSEN_MASUK"
    );
    if (!netCheckMasuk.success) {
      return netCheckMasuk;
    }

    const idAbsen = "ABS-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd") + "-" + cleanNip;
    const statusEfektif = (statusApprovalAwal === "Ditolak") ? "Izin Kepentingan Pribadi" : tipeKehadiran;
    const batasKompMenit = getKompensasiTelatMenit(ss);
    const jamBatasPulang = getJamBatasPulangWib(ss);
    const infoBatasMasuk = hitungInfoBatasPulang(serverTimeStr, jamBatasPulang);
    const opsiKompAwal = normalizeOpsiKompensasi(dataIn.opsiKompensasi || "");
    const kalkulasiAwal = hitungTukinKPU1090(serverTimeStr, null, statusEfektif, statusApprovalAwal, {
      opsi: opsiKompAwal,
      batasMenit: batasKompMenit,
      jamBatasPulang: jamBatasPulang
    });
    const infoKompMasuk = kalkulasiAwal.infoKompensasi || hitungInfoKompensasiTelat(serverTimeStr, statusEfektif, opsiKompAwal, null, batasKompMenit, jamBatasPulang);
    const fotoMasukDrive = simpanFotoKeDrive(fotoBase64, "Foto_Masuk_" + cleanNip, idAbsen, "Masuk");
    const initialPotStr = (statusApprovalAwal === "Ditolak")
      ? "1.50% (IZIN)"
      : (kalkulasiAwal.potonganDisplayText || (kalkulasiAwal.potonganTL > 0 ? (kalkulasiAwal.potonganTL.toFixed(2) + "% (" + kalkulasiAwal.kodeTL + ")") : "0.00%"));
    const initialKodeTukin = (statusApprovalAwal === "Ditolak") ? "IZIN" : (kalkulasiAwal.kodePelanggaran || "-");
    const kekuranganAwalStr = (infoKompMasuk.isTerlambat && kalkulasiAwal.kekuranganJamKerja)
      ? kalkulasiAwal.kekuranganJamKerja
      : "-";

    const newRow = [
      idAbsen,
      cleanNip,
      namaPegawai,
      todayStr,
      serverTimeStr,
      statusEfektif,
      userLat,
      userLon,
      fotoMasukDrive.cellValue,
      "",
      "",
      "",
      "",
      "-",
      kekuranganAwalStr,
      initialPotStr,
      buktiIzinHariIni,
      "",
      "",
      "",
      statusApprovalAwal,
      catatanApprovalAwal,
      diverifikasiOlehAwal,
      devCheckMasuk.deviceId || "",
      "",
      devCheckMasuk.platform || "",
      infoKompMasuk.teksTerlambat || "0 Menit",
      infoKompMasuk.opsiKompensasi || "Tepat Waktu",
      infoKompMasuk.jamPulangWajib || (CONFIG.JAM_PULANG_STANDAR || "16:00:00"),
      infoKompMasuk.statusKompensasi || "Tepat Waktu",
      jamBatasPulang,
      infoBatasMasuk.statusBatasPulang,
      netCheckMasuk.publicIp || "-",
      netCheckMasuk.statusJaringan || "-",
      netCheckMasuk.skorGps || "100/100",
      netCheckMasuk.statusKeamananLokasi || "AMAN",
      initialKodeTukin
    ];

    sheetAbsensi.appendRow(newRow);
    const lastRowIdx = sheetAbsensi.getLastRow();
    sheetAbsensi.getRange(lastRowIdx, 2).setNumberFormat("@");
    sheetAbsensi.getRange(lastRowIdx, 16).setNumberFormat("@").setValue(initialPotStr);
    sheetAbsensi.getRange(lastRowIdx, 24, 1, 14).setNumberFormat("@");
    setCellLinkOrText(sheetAbsensi, lastRowIdx, 9, fotoMasukDrive.labelText || "Foto Masuk.jpg", fotoMasukDrive.driveUrl);
    if (urlBuktiIzin) {
      setCellLinkOrText(sheetAbsensi, lastRowIdx, 17, buktiIzinHariIni || "Dokumen Bukti", urlBuktiIzin);
    }

    return {
      success: true,
      idAbsen: idAbsen,
      message: infoKompMasuk.isTerlambat
        ? "Absen Masuk (" + statusEfektif + ") tercatat pukul " + serverTimeStr + " WIB (Terlambat " + infoKompMasuk.teksTerlambat + "). Silakan pilih opsi Kompensasi Keterlambatan."
        : "Absen Masuk (" + statusEfektif + ") berhasil dicatat pada pukul " + serverTimeStr + " WIB!",
      jamMasuk: serverTimeStr,
      statusKehadiran: statusEfektif,
      statusApproval: statusApprovalAwal,
      deviceId: devCheckMasuk.deviceId,
      devicePlatform: devCheckMasuk.platform,
      jarakMeter: jarak,
      maxRadiusMeter: maxRadiusAllowed,
      potonganTL: kalkulasiAwal.potonganTL,
      potonganTukin: initialPotStr,
      kodeTL: kalkulasiAwal.kodeTL,
      kompensasiInfo: infoKompMasuk,
      jamBatasPulang: jamBatasPulang,
      batasPulangInfo: infoBatasMasuk,
      publicIp: netCheckMasuk.publicIp,
      statusJaringan: netCheckMasuk.statusJaringan,
      skorGps: netCheckMasuk.skorGps,
      statusKeamananLokasi: netCheckMasuk.statusKeamananLokasi
    };
  } catch (error) {
    return { success: false, message: "Gagal memproses Absen Masuk: " + error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * -----------------------------------------------------------------------------
 * 5A. SIMPAN PILIHAN KOMPENSASI KETERLAMBATAN ("Mengganti Jam Keterlambatan" / "Cepat Pulang")
 * -----------------------------------------------------------------------------
 */
function simpanOpsiKompensasiTelat(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const dataIn = payload || {};
    const nipCheck = validateNip(dataIn.nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;
    const opsiNorm = normalizeOpsiKompensasi(dataIn.opsi);
    if (opsiNorm !== "Mengganti Jam Keterlambatan" && opsiNorm !== "Cepat Pulang") {
      return {
        success: false,
        message: "Pilihan opsi kompensasi tidak valid! Pilih 'Mengganti Jam Keterlambatan' atau 'Cepat Pulang'."
      };
    }

    const ss = ensureDatabaseReady();
    const sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (!sheetAbsensi || sheetAbsensi.getLastRow() <= 1) {
      return { success: false, message: "Data Absen Masuk hari ini belum ditemukan." };
    }

    const todayStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
    const dataAbsen = sheetAbsensi.getDataRange().getValues();
    const displayAbsen = sheetAbsensi.getDataRange().getDisplayValues();
    let rowIndex = -1;
    let jamMasukRecord = "";
    let statusKehadiranRecord = "Hadir";
    let statusApprovalRecord = "";

    for (let i = 1; i < dataAbsen.length; i++) {
      const rowNip = normalizeNipValue(displayAbsen[i][1] || dataAbsen[i][1]);
      const rowTanggal = normalizeDateStr(dataAbsen[i][3]);
      if (rowNip === cleanNip && rowTanggal === todayStr) {
        const jamPulangExist = formatJamWIB(dataAbsen[i][9]);
        if (jamPulangExist) {
          return {
            success: false,
            message: "Anda sudah melakukan Absen Pulang hari ini pada pukul " + jamPulangExist + " WIB. Opsi kompensasi tidak dapat diubah lagi."
          };
        }
        rowIndex = i + 1;
        jamMasukRecord = formatJamWIB(dataAbsen[i][4]);
        statusKehadiranRecord = normalizeStatusKehadiran(dataAbsen[i][5] || "Hadir");
        statusApprovalRecord = String(displayAbsen[i][20] || dataAbsen[i][20] || "").trim();
        break;
      }
    }

    if (rowIndex === -1 || !jamMasukRecord) {
      return { success: false, message: "Catatan Absen Masuk hari ini tidak ditemukan." };
    }

    const batasMenit = getKompensasiTelatMenit(ss);
    const jamBatasPulang = getJamBatasPulangWib(ss);
    const infoBatasPre = hitungInfoKompensasiTelat(jamMasukRecord, statusKehadiranRecord, opsiNorm, null, batasMenit, jamBatasPulang);
    if (!infoBatasPre.isTerlambat) {
      return {
        success: false,
        message: "Presensi masuk Anda hari ini tercatat Tepat Waktu (" + jamMasukRecord + " WIB), tidak memerlukan kompensasi keterlambatan."
      };
    }

    const efektifOpsi = infoBatasPre.melebihiBatasPenggantian ? infoBatasPre.opsiKompensasi : opsiNorm;
    const kalkulasi = hitungTukinKPU1090(jamMasukRecord, null, statusKehadiranRecord, statusApprovalRecord, {
      opsi: efektifOpsi,
      batasMenit: batasMenit,
      jamBatasPulang: jamBatasPulang
    });
    const infoKomp = kalkulasi.infoKompensasi || infoBatasPre;
    const potStr = kalkulasi.potonganDisplayText || (kalkulasi.potonganTL > 0 ? (kalkulasi.potonganTL.toFixed(2) + "% (" + kalkulasi.kodeTL + ")") : "0.00%");
    const kodeTukinStr = kalkulasi.kodePelanggaran || kalkulasi.kodeTL || "-";

    sheetAbsensi.getRange(rowIndex, 15).setValue(kalkulasi.kekuranganJamKerja);
    sheetAbsensi.getRange(rowIndex, 16).setNumberFormat("@").setValue(potStr);
    sheetAbsensi.getRange(rowIndex, 27).setNumberFormat("@").setValue(infoKomp.teksTerlambat);
    sheetAbsensi.getRange(rowIndex, 28).setNumberFormat("@").setValue(infoKomp.opsiKompensasi);
    sheetAbsensi.getRange(rowIndex, 29).setNumberFormat("@").setValue(infoKomp.jamPulangWajib);
    sheetAbsensi.getRange(rowIndex, 30).setNumberFormat("@").setValue(infoKomp.statusKompensasi);
    if (sheetAbsensi.getLastColumn() >= 37) {
      sheetAbsensi.getRange(rowIndex, 37).setNumberFormat("@").setValue(kodeTukinStr);
    }
    SpreadsheetApp.flush();

    let msgSuccess = "";
    if (infoKomp.melebihiBatasPenggantian) {
      msgSuccess = "Waktu keterlambatan (" + infoKomp.teksTerlambat + ") melebihi batas waktu penggantian pukul " + jamBatasPulang.substring(0, 5) + " WIB (Target penggantian " + infoKomp.jamPulangKompensasi + " WIB > " + jamBatasPulang.substring(0, 5) + " WIB). Sesuai ketentuan, diberlakukan Kode TL 4 (Potongan 1.50%).";
    } else if (efektifOpsi === "Mengganti Jam Keterlambatan") {
      msgSuccess = "Pilihan 'Mengganti Jam Keterlambatan' tersimpan! Target Absen Pulang Anda menjadi pukul " + infoKomp.jamPulangKompensasi + " WIB (maks. " + jamBatasPulang.substring(0, 5) + " WIB) agar potongan keterlambatan (TL) menjadi 0.00%.";
    } else {
      msgSuccess = "Pilihan 'Cepat Pulang' tersimpan! Jadwal pulang tetap pukul " + infoKomp.jamPulangNormal + " WIB dengan ketentuan potongan " + potStr + ".";
    }

    return {
      success: true,
      message: msgSuccess,
      opsiKompensasi: infoKomp.opsiKompensasi,
      jamPulangWajib: infoKomp.jamPulangWajib,
      statusKompensasi: infoKomp.statusKompensasi,
      potonganTL: kalkulasi.potonganTL,
      potonganTukin: potStr,
      kodeTukin: kodeTukinStr,
      kekuranganJamKerja: kalkulasi.kekuranganJamKerja,
      kompensasiInfo: infoKomp
    };
  } catch (error) {
    return { success: false, message: "Gagal menyimpan opsi kompensasi keterlambatan: " + error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * -----------------------------------------------------------------------------
 * 5B. SIMPAN LAPORAN KINERJA HARIAN (LKH) KHUSUS WFH SEBELUM ABSEN PULANG
 * -----------------------------------------------------------------------------
 */
function simpanLkhWfh(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const dataIn = payload || {};
    const nipCheck = validateNip(dataIn.nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;

    const fileBase64 = String(dataIn.fileBase64 || "").trim();
    const fileName = sanitizeTextForSheet(dataIn.fileName || "LKH_WFH", 120);
    const catatanLkh = sanitizeTextForSheet(dataIn.catatanLkh || "", 500);

    if (!fileBase64) {
      return { success: false, message: "File Laporan Kinerja Harian (LKH) dalam format Foto atau PDF wajib dipilih!" };
    }
    if (containsDangerPayload(dataIn.catatanLkh) || containsDangerPayload(dataIn.fileName)) {
      return { success: false, message: "Input LKH mengandung karakter tidak diizinkan." };
    }

    const now = new Date();
    const todayStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd");
    const ss = ensureDatabaseReady();
    const sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (!sheetAbsensi || sheetAbsensi.getLastRow() <= 1) {
      return { success: false, message: "Belum ada catatan Absen Masuk WFH hari ini." };
    }

    const dataAbsen = sheetAbsensi.getDataRange().getValues();
    const displayAbsen = sheetAbsensi.getDataRange().getDisplayValues();
    let targetRow = -1;
    let statusRow = "";

    for (let i = 1; i < dataAbsen.length; i++) {
      const rowNip = normalizeNipValue(displayAbsen[i][1] || dataAbsen[i][1]);
      const rowTanggal = normalizeDateStr(dataAbsen[i][3]);
      if (rowNip === cleanNip && rowTanggal === todayStr) {
        targetRow = i + 1;
        statusRow = normalizeStatusKehadiran(dataAbsen[i][5]);
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "Data Absen Masuk hari ini tidak ditemukan. Lakukan Absen Masuk terlebih dahulu." };
    }
    if (statusRow !== "WFH") {
      return { success: false, message: "Upload LKH hanya diperlukan untuk status kehadiran Work From Home (WFH)." };
    }

    const idLkh = "LKH-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd-HHmmss") + "-" + cleanNip.slice(-4);
    const uploadRes = simpanDokumenKeDrive(fileBase64, fileName, idLkh, "Dokumen_LKH_WFH_KIP_Agara");
    if (!uploadRes.success) {
      return { success: false, message: uploadRes.message };
    }

    setCellLinkOrText(sheetAbsensi, targetRow, 18, uploadRes.labelText, uploadRes.driveUrl);
    sheetAbsensi.getRange(targetRow, 19).setValue(uploadRes.driveUrl);
    if (catatanLkh) {
      sheetAbsensi.getRange(targetRow, 20).setValue(catatanLkh);
      if (!String(sheetAbsensi.getRange(targetRow, 17).getValue() || "").trim()) {
        sheetAbsensi.getRange(targetRow, 17).setValue("LKH: " + catatanLkh);
      }
    }
    sheetAbsensi.getRange(targetRow, 21).setValue("Menunggu Validasi");

    return {
      success: true,
      message: "Laporan Kinerja Harian (LKH) berhasil diupload! Tombol Absen Pulang sekarang aktif dan dokumen diteruskan ke Verifikasi Approval Pimpinan.",
      lkhUrl: uploadRes.driveUrl,
      lkhLabel: uploadRes.fileName,
      lkhCell: uploadRes.labelText
    };
  } catch (error) {
    return { success: false, message: "Gagal menyimpan Laporan Kinerja Harian (LKH): " + error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * -----------------------------------------------------------------------------
 * 6. SIMPAN ABSEN PULANG
 * -----------------------------------------------------------------------------
 */
function simpanAbsenPulang(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const dataIn = payload || {};
    const nip = dataIn.nip;
    const latitude = dataIn.latitude;
    const longitude = dataIn.longitude;
    const fotoBase64 = dataIn.fotoBase64;

    const nipCheck = validateNip(nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;

    if (latitude === undefined || longitude === undefined || !fotoBase64) {
      return { success: false, message: "Data absen pulang tidak lengkap (Koordinat GPS atau Foto Swafoto belum ada)." };
    }

    const parseCoord = (c) => parseFloat(String(c).replace(",", ".").trim());
    const userLat = parseCoord(latitude);
    const userLon = parseCoord(longitude);

    if (isNaN(userLat) || isNaN(userLon) || userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
      return { success: false, message: "Koordinat GPS tidak valid. Harap periksa GPS perangkat Anda." };
    }

    const now = new Date();
    const todayStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd");
    const serverTimeStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm:ss");

    const ss = ensureDatabaseReady();
    const sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (!sheetAbsensi) {
      return { success: false, message: "Sheet Absensi tidak ditemukan." };
    }

    const dataAbsen = sheetAbsensi.getDataRange().getValues();
    const displayAbsen = sheetAbsensi.getDataRange().getDisplayValues();
    let rowIndex = -1;
    let jamMasukRecord = null;
    let statusKehadiranRecord = "Hadir";
    let existingLkhCell = "";

    let statusApprovalRecord = "";
    let opsiKompensasiRecord = "";
    for (let i = 1; i < dataAbsen.length; i++) {
      const rowNip = normalizeNipValue(displayAbsen[i][1] || dataAbsen[i][1]);
      const rowTanggal = normalizeDateStr(dataAbsen[i][3]);

      if (rowNip === cleanNip && rowTanggal === todayStr) {
        rowIndex = i + 1;
        jamMasukRecord = formatJamWIB(dataAbsen[i][4]);
        statusKehadiranRecord = normalizeStatusKehadiran(dataAbsen[i][5] || "Hadir");
        existingLkhCell = String(displayAbsen[i][17] || dataAbsen[i][17] || displayAbsen[i][18] || dataAbsen[i][18] || "").trim();
        statusApprovalRecord = String(displayAbsen[i][20] || dataAbsen[i][20] || "").trim();
        opsiKompensasiRecord = String(displayAbsen[i][27] || dataAbsen[i][27] || "").trim();

        const existingJamPulang = formatJamWIB(dataAbsen[i][9]);
        if (existingJamPulang) {
          return {
            success: false,
            message: "PERINGATAN: Anda sudah melakukan Absen Pulang hari ini pada pukul " + existingJamPulang + " WIB. Absen pulang tidak dapat diulang kembali!"
          };
        }
        break;
      }
    }

    if (rowIndex === -1 || !jamMasukRecord) {
      return { success: false, message: "Anda belum melakukan Absen Masuk hari ini. Tidak dapat melakukan Absen Pulang sebelum ada riwayat Absen Masuk." };
    }

    // Batas Waktu Akhir Klik Presensi Jam Pulang pukul 18:00:00 WIB
    const jamBatasPulang = getJamBatasPulangWib(ss);
    const infoBatasPulang = hitungInfoBatasPulang(serverTimeStr, jamBatasPulang);
    if (infoBatasPulang.isLewatBatas) {
      sheetAbsensi.getRange(rowIndex, 31).setNumberFormat("@").setValue(jamBatasPulang);
      sheetAbsensi.getRange(rowIndex, 32).setNumberFormat("@").setValue(infoBatasPulang.statusBatasPulang);
      SpreadsheetApp.flush();
      return {
        success: false,
        closedAfterDeadline: true,
        jamBatasPulang: jamBatasPulang,
        batasPulangInfo: infoBatasPulang,
        message: "PRESENSI PULANG DITUTUP! Batas waktu akhir klik Presensi Jam Pulang adalah pukul " + jamBatasPulang + " WIB (Waktu server saat ini: " + serverTimeStr + " WIB)."
      };
    }

    const maxRadiusAllowed = getMaxRadiusByStatus(statusKehadiranRecord, ss);
    const jarak = hitungJarakMeter(userLat, userLon, CONFIG.OFFICE_LAT, CONFIG.OFFICE_LON);
    if (jarak > maxRadiusAllowed) {
      return {
        success: false,
        message: "Presensi Pulang DITOLAK! Posisi Anda berada di luar radius yang diizinkan untuk status " + statusKehadiranRecord + " (Jarak Anda: " + jarak + " meter, Batas Maksimal: " + maxRadiusAllowed + " meter)."
      };
    }

    // Validasi dokumen izin/sakit/cuti saat Pulang
    if (statusKehadiranRecord === "Dinas Luar" || statusKehadiranRecord === "Cuti" || statusKehadiranRecord === "Sakit") {
      const izinMap = getIzinHariIniMap(ss, cleanNip, todayStr);
      const izinObj = izinMap[statusKehadiranRecord];
      if (!izinObj) {
        return {
          success: false,
          requireIzinForm: true,
          message: "Presensi Pulang " + statusKehadiranRecord + " DITOLAK! Dokumen pembuktian pada Form Izin / DL belum lengkap untuk tanggal hari ini."
        };
      }
      if (!statusApprovalRecord) statusApprovalRecord = izinObj.statusApproval || "Menunggu Validasi";
    }

    // Validasi WAJIB Laporan Kinerja Harian (LKH) saat Pulang untuk status WFH
    if (statusKehadiranRecord === "WFH") {
      if (!existingLkhCell) {
        if (dataIn.lkhFileBase64) {
          const lkhId = "LKH-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd-HHmmss") + "-" + cleanNip.slice(-4);
          const lkhDrive = simpanDokumenKeDrive(dataIn.lkhFileBase64, dataIn.lkhFileName || "LKH_WFH", lkhId, "Dokumen_LKH_WFH_KIP_Agara");
          if (!lkhDrive.success) {
            return { success: false, requireLkh: true, message: lkhDrive.message };
          }
          existingLkhCell = lkhDrive.labelText;
          setCellLinkOrText(sheetAbsensi, rowIndex, 18, lkhDrive.labelText, lkhDrive.driveUrl);
          sheetAbsensi.getRange(rowIndex, 19).setValue(lkhDrive.driveUrl);
        } else {
          return {
            success: false,
            requireLkh: true,
            message: "Presensi Pulang WFH DITOLAK! Anda WAJIB mengupload Laporan Kinerja Harian (LKH) terlebih dahulu sebelum melakukan Absen Pulang."
          };
        }
      }
    }

    // Verifikasi Perangkat Android/iOS Anti-Titip Presensi saat Absen Pulang
    const namaPegPulang = String(sheetAbsensi.getRange(rowIndex, 3).getValue() || cleanNip);
    const devCheckPulang = verifikasiDanIkatPerangkat(ss, cleanNip, namaPegPulang, dataIn.device, "ABSEN_PULANG");
    if (!devCheckPulang.success) {
      return devCheckPulang;
    }

    // Verifikasi Jaringan Wi-Fi Satker KIP Agara & Anti-Fake GPS Multi-Lapis saat Pulang
    const netCheckPulang = verifikasiJaringanDanAntiFakeGps(
      ss,
      cleanNip,
      namaPegPulang,
      statusKehadiranRecord,
      dataIn.network,
      dataIn.gpsSecurity,
      "ABSEN_PULANG"
    );
    if (!netCheckPulang.success) {
      return netCheckPulang;
    }

    const batasKompMenitPulang = getKompensasiTelatMenit(ss);
    const opsiEfektifPulang = normalizeOpsiKompensasi(dataIn.opsiKompensasi || opsiKompensasiRecord);
    const kalkulasi = hitungTukinKPU1090(jamMasukRecord, serverTimeStr, statusKehadiranRecord, statusApprovalRecord, {
      opsi: opsiEfektifPulang,
      batasMenit: batasKompMenitPulang,
      jamBatasPulang: jamBatasPulang
    });
    const infoKompPulang = kalkulasi.infoKompensasi || hitungInfoKompensasiTelat(jamMasukRecord, statusKehadiranRecord, opsiEfektifPulang, serverTimeStr, batasKompMenitPulang, jamBatasPulang);
    const idAbsenRecord = String(sheetAbsensi.getRange(rowIndex, 1).getValue() || ("ABS-" + cleanNip));
    const fotoPulangDrive = simpanFotoKeDrive(fotoBase64, "Foto_Pulang_" + cleanNip, idAbsenRecord, "Pulang");
    const potFinalDisplay = kalkulasi.potonganDisplayText || kalkulasi.totalPotonganPersen;
    const kodeTukinFinal = kalkulasi.kodePelanggaran || "-";

    sheetAbsensi.getRange(rowIndex, 10).setValue(serverTimeStr);
    sheetAbsensi.getRange(rowIndex, 11).setValue(userLat);
    sheetAbsensi.getRange(rowIndex, 12).setValue(userLon);
    setCellLinkOrText(sheetAbsensi, rowIndex, 13, fotoPulangDrive.labelText || "Foto Pulang.jpg", fotoPulangDrive.driveUrl);
    sheetAbsensi.getRange(rowIndex, 14).setValue(kalkulasi.totalJamKerja);
    sheetAbsensi.getRange(rowIndex, 15).setValue(kalkulasi.kekuranganJamKerja);
    sheetAbsensi.getRange(rowIndex, 16).setNumberFormat("@").setValue(potFinalDisplay);
    sheetAbsensi.getRange(rowIndex, 25).setNumberFormat("@").setValue(devCheckPulang.deviceId || "");
    if (!String(sheetAbsensi.getRange(rowIndex, 26).getValue() || "").trim()) {
      sheetAbsensi.getRange(rowIndex, 26).setNumberFormat("@").setValue(devCheckPulang.platform || "");
    }
    sheetAbsensi.getRange(rowIndex, 27).setNumberFormat("@").setValue(infoKompPulang.teksTerlambat || "0 Menit");
    sheetAbsensi.getRange(rowIndex, 28).setNumberFormat("@").setValue(infoKompPulang.opsiKompensasi || "Tepat Waktu");
    sheetAbsensi.getRange(rowIndex, 29).setNumberFormat("@").setValue(infoKompPulang.jamPulangWajib || (CONFIG.JAM_PULANG_STANDAR || "16:00:00"));
    sheetAbsensi.getRange(rowIndex, 30).setNumberFormat("@").setValue(infoKompPulang.statusKompensasi || "Tepat Waktu");
    sheetAbsensi.getRange(rowIndex, 31).setNumberFormat("@").setValue(jamBatasPulang);
    sheetAbsensi.getRange(rowIndex, 32).setNumberFormat("@").setValue("Tepat Waktu (<= " + jamBatasPulang.substring(0, 5) + " WIB)");
    sheetAbsensi.getRange(rowIndex, 33, 1, 5).setNumberFormat("@").setValues([[
      netCheckPulang.publicIp || "-",
      netCheckPulang.statusJaringan || "-",
      netCheckPulang.skorGps || "100/100",
      netCheckPulang.statusKeamananLokasi || "AMAN",
      kodeTukinFinal
    ]]);

    return {
      success: true,
      message: "Absen Pulang (" + statusKehadiranRecord + ") berhasil dicatat pada pukul " + serverTimeStr + " WIB! Terima kasih atas dedikasi Anda.",
      jamPulang: serverTimeStr,
      statusKehadiran: statusKehadiranRecord,
      deviceId: devCheckPulang.deviceId,
      devicePlatform: devCheckPulang.platform,
      jarakMeter: jarak,
      maxRadiusMeter: maxRadiusAllowed,
      totalJamKerja: kalkulasi.totalJamKerja,
      kekuranganJamKerja: kalkulasi.kekuranganJamKerja,
      totalPotongan: potFinalDisplay,
      totalPotonganAngka: kalkulasi.totalPotonganPersen,
      kodeTukin: kodeTukinFinal,
      kompensasiInfo: infoKompPulang,
      jamBatasPulang: jamBatasPulang,
      batasPulangInfo: infoBatasPulang,
      publicIp: netCheckPulang.publicIp,
      statusJaringan: netCheckPulang.statusJaringan,
      skorGps: netCheckPulang.skorGps,
      statusKeamananLokasi: netCheckPulang.statusKeamananLokasi,
      detailKalkulasi: kalkulasi
    };
  } catch (error) {
    return { success: false, message: "Gagal memproses Absen Pulang: " + error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * -----------------------------------------------------------------------------
 * 7. PENGAJUAN IZIN / CUTI / SAKIT / DINAS LUAR (SPT) + UPLOAD FOTO/PDF
 * -----------------------------------------------------------------------------
 */
function simpanPengajuanIzin(payload) {
  try {
    const dataIn = payload || {};
    const nipCheck = validateNip(dataIn.nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;

    const jenisIzin = sanitizeTextForSheet(dataIn.jenisIzin, 100);
    const tglMulai = normalizeDateStr(dataIn.tglMulai);
    const tglSelesai = normalizeDateStr(dataIn.tglSelesai);
    const keterangan = sanitizeTextForSheet(dataIn.keterangan, 1000);
    const linkDokumen = sanitizeTextForSheet(dataIn.linkDokumen || "", 500);
    const fileBase64 = String(dataIn.fileBase64 || "").trim();
    const fileName = sanitizeTextForSheet(dataIn.fileName || "", 120);

    if (!jenisIzin || !tglMulai || !tglSelesai || !keterangan) {
      return { success: false, message: "Jenis pengajuan, tanggal, dan Keterangan wajib diisi dengan lengkap!" };
    }
    if (tglSelesai < tglMulai) {
      return { success: false, message: "Tanggal selesai tidak boleh lebih awal dari tanggal mulai." };
    }

    if (containsDangerPayload(dataIn.keterangan) || containsDangerPayload(dataIn.linkDokumen)) {
      return { success: false, message: "Input pengajuan izin mengandung karakter tidak diizinkan." };
    }

    const kategori = getKategoriFromJenisIzin(jenisIzin);
    const isDokumenWajib = (kategori === "Dinas Luar" || kategori === "Cuti" || kategori === "Sakit");

    if (isDokumenWajib && !fileBase64 && !linkDokumen) {
      const labelDok = kategori === "Sakit"
        ? "Surat Keterangan Dokter (Foto/PDF)"
        : "Dokumen Pembuktian (Foto/PDF atau tautan Google Drive)";
      return {
        success: false,
        message: "Pengajuan " + jenisIzin + " WAJIB melampirkan/mengupload " + labelDok + " terlebih dahulu!"
      };
    }

    const validasiNip = getValidasiNIP(cleanNip);
    if (!validasiNip.success) return validasiNip;
    const namaPegawai = validasiNip.pegawai.nama;

    const ss = ensureDatabaseReady();
    let sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);

    const now = new Date();
    const idIzin = "IZN-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd-HHmmss");
    const waktuPengajuan = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

    let buktiLabel = linkDokumen ? "Tautan Dokumen Drive" : "Tidak Ada Lampiran";
    let dokumenUrl = linkDokumen || "";

    if (fileBase64) {
      const uploadRes = simpanDokumenKeDrive(fileBase64, fileName || ("Dokumen_" + jenisIzin), idIzin, "Dokumen_Izin_KIP_Agara");
      if (!uploadRes.success) {
        return { success: false, message: uploadRes.message };
      }
      buktiLabel = uploadRes.labelText;
      dokumenUrl = uploadRes.driveUrl;
    }

    sheetIzin.appendRow([
      idIzin,
      cleanNip,
      namaPegawai,
      jenisIzin,
      tglMulai,
      tglSelesai,
      keterangan,
      buktiLabel,
      "Menunggu Validasi Pimpinan/Kasubbag",
      waktuPengajuan,
      dokumenUrl,
      "",
      "",
      ""
    ]);
    const lastIzinRow = sheetIzin.getLastRow();
    sheetIzin.getRange(lastIzinRow, 2).setNumberFormat("@");
    if (dokumenUrl) {
      setCellLinkOrText(sheetIzin, lastIzinRow, 8, buktiLabel, dokumenUrl);
    }

    return {
      success: true,
      idIzin: idIzin,
      jenisIzin: jenisIzin,
      kategoriKehadiran: kategori,
      tglMulai: tglMulai,
      tglSelesai: tglSelesai,
      keterangan: keterangan,
      fileName: fileName || (dokumenUrl ? "Tautan Dokumen" : ""),
      dokumenUrl: dokumenUrl,
      buktiDokumen: buktiLabel,
      statusApproval: "Menunggu Validasi",
      message: "Pengajuan " + jenisIzin + " & Dokumen Pembuktian berhasil dikirim ke Verifikasi Approval Pimpinan/Kasubbag (ID: " + idIzin + "). Anda sekarang dapat mengirim Presensi."
    };
  } catch (error) {
    return { success: false, message: "Gagal mengajukan permohonan izin: " + error.toString() };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 8. MENGAMBIL REKAP RIWAYAT ABSENSI ASN
 * -----------------------------------------------------------------------------
 */
function getRekapAbsensi(nip) {
  try {
    const nipCheck = validateNip(nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const cleanNip = nipCheck.value;

    const ss = ensureDatabaseReady();
    const sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (!sheetAbsensi) {
      return { success: true, list: [], totalHadir: 0, totalPotongan: "0.00%" };
    }

    const data = sheetAbsensi.getDataRange().getValues();
    const displayData = sheetAbsensi.getDataRange().getDisplayValues();
    const kompensasiMenitCfg = getKompensasiTelatMenit(ss);
    const jamBatasPulangCfg = getJamBatasPulangWib(ss);
    const list = [];
    let akumulasiPotongan = 0.0;
    let totalHadir = 0;

    for (let i = 1; i < data.length; i++) {
      const rowNip = normalizeNipValue(displayData[i][1] || data[i][1]);
      if (rowNip === cleanNip) {
        totalHadir++;
        let tgl = normalizeDateStr(data[i][3]);
        const synced = sinkronkanBarisAbsensiHadir(sheetAbsensi, i + 1, data[i], displayData[i], kompensasiMenitCfg, jamBatasPulangCfg);
        akumulasiPotongan += synced.potonganNum;

        list.unshift({
          idAbsen: data[i][0],
          tanggal: tgl,
          jamMasuk: synced.jamMasuk || "-",
          statusKehadiran: data[i][5],
          jamPulang: synced.jamPulang || "-",
          jumlahJamKerja: synced.jumlahJamKerja || "-",
          kekuranganJamKerja: synced.kekuranganJamKerja || "-",
          potongan: synced.potonganStr || "0.00%",
          kodePotongan: synced.kodeTukin || "-",
          opsiKompensasi: synced.opsiKompensasi || "-",
          jamPulangKompensasi: synced.jamPulangKompensasi || "-",
          statusKompensasi: synced.statusKompensasi || "-",
          batasWaktuPulang: (formatJamWIB(displayData[i][30] || data[i][30]) || jamBatasPulangCfg || "18:00:00"),
          statusBatasPulang: (displayData[i][31] || data[i][31] || "-"),
          publicIp: (displayData[i][32] || data[i][32] || "-"),
          statusJaringan: (displayData[i][33] || data[i][33] || "-"),
          skorGps: (displayData[i][34] || data[i][34] || "-"),
          statusKeamananLokasi: (displayData[i][35] || data[i][35] || "-")
        });
      }
    }

    return {
      success: true,
      list: list,
      totalHadir: totalHadir,
      totalPotongan: akumulasiPotongan.toFixed(2) + "%"
    };
  } catch (error) {
    return { success: false, message: "Gagal mengambil rekap: " + error.toString() };
  }
}

/**
 * Mengambil Waktu Server Google Akurat (WIB)
 */
function getServerTime() {
  const now = new Date();
  return {
    waktu: Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm:ss"),
    tanggal: Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd"),
    hariTanggal: Utilities.formatDate(now, CONFIG.TIMEZONE, "EEEE, dd MMMM yyyy")
  };
}

/**
 * -----------------------------------------------------------------------------
 * 9. AUTENTIKASI: LOGIN USER PEGAWAI ASN & ADMIN SATKER
 * Memvalidasi input, mencegah injeksi, memeriksa koneksi database Google Sheets,
 * serta mengembalikan pesan error yang jelas jika autentikasi gagal.
 * -----------------------------------------------------------------------------
 */
function loginPegawai(nip, pin, devicePayload) {
  try {
    // 1. Validasi Keamanan Input NIP & PIN
    const nipCheck = validateNip(nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    const pinCheck = validatePin(pin);
    if (!pinCheck.valid) {
      return { success: false, message: pinCheck.message };
    }

    const cleanNip = nipCheck.value;
    const cleanPin = pinCheck.value;

    // 2. Pembatasan Percobaan Gagal
    const limitCheck = checkLoginRateLimit("NIP_" + cleanNip);
    if (!limitCheck.allowed) {
      return { success: false, message: limitCheck.message };
    }

    // 3. Pastikan Database Google Sheets Tersambung & Lookup Pegawai
    let pegawai = null;
    try {
      pegawai = getPegawaiWithPin(cleanNip);
    } catch (dbErr) {
      return {
        success: false,
        message: "Koneksi ke database Google Sheets bermasalah: " + dbErr.toString()
      };
    }

    if (!pegawai) {
      recordLoginFailure("NIP_" + cleanNip);
      return {
        success: false,
        message: "NIP (" + cleanNip + ") tidak ditemukan dalam database ASN KIP Aceh Tenggara."
      };
    }

    if (String(pegawai.status || "Aktif").trim() !== "Aktif") {
      return {
        success: false,
        message: "Status kepegawaian Anda saat ini tidak aktif (" + pegawai.status + "). Hubungi Subbagian Hukum & SDM."
      };
    }

    const expectedPin = String(pegawai.pin || "123456").trim();
    if (cleanPin !== expectedPin) {
      recordLoginFailure("NIP_" + cleanNip);
      return {
        success: false,
        message: "PIN Presensi yang Anda masukkan salah! Silakan periksa kembali PIN Anda."
      };
    }

    // 4. Verifikasi & Pengikatan ID Perangkat Android/iOS (Anti-Titip Presensi)
    const ssLogin = ensureDatabaseReady();
    const devResult = verifikasiDanIkatPerangkat(ssLogin, cleanNip, pegawai.nama, devicePayload, "LOGIN_VALID");
    if (!devResult.success) {
      return {
        success: false,
        blockedByDevice: true,
        message: devResult.message
      };
    }

    resetLoginFailure("NIP_" + cleanNip);

    // 5. Sekaligus kembalikan data validasi absensi hari ini agar dashboard langsung aktif
    const validasiData = getValidasiNIP(cleanNip);

    return {
      success: true,
      message: devResult.newlyBound
        ? "Login berhasil & perangkat " + devResult.platform + " Anda resmi didaftarkan (Anti-Titip Presensi Aktif). Selamat datang, " + pegawai.nama
        : "Login berhasil! Selamat datang, " + pegawai.nama,
      deviceBound: {
        deviceId: devResult.deviceId,
        platform: devResult.platform,
        deviceInfo: devResult.deviceInfo,
        newlyBound: devResult.newlyBound
      },
      session: {
        role: "pegawai",
        nip: String(pegawai.nip),
        nama: String(pegawai.nama),
        jabatan: String(pegawai.jabatan),
        unitKerja: String(pegawai.unitKerja),
        foto: String(pegawai.fotoProfil || ""),
        pangkatGolongan: String(pegawai.pangkatGolongan || ""),
        deviceId: devResult.deviceId,
        devicePlatform: devResult.platform
      },
      validasiData: validasiData && validasiData.success ? validasiData : null
    };
  } catch (error) {
    return { success: false, message: "Kesalahan login pegawai: " + error.toString() };
  }
}

function loginAdmin(username, password) {
  try {
    // 1. Validasi Keamanan Input Username & Password Admin
    const adminCheck = validateAdminInput(username, password);
    if (!adminCheck.valid) {
      return { success: false, message: adminCheck.message };
    }

    const cleanUser = adminCheck.username;
    const cleanPass = adminCheck.password;

    // 2. Pembatasan Percobaan Gagal
    const limitCheck = checkLoginRateLimit("ADM_" + cleanUser);
    if (!limitCheck.allowed) {
      return { success: false, message: limitCheck.message };
    }

    // 3. Verifikasi Koneksi Database Google Sheets terlebih dahulu agar Admin siap mengelola data
    try {
      ensureDatabaseReady();
    } catch (dbErr) {
      return {
        success: false,
        message: "Koneksi ke database Google Sheets gagal saat login Admin: " + dbErr.toString()
      };
    }

    // 4. Default admin Satker KIP Agara (aman meski PropertiesService belum diotorisasi penuh)
    let customUser = "admin";
    let customPass = "";
    try {
      const props = PropertiesService.getScriptProperties();
      const propUser = props.getProperty("ADMIN_USERNAME");
      const propPass = props.getProperty("ADMIN_PASSWORD");
      if (propUser) customUser = String(propUser).trim().toLowerCase();
      if (propPass) customPass = String(propPass).trim();
    } catch (propErr) {
      Logger.log("ScriptProperties fallback dipakai saat loginAdmin: " + propErr);
    }

    const isValidUser = cleanUser === customUser;
    const isValidPass = customPass
      ? cleanPass === customPass
      : (cleanPass === "AgaraJuara2026!" || cleanPass === "kipagara2026");

    if (isValidUser && isValidPass) {
      resetLoginFailure("ADM_" + cleanUser);
      const ssAdmin = ensureDatabaseReady();
      const radiusCfg = getRadiusConfigMap(ssAdmin);
      const wifiCfgAdmin = getWifiConfig(ssAdmin);
      const kompMenitAdmin = getKompensasiTelatMenit(ssAdmin);
      const jamBatasPulangAdmin = getJamBatasPulangWib(ssAdmin);
      return {
        success: true,
        message: "Autentikasi Administrator Satker Berhasil!",
        session: {
          role: "admin",
          username: customUser,
          nama: "Administrator Satker KIP Agara",
          jabatan: "Pengelola Sistem Informasi Kepegawaian & Presensi",
          unitKerja: "Sekretariat KIP Kabupaten Aceh Tenggara",
          foto: ""
        },
        radiusConfig: radiusCfg,
        wifiConfig: wifiCfgAdmin,
        kompensasiTelatMenit: kompMenitAdmin,
        jamBatasPulang: jamBatasPulangAdmin,
        antiTitipMode: getAntiTitipMode(ssAdmin),
        officeConfig: {
          latitude: CONFIG.OFFICE_LAT,
          longitude: CONFIG.OFFICE_LON,
          radiusMeter: radiusCfg["Hadir"] || CONFIG.RADIUS_METER,
          jamBatasPulang: jamBatasPulangAdmin,
          wifiConfig: wifiCfgAdmin,
          instansi: CONFIG.INSTANSI,
          kota: CONFIG.KOTA
        }
      };
    } else {
      recordLoginFailure("ADM_" + cleanUser);
      return {
        success: false,
        message: "Username atau Password Admin salah! Periksa kembali kredensial Anda."
      };
    }
  } catch (error) {
    return { success: false, message: "Kesalahan login admin: " + error.toString() };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 10. REKAPITULASI PRESENSI & TUKIN KOLEKTIF / INDIVIDU (UNTUK CETAK / PRINT)
 * -----------------------------------------------------------------------------
 */
function getRekapKolektif(periodeBulan, nipFilter, requesterRole) {
  try {
    const isAdmin = requesterRole === "admin";
    if (!isAdmin && !nipFilter) {
      return {
        success: false,
        message: "Akses ditolak! Rekapitulasi kolektif seluruh pegawai hanya dapat diakses oleh Administrator Satker."
      };
    }

    let cleanFilterNip = "";
    if (nipFilter) {
      const nipCheck = validateNip(nipFilter);
      if (!nipCheck.valid) {
        return { success: false, message: nipCheck.message };
      }
      cleanFilterNip = nipCheck.value;
    }

    const cleanPeriode = periodeBulan ? String(periodeBulan).replace(/[^0-9-]/g, "").trim() : "";

    const ss = ensureDatabaseReady();
    const sheetAbsensi = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    const sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);

    if (!sheetAbsensi || sheetAbsensi.getLastRow() <= 1) {
      return { success: true, list: [], totalHadir: 0, totalPotongan: "0.00%", pegawaiMap: {} };
    }

    const absensiData = sheetAbsensi.getDataRange().getValues();
    const absensiDisplay = sheetAbsensi.getDataRange().getDisplayValues();
    const kompensasiMenitCfg = getKompensasiTelatMenit(ss);
    const jamBatasPulangCfg = getJamBatasPulangWib(ss);
    const pegawaiMap = {};
    if (isAdmin && sheetPegawai && sheetPegawai.getLastRow() > 1) {
      const pData = sheetPegawai.getDataRange().getDisplayValues();
      for (let p = 1; p < pData.length; p++) {
        const nipKey = normalizeNipValue(pData[p][0]);
        pegawaiMap[nipKey] = {
          nip: nipKey,
          nama: String(pData[p][1]),
          jabatan: String(pData[p][2]),
          unitKerja: String(pData[p][3]),
          pangkatGol: pData[p][5] ? String(pData[p][5]) : "-",
          fotoProfil: pData[p][7] ? String(pData[p][7]) : ""
        };
      }
    }

    const filtered = [];
    let akumulasiPotongan = 0.0;

    for (let i = 1; i < absensiData.length; i++) {
      const rowNip = normalizeNipValue(absensiDisplay[i][1] || absensiData[i][1]);
      let rowTanggal = normalizeDateStr(absensiData[i][3]);

      if (cleanFilterNip && rowNip !== cleanFilterNip) {
        continue;
      }

      if (cleanPeriode && !rowTanggal.startsWith(cleanPeriode)) {
        continue;
      }

      const synced = sinkronkanBarisAbsensiHadir(sheetAbsensi, i + 1, absensiData[i], absensiDisplay[i], kompensasiMenitCfg, jamBatasPulangCfg);
      akumulasiPotongan += synced.potonganNum;

      filtered.push({
        idAbsen: absensiData[i][0],
        nip: rowNip,
        nama: absensiData[i][2],
        tanggal: rowTanggal,
        jamMasuk: synced.jamMasuk || "-",
        statusKehadiran: absensiData[i][5],
        jamPulang: synced.jamPulang || "-",
        jumlahJamKerja: synced.jumlahJamKerja || "-",
        kekuranganJamKerja: synced.kekuranganJamKerja || "-",
        potonganJamKerja: synced.potonganStr || "0.00%",
        kodePotongan: synced.kodeTukin || "-",
        opsiKompensasi: synced.opsiKompensasi || "-",
        jamPulangKompensasi: synced.jamPulangKompensasi || "-",
        statusKompensasi: synced.statusKompensasi || "-",
        batasWaktuPulang: formatJamWIB(absensiDisplay[i][30] || absensiData[i][30]) || jamBatasPulangCfg || "18:00:00",
        statusBatasPulang: absensiDisplay[i][31] || absensiData[i][31] || "-",
        publicIp: absensiDisplay[i][32] || absensiData[i][32] || "-",
        statusJaringan: absensiDisplay[i][33] || absensiData[i][33] || "-",
        skorGps: absensiDisplay[i][34] || absensiData[i][34] || "-",
        statusKeamananLokasi: absensiDisplay[i][35] || absensiData[i][35] || "-"
      });
    }

    return {
      success: true,
      list: filtered,
      totalRecord: filtered.length,
      totalPotongan: akumulasiPotongan.toFixed(2) + "%",
      pegawaiMap: pegawaiMap
    };
  } catch (error) {
    return { success: false, message: "Gagal mengambil data rekap kolektif: " + error.toString() };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 11. PENGATURAN LOGO RESMI LEMBAGA (LOGIN, HEADER & KOP SURAT REKAP)
 * -----------------------------------------------------------------------------
 */
function getAppConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const logoUrl = props.getProperty("CUSTOM_LOGO_URL") || "";
    return {
      success: true,
      logoUrl: logoUrl,
      instansi: CONFIG.INSTANSI,
      kota: CONFIG.KOTA
    };
  } catch (error) {
    return { success: false, logoUrl: "", message: error.toString() };
  }
}

function simpanLogoLembaga(logoInput, requesterRole) {
  try {
    if (requesterRole !== "admin") {
      return {
        success: false,
        message: "Akses ditolak! Hanya Administrator Satker yang berhak mengubah Logo Lembaga."
      };
    }

    const props = PropertiesService.getScriptProperties();
    const cleanInput = String(logoInput || "").trim();

    if (!cleanInput) {
      props.deleteProperty("CUSTOM_LOGO_URL");
      return {
        success: true,
        logoUrl: "",
        message: "Logo Lembaga dikembalikan ke emblem bawaan sistem."
      };
    }

    if (containsDangerPayload(cleanInput) && cleanInput.indexOf("data:image/") !== 0) {
      return {
        success: false,
        message: "URL logo mengandung pola atau protokol tidak aman."
      };
    }

    let finalUrl = cleanInput;

    if (cleanInput.indexOf("data:image/") === 0) {
      const folderName = "Foto_Presensi_KIP_Agara";
      const folders = DriveApp.getFoldersByName(folderName);
      let folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      const parts = cleanInput.split(",");
      const header = parts[0];
      const cleanBase64 = parts[1];
      let contentType = "image/png";
      const mimeMatch = header.match(/:(image\/[a-zA-Z0-9.+-]+);/);
      if (mimeMatch) contentType = mimeMatch[1];

      const decoded = Utilities.base64Decode(cleanBase64);
      const blob = Utilities.newBlob(decoded, contentType, "Logo_Resmi_KIP_Agara_" + Date.now() + ".png");
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      finalUrl = "https://lh3.googleusercontent.com/d/" + file.getId();
    } else if (/^https?:\/\//i.test(cleanInput)) {
      const driveMatch = cleanInput.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                         cleanInput.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
      if (driveMatch && driveMatch[1]) {
        finalUrl = "https://lh3.googleusercontent.com/d/" + driveMatch[1];
      }
    } else {
      return {
        success: false,
        message: "URL Logo harus diawali dengan https:// atau merupakan file gambar yang valid."
      };
    }

    props.setProperty("CUSTOM_LOGO_URL", finalUrl);

    return {
      success: true,
      logoUrl: finalUrl,
      message: "Logo Resmi Lembaga berhasil diperbarui dan diterapkan ke Login, Header, serta Kop Surat Rekap!"
    };
  } catch (error) {
    return { success: false, message: "Gagal menyimpan logo lembaga: " + error.toString() };
  }
}

/**
 * -----------------------------------------------------------------------------
 * 12. MODUL KHUSUS ADMIN SATKER: PENGATURAN RADIUS & VERIFIKASI APPROVAL
 * -----------------------------------------------------------------------------
 */
function getPengaturanRadius() {
  try {
    var ss = ensureDatabaseReady();
    var radiusConfig = getRadiusConfigMap(ss);
    var wifiConfig = getWifiConfig(ss);
    var antiTitipMode = getAntiTitipMode(ss);
    var kompensasiTelatMenit = getKompensasiTelatMenit(ss);
    var jamBatasPulang = getJamBatasPulangWib(ss);
    return {
      success: true,
      radiusConfig: radiusConfig,
      wifiConfig: wifiConfig,
      antiTitipMode: antiTitipMode,
      kompensasiTelatMenit: kompensasiTelatMenit,
      jamBatasPulang: jamBatasPulang
    };
  } catch (err) {
    return { success: false, message: "Gagal mengambil pengaturan radius: " + err.toString() };
  }
}

function simpanPengaturanRadius(payload) {
  try {
    var dataIn = payload || {};
    if (dataIn.requesterRole !== "admin") {
      return { success: false, message: "Akses ditolak! Hanya Admin Satker yang dapat mengubah pengaturan Jarak Radius." };
    }

    var keys = [
      { field: "Hadir", key: "RADIUS_HADIR", label: "Hadir di Kantor" },
      { field: "Dinas Luar", key: "RADIUS_DINAS_LUAR", label: "Dinas Luar / Tahapan Pemilu/Pilkada" },
      { field: "WFH", key: "RADIUS_WFH", label: "Work From Home (WFH)" },
      { field: "Cuti", key: "RADIUS_CUTI", label: "Cuti Tahunan / Bersalin / Alasan Penting" },
      { field: "Sakit", key: "RADIUS_SAKIT", label: "Sakit (Surat Keterangan Dokter)" }
    ];

    var parsedMap = {};
    for (var i = 0; i < keys.length; i++) {
      var kObj = keys[i];
      var rawVal = dataIn.radiusConfig ? dataIn.radiusConfig[kObj.field] : dataIn[kObj.key];
      var num = parseInt(rawVal, 10);
      if (isNaN(num) || num < 5 || num > 250000) {
        return {
          success: false,
          message: "Nilai jarak radius untuk '" + kObj.label + "' harus berupa angka antara 5 hingga 250.000 meter."
        };
      }
      parsedMap[kObj.field] = num;
    }

    if (dataIn.wifiConfig && (containsDangerPayload(dataIn.wifiConfig.wifiNama) || containsDangerPayload(dataIn.wifiConfig.allowedIps))) {
      return { success: false, message: "Input pengaturan Wi-Fi Satker mengandung karakter tidak diizinkan." };
    }

    var ss = ensureDatabaseReady();
    var sheetPengaturan = ss.getSheetByName(CONFIG.SHEET_PENGATURAN);
    if (!sheetPengaturan) {
      setupDatabase();
      sheetPengaturan = ss.getSheetByName(CONFIG.SHEET_PENGATURAN);
    }

    var nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    var adminName = sanitizeTextForSheet(dataIn.updatedBy || "Administrator Satker", 80);

    var upsertSettingRow = function(settingKey, settingVal, settingLabel, forceText) {
      var rowsCur = sheetPengaturan.getDataRange().getValues();
      var foundIdx = -1;
      for (var sr = 1; sr < rowsCur.length; sr++) {
        if (String(rowsCur[sr][0] || "").trim().toUpperCase() === settingKey) {
          foundIdx = sr + 1;
          break;
        }
      }
      var rowArr = [settingKey, settingVal, settingLabel, nowStr, adminName];
      if (foundIdx !== -1) {
        sheetPengaturan.getRange(foundIdx, 1, 1, 5).setValues([rowArr]);
        if (forceText) sheetPengaturan.getRange(foundIdx, 2).setNumberFormat("@").setValue(String(settingVal));
      } else {
        sheetPengaturan.appendRow(rowArr);
        if (forceText) sheetPengaturan.getRange(sheetPengaturan.getLastRow(), 2).setNumberFormat("@").setValue(String(settingVal));
      }
    };

    for (var j = 0; j < keys.length; j++) {
      var target = keys[j];
      upsertSettingRow(target.key, parsedMap[target.field], target.label, false);
    }

    var antiTitipMode = getAntiTitipMode(ss);
    if (typeof dataIn.antiTitipMode !== "undefined") {
      antiTitipMode = Boolean(dataIn.antiTitipMode === true || dataIn.antiTitipMode === 1 || String(dataIn.antiTitipMode) === "1" || String(dataIn.antiTitipMode) === "true");
      upsertSettingRow("ANTI_TITIP_DEVICE_MODE", antiTitipMode ? 1 : 0, "Kunci 1 Perangkat Android/iOS per NIP (1=Aktif Ketat, 0=Nonaktif)", false);
    }

    var kompensasiTelatMenit = getKompensasiTelatMenit(ss);
    if (typeof dataIn.kompensasiTelatMenit !== "undefined") {
      var parsedKomp = parseInt(dataIn.kompensasiTelatMenit, 10);
      if (isNaN(parsedKomp) || parsedKomp < 0 || parsedKomp > 60) {
        return {
          success: false,
          message: "Batas Kompensasi Keterlambatan harus berupa angka antara 0 hingga 60 menit."
        };
      }
      kompensasiTelatMenit = parsedKomp;
      upsertSettingRow("KOMPENSASI_TELAT_MENIT", kompensasiTelatMenit, "Batas Kompensasi Keterlambatan (Menit)", false);
    }

    var wifiConfig = getWifiConfig(ss);
    if (dataIn.wifiConfig && typeof dataIn.wifiConfig === "object") {
      var wc = dataIn.wifiConfig;
      if (typeof wc.wifiMode !== "undefined") {
        wifiConfig.wifiMode = Boolean(wc.wifiMode === true || wc.wifiMode === 1 || String(wc.wifiMode) === "1" || String(wc.wifiMode) === "true");
        upsertSettingRow("WIFI_KANTOR_MODE", wifiConfig.wifiMode ? 1 : 0, "Wajib Jaringan Wi-Fi Satker saat Hadir di Kantor (1=Aktif Ketat, 0=Nonaktif)", false);
      }
      if (typeof wc.wifiNama === "string") {
        wifiConfig.wifiNama = sanitizeTextForSheet(wc.wifiNama || "Wi-Fi Kantor KIP Aceh Tenggara", 100);
        upsertSettingRow("WIFI_KANTOR_NAMA", wifiConfig.wifiNama, "Nama SSID / Jaringan Wi-Fi Resmi Satker", true);
      }
      if (typeof wc.allowedIps === "string") {
        var cleanIps = String(wc.allowedIps || "").replace(/[^0-9a-fA-F.:*\/,;\s-]/g, "").trim().substring(0, 300);
        wifiConfig.allowedIps = cleanIps;
        upsertSettingRow("WIFI_KANTOR_IPS", cleanIps, "Daftar IP Publik / Prefix CIDR Wi-Fi Satker (pisah koma)", true);
      }
      if (typeof wc.fakeGpsCheckMode !== "undefined") {
        wifiConfig.fakeGpsCheckMode = Boolean(wc.fakeGpsCheckMode === true || wc.fakeGpsCheckMode === 1 || String(wc.fakeGpsCheckMode) === "1" || String(wc.fakeGpsCheckMode) === "true");
        upsertSettingRow("FAKE_GPS_CHECK_MODE", wifiConfig.fakeGpsCheckMode ? 1 : 0, "Deteksi Anomali Fake GPS Multi-Lapis (1=Aktif, 0=Nonaktif)", false);
      }
    }

    SpreadsheetApp.flush();
    return {
      success: true,
      radiusConfig: parsedMap,
      wifiConfig: wifiConfig,
      antiTitipMode: antiTitipMode,
      kompensasiTelatMenit: kompensasiTelatMenit,
      message: "Pengaturan Radius, Anti-Titip Perangkat, Kompensasi (" + kompensasiTelatMenit + " Menit), Wi-Fi Satker & Anti-Fake GPS berhasil disimpan!"
    };
  } catch (err) {
    return { success: false, message: "Gagal menyimpan pengaturan radius: " + err.toString() };
  }
}

function getDaftarVerifikasiApproval(filterStatus, filterTipe, requesterRole) {
  try {
    if (requesterRole !== "admin") {
      return { success: false, message: "Akses ditolak! Menu Verifikasi Approval hanya untuk Admin / Pimpinan / Kasubbag." };
    }

    var ss = ensureDatabaseReady();
    var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
    var pegawaiMap = {};
    if (sheetPegawai && sheetPegawai.getLastRow() > 1) {
      var pRows = sheetPegawai.getDataRange().getDisplayValues();
      for (var p = 1; p < pRows.length; p++) {
        var pNip = normalizeNipValue(pRows[p][0]);
        pegawaiMap[pNip] = {
          nama: String(pRows[p][1] || ""),
          jabatan: String(pRows[p][2] || ""),
          unitKerja: String(pRows[p][3] || "")
        };
      }
    }

    var allItems = [];

    // 1. Ambil seluruh pengajuan Sakit, Cuti, Dinas Luar dari sheet Pengajuan_Izin
    var sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);
    if (sheetIzin && sheetIzin.getLastRow() > 1) {
      var iv = sheetIzin.getDataRange().getValues();
      var idisp = sheetIzin.getDataRange().getDisplayValues();
      for (var i = 1; i < iv.length; i++) {
        var rNip = normalizeNipValue(idisp[i][1] || iv[i][1]);
        var jenis = String(idisp[i][3] || iv[i][3] || "").trim();
        var kategori = getKategoriFromJenisIzin(jenis);
        if (kategori !== "Sakit" && kategori !== "Cuti" && kategori !== "Dinas Luar") continue;

        var infoPeg = pegawaiMap[rNip] || {};
        var stApproval = normalizeStatusApproval(idisp[i][8] || iv[i][8]);
        allItems.push({
          sumber: "IZIN",
          idRef: String(iv[i][0] || ""),
          nip: rNip,
          nama: String(idisp[i][2] || iv[i][2] || infoPeg.nama || "-"),
          jabatan: infoPeg.jabatan || "-",
          unitKerja: infoPeg.unitKerja || "-",
          jenis: jenis,
          kategori: kategori,
          tglMulai: normalizeDateStr(iv[i][4]),
          tglSelesai: normalizeDateStr(iv[i][5]),
          keterangan: String(idisp[i][6] || iv[i][6] || ""),
          dokumenLabel: String(idisp[i][7] || iv[i][7] || "Dokumen Terlampir"),
          dokumenUrl: String(idisp[i][10] || iv[i][10] || ""),
          statusApproval: stApproval,
          diverifikasiOleh: String(idisp[i][11] || iv[i][11] || ""),
          catatanApproval: String(idisp[i][12] || iv[i][12] || ""),
          waktuVerifikasi: String(idisp[i][13] || iv[i][13] || ""),
          waktuKirim: String(idisp[i][9] || iv[i][9] || ""),
          dampakTukin: stApproval === "Ditolak" ? "1.50% (Izin Kepentingan Pribadi)" : "0.00%"
        });
      }
    }

    // 2. Ambil seluruh catatan Work From Home (WFH) & LKH dari sheet Absensi
    var sheetAbs = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
    if (sheetAbs && sheetAbs.getLastRow() > 1) {
      var av = sheetAbs.getDataRange().getValues();
      var ad = sheetAbs.getDataRange().getDisplayValues();
      for (var j = 1; j < av.length; j++) {
        var statusK = String(ad[j][5] || av[j][5] || "").trim();
        var catApp = String(ad[j][21] || av[j][21] || "").trim();
        var isWfh = (statusK === "WFH" || catApp.indexOf("WFH") !== -1);
        if (!isWfh) continue;

        var aNip = normalizeNipValue(ad[j][1] || av[j][1]);
        var aPeg = pegawaiMap[aNip] || {};
        var tglAbs = normalizeDateStr(av[j][3]);
        var jamIn = formatJamWIB(av[j][4]);
        var jamOut = formatJamWIB(av[j][9]);
        var lkhLabel = String(ad[j][17] || av[j][17] || "").trim();
        var lkhUrl = String(ad[j][18] || av[j][18] || "").trim();
        var lkhKet = String(ad[j][19] || av[j][19] || "").trim();
        var stWfh = normalizeStatusApproval(ad[j][20] || av[j][20] || "Menunggu Validasi");

        allItems.push({
          sumber: "WFH",
          idRef: String(av[j][0] || ""),
          nip: aNip,
          nama: String(ad[j][2] || av[j][2] || aPeg.nama || "-"),
          jabatan: aPeg.jabatan || "-",
          unitKerja: aPeg.unitKerja || "-",
          jenis: "Work From Home (WFH)",
          kategori: "WFH",
          tglMulai: tglAbs,
          tglSelesai: tglAbs,
          keterangan: lkhKet || ("Presensi WFH: Masuk " + (jamIn || "-") + " WIB | Pulang " + (jamOut || "Belum Pulang")),
          dokumenLabel: lkhLabel || "LKH Belum Diupload",
          dokumenUrl: lkhUrl,
          statusApproval: stWfh,
          diverifikasiOleh: String(ad[j][22] || av[j][22] || ""),
          catatanApproval: catApp,
          waktuVerifikasi: "",
          waktuKirim: tglAbs + " " + (jamIn || "00:00:00"),
          dampakTukin: stWfh === "Ditolak" ? "1.50% (Izin Kepentingan Pribadi)" : "0.00%"
        });
      }
    }

    // Urutkan terbaru dahulu
    allItems.sort(function(a, b) {
      return String(b.waktuKirim || "").localeCompare(String(a.waktuKirim || ""));
    });

    var counts = { total: allItems.length, menunggu: 0, disetujui: 0, ditolak: 0 };
    for (var c = 0; c < allItems.length; c++) {
      if (allItems[c].statusApproval === "Disetujui") counts.disetujui++;
      else if (allItems[c].statusApproval === "Ditolak") counts.ditolak++;
      else counts.menunggu++;
    }

    var fStatus = String(filterStatus || "SEMUA").trim();
    var fTipe = String(filterTipe || "SEMUA").trim();
    var filtered = allItems.filter(function(item) {
      if (fStatus !== "SEMUA" && item.statusApproval !== fStatus) return false;
      if (fTipe !== "SEMUA" && item.kategori !== fTipe) return false;
      return true;
    });

    return {
      success: true,
      list: filtered,
      counts: counts
    };
  } catch (err) {
    return { success: false, message: "Gagal memuat daftar Verifikasi Approval: " + err.toString() };
  }
}

function verifikasiApprovalDokumen(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var dataIn = payload || {};
    if (dataIn.requesterRole !== "admin") {
      return { success: false, message: "Akses ditolak! Hanya Admin / Pimpinan / Kasubbag yang berhak memvalidasi dokumen." };
    }

    var sumber = String(dataIn.sumber || "").trim().toUpperCase();
    var idRef = sanitizeTextForSheet(dataIn.idRef || "", 80);
    var keputusan = String(dataIn.keputusan || "").trim();
    var catatan = sanitizeTextForSheet(dataIn.catatan || "", 500);
    var verifikator = sanitizeTextForSheet(dataIn.verifikator || "Pimpinan / Kasubbag (Admin Satker)", 100);

    if (!idRef || (keputusan !== "Disetujui" && keputusan !== "Ditolak")) {
      return { success: false, message: "Parameter verifikasi tidak valid (pilih Disetujui atau Ditolak)." };
    }
    if (containsDangerPayload(dataIn.catatan) || containsDangerPayload(dataIn.verifikator)) {
      return { success: false, message: "Input catatan verifikasi mengandung karakter tidak diizinkan." };
    }

    var ss = ensureDatabaseReady();
    var nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    var isRejected = (keputusan === "Ditolak");

    if (sumber === "IZIN") {
      var sheetIzin = ss.getSheetByName(CONFIG.SHEET_IZIN);
      if (!sheetIzin || sheetIzin.getLastRow() <= 1) {
        return { success: false, message: "Data Pengajuan_Izin tidak ditemukan." };
      }

      var iv = sheetIzin.getDataRange().getValues();
      var idisp = sheetIzin.getDataRange().getDisplayValues();
      var targetRow = -1;
      var targetNip = "";
      var targetJenis = "";
      var tglM = "";
      var tglS = "";

      for (var i = 1; i < iv.length; i++) {
        if (String(iv[i][0] || "").trim() === idRef) {
          targetRow = i + 1;
          targetNip = normalizeNipValue(idisp[i][1] || iv[i][1]);
          targetJenis = String(idisp[i][3] || iv[i][3] || "").trim();
          tglM = normalizeDateStr(iv[i][4]);
          tglS = normalizeDateStr(iv[i][5]);
          break;
        }
      }

      if (targetRow === -1) {
        return { success: false, message: "ID Pengajuan Izin (" + idRef + ") tidak ditemukan." };
      }

      var statusValidasiText = isRejected
        ? "Ditolak (Izin Kepentingan Pribadi 1.50%)"
        : "Disetujui (" + targetJenis + " 0.00%)";

      sheetIzin.getRange(targetRow, 9).setValue(statusValidasiText);
      sheetIzin.getRange(targetRow, 12).setValue(verifikator);
      sheetIzin.getRange(targetRow, 13).setValue(catatan || (isRejected ? "Dokumen tidak sesuai -> Dialihkan ke Izin Kepentingan Pribadi (1.50%)" : "Dokumen pembuktian valid & disetujui."));
      sheetIzin.getRange(targetRow, 14).setValue(nowStr);

      // Sinkronkan dampak Tukin & status ke sheet Absensi pada rentang tanggal izin
      var sheetAbs = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
      if (sheetAbs && sheetAbs.getLastRow() > 1 && targetNip && tglM && tglS) {
        var av = sheetAbs.getDataRange().getValues();
        var ad = sheetAbs.getDataRange().getDisplayValues();
        var kategori = getKategoriFromJenisIzin(targetJenis);
        for (var a = 1; a < av.length; a++) {
          var aNip = normalizeNipValue(ad[a][1] || av[a][1]);
          var aTgl = normalizeDateStr(av[a][3]);
          if (aNip === targetNip && aTgl >= tglM && aTgl <= tglS) {
            var aRow = a + 1;
            var statusBaru = isRejected ? "Izin Kepentingan Pribadi" : kategori;
            var potBaru = isRejected ? "1.50% (IZIN)" : "0.00%";
            var kodeBaru = isRejected ? "IZIN" : kategori.toUpperCase();
            var ketBaru = isRejected
              ? ("Ditolak -> Izin Kepentingan Pribadi (1.50%) | " + (catatan || "Bukti dukung ditolak"))
              : ("Disetujui (" + targetJenis + ") | " + (catatan || "Terverifikasi"));
            sheetAbs.getRange(aRow, 6).setValue(statusBaru);
            sheetAbs.getRange(aRow, 16).setNumberFormat("@").setValue(potBaru);
            sheetAbs.getRange(aRow, 21).setValue(keputusan);
            sheetAbs.getRange(aRow, 22).setValue(ketBaru);
            sheetAbs.getRange(aRow, 23).setValue(verifikator + " (" + nowStr + ")");
            if (sheetAbs.getLastColumn() >= 37) {
              sheetAbs.getRange(aRow, 37).setNumberFormat("@").setValue(kodeBaru);
            }
          }
        }
      }

      SpreadsheetApp.flush();
      return {
        success: true,
        keputusan: keputusan,
        dampakTukin: isRejected ? "1.50%" : "0.00%",
        message: isRejected
          ? "Dokumen " + targetJenis + " ditolak. Sistem otomatis menerapkan Status 'Izin Kepentingan Pribadi' (Potongan Tukin 1.50%) dan meneruskannya ke Dashboard Pegawai."
          : "Dokumen " + targetJenis + " berhasil DISETUJUI (Potongan Tukin 0.00%) dan diteruskan ke Dashboard Pegawai."
      };
    } else if (sumber === "WFH") {
      var sheetAbsWfh = ss.getSheetByName(CONFIG.SHEET_ABSENSI);
      if (!sheetAbsWfh || sheetAbsWfh.getLastRow() <= 1) {
        return { success: false, message: "Data Absensi WFH tidak ditemukan." };
      }

      var wv = sheetAbsWfh.getDataRange().getValues();
      var wRow = -1;
      for (var w = 1; w < wv.length; w++) {
        if (String(wv[w][0] || "").trim() === idRef) {
          wRow = w + 1;
          break;
        }
      }
      if (wRow === -1) {
        return { success: false, message: "Data Presensi WFH (" + idRef + ") tidak ditemukan." };
      }

      var statusWfhBaru = isRejected ? "Izin Kepentingan Pribadi" : "WFH";
      var potWfhBaru = isRejected ? "1.50% (IZIN)" : "0.00%";
      var kodeWfhBaru = isRejected ? "IZIN" : "WFH";
      var catWfhBaru = isRejected
        ? ("WFH Ditolak -> Izin Kepentingan Pribadi (1.50%) | " + (catatan || "Bukti LKH WFH ditolak"))
        : ("WFH Disetujui | " + (catatan || "LKH terverifikasi"));

      sheetAbsWfh.getRange(wRow, 6).setValue(statusWfhBaru);
      sheetAbsWfh.getRange(wRow, 16).setNumberFormat("@").setValue(potWfhBaru);
      sheetAbsWfh.getRange(wRow, 21).setValue(keputusan);
      sheetAbsWfh.getRange(wRow, 22).setValue(catWfhBaru);
      sheetAbsWfh.getRange(wRow, 23).setValue(verifikator + " (" + nowStr + ")");
      if (sheetAbsWfh.getLastColumn() >= 37) {
        sheetAbsWfh.getRange(wRow, 37).setNumberFormat("@").setValue(kodeWfhBaru);
      }

      SpreadsheetApp.flush();
      return {
        success: true,
        keputusan: keputusan,
        dampakTukin: potWfhBaru,
        message: isRejected
          ? "Bukti WFH/LKH ditolak. Aturan Tukin membaca pegawai sebagai 'Izin Kepentingan Pribadi' (1.50%) dan hasil diteruskan ke Dashboard Pegawai."
          : "Bukti WFH/LKH berhasil DISETUJUI (Potongan Tukin 0.00%) dan diteruskan ke Dashboard Pegawai."
      };
    }

    return { success: false, message: "Sumber data approval tidak dikenali." };
  } catch (err) {
    return { success: false, message: "Gagal memproses verifikasi approval: " + err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * -----------------------------------------------------------------------------
 * 13. MODUL ADMIN SATKER: MANAJEMEN PERANGKAT ANDROID/iOS & LOG ANTI-TITIP
 * -----------------------------------------------------------------------------
 */
function getDaftarPerangkatAdmin(requesterRole) {
  try {
    if (requesterRole !== "admin") {
      return { success: false, message: "Akses ditolak! Hanya Admin Satker yang dapat mengelola daftar perangkat ASN." };
    }

    var ss = ensureDatabaseReady();
    var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
    var pegawaiDevices = [];
    var terikatCount = 0;
    var belumCount = 0;

    if (sheetPegawai && sheetPegawai.getLastRow() > 1) {
      var rows = sheetPegawai.getDataRange().getDisplayValues();
      for (var i = 1; i < rows.length; i++) {
        var rNip = normalizeNipValue(rows[i][0]);
        if (!rNip) continue;
        var devId = String(rows[i][8] || "").trim();
        var plat = String(rows[i][9] || "").trim();
        var info = String(rows[i][10] || "").trim();
        var fp = String(rows[i][11] || "").trim();
        var lastLog = String(rows[i][12] || "").trim();
        if (devId) terikatCount++;
        else belumCount++;

        pegawaiDevices.push({
          nip: rNip,
          nama: String(rows[i][1] || ""),
          jabatan: String(rows[i][2] || ""),
          unitKerja: String(rows[i][3] || ""),
          deviceId: devId,
          platform: plat || "-",
          deviceInfo: info || "-",
          fingerprint: fp || "-",
          lastLogin: lastLog || "-",
          statusTerikat: devId ? "Terikat" : "Belum Terdaftar"
        });
      }
    }

    var securityLogs = [];
    var blockedCount = 0;
    var sheetDev = ss.getSheetByName(CONFIG.SHEET_PERANGKAT);
    if (sheetDev && sheetDev.getLastRow() > 1) {
      var dRows = sheetDev.getDataRange().getDisplayValues();
      for (var j = dRows.length - 1; j >= 1; j--) {
        var stSec = String(dRows[j][9] || "").trim();
        if (stSec === "DIBLOKIR") blockedCount++;
        if (securityLogs.length < 40) {
          securityLogs.push({
            idLog: String(dRows[j][0] || ""),
            waktu: String(dRows[j][1] || ""),
            nip: normalizeNipValue(dRows[j][2]),
            nama: String(dRows[j][3] || ""),
            deviceId: String(dRows[j][4] || ""),
            platform: String(dRows[j][5] || ""),
            deviceInfo: String(dRows[j][6] || ""),
            aksi: String(dRows[j][8] || ""),
            statusKeamanan: stSec,
            keterangan: String(dRows[j][10] || "")
          });
        }
      }
    }

    var deployUrl = "";
    try {
      deployUrl = ScriptApp.getService().getUrl() || "";
    } catch (uErr) {
      deployUrl = "";
    }

    return {
      success: true,
      pegawaiDevices: pegawaiDevices,
      securityLogs: securityLogs,
      antiTitipMode: getAntiTitipMode(ss),
      deployUrl: deployUrl,
      counts: {
        totalPegawai: pegawaiDevices.length,
        terikat: terikatCount,
        belumTerikat: belumCount,
        percobaanDiblokir: blockedCount
      }
    };
  } catch (err) {
    return { success: false, message: "Gagal memuat daftar perangkat ASN: " + err.toString() };
  }
}

function resetPerangkatPegawai(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var dataIn = payload || {};
    if (dataIn.requesterRole !== "admin") {
      return { success: false, message: "Akses ditolak! Hanya Admin Satker yang dapat melakukan reset perangkat ASN." };
    }

    var nipCheck = validateNip(dataIn.nip);
    if (!nipCheck.valid) {
      return { success: false, message: nipCheck.message };
    }
    var cleanNip = nipCheck.value;
    var adminName = sanitizeTextForSheet(dataIn.adminName || "Administrator Satker", 80);

    var ss = ensureDatabaseReady();
    var sheetPegawai = ss.getSheetByName(CONFIG.SHEET_PEGAWAI);
    if (!sheetPegawai || sheetPegawai.getLastRow() <= 1) {
      return { success: false, message: "Sheet Pegawai tidak ditemukan." };
    }

    var rows = sheetPegawai.getDataRange().getDisplayValues();
    var targetRow = -1;
    var targetNama = "";
    var oldDeviceId = "";
    var oldPlatform = "";

    for (var i = 1; i < rows.length; i++) {
      if (normalizeNipValue(rows[i][0]) === cleanNip) {
        targetRow = i + 1;
        targetNama = String(rows[i][1] || "");
        oldDeviceId = String(rows[i][8] || "").trim();
        oldPlatform = String(rows[i][9] || "").trim();
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "NIP " + cleanNip + " tidak ditemukan di database Pegawai." };
    }

    sheetPegawai.getRange(targetRow, 9, 1, 5).setValues([["", "", "", "", ""]]);
    catatLogPerangkat(ss, {
      nip: cleanNip,
      nama: targetNama,
      deviceId: oldDeviceId || "-",
      platform: oldPlatform || "-",
      deviceInfo: "Direset oleh Admin",
      fingerprint: "-",
      aksi: "RESET_OLEH_ADMIN",
      statusKeamanan: "DIRESET",
      keterangan: "Ikatan perangkat lama (" + (oldDeviceId || "-") + ") direset oleh " + adminName + " agar pegawai dapat mendaftarkan HP Android/iOS baru."
    });

    SpreadsheetApp.flush();
    return {
      success: true,
      message: "Ikatan perangkat untuk " + targetNama + " (NIP: " + cleanNip + ") berhasil direset! Pegawai dapat login ulang menggunakan HP Android/iOS barunya."
    };
  } catch (err) {
    return { success: false, message: "Gagal mereset perangkat pegawai: " + err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
