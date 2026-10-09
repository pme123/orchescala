// The theme of an app as CSS variables: light colours in light mode, primary, font and corners in both.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { homeParams } from '../src/pages/runtime/homeParams';
import colourCases from '../../.claude/skills/orch-theme-from-site/colour-cases.json';
import { alphaOf, contrast, svgDropsAttribute, svgDropsElement, dataUriBytes, FONTS, isFontPreset, isThemeColor, MAX_LOGO_BYTES, parseThemeFile, rgbOf, syncedText, textOn, themeProblem, themeStyle } from '../src/pages/runtime/theme';
import { cleanLogo, decodeBase64, encodeBase64 } from '../src/pages/designer/logo';
import { appModeKey, isDarkMode, rememberMode, storedMode } from '../src/pages/runtime/ui';

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
  assert.deepEqual(rgbOf('rgb(255 0 0 / 50%)'), [1, 0.5, 0.5]); // half red on white
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
  // the app's last mode: per app - two apps on one origin do not share it
  assert.notEqual(appModeKey('/app/a/'), appModeKey('/app/b/'));
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

test('parseThemeFile - a theme file without a theme is an error, not an empty theme', () => {
  assert.ok('error' in parseThemeFile('{"kind": "orch-theme", "name": "Acme"}'));
  assert.ok('error' in parseThemeFile('{"theme": null}'));
  assert.ok('error' in parseThemeFile('{"theme": ["#fff"]}'));
  const plain = parseThemeFile('{"primary": "#004b87"}');
  assert.ok('theme' in plain && plain.theme.primary === '#004b87');
});

test('themeStyle - a dark theme brings its colours in dark mode; the other mode keeps the z9nai ones', () => {
  const darkTheme = { primary: '#ffd200', background: '#101820', surface: '#1b2733', text: '#e6edf3', mode: 'dark' as const };
  const inDark = themeStyle(darkTheme, true) as Record<string, string>;
  assert.equal(inDark['--orch-bg'], '#101820');
  assert.equal(inDark['--orch-surface'], '#1b2733');
  assert.equal(inDark['--orch-text'], '#e6edf3');
  const inLight = themeStyle(darkTheme, false) as Record<string, string>; // the user switched to light
  assert.equal(inLight['--orch-bg'], undefined);
  assert.equal(inLight['--orch-primary'], '#ffd200');
  const lightTheme = themeStyle({ background: '#ffffff', mode: 'light' }, true) as Record<string, string>;
  assert.equal(lightTheme['--orch-bg'], undefined);
});

test('isFontPreset - own keys only', () => {
  assert.ok(isFontPreset('sans') && isFontPreset('mono'));
  assert.ok(!isFontPreset('toString') && !isFontPreset('constructor') && !isFontPreset('Arial'));
  assert.equal((themeStyle({ font: 'constructor' }, false) as Record<string, string>)['--orch-font'], 'constructor');
});

test('syncedText - the colour field keeps what is typed while it means the value', () => {
  assert.equal(syncedText('#abc', '#abc'), '#abc'); // typed, valid, committed: stays (on the way to #abcdef)
  assert.equal(syncedText(' #abc ', '#abc'), ' #abc '); // trimmed for the value - the typing stays
  assert.equal(syncedText('#abc', '#7252ac'), '#7252ac'); // the colour picker / an import: follows
  assert.equal(syncedText('#ab', undefined), ''); // reset to the default
  assert.equal(syncedText('', undefined), '');
});

test('themeStyle - an own text on the primary colour only if it can be read (3:1), else black or white', () => {
  assert.equal(Math.round(contrast('#ffffff', '#000000')!), 21);
  assert.equal(contrast('blau', '#000000'), null);
  const on = (primary: string, onPrimary: string) => (themeStyle({ primary, onPrimary }, false) as Record<string, string>)['--orch-on-primary'];
  assert.equal(on('#004b87', '#ffd200'), '#ffd200'); // yellow on dark blue: readable, kept
  assert.equal(on('#ffd200', '#ffffff'), '#000000'); // white on yellow (1.4:1): black instead
  assert.equal(on('#7252ac', '#6a4ba0'), '#ffffff'); // nearly the same purple: white instead
});

