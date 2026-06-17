// ECU part number → car/engine lookup.
//
// Nissan ECU part numbers are "23710-" plus a 5-char suffix. The suffix is
// specific to engine/chassis/year/transmission, and the first three chars
// identify the family, so we match exact suffixes first, then prefixes.
//
// This table is community-sourced and intentionally small — add your own
// cars as you identify them. Suffix keys are uppercase, without "23710-".

const EXACT = {
  '04U00': 'RB20DET — R32 Skyline (MT)',
  '04U01': 'RB20DET — R32 Skyline (MT)',
  '21U60': 'RB25DET — R33 Skyline',
  '21U01': 'RB25DET — R33 Skyline',
  '24U00': 'RB26DETT — R33 GT-R (BCNR33)',
  '24U01': 'RB26DETT — R33 GT-R (BCNR33)',
  '0A903': 'RB26DETT — Stagea 260RS Autech (WGNC34)',
};

const PREFIX = {
  '04U': 'RB20DET — R32 Skyline',
  '05U': 'RB26DETT — R32 GT-R (BNR32)',
  '21U': 'RB25DET — R33 Skyline',
  '24U': 'RB26DETT — R33 GT-R (BCNR33)',
  '53F': 'KA24DE — S13 240SX (1991–94)',
  '54F': 'KA24DE — S13 240SX (1991–94)',
  '70F': 'KA24DE — S14 240SX (1995)',
  '72F': 'KA24DE — S14 240SX (1996)',
  '81F': 'KA24DE — S14 240SX (1997–98)',
  '0A9': 'RB26DETT — Stagea 260RS Autech (WGNC34)',
};

function lookupEcu(partNumber) {
  if (!partNumber) return null;
  const suffix = partNumber.replace(/^23710-?/i, '').trim().toUpperCase();
  if (EXACT[suffix]) return EXACT[suffix];
  const prefix = suffix.slice(0, 3);
  if (PREFIX[prefix]) return `${PREFIX[prefix]} (family match)`;
  return null;
}

module.exports = { lookupEcu };
