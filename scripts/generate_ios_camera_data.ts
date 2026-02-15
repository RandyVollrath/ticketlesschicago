import fs from 'node:fs';
import path from 'node:path';

// Import the runtime camera list (hardcoded unless fetchCameraLocations() is called).
import { CHICAGO_CAMERAS } from '../TicketlessChicagoMobile/src/data/chicago-cameras';

type Cam = {
  type: 'speed' | 'redlight';
  address: string;
  latitude: number;
  longitude: number;
  approaches: string[];
};

function swiftStringLiteral(s: string): string {
  // Keep this file ASCII-safe for Swift compilation.
  // Replace non-ASCII with '?' and escape backslash/quotes.
  const ascii = Array.from(s)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 63;
      if (code < 32 || code > 126) return '?';
      return ch;
    })
    .join('');
  return `"${ascii.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function main() {
  const cams: Cam[] = Array.from({ length: (CHICAGO_CAMERAS as any).length }, (_, i) => (CHICAGO_CAMERAS as any)[i]);
  if (!cams.length) {
    throw new Error('No cameras loaded from CHICAGO_CAMERAS');
  }

  const entries = cams.map((c) => {
    const approaches = `[${(c.approaches || []).map(swiftStringLiteral).join(', ')}]`;
    return `    NativeCameraDef(type: ${swiftStringLiteral(c.type)}, address: ${swiftStringLiteral(c.address)}, lat: ${c.latitude}, lng: ${c.longitude}, approaches: ${approaches}),`;
  });

  const root = path.resolve(process.cwd());
  const swiftPath = path.join(root, 'TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift');
  const src = fs.readFileSync(swiftPath, 'utf8');

  const begin = '// CAMERA_ENTRIES_BEGIN';
  const end = '// CAMERA_ENTRIES_END';
  const i0 = src.indexOf(begin);
  const i1 = src.indexOf(end);
  if (i0 === -1 || i1 === -1 || i1 <= i0) {
    throw new Error('Camera markers not found in BackgroundLocationModule.swift');
  }

  const before = src.slice(0, i0 + begin.length);
  const after = src.slice(i1);
  const out =
    before +
    '\n' +
    `    // Generated from TicketlessChicagoMobile/src/data/chicago-cameras.ts (${cams.length} cameras)\n` +
    entries.join('\n') +
    '\n    ' +
    after;

  fs.writeFileSync(swiftPath, out, 'utf8');
  console.log(`Updated ${swiftPath} with ${cams.length} cameras`);
}

main();

