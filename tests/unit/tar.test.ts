import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tar } from '../../src/server/tar';

describe('archive .tar de l’export', () => {
  it('se lit avec tar : noms, contenus binaires et accents intacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    const bin = new Uint8Array(1500).map((_, i) => i % 256);
    writeFileSync(join(dir, 'a.tar'), tar([
      { name: 'donnees/clients.json', data: Buffer.from('[{"nom":"Société Élan"}]') },
      { name: 'fichiers/photo.png', data: bin },
      { name: 'vide.txt', data: new Uint8Array(0) },
    ]));
    expect(execFileSync('tar', ['-tf', join(dir, 'a.tar')]).toString().trim().split('\n')).toEqual(['donnees/clients.json', 'fichiers/photo.png', 'vide.txt']);
    execFileSync('tar', ['-xf', join(dir, 'a.tar'), '-C', dir]);
    expect(readFileSync(join(dir, 'donnees/clients.json'), 'utf8')).toBe('[{"nom":"Société Élan"}]');
    expect([...readFileSync(join(dir, 'fichiers/photo.png'))]).toEqual([...bin]);
  });
  it('refuse un nom qui sortirait du dossier', () => {
    expect(() => tar([{ name: '../x', data: new Uint8Array(1) }])).toThrow();
    expect(() => tar([{ name: '/etc/x', data: new Uint8Array(1) }])).toThrow();
  });
});
