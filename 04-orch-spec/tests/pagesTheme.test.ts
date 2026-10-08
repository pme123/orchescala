// The theme of an app as CSS variables: light colours in light mode, primary, font and corners in both.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeParams } from '../src/pages/runtime/homeParams';
import { dataUriBytes, FONTS, isThemeColor, MAX_LOGO_BYTES, parseThemeFile, rgbOf, textOn, themeProblem, themeStyle } from '../src/pages/runtime/theme';
import { isDarkMode, rememberMode, storedMode } from '../src/pages/runtime/ui';

test('themeStyle - the variables of a theme', () => {
  const light = themeStyle({ primary: '#0b5cab', background: '#fafafa', font: 'sans', radius: 'md' }, false) as Record<string, string>;
  assert.equal(light['--orch-primary'], '#0b5cab');
  assert.equal(light['--orch-on-primary'], '#ffffff'); // dark blue: white text
  assert.equal(light['--orch-bg'], '#fafafa');
  assert.equal(light['--orch-font'], FONTS.sans);
  assert.equal(light.fontFamily, FONTS.sans);
  assert.equal(light['--orch-radius'], '8px');
  const dark = themeStyle({ primary: '#ffd200', background: '#fafafa' }, true) as Record<string, string>;
  assert.equal(dark['--orch-on-primary'], '#000000'); // yellow: black text
  assert.equal(dark['--orch-bg'], undefined); // the light background is not for dark mode
  assert.deepEqual(themeStyle(undefined, false), {});
  assert.equal((themeStyle({ font: '"Frutiger", Arial, sans-serif' }, false) as Record<string, string>)['--orch-font'], '"Frutiger", Arial, sans-serif');
});

test('parseThemeFile - the file of the skill or a plain theme', () => {
  const fromSkill = parseThemeFile(JSON.stringify({ kind: 'orch-theme', version: 1, name: 'Acme Bank', source: 'https://acme.example', theme: { primary: '#004b87', font: 'sans' } }));
  assert.ok(!('error' in fromSkill));
  if (!('error' in fromSkill)) {
    assert.equal(fromSkill.theme.primary, '#004b87');
    assert.equal(fromSkill.name, 'Acme Bank');
  }
  const plain = parseThemeFile(JSON.stringify({ primary: '#004b87' }));
  assert.ok(!('error' in plain) && plain.theme.primary === '#004b87');
  assert.ok('error' in parseThemeFile('nicht json'));
  assert.ok('error' in parseThemeFile(JSON.stringify({ theme: { primary: 'blau' } })));
});

test('themeProblem - keys of the prototype are no corners', () => {
  for (const radius of ['toString', 'constructor', '__proto__', 'hasOwnProperty'])
    assert.match(themeProblem({ radius }) ?? '', /theme\.radius/, radius);
  assert.equal(themeProblem({ radius: 'md' }), null);
  assert.equal((themeStyle({ radius: 'toString' as never }, false) as Record<string, string>)['--orch-radius'], undefined);
  assert.ok(isThemeColor('#0b5cab') && isThemeColor('rgb(1, 2, 3)'));
  assert.ok(!isThemeColor('rgb(') && !isThemeColor('blau'));
});

test('isThemeColor - exactly the forms CSS takes', () => {
  for (const ok of ['#abc', '#abcd', '#0b5cab', '#0b5cab80', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'rgb(1 2 3 / 50%)', 'rgb(10%, 20%, 30%)',
    'hsl(210, 50%, 40%)', 'hsl(210deg 50% 40% / .5)', 'hsla(-30, 100%, 50%, 1)'])
    assert.ok(isThemeColor(ok), ok);
  for (const bad of ['#abcde', '#abcdefa', '#ggg', 'rgb(%%)', 'rgb(1, 2)', 'rgb(1,,2,3)', 'hsl(1, 2, 3)', 'rgb(1 2 3 4)', 'blau', 'rgb(1,2,3); x'])
    assert.ok(!isThemeColor(bad), bad);
  assert.match(themeProblem({ primary: 'rgb(%%)' }) ?? '', /theme.primary/);
});

