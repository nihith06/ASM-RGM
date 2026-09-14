const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function normalizeDay(str) {
  if (!str) return null;
  const clean = str.trim().toLowerCase();
  for (const d of VALID_DAYS) {
    if (d.toLowerCase() === clean || clean.startsWith(d.toLowerCase().slice(0, 3))) {
      return d;
    }
  }
  return null;
}

function parsePeriodNumber(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  const clean = str.replace(/^(hour|period)\s*/i, '').trim();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && String(num) === clean && num >= 1 && num <= 7) {
    return num;
  }
  return null;
}

function splitCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^["']|["']$/g, ''));
  return result;
}

/**
 * Flexible timetable parser supporting:
 * 1. Standard CSV row format: Day,Period/Hour,Subject,Faculty,Room
 * 2. Grid Matrix CSV format: Day,Hour 1,Hour 2,...,Hour 7
 * 3. JSON format: [{ day, period, subject, faculty_name, room }] or { cells: [...] }
 */
export function parseTimetableContent(text, fileName = '') {
  if (!text || typeof text !== 'string') {
    throw new Error('File content is empty or unreadable.');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('File is empty.');
  }

  // 1. Check for JSON format
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const cells = Array.isArray(data) ? data : (data.cells || []);
      if (Array.isArray(cells) && cells.length > 0) {
        const parsed = [];
        for (const item of cells) {
          const rawDay = (item.day || item.Day || '').trim();
          const rawPeriod = (item.period !== undefined ? item.period : (item.Period !== undefined ? item.Period : (item.hour !== undefined ? item.hour : item.Hour)));
          const day = normalizeDay(rawDay);
          const period = parsePeriodNumber(rawPeriod);
          const sub = (item.subject || item.Subject || '').trim();
          const fac = (item.faculty_name || item.faculty || item.Faculty || '').trim();
          const rm = (item.room || item.Room || '').trim();

          parsed.push({
            day: day || rawDay,
            period: period !== null ? period : rawPeriod,
            subject: sub || '—',
            faculty_name: fac || '—',
            room: rm
          });
        }
        if (parsed.length > 0) return parsed;
      }
    } catch (e) {
      // Not valid JSON, proceed to CSV parser
    }
  }

  // 2. CSV / Plain Text parser
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    throw new Error('No timetable rows found in file.');
  }

  // Detect delimiter
  const firstLine = lines[0];
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';

  const rows = lines.map(line => splitCsvLine(line, delimiter));

  // Check if Header exists
  let startIndex = 0;
  const headerParts = rows[0].map(h => h.toLowerCase());
  const hasHeader = headerParts.some(h => h.includes('day') || h.includes('hour') || h.includes('period') || h.includes('subject'));

  // Detect if Matrix layout (multiple period columns like Hour 1, Hour 2, etc., and no 'subject' column)
  const isMatrix = hasHeader && 
    !headerParts.includes('subject') && 
    !headerParts.includes('faculty') &&
    headerParts.filter(h => h.includes('hour') || h.includes('period') || /^[1-7]$/.test(h)).length > 1;
  const parsedCells = [];

  if (isMatrix && rows.length > 1) {
    // Map column indices to periods
    const colToPeriod = {};
    for (let c = 1; c < headerParts.length; c++) {
      const p = parsePeriodNumber(headerParts[c]);
      if (p) colToPeriod[c] = p;
    }

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rawDay = (row[0] || '').trim();
      if (!rawDay) continue;
      const day = normalizeDay(rawDay);

      for (let c = 1; c < row.length; c++) {
        const period = colToPeriod[c] || c;
        const cellStr = (row[c] || '').trim();
        let subject = '—';
        let faculty_name = '—';
        let room = '';

        if (cellStr && cellStr !== '-' && cellStr !== '—') {
          // Check patterns like: "Subject (Faculty)" or "Subject - Faculty"
          const parenMatch = cellStr.match(/^(.+?)\s*\((.+?)\)$/);
          if (parenMatch) {
            subject = parenMatch[1].trim();
            faculty_name = parenMatch[2].trim();
          } else if (cellStr.includes(' - ')) {
            const dashParts = cellStr.split(' - ');
            subject = dashParts[0].trim();
            faculty_name = dashParts[1].trim();
          } else {
            subject = cellStr;
          }
        }

        parsedCells.push({
          day: day || rawDay,
          period,
          subject: subject || '—',
          faculty_name: faculty_name || '—',
          room
        });
      }
    }
  } else {
    // Standard row-by-row format: Day,Period/Hour,Subject,Faculty,Room
    startIndex = hasHeader ? 1 : 0;
    for (let i = startIndex; i < rows.length; i++) {
      const parts = rows[i];
      // Skip completely empty lines, instruction labels, or single non-data tokens
      if (parts.length < 2) continue;
      const lower0 = parts[0].toLowerCase();
      if (lower0.includes('format:') || lower0.includes('example:')) continue;
      if (lower0 === 'day' && parts[1] && (parts[1].toLowerCase().includes('hour') || parts[1].toLowerCase().includes('period'))) continue;

      const rawDay = (parts[0] || '').trim();
      const rawPeriod = (parts[1] || '').trim();
      const day = normalizeDay(rawDay);
      const period = parsePeriodNumber(rawPeriod);

      const subject = parts[2] ? parts[2].trim() : '';
      const faculty_name = parts[3] ? parts[3].trim() : '';
      const room = parts[4] ? parts[4].trim() : '';

      parsedCells.push({
        day: day || rawDay,
        period: period !== null ? period : rawPeriod,
        subject: subject || '—',
        faculty_name: faculty_name || '—',
        room
      });
    }
  }

  if (parsedCells.length === 0) {
    throw new Error('No valid timetable slots found in uploaded file. Format: Day,Hour,Subject,Faculty,Room');
  }

  return parsedCells;
}