test('themeProblem - the logo payload must be base64', () => {
  assert.match(themeProblem({ logo: 'data:image/png;base64,ab!d' }) ?? '', /base64/);
  assert.match(themeProblem({ logo: 'data:image/png;base64,abc' }) ?? '', /base64/); // not padded to 4
  assert.equal(themeProblem({ logo: 'data:image/png;base64,YWJj' }), null);
});

test('rgbOf / textOn - a semi-transparent colour as it looks on white (like the skill)', () => {
  assert.deepEqual(rgbOf('rgba(0, 0, 0, 0.5)'), [0.5, 0.5, 0.5]);
  assert.deepEqual(rgbOf('#00000080')?.map((v) => Math.round(v * 100) / 100), [0.5, 0.5, 0.5]);
  assert.equal(textOn('rgba(0, 75, 135, 1)'), '#ffffff'); // dark blue
  assert.equal(textOn('rgba(0, 75, 135, 0.2)'), '#000000'); // the same, faint on white: light
  assert.deepEqual(rgbOf('#00ff00'), [0, 1, 0]); // six digits, not #00f
});

test('themeStyle - the text colour also as a property (inherited in the designer preview)', () => {
  assert.equal((themeStyle({ text: '#663399' }, false) as Record<string, string>).color, '#663399');
  assert.equal((themeStyle({ text: '#663399' }, true) as Record<string, string>).color, undefined);
});

test('isThemeColor - commas: all numbers or all percent (CSS takes no mix); spaces may mix', () => {
  assert.ok(isThemeColor('rgb(255, 0, 0)') && isThemeColor('rgb(100%, 0%, 0%)'));
  assert.ok(!isThemeColor('rgb(100%, 0, 0)') && !isThemeColor('rgba(255, 0%, 0, 0.5)'));
  assert.ok(isThemeColor('rgb(100% 0 0)')); // the modern form mixes
});

test('themeStyle - a semi-transparent primary as it looks on the page of the theme (dark too)', () => {
  const dark = { mode: 'dark' as const, background: '#000000', primary: 'rgba(255,255,255,0.1)' };
  const on = (t: object, isDark: boolean) => (themeStyle(t, isDark) as Record<string, string>)['--orch-on-primary'];
  assert.equal(on(dark, true), '#ffffff'); // nearly black on black: white text (on white it was black)
  assert.equal(on({ ...dark, onPrimary: '#ffffff' }, true), '#ffffff'); // the own white is kept
  assert.equal(on({ primary: 'rgba(0,0,0,0.1)' }, false), '#000000'); // faint grey on the light page
  assert.ok(contrast('rgba(255,255,255,0.1)', '#ffffff', '#000000')! > 10);
});

test('themeProblem - a font is names only (allowlist); the page background is opaque', () => {
  assert.equal(themeProblem({ font: '"Frutiger LT", Arial, sans-serif' }), null);
  assert.equal(themeProblem({ font: 'Société Générale, -apple-system, system_ui' }), null);
  for (const font of ['a(b)', 'x/y', 'a: b', 'a!important', 'x*y'])
    assert.match(themeProblem({ font }) ?? '', /theme.font/, font);
  assert.match(themeProblem({ background: 'rgba(0,0,0,0.5)' }) ?? '', /theme.background/);
  assert.match(themeProblem({ background: '#ffffff80' }) ?? '', /theme.background/);
  assert.equal(themeProblem({ background: 'rgba(0,0,0,1)' }), null);
  assert.equal(themeProblem({ surface: 'rgba(0,0,0,0.05)' }), null); // a surface may be faint
});

