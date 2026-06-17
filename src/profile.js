// Profiles: per-vehicle monitor presets for cars we've actually scanned and
// characterized. Keyed by ECU part-number suffix (exact first, then the 3-char
// family prefix), the same scheme as ecu-db.js. When a connected ECU matches,
// the UI pre-selects this car's Live data sensors and switch/flag registers.
//
// Each preset's selection must fit the Consult 20-byte stream budget (16-bit
// sensors cost 2 bytes, 8-bit sensors and flag registers 1 byte each).

const PROFILES = {
  // Stagea 260RS Autech (WGNC34), RB26DETT. Monitor set chosen from a full
  // 0x00–0xFF register scan that confirmed 27 supported registers. Favors the
  // twin-bank channels (both MAF / O2 / A-F alpha) since bank balance is the
  // useful thing to watch on the RB26. 15 sensor bytes + 4 flag bytes = 19/20.
  '0A903': {
    name: 'Stagea 260RS (RB26DETT)',
    sensors: [
      'rpm', 'maf', 'maf_rh', 'coolant', 'tps', 'timing',
      'o2', 'o2_rh', 'alpha', 'alpha_rh', 'battery', 'aac',
    ],
    flags: [0x13, 0x1e, 0x1f, 0x21],
  },
};

// Family-prefix fallbacks: other revisions of the same car share the preset.
const PREFIX = {
  '0A9': '0A903',
};

function lookupProfile(partNumber) {
  if (!partNumber) return null;
  const suffix = partNumber.replace(/^23710-?/i, '').trim().toUpperCase();
  if (PROFILES[suffix]) return PROFILES[suffix];
  const key = PREFIX[suffix.slice(0, 3)];
  return key ? PROFILES[key] : null;
}

module.exports = { lookupProfile, PROFILES };
