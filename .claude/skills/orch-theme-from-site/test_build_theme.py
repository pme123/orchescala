"""Tests of build_theme.py:  python3 -m unittest test_build_theme  (in this folder)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

import base64

from build_theme import MAX_LOGO, clear_white_png, contrast, logo_uri, png_encode, png_rgba, parse_svg, sniff_image, svg_symbol, unread_colours, data_uri_bytes, font_stack, problems, radius, to_hex

HERE = os.path.dirname(os.path.abspath(__file__))


def png(w, h, pixels, ctype=2, filters=(0,), plte=b'', trns=b''):
    """A small PNG of `pixels` (rows of tuples: RGB for type 2, palette indices for type 3), each row
    stored with the next filter of `filters` - to read back with png_rgba."""
    import struct
    import zlib
    bpp = 3 if ctype == 2 else 1
    raw, prev = b'', bytes(w * bpp)
    for y, row in enumerate(pixels):
        line = bytes(v for px in row for v in (px if ctype == 2 else (px,)))
        f = filters[y % len(filters)]
        out = bytearray()
        for x in range(len(line)):
            a = line[x - bpp] if x >= bpp else 0
            b, c = prev[x], (prev[x - bpp] if x >= bpp else 0)
            pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
            pred = (0, a, b, (a + b) // 2, a if pa <= pb and pa <= pc else b if pb <= pc else c)[f]
            out.append((line[x] - pred) & 255)
        raw += bytes((f,)) + bytes(out)
        prev = line
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
            + (chunk(b'PLTE', plte) if plte else b'') + (chunk(b'tRNS', trns) if trns else b'')
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


W = (255, 255, 255)
# a logo on a white box: black, a soft (half) edge, the bank's blue
LOGO = [[W, W, W, W], [W, (0, 0, 0), (128, 128, 128), W], [W, (0, 119, 185), W, W], [W, W, W, W]]


class LogoBackground(unittest.TestCase):
    def pixel(self, data, x, y):
        w, h, rows = png_rgba(data)
        return tuple(rows[y][4 * x:4 * x + 4])

    def test_png_filters_are_read(self):
        for f in range(5):
            data = png(4, 4, LOGO, filters=(f,))
            self.assertEqual(self.pixel(data, 1, 2), (0, 119, 185, 255), f'filter {f}')
            self.assertEqual(self.pixel(data, 2, 1), (128, 128, 128, 255), f'filter {f}')

    def test_white_box_becomes_transparent(self):
        out, reason = clear_white_png(png(4, 4, LOGO, filters=(0, 1, 2, 4)))
        self.assertIsNone(reason)
        self.assertEqual(self.pixel(out, 0, 0), (0, 0, 0, 0))
        self.assertEqual(self.pixel(out, 1, 1), (0, 0, 0, 255))
        self.assertEqual(self.pixel(out, 2, 1), (0, 0, 0, 127))  # the soft edge: black, half - no grey seam
        r, g, b, a = self.pixel(out, 1, 2)
        self.assertEqual(a, 255)
        self.assertEqual((r, g, b), (0, 119, 185))  # the colour stays

    def test_palette_png(self):
        data = png(3, 3, [[0, 0, 0], [0, 1, 0], [0, 0, 0]], ctype=3, plte=bytes((255, 255, 255, 0, 75, 135)), filters=(4,))
        out, reason = clear_white_png(data)
        self.assertIsNone(reason)
        self.assertEqual(self.pixel(out, 0, 0)[3], 0)
        self.assertEqual(self.pixel(out, 1, 1), (0, 75, 135, 255))

    def test_already_transparent_stays(self):
        data = png(2, 2, [[0, 0], [0, 1]], ctype=3, plte=bytes((255, 255, 255, 0, 75, 135)), trns=b'\x00')
        out, reason = clear_white_png(data)
        self.assertIs(out, data)
        self.assertIsNone(reason)

    def test_coloured_box_stays(self):
        blue = (0, 119, 185)
        data = png(3, 3, [[blue] * 3, [blue, W, blue], [blue] * 3])
        out, reason = clear_white_png(data)
        self.assertIs(out, data)
        self.assertEqual(reason, 'Ecken nicht weiss')

    def test_unread_png_stays(self):
        out, reason = clear_white_png(b'\x89PNG\r\n\x1a\nnonsense')
        self.assertIsNotNone(reason)


class ToHex(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(to_hex('#ABC'), '#aabbcc')
        self.assertEqual(to_hex('#7252ac'), '#7252ac')
        self.assertEqual(to_hex('rgb(114, 82, 172)'), '#7252ac')
        self.assertEqual(to_hex('rgba(114,82,172,0.5)'), '#b8a8d6')  # half on white
        self.assertEqual(to_hex('rgb(114 82 172 / 50%)'), '#b8a8d6')
        self.assertEqual(to_hex('rgb(300, 0, 0)'), '#ff0000')  # clamped
        self.assertEqual(to_hex('rgb(100%, 0%, 0%)'), '#ff0000')

    def test_semi_transparent_as_on_the_page(self):
        self.assertEqual(to_hex('rgba(0, 0, 0, 0.5)'), '#808080')  # on white
        self.assertEqual(to_hex('rgb(0 0 0 / 50%)', over='#000000'), '#000000')
        self.assertEqual(to_hex('rgba(114, 82, 172, 1)'), '#7252ac')

    def test_hsl(self):
        self.assertEqual(to_hex('hsl(0, 100%, 50%)'), '#ff0000')
        self.assertEqual(to_hex('hsl(120deg 100% 25%)'), '#008000')
        self.assertEqual(to_hex('hsla(240, 100%, 50%, 0)'), None)

    def test_none(self):
        for v in (None, '', 'transparent', 'rgba(0, 0, 0, 0)', 'rgb(0 0 0 / 0%)', '#abcde', 'red', 'color(srgb 1 0 0)'):
            self.assertIsNone(to_hex(v), v)

    def test_unread_colours(self):
        ex = {'background': 'transparent', 'text': 'red', 'ctaBackgrounds': [['color(srgb 1 0 0)', 2], ['#004b87', 1]],
              'links': [['rgba(0, 0, 0, 0)', 3]], 'surfaces': []}
        self.assertEqual(unread_colours(ex), ['color(srgb 1 0 0)', 'red'])  # transparent is read (as nothing)
        self.assertEqual(unread_colours({}), [])


class FontStack(unittest.TestCase):
    def test_brand_font_first_then_system(self):
        self.assertEqual(font_stack('ObjektivMedium, "Helvetica Neue", Arial'), 'ObjektivMedium, "Helvetica Neue", Arial, Helvetica, sans-serif')
        self.assertEqual(font_stack('"Frutiger LT", serif'), '"Frutiger LT", Georgia, serif')

    def test_system_body_takes_the_heading_font(self):
        self.assertEqual(font_stack('-apple-system, Arial, sans-serif', ['Brand Sans, Arial']), '"Brand Sans", Arial, Helvetica, sans-serif')
        self.assertEqual(font_stack('system-ui, sans-serif'), 'sans')

    def test_generic_in_any_case(self):
        self.assertEqual(font_stack('"Frutiger LT", SERIF'), '"Frutiger LT", Georgia, serif')
        self.assertEqual(font_stack('Brand, Serif'), 'Brand, Georgia, serif')

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

    def test_logo_payload_is_base64(self):
        self.assertEqual(problems({'logo': 'data:image/png;base64,ab!d'}), ['theme.logo ist kein gültiges base64'])
        self.assertEqual(problems({'logo': 'data:image/png;base64,abc'}), ['theme.logo ist kein gültiges base64'])

    def test_one_message_per_bad_logo(self):
        big_junk = 'data:image/png;base64,' + '!' * (MAX_LOGO * 2)
        self.assertEqual(problems({'logo': big_junk}), ['theme.logo ist kein gültiges base64'])

    def test_svg_symbol_from_a_sprite(self):
        sprite = (b'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs>'
                  b'<symbol id="bank-logo" viewBox="0 0 100 30"><rect width="100" height="30" fill="url(#g)"/></symbol>'
                  b'<symbol id="other"><circle r="1"/></symbol></svg>')
        logo = svg_symbol(sprite, 'bank-logo').decode()
        self.assertIn('viewBox="0 0 100 30"', logo)
        self.assertIn('<rect', logo)
        self.assertIn('linearGradient', logo)  # the defs it references
        self.assertNotIn('circle', logo)  # not the other symbols
        self.assertNotIn('<symbol', logo)
        with self.assertRaises(SystemExit):
            svg_symbol(sprite, 'missing')

    def test_shared_colour_cases(self):
        # the same table as 04-orch-spec/tests/pagesTheme.test.ts
        with open(os.path.join(HERE, 'colour-cases.json')) as f:
            cases = json.load(f)
        for c in cases['valid']:
            self.assertIsNotNone(to_hex(c), c)
        for c in cases['invalid']:
            self.assertIsNone(to_hex(c), c)

    def test_svg_style_cannot_load_from_outside(self):
        svg = (b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/a.css);</style>'
               b'<rect style="fill:url(https://evil.example/p.svg#g)" width="1"/>'
               b'<rect style="fill:url(#local)" width="2"/></svg>')
        import xml.etree.ElementTree as ET
        out = ET.tostring(parse_svg(svg)).decode()
        self.assertNotIn('evil.example', out)
        self.assertNotIn('style>', out)
        self.assertIn('url(#local)', out)

    def test_colour_rules_as_theme_ts(self):
        self.assertEqual(to_hex('#f008'), to_hex('rgba(255, 0, 0, 0.533)'))  # #rgba read
        self.assertEqual(to_hex('#ff000080'), '#ff7f7f')  # #rrggbbaa: half red on white
        self.assertIsNone(to_hex('rgb(10%, 20, 30)'))  # commas: no mix
        self.assertEqual(to_hex('rgb(100% 0 0)'), '#ff0000')  # spaces may mix
        self.assertIsNone(to_hex('rgb(1.2.3, 0, 0)'))  # read as nothing - no crash
        self.assertEqual(unread_colours({'text': 'rgb(1.2.3, 0, 0)'}), ['rgb(1.2.3, 0, 0)'])

    def test_font_allowlist(self):
        self.assertEqual(problems({'font': '"Frutiger LT", Arial, sans-serif'}), [])
        self.assertEqual(problems({'font': 'Société Générale, -apple-system'}), [])
        for font in ('a(b)', 'x/y', 'a: b', 'a!important'):
            self.assertTrue(problems({'font': font}), font)

    def test_svg_from_the_site_is_cleaned(self):
        svg = (b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script>'
               b'<foreignObject><div/></foreignObject><use href="https://evil.example/x.svg#a"/>'
               b'<use href="#ok"/><rect onclick="x()" width="1"/></svg>')
        import xml.etree.ElementTree as ET
        out = ET.tostring(parse_svg(svg)).decode()
        for bad in ('alert', 'script', 'foreignObject', 'evil.example', 'onclick', 'onload'):
            self.assertNotIn(bad, out)
        self.assertIn('href="#ok"', out)
        self.assertIn('rect', out)

    def test_svg_not_in_utf8_is_refused(self):
        bomb = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg/>'.encode('utf-16')
        with self.assertRaises(SystemExit):
            parse_svg(bomb)
        with self.assertRaises(SystemExit):
            parse_svg(b'<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"/>')
        self.assertIsNotNone(parse_svg('\ufeff<svg xmlns="http://www.w3.org/2000/svg"/>'.encode('utf-8')))  # UTF-8 BOM

    def test_rgb_numbers_are_clamped(self):
        self.assertEqual(to_hex('rgb(300, 0, 0)'), '#ff0000')
        self.assertEqual(to_hex('rgb(300 0 0)'), '#ff0000')

    def test_logo_type_by_its_content(self):
        self.assertEqual(sniff_image(b'\x89PNG\r\n\x1a\n....'), 'image/png')
        self.assertEqual(sniff_image(b'\xff\xd8\xff\xe0'), 'image/jpeg')
        self.assertEqual(sniff_image(b'GIF89a...'), 'image/gif')
        self.assertEqual(sniff_image(b'RIFF\x00\x00\x00\x00WEBPVP8 '), 'image/webp')
        self.assertEqual(sniff_image(b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')
        self.assertIsNone(sniff_image(b'<html><body>not found</body></html>'))  # an error page saved as logo.png
        with tempfile.TemporaryDirectory() as d:
            fake = os.path.join(d, 'logo.png')
            with open(fake, 'wb') as f:
                f.write(b'<html>404</html>')
            with self.assertRaises(SystemExit):
                logo_uri(fake)

    def test_svg_animation_is_removed(self):
        svg = (b'<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><set attributeName="href" to="javascript:alert(1)"/>'
               b'<animate attributeName="href" values="javascript:alert(2)"/><rect width="1"/></a>'
               b'<rect fill="javascript:x" width="2"/></svg>')
        import xml.etree.ElementTree as ET
        out = ET.tostring(parse_svg(svg)).decode()
        self.assertNotIn('javascript', out)
        self.assertNotIn('animate', out)
        self.assertNotIn('set ', out)
        self.assertIn('rect', out)

    def test_svg_links_and_styles_out(self):
        svg = (b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
               b'<use href="http://evil.example/s.svg#a"/><use xlink:href="https://evil.example/s.svg#b"/>'
               b'<a href=" JaVaScript:alert(1)"><rect width="1"/></a>'
               b'<rect style="background:url(http://evil.example/p.png)" width="2"/>'
               b'<rect style="fill: URL( \'https://evil.example/g\' )" width="3"/>'
               b'<use xlink:href="#ok"/></svg>')
        import xml.etree.ElementTree as ET
        out = ET.tostring(parse_svg(svg)).decode()
        self.assertNotIn('evil.example', out)
        self.assertNotIn('JaVaScript', out)
        self.assertIn('#ok', out)

    def test_svg_symbol_keeps_its_sizing_and_is_drawn(self):
        sprite = (b'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/>'
                  b'<symbol id="logo" viewBox="0 0 10 5" preserveAspectRatio="xMinYMid meet"><rect fill="url(#g)"/></symbol>'
                  b'</defs></svg>')
        out = svg_symbol(sprite, 'logo').decode()
        self.assertIn('preserveAspectRatio="xMinYMid meet"', out)
        self.assertIn('linearGradient', out)
        self.assertEqual(out.count('<rect'), 1)  # once, outside <defs> - drawn
        self.assertNotIn('<symbol', out)
        bare = (b'<svg xmlns="http://www.w3.org/2000/svg"><g id="mark" width="40" height="20"><rect/></g></svg>')
        out2 = svg_symbol(bare, 'mark').decode()
        self.assertIn('width="40"', out2)

    def test_svg_image_elements_are_removed(self):
        svg = (b'<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/>'
               b'<filter id="f"><feImage href="https://evil.example/x.png"/></filter><rect width="1"/></svg>')
        import xml.etree.ElementTree as ET
        out = ET.tostring(parse_svg(svg)).decode()
        self.assertNotIn('image', out.lower())
        self.assertIn('rect', out)

    def test_svg_with_entities_is_refused(self):
        bomb = b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>'
        with self.assertRaises(SystemExit):
            parse_svg(bomb)

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

    def test_unread_colours_are_named(self):
        p, theme = self.run_script({'background': '#ffffff', 'ctaBackgrounds': [['color(display-p3 1 0 0)', 3], ['#004b87', 1]]})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(theme['primary'], '#004b87')
        self.assertIn('WARN Farben der Seite nicht gelesen', p.stdout)

    def test_logo_on_white_becomes_transparent_in_light_mode(self):
        with tempfile.TemporaryDirectory() as d:
            logo = os.path.join(d, 'logo.png')
            with open(logo, 'wb') as f:
                f.write(png(4, 4, LOGO))
            light = {'background': '#ffffff', 'ctaBackgrounds': [['#004b87', 1]]}
            p, theme = self.run_script(light, '--logo', logo)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn('transparent gemacht', p.stdout)
            data = base64.b64decode(theme['logo'].split(',', 1)[1])
            self.assertEqual(png_rgba(data)[2][0][3], 0)
            p, theme = self.run_script(light, '--logo', logo, '--keep-logo-background')
            self.assertEqual(base64.b64decode(theme['logo'].split(',', 1)[1]), png(4, 4, LOGO))
            p, theme = self.run_script({'background': '#101418', 'ctaBackgrounds': [['#004b87', 1]]}, '--logo', logo)
            self.assertEqual(theme['mode'], 'dark')
            self.assertEqual(base64.b64decode(theme['logo'].split(',', 1)[1]), png(4, 4, LOGO))  # a dark logo would vanish

    def test_missing_logo_file_is_a_message(self):
        p, theme = self.run_script({'background': '#ffffff'}, '--logo', '/nonexistent/logo.svg')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('lässt sich nicht lesen', p.stderr)
        self.assertNotIn('Traceback', p.stderr)

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
