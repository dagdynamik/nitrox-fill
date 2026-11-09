// Unit tests for the gas-blending math in plan() inside site/index.html.
// The constants and plan() are sliced out of the shipped page at test time,
// so these tests always exercise the code that is actually deployed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML_PATH = fileURLToPath(new URL('../site/index.html', import.meta.url));

function extract() {
  const html = readFileSync(HTML_PATH, 'utf8');

  const constMatch = html.match(/const\s+AIR\s*=[^;]*;/);
  if (!constMatch) throw new Error(`extract: "const AIR = ...;" not found in ${HTML_PATH}`);
  const constSrc = constMatch[0];
  for (const name of ['AIR', 'FO2', 'EPS']) {
    if (!new RegExp(`\\b${name}\\s*=`).test(constSrc)) {
      throw new Error(`extract: constant ${name} not declared in "${constSrc}"`);
    }
  }

  const start = html.indexOf('function plan(');
  if (start < 0) throw new Error(`extract: "function plan(" not found in ${HTML_PATH}`);
  const open = html.indexOf('{', start);
  if (open < 0) throw new Error('extract: opening brace of plan() not found');
  // Brace matching that skips string literals and comments.
  let depth = 0, i = open, end = -1;
  while (i < html.length) {
    const c = html[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < html.length && html[i] !== q) { if (html[i] === '\\') i++; i++; }
    } else if (c === '/' && html[i + 1] === '/') {
      while (i < html.length && html[i] !== '\n') i++;
    } else if (c === '/' && html[i + 1] === '*') {
      i = html.indexOf('*/', i + 2); if (i < 0) break; i++;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    i++;
  }
  if (end < 0) throw new Error('extract: closing brace of plan() not found');
  const planSrc = html.slice(start, end);

  let mod;
  try {
    mod = new Function(`"use strict";\n${constSrc}\n${planSrc}\nreturn { plan, AIR, FO2, EPS };`)();
  } catch (e) {
    throw new Error(`extract: extracted source does not evaluate: ${e.message}\n---\n${constSrc}\n${planSrc}`);
  }
  if (typeof mod.plan !== 'function') throw new Error('extract: plan is not a function');
  return mod;
}

