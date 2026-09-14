/**
 * Section naming utility.
 * Generates sequential section names (e.g. Section A, Section B, Section C...)
 * based on existing sections, automatically finding the first unused sequential letter
 * to avoid duplicates and fill gaps.
 */
export const getNextSectionName = (existingSections = []) => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const usedLetters = new Set();
  const existingNamesLower = new Set(
    existingSections.map(s => (s && s.name ? s.name.trim().toLowerCase() : ''))
  );

  for (const s of existingSections) {
    if (!s || !s.name) continue;
    const match = s.name.trim().match(/\b([A-Za-z])\b/) || s.name.trim().match(/([A-Za-z])$/);
    if (match) {
      usedLetters.add(match[1].toUpperCase());
    }
  }

  for (const letter of letters) {
    const candidate = `Section ${letter}`;
    if (!usedLetters.has(letter) && !existingNamesLower.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `Section ${existingSections.length + 1}`;
};
