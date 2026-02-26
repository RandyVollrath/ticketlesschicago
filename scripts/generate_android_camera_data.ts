import fs from 'node:fs';
import path from 'node:path';

// Import the runtime camera list
import { CHICAGO_CAMERAS } from '../TicketlessChicagoMobile/src/data/chicago-cameras';

type Cam = {
  type: 'speed' | 'redlight';
  address: string;
  latitude: number;
  longitude: number;
  approaches: string[];
};

function kotlinStringLiteral(s: string): string {
  // Keep file ASCII-safe for Kotlin compilation.
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
    const approaches = `listOf(${(c.approaches || []).map(kotlinStringLiteral).join(', ')})`;
    return `            CameraDef(${kotlinStringLiteral(c.type)}, ${kotlinStringLiteral(c.address)}, ${c.latitude}, ${c.longitude}, ${approaches}),`;
  });

  const root = path.resolve(process.cwd());
  const ktPath = path.join(root, 'TicketlessChicagoMobile/android/app/src/main/java/fyi/ticketless/app/CameraAlertModule.kt');
  const src = fs.readFileSync(ktPath, 'utf8');

  const begin = '// CAMERA_ENTRIES_BEGIN';
  const end = '// CAMERA_ENTRIES_END';
  const i0 = src.indexOf(begin);
  const i1 = src.indexOf(end);
  if (i0 === -1 || i1 === -1 || i1 <= i0) {
    throw new Error('Camera markers not found in CameraAlertModule.kt');
  }

  const before = src.slice(0, i0 + begin.length);
  const after = src.slice(i1);
  const out =
    before +
    '\n' +
    `            // Generated from TicketlessChicagoMobile/src/data/chicago-cameras.ts (${cams.length} cameras)\n` +
    entries.join('\n') +
    '\n            ' +
    after;

  fs.writeFileSync(ktPath, out, 'utf8');
  console.log(`Updated ${ktPath} with ${cams.length} cameras`);
}

main();
