/**
 * Archive .tar (format ustar) écrite sans dépendance : l'export RGPD s'ouvre partout
 * (Windows 10+, macOS, Linux, 7-Zip). Noms de 100 caractères maximum, fichiers ordinaires seulement.
 */

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, mtime: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  if (nameBytes.length > 100 || name.includes('..') || name.startsWith('/')) throw new Error(`nom de fichier refusé : ${name}`);
  const h = Buffer.alloc(512, 0);
  nameBytes.copy(h, 0);
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(mtime, 12), 136, 'ascii');
  h.fill(' ', 148, 156); // somme de contrôle calculée avec ce champ rempli d'espaces
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 'ascii');
  return h;
}

export function tar(entries: TarEntry[], mtime = Math.floor(Date.now() / 1000)): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.name, e.data.length, mtime), Buffer.from(e.data));
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}
