// The theme of an app as CSS variables: light colours in light mode, primary, font and corners in both.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FONTS, parseThemeFile, themeStyle } from '../src/pages/runtime/theme';

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