test('isThemeColor - the shared colour table (the same as test_build_theme.py)', () => {
  for (const c of colourCases.valid) assert.ok(isThemeColor(c), c);
  for (const c of colourCases.invalid) assert.ok(!isThemeColor(c), c);
});

test('alphaOf - the opacity itself; the page background check uses it', () => {
  assert.equal(alphaOf('#fff'), 1);
  assert.equal(alphaOf('rgba(0,0,0,0.25)'), 0.25);
  assert.equal(alphaOf('rgb(0 0 0 / 50%)'), 0.5);
  assert.equal(alphaOf('blau'), null);
  assert.equal(alphaOf('#ff000080'), 0x80 / 255); // #rrggbbaa
  assert.equal(alphaOf('#f008'), 0x88 / 255); // #rgba
  assert.equal(alphaOf('hsla(120, 100%, 50%, .5)'), 0.5);
  assert.equal(alphaOf('rgb(0 0 0 / 200%)'), 1); // at most 1
  // and the colour itself of the same forms (on white): #rgba doubled, the hsl conversion, % clamped
  const rgb255 = (c: string) => rgbOf(c)?.map((v) => Math.round(v * 255));
  assert.deepEqual(rgb255('#f008'), [255, 119, 119]); // red, 0x88 opaque, on white
  assert.deepEqual(rgb255('#ff000080'), [255, 127, 127]);
  assert.deepEqual(rgb255('hsl(240, 100%, 50%)'), [0, 0, 255]);
  assert.deepEqual(rgb255('hsla(0, 100%, 25%, 1)'), [128, 0, 0]);
  assert.deepEqual(rgb255('rgb(200% 0% 0%)'), [255, 0, 0]); // over 100%: 100%
  // fewer than three components never reach the conversion: COLOR refuses them
  for (const c of ['hsl(120)', 'hsl(120, 50%)', 'rgb(1, 2)', 'hsl(120 50%)'])
    assert.equal(rgbOf(c), null, c);
});

test('parseThemeFile - a plain object is a theme only with theme keys alone', () => {
  assert.ok('error' in parseThemeFile('{}'));
  assert.ok('error' in parseThemeFile('{"gatewayPort": 8888, "debug": true}'));
  assert.ok('error' in parseThemeFile('{"primary": "#004b87", "port": 1}'));
  assert.ok('theme' in parseThemeFile('{"primary": "#004b87", "mode": "light"}'));
});

test('draftAfterSave - the Admin form keeps an edit made while saving', async () => {
  const { draftAfterSave } = await import('../src/pages/designer/ThemeEditor');
  const saved = { primary: '#004b87' };
  assert.equal(draftAfterSave({ theme: { primary: '#004b87' } }, saved), null); // what was saved: done
  const newer = { theme: { primary: '#004b87', radius: 'lg' as const } };
  assert.equal(draftAfterSave(newer, saved), newer); // changed meanwhile: stays a draft
  assert.equal(draftAfterSave(null, saved), null);
  assert.equal(draftAfterSave({ theme: undefined }, undefined), null); // «Vorgabe» saved
});

test('contrast / textOn - a background that is no colour is not taken for white', () => {
  assert.equal(contrast('#000000', '#ffffff', 'blau'), null);
  assert.equal(textOn('#ffd200', 'blau'), '#ffffff'); // no colour: the default, not a guess on white
  assert.equal(textOn('#ffd200', '#ffffff'), '#000000');
});

