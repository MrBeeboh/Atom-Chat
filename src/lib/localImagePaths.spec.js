import { describe, expect, it } from 'vitest';
import {
  extractLocalImagePaths,
  localImageServeUrl,
  normalizeLocalImagePath,
  rewriteLocalMarkdownImages,
} from './localImagePaths.js';

describe('normalizeLocalImagePath', () => {
  it('strips ~/Documents and absolute Documents prefixes', () => {
    expect(normalizeLocalImagePath('~/Documents/Quantum_vs_Newtonian_Physics_Infographic.png')).toBe(
      'Quantum_vs_Newtonian_Physics_Infographic.png',
    );
    expect(
      normalizeLocalImagePath('/home/mike/Documents/Quantum_vs_Newtonian_Physics_Infographic.png'),
    ).toBe('Quantum_vs_Newtonian_Physics_Infographic.png');
    expect(normalizeLocalImagePath('Documents/charts/a.png')).toBe('charts/a.png');
  });

  it('rejects remote and data URLs', () => {
    expect(normalizeLocalImagePath('https://example.com/a.png')).toBe('');
    expect(normalizeLocalImagePath('data:image/png;base64,xx')).toBe('');
  });
});

describe('extractLocalImagePaths', () => {
  it('finds bare Documents paths and markdown images', () => {
    const text = [
      'Saved to /home/mike/Documents/Quantum_vs_Newtonian_Physics_Infographic.png',
      'Also ![preview](charts/out.png)',
      '[Image: ~/Documents/other.webp]',
    ].join('\n');
    expect(extractLocalImagePaths(text)).toEqual([
      'charts/out.png',
      'other.webp',
      'Quantum_vs_Newtonian_Physics_Infographic.png',
    ]);
  });
});

describe('rewriteLocalMarkdownImages', () => {
  it('rewrites local markdown image src to the desktop-host file API', () => {
    const out = rewriteLocalMarkdownImages('See ![x](/home/mike/Documents/a.png)');
    expect(out).toContain('/api/desktop-host/file?path=');
    expect(out).toContain(encodeURIComponent('a.png'));
  });
});

describe('localImageServeUrl', () => {
  it('builds a query URL', () => {
    expect(localImageServeUrl('a/b.png')).toBe(
      '/api/desktop-host/file?path=' + encodeURIComponent('a/b.png'),
    );
  });
});