test('textOn - black or white by WCAG contrast, for hex, rgb() and hsl()', () => {
  assert.deepEqual(rgbOf('#f00'), [1, 0, 0]);
  assert.deepEqual(rgbOf('rgb(255 0 0 / 50%)'), [1, 0, 0]);
  assert.deepEqual(rgbOf('hsl(120, 100%, 50%)')?.map((v) => Math.round(v * 255)), [0, 255, 0]);
  assert.equal(rgbOf('blau'), null);
  assert.equal(textOn('#0b5cab'), '#ffffff'); // dark blue
  assert.equal(textOn('#ffd200'), '#000000'); // yellow
  assert.equal(textOn('rgb(255, 210, 0)'), '#000000'); // the same yellow as rgb() - was white before
  assert.equal(textOn('hsl(50, 100%, 50%)'), '#000000');
  // a mid-tone: build_theme.py picks black for it (contrast 6.4 vs 3.3) - the app now agrees
  assert.equal(textOn('#e07000'), '#000000');
  assert.equal((themeStyle({ primary: '#e07000' }, false) as Record<string, string>)['--orch-on-primary'], '#000000');
  assert.equal((themeStyle({ primary: '#e07000', onPrimary: '#ffffff' }, false) as Record<string, string>)['--orch-on-primary'], '#ffffff');
});

test('themeStyle - corners only for a known radius, the theme colours only in light mode', () => {
  assert.equal((themeStyle({ radius: 'toString' as never }, false) as Record<string, string>)['--orch-radius'], undefined);
  const dark = themeStyle({ surface: '#fff', text: '#111', radius: 'none' }, true) as Record<string, string>;
  assert.equal(dark['--orch-surface'], undefined);
  assert.equal(dark['--orch-text'], undefined);
  assert.equal(dark['--orch-radius'], '0px');
});

test('homeParams - the IdP reply is dropped only when it is one and the login did not complete', () => {
  assert.equal(homeParams('?token=abc&code=1&state=2&session_state=3&iss=x', false), 'token=abc');
  assert.equal(homeParams('?token=abc&code=1&state=2', true), 'token=abc&code=1&state=2'); // logged in: as is
  assert.equal(homeParams('?state=offen', false), 'state=offen'); // an app parameter «state» alone stays
  assert.equal(homeParams('?code=X7', false), 'code=X7');
  assert.equal(homeParams('', false), '');
});

test('theme mode - the user\'s choice before the app\'s default, stored under its own key', () => {
  assert.equal(isDarkMode(null, 'dark'), true);
  assert.equal(isDarkMode('light', 'dark'), false);
  assert.equal(isDarkMode(null, undefined), false);
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  mem.set('orch-ui.theme', 'light'); // what orch-spec writes on every load - not a choice for the pages
  assert.equal(storedMode('orch-pages.theme', store), null);
  rememberMode('orch-pages.theme', 'dark', store);
  assert.equal(storedMode('orch-pages.theme', store), 'dark');
  rememberMode('orch-pages.theme', undefined, store);
  assert.equal(storedMode('orch-pages.theme', store), 'dark');
  mem.set('orch-pages.theme', 'purple');
  assert.equal(storedMode('orch-pages.theme', store), null);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(storedMode('orch-pages.theme', broken), null);
  rememberMode('orch-pages.theme', 'dark', broken); // no exception
  assert.equal(storedMode('orch-pages.theme', null), null);
});

test('themeProblem - a font loads nothing from outside', () => {
  for (const font of ['x, url(http://evil.example/f.woff)', 'X, URL (x)', '"A\\"', '@import x', 'a; b'])
    assert.match(themeProblem({ font }) ?? '', /theme.font/, font);
  assert.equal(themeProblem({ font: '"Frutiger LT", Arial, sans-serif' }), null);
});

test('themeProblem - the logo size is the decoded size (200 KB)', () => {
  const uri = (n: number) => `data:image/png;base64,${Buffer.from('x'.repeat(n)).toString('base64')}`;
  for (const n of [0, 1, 2, 3, 150 * 1024, MAX_LOGO_BYTES]) assert.equal(dataUriBytes(uri(n)), n);
  assert.equal(themeProblem({ logo: uri(150 * 1024) }), null); // was rejected by the length estimate
  assert.equal(themeProblem({ logo: uri(MAX_LOGO_BYTES) }), null);
  assert.match(themeProblem({ logo: uri(MAX_LOGO_BYTES + 1) }) ?? '', /200 KB/);
});
