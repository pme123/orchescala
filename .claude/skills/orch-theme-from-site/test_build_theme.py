"""Tests of build_theme.py:  python3 -m unittest test_build_theme  (in this folder)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

import base64

from build_theme import MAX_LOGO, contrast, data_uri_bytes, font_stack, problems, radius, to_hex

HERE = os.path.dirname(os.path.abspath(__file__))


class ToHex(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(to_hex('#ABC'), '#aabbcc')
        self.assertEqual(to_hex('#7252ac'), '#7252ac')
        self.assertEqual(to_hex('rgb(114, 82, 172)'), '#7252ac')
        self.assertEqual(to_hex('rgba(114,82,172,0.5)'), '#7252ac')
        self.assertEqual(to_hex('rgb(114 82 172 / 50%)'), '#7252ac')
        self.assertEqual(to_hex('rgb(300, 0, 0)'), '#ff0000')  # clamped

    def test_none(self):
        for v in (None, '', 'transparent', 'rgba(0, 0, 0, 0)', 'rgb(0 0 0 / 0%)', '#abcd', 'red', 'hsl(0, 0%, 0%)'):
            self.assertIsNone(to_hex(v), v)


class FontStack(unittest.TestCase):
    def test_brand_font_first_then_system(self):
        self.assertEqual(font_stack('ObjektivMedium, "Helvetica Neue", Arial'), 'ObjektivMedium, "Helvetica Neue", Arial, Helvetica, sans-serif')
        self.assertEqual(font_stack('"Frutiger LT", serif'), '"Frutiger LT", Georgia, serif')

    def test_system_body_takes_the_heading_font(self):
        self.assertEqual(font_stack('-apple-system, Arial, sans-serif', ['Brand Sans, Arial']), '"Brand Sans", Arial, Helvetica, sans-serif')
        self.assertEqual(font_stack('system-ui, sans-serif'), 'sans')

    def test_generic_only(self):
        self.assertEqual(font_stack('monospace'), 'sans')  # a system body: all generic
        self.assertIsNone(font_stack(''))


class Radius(unittest.TestCase):
    def test_steps(self):
        self.assertEqual([radius([(f'{px}px', 1)]) for px in (0, 3, 8, 12, 24)], ['none', 'sm', 'md', 'lg', 'xl'])
        self.assertEqual(radius([('auto', 3), ('6px', 1)]), 'md')  # the first in px
        self.assertIsNone(radius([]))


class Problems(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(problems({'primary': '#7252ac', 'font': 'sans', 'radius': 'lg', 'mode': 'light',
                                   'logo': 'data:image/svg+xml;base64,PHN2Zy8+'}), [])

    def test_invalid(self):
        found = problems({'primary': 'red', 'font': 'x; color: red', 'radius': 'huge', 'mode': 'dim', 'logo': 'https://x/logo.svg'})
        self.assertEqual(len(found), 5, found)

    def test_font_loading_from_outside(self):
        for font in ('x, url(http://evil.example/f.woff)', 'X, URL (x)', '"A\\"', '@import x'):
            self.assertTrue(problems({'font': font}), font)

    def test_logo_size_is_the_decoded_size(self):
        uri = lambda n: 'data:image/png;base64,' + base64.b64encode(b'x' * n).decode()
        for n in (0, 1, 2, 3, 150 * 1024, MAX_LOGO):
            self.assertEqual(data_uri_bytes(uri(n)), n)
        self.assertEqual(problems({'logo': uri(MAX_LOGO)}), [])
        self.assertEqual(problems({'logo': uri(MAX_LOGO + 1)}), ['theme.logo ist grösser als 200 KB'])

    def test_contrast(self):
        self.assertAlmostEqual(contrast('#ffffff', '#000000'), 21, places=1)


class Cli(unittest.TestCase):
    def run_script(self, extracted, *args):
        with tempfile.TemporaryDirectory() as d:
            src, out = os.path.join(d, 'extracted.json'), os.path.join(d, 'theme.json')
            with open(src, 'w') as f:
                json.dump(extracted, f)
            p = subprocess.run([sys.executable, os.path.join(HERE, 'build_theme.py'), src, '--name', 'Test', '-o', out, *args],
                               capture_output=True, text=True)
            theme = None
            if os.path.exists(out):
                with open(out) as f:
                    theme = json.load(f)['theme']
            return p, theme

    def test_builds_a_theme(self):
        p, theme = self.run_script({'url': 'https://bank.example/', 'background': 'rgb(255, 255, 255)', 'text': 'rgb(10, 10, 10)',
                                    'font': 'Arial', 'ctaBackgrounds': [['rgb(114, 82, 172)', 4]], 'ctaRadius': [['12px', 4]]})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(theme['primary'], '#7252ac')
        self.assertEqual(theme['onPrimary'], '#ffffff')
        self.assertEqual(theme['radius'], 'lg')
        self.assertEqual(theme['mode'], 'light')

    def test_invalid_override_is_named(self):
        p, theme = self.run_script({'background': '#ffffff'}, '--primary', 'blau')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('--primary', p.stderr)
        self.assertIsNone(theme)

    def test_unsafe_font_is_rejected(self):
        p, theme = self.run_script({'background': '#ffffff', 'ctaBackgrounds': [['#004b87', 1]]}, '--font', 'x}body{color:red')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('theme.font', p.stderr)
        self.assertIsNone(theme)


if __name__ == '__main__':
    unittest.main()