test('svgDrops* - the SVG rules of an imported or uploaded logo (as parse_svg of the skill)', () => {
  for (const el of ['script', 'foreignObject', 'style', 'set', 'animate', 'animateMotion', 'image', 'feImage', 'SCRIPT'])
    assert.ok(svgDropsElement(el), el);
  for (const el of ['svg', 'g', 'path', 'rect', 'use', 'linearGradient', 'defs', 'a']) assert.ok(!svgDropsElement(el), el);
  assert.ok(svgDropsAttribute('onload', 'x()'));
  assert.ok(svgDropsAttribute('href', 'https://evil.example/s.svg#a'));
  assert.ok(svgDropsAttribute('xlink:href', ' JaVaScript:alert(1)'));
  assert.ok(svgDropsAttribute('style', "fill: URL( 'https://evil.example/g' )"));
  assert.ok(svgDropsAttribute('to', 'javascript:alert(1)'));
  assert.ok(svgDropsAttribute('fill', 'data:text/html,x'));
  assert.ok(!svgDropsAttribute('href', '#logo'));
  assert.ok(!svgDropsAttribute('fill', 'url(#g)'));
  assert.ok(!svgDropsAttribute('d', 'M0 0h10v10z'));
});

test('parseThemeFile - JSON null is JSON, but no theme', () => {
  const r = parseThemeFile('null');
  assert.ok('error' in r && r.error === 'Die Datei ist kein Theme.');
  const broken = parseThemeFile('{nope');
  assert.ok('error' in broken && broken.error === 'Die Datei ist kein JSON.');
});

test('cleanLogo - the SVG walked and cleaned: scripts, handlers and outside links dropped, the rest kept', () => {
  // the browser's parser and serializer, from linkedom (it has no XMLSerializer: a document's toString is its XML).
  // So this tests the walk, not the browser's serialization (checked by hand). The globals are set for this test
  // only - fine while the tests of a file run one after the other (node:test without `concurrency`)
  const g = globalThis as unknown as { DOMParser?: unknown; XMLSerializer?: unknown };
  g.DOMParser = DOMParser;
  g.XMLSerializer = class { serializeToString = (doc: Document) => doc.toString(); };
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">'
      + '<defs><linearGradient id="g"/></defs><script>alert(2)</script>'
      + '<a href="https://evil.test"><rect fill="url(#g)" onclick="alert(3)" width="10" height="10"/></a>'
      + '<use href="#g"/><image href="https://evil.test/x.png"/><text>Prüfung ä</text></svg>';
    const out = cleanLogo(`data:image/svg+xml;base64,${encodeBase64(svg)}`);
    assert.ok(out?.startsWith('data:image/svg+xml;base64,'), String(out));
    const clean = decodeBase64(out!.slice(out!.indexOf(',') + 1))!;
    for (const gone of ['onload', 'alert', '<script', 'onclick', 'evil.test', '<image']) assert.ok(!clean.includes(gone), `${gone} in ${clean}`);
    for (const kept of ['viewBox="0 0 10 10"', 'fill="url(#g)"', 'href="#g"', '<linearGradient id="g"', 'Prüfung ä'])
      assert.ok(clean.includes(kept), `${kept} not in ${clean}`);
    assert.equal(cleanLogo(`data:image/svg+xml;base64,${encodeBase64('<html><body/></html>')}`), null); // no SVG
  } finally {
    delete g.DOMParser;
    delete g.XMLSerializer;
  }
});

test('encodeBase64 / decodeBase64 / cleanLogo - UTF-8 text to base64 and back, refused before the parser', () => {
  // the encoding cleanLogo returns its SVG with - umlauts and characters beyond Latin-1 survive the round trip
  assert.equal(decodeBase64(encodeBase64('<svg>Prüfung ä € 銀行</svg>')), '<svg>Prüfung ä € 銀行</svg>');
  assert.equal(encodeBase64('ä'), 'w6Q='); // UTF-8 (c3 a4), not Latin-1
  assert.equal(decodeBase64('!!!'), null);
  // without a DOM (no DOMParser): what returns before the SVG is parsed
  assert.equal(cleanLogo('data:image/svg+xml;base64,!!!'), null);
  assert.equal(cleanLogo(`data:image/svg+xml;base64,${encodeBase64('<!DOCTYPE svg [<!ENTITY a "a">]><svg/>')}`), null);
  assert.equal(cleanLogo('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA'); // not an SVG: as it is
});
