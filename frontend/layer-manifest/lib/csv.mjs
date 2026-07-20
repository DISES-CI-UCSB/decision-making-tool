export function parseCsv(raw) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

export function parseCsvRow(line) {
  return (parseCsv(line)[0] ?? []).map((field) => field.trim());
}

export function rowsToObjects(parsedRows, columnAliases = {}) {
  const [headers = [], ...records] = parsedRows;
  const keys = headers.map((header) => mapHeader(header, columnAliases));

  return records.map((record) => {
    const row = {};
    keys.forEach((key, index) => {
      row[key] = normalizeCsvCell(record[index] ?? '');
    });
    return row;
  });
}

export function toCsv(rows) {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function mapHeader(header, columnAliases) {
  const normalized = header.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const [key, aliases] of Object.entries(columnAliases)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return key;
    }
  }
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeCsvCell(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '');
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}
