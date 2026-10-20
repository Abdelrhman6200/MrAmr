// Reads an uploaded .xlsx / .csv into { columns, rows } where rows are objects
// keyed by the header row, and guesses which columns hold name/phone/email.

export async function readSpreadsheet(file) {
  const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';
  let grid;
  if (isCsv) {
    grid = parseCsv(await file.text());
  } else {
    // Loaded on demand so the Excel reader only downloads for people who upload.
    const { readSheet } = await import('read-excel-file/browser');
    grid = await readSheet(file);
  }
  grid = grid.map((row) => row.map(cellText)).filter((row) => row.some((c) => c !== ''));
  if (!grid.length) return { columns: [], rows: [] };

  const columns = uniqueHeaders(grid[0]);
  const rows = grid.slice(1).map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i] ?? ''])));
  return { columns, rows };
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
}

function uniqueHeaders(row) {
  const seen = new Map();
  return row.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
}

// RFC 4180-ish: quoted fields, escaped quotes, CRLF, BOM; detects ; or tab delimiters.
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const GUESSES = {
  name: [/^name$/i, /full.?name/i, /student/i, /customer/i, /client/i, /contact/i, /الاسم/, /اسم/, /name/i],
  phone: [/phone/i, /mobile/i, /^tel/i, /whats.?app/i, /number/i, /هاتف/, /موبايل/, /جوال/, /تليفون/, /رقم/],
  email: [/e-?mail/i, /بريد/, /ايميل|إيميل/],
};

export function guessColumns(columns, rows = []) {
  const pick = (patterns, taken) => {
    for (const re of patterns) {
      const c = columns.find((col) => re.test(col) && !taken.includes(col));
      if (c) return c;
    }
    return '';
  };
  const name = pick(GUESSES.name, []);
  let phone = pick(GUESSES.phone, [name]);
  // Fall back to the column whose values look most like phone numbers.
  if (!phone && rows.length) {
    const score = (c) => rows.slice(0, 20).filter((r) => /^\+?[\d\s()-]{7,}$/.test(r[c] || '')).length;
    const best = columns.filter((c) => c !== name).sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) > 0) phone = best;
  }
  const email = pick(GUESSES.email, [name, phone]);
  return { name, phone, email };
}

export function toCsv(columns, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  // BOM so Excel opens Arabic text correctly.
  return '﻿' + [columns, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