const { plan, AIR, FO2, EPS } = extract();
const TOL = 1e-6;

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg ?? ''} expected ${expected}, got ${actual} (tol ${tol})`);
}

// Final mix derived from the returned plan: optional bleed, then O2, then top gas.
function finalMix(Ps, Fs, p) {
  const startP = p.bleedTo !== null ? p.bleedTo : Ps;
  const P = startP + p.o2 + p.topBar;
  const o2bar = startP * Fs + p.o2 * FO2 + p.topBar * p.topF;
  return { startP, P, F: P > 0 ? o2bar / P : NaN };
}

function assertReachesTarget(Ps, Fs, Pt, Ft, Fmax, p, label = '') {
  const tag = `${label} [Ps=${Ps} Fs=${Fs} Pt=${Pt} Ft=${Ft} Fmax=${Fmax}] plan=${JSON.stringify(p)}`;
  assert.equal(p.error, null, `unexpected error ${tag}`);
  const m = finalMix(Ps, Fs, p);
  close(m.P, Pt, TOL, `final pressure ${tag}`);
  close(m.F, Ft, TOL, `final O2 fraction ${tag}`);
  return m;
}

test('extraction found the shipped constants', () => {
  assert.equal(AIR, 0.209);
  assert.equal(FO2, 1.0);
  assert.ok(EPS > 0 && EPS < 1e-3);
});

describe('HANDOVER example: 50 bar of 32 % -> 200 bar of 50 %', () => {
  test('with a 40 % continuous top: 40 bar O2 then 110 bar of 40 %', () => {
    const p = plan(50, 0.32, 200, 0.50, 0.40);
    assert.equal(p.error, null);
    assert.equal(p.bleedTo, null);
    close(p.o2, 40, TOL, 'o2');
    close(p.topBar, 110, TOL, 'topBar');
    close(p.topF, 0.40, TOL, 'topF');
    assertReachesTarget(50, 0.32, 200, 0.50, 0.40, p);
  });

  test('with an air top: about 67 bar O2', () => {
    const p = plan(50, 0.32, 200, 0.50, AIR);
    assert.equal(p.error, null);
    assert.equal(p.bleedTo, null);
    assert.equal(Math.round(p.o2), 67);
    close(p.o2, (200 * 0.5 - 50 * 0.32 - 150 * AIR) / (1 - AIR), TOL, 'o2');
    close(p.topF, AIR, TOL, 'topF');
    assertReachesTarget(50, 0.32, 200, 0.50, AIR, p);
  });
});

describe('named cases', () => {
  test('empty cylinder to EAN32 with continuous: no O2, top at 32 %', () => {
    const p = plan(0, AIR, 200, 0.32, 0.40);
    assert.equal(p.error, null);
    assert.equal(p.bleedTo, null);
    assert.equal(p.o2, 0);
    close(p.topF, 0.32, TOL, 'topF');
    close(p.topBar, 200, TOL, 'topBar');
    assertReachesTarget(0, AIR, 200, 0.32, 0.40, p);
  });

  test('EAN32 from empty without continuous: O2 then air', () => {
    const p = plan(0, AIR, 200, 0.32, AIR);
    assert.equal(p.error, null);
    assert.equal(p.bleedTo, null);
    close(p.o2, (200 * 0.32 - 200 * AIR) / (1 - AIR), TOL, 'o2'); // ~28.07
    close(p.topF, AIR, TOL, 'topF');
    close(p.topBar, 200 - p.o2, TOL, 'topBar');
    assertReachesTarget(0, AIR, 200, 0.32, AIR, p);
  });

  test('start richer than target: bleed to Pt(Ft-0.209)/(Fs-0.209), then air top', () => {
    for (const Fmax of [AIR, 0.40]) {
      const p = plan(100, 0.50, 200, 0.32, Fmax);
      const Pb = 200 * (0.32 - AIR) / (0.50 - AIR); // ~76.29
      assert.equal(p.error, null);
      close(p.bleedTo, Pb, TOL, 'bleedTo');
      assert.equal(p.o2, 0);
      close(p.topF, AIR, TOL, 'topF');
      close(p.topBar, 200 - Pb, TOL, 'topBar');
      assertReachesTarget(100, 0.50, 200, 0.32, Fmax, p);
    }
  });

  test('start pressure above target, same mix: bleed to Pt and stop', () => {
    const p = plan(230, 0.32, 200, 0.32, 0.40);
    assert.equal(p.error, null);
    close(p.bleedTo, 200, TOL, 'bleedTo');
    assert.equal(p.o2, 0);
    assert.equal(p.topBar, 0);
    assertReachesTarget(230, 0.32, 200, 0.32, 0.40, p);
  });

  test('start pressure above target, leaner mix: bleed past Pt, then O2 only', () => {
    const p = plan(230, AIR, 200, 0.32, 0.40);
    const Pb = 200 * (1 - 0.32) / (1 - AIR);
    close(p.bleedTo, Pb, TOL, 'bleedTo');
    close(p.o2, 200 - Pb, TOL, 'o2');
    assert.equal(p.topBar, 0);
    assertReachesTarget(230, AIR, 200, 0.32, 0.40, p);
  });

  test('start pressure above target, richer mix: bleed then air top', () => {
    const p = plan(230, 0.50, 200, 0.32, 0.40);
    const Pb = 200 * (0.32 - AIR) / (0.50 - AIR);
    close(p.bleedTo, Pb, TOL, 'bleedTo');
    assert.equal(p.o2, 0);
    close(p.topF, AIR, TOL, 'topF');
    assertReachesTarget(230, 0.50, 200, 0.32, 0.40, p);
  });

  test('Ps + x > Pt: bleed to Pt(1-Ft)/(1-Fs), then O2 only', () => {
    // need = (64 - 39.71)/10 = 2.43 > 0.4; x = 33.8 bar > 10 bar of room.
    const p = plan(190, AIR, 200, 0.32, 0.40);
    const Pb = 200 * (1 - 0.32) / (1 - AIR); // ~171.93
    assert.equal(p.error, null);
    close(p.bleedTo, Pb, TOL, 'bleedTo');
    close(p.o2, 200 - Pb, TOL, 'o2');
    assert.equal(p.topBar, 0);
    assert.ok(p.bleedTo < 190, 'bleeds down, never up');
    assertReachesTarget(190, AIR, 200, 0.32, 0.40, p);
  });

  test('already on target: nothing to do', () => {
    const p = plan(200, 0.32, 200, 0.32, 0.40);
    assert.deepEqual(p, { bleedTo: null, o2: 0, topF: AIR, topBar: 0, error: null });
    assertReachesTarget(200, 0.32, 200, 0.32, 0.40, p);
  });

  test('Fmax below air is treated as air', () => {
    const a = plan(50, 0.32, 200, 0.50, 0.10);
    const b = plan(50, 0.32, 200, 0.50, AIR);
    assert.deepEqual(a, b);
  });
});

describe('errors', () => {
  test('target below 20.9 % is rejected', () => {
    const p = plan(0, AIR, 200, 0.20, 0.40);
    assert.ok(typeof p.error === 'string' && p.error.length > 0);
    assert.match(p.error, /20\.9/);
  });

  test('target above 100 % is rejected', () => {
    const p = plan(0, AIR, 200, 1.01, 0.40);
    assert.ok(typeof p.error === 'string' && p.error.length > 0);
    assert.match(p.error, /100/);
  });

  test('target exactly 20.9 % and exactly 100 % are accepted', () => {
    assertReachesTarget(0, AIR, 200, AIR, 0.40, plan(0, AIR, 200, AIR, 0.40));
    assertReachesTarget(50, 0.32, 200, 1.0, 0.40, plan(50, 0.32, 200, 1.0, 0.40));
  });
});

describe('property: every valid input reaches the target', () => {
  const PS = [0, 10, 50, 100, 150, 190, 200, 210, 232, 300];
  const FS = [0, 0.1, AIR, 0.25, 0.32, 0.36, 0.40, 0.50, 0.80, 1.0];
  const PT = [12, 200, 232, 300];
  const FT = [AIR, 0.22, 0.28, 0.32, 0.36, 0.40, 0.50, 0.80, 1.0];
  const FMAX = [AIR, 0.30, 0.36, 0.40, 0.60, 1.0];

  test(`grid of ${PS.length * FS.length * PT.length * FT.length * FMAX.length} inputs`, () => {
    let n = 0;
    for (const Ps of PS) for (const Fs of FS) for (const Pt of PT)
      for (const Ft of FT) for (const Fmax of FMAX) {
        const p = plan(Ps, Fs, Pt, Ft, Fmax);
        const tag = `[Ps=${Ps} Fs=${Fs} Pt=${Pt} Ft=${Ft} Fmax=${Fmax}] plan=${JSON.stringify(p)}`;
        const m = assertReachesTarget(Ps, Fs, Pt, Ft, Fmax, p);

        assert.ok(m.startP >= -TOL, `pressure after bleed < 0 ${tag}`);
        assert.ok(m.startP <= Ps + TOL, `bleed must not raise pressure ${tag}`);
        if (p.bleedTo !== null) assert.ok(p.bleedTo >= -TOL, `bleedTo < 0 ${tag}`);
        assert.ok(m.startP + p.o2 >= -TOL && m.startP + p.o2 <= Pt + TOL, `pressure after O2 out of range ${tag}`);
        assert.ok(p.o2 >= -TOL, `o2 < 0 ${tag}`);
        assert.ok(p.topBar >= -TOL, `topBar < 0 ${tag}`);
        assert.ok(p.topF >= AIR - TOL && p.topF <= Math.max(Fmax, AIR) + TOL, `topF outside [0.209, Fmax] ${tag}`);
        assert.ok(Number.isFinite(p.o2) && Number.isFinite(p.topBar) && Number.isFinite(p.topF), `non-finite value ${tag}`);
        n++;
      }
    assert.ok(n > 0);
  });

  test('random inputs (seeded)', () => {
    let s = 0x9e3779b9;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
    for (let k = 0; k < 20000; k++) {
      const Ps = rnd() * 300, Fs = rnd(), Pt = 1 + rnd() * 299;
      const Ft = AIR + rnd() * (1 - AIR), Fmax = AIR + rnd() * (1 - AIR);
      const p = plan(Ps, Fs, Pt, Ft, Fmax);
      const tag = `[Ps=${Ps} Fs=${Fs} Pt=${Pt} Ft=${Ft} Fmax=${Fmax}] plan=${JSON.stringify(p)}`;
      const m = assertReachesTarget(Ps, Fs, Pt, Ft, Fmax, p);
      assert.ok(m.startP >= -TOL && m.startP <= Ps + TOL, `bleed out of range ${tag}`);
      assert.ok(p.o2 >= -TOL && p.topBar >= -TOL, `negative amount ${tag}`);
      assert.ok(p.topF >= AIR - TOL && p.topF <= Fmax + TOL, `topF outside [0.209, Fmax] ${tag}`);
    }
  });
});
