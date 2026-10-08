#!/usr/bin/env python3
"""Builds an orch-spec theme file from what extract.js read on the bank's website.

    python3 build_theme.py extracted.json --name "Acme Bank" [--logo logo.svg] [--primary "#004b87"] -o acme-theme.json

extracted.json is the object extract.js returned. The choices (primary colour, font, corners) are
taken from it; --primary / --background / --text / --font / --radius override them. The output is
{ kind: 'orch-theme', version: 1, name, source, theme }. Before it is written, problems() checks it
like orch-spec's themeProblem (04-orch-spec/src/pages/runtime/theme.ts) - a stricter subset, for what
this script writes: colours as #rrggbb, a known radius and mode, a font without CSS syntax, the logo as an image
data: URI up to 200 KB.
"""
import argparse
import base64
import json
import re
import sys
from datetime import date

MAX_LOGO = 200 * 1024
GENERIC = {'serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace'}


def _rgba(color):
    """#rgb/#rrggbb, rgb(…)/rgba(…), hsl(…)/hsla(…) -> ([r, g, b] 0…255, alpha 0…1); None for what it
    cannot read (e.g. color(…), a name); 'transparent' is alpha 0."""
    c = color.strip().lower()
    m = re.fullmatch(r'#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})', c)
    if m:
        h = m.group(1)
        h = ''.join(ch * 2 for ch in h) if len(h) <= 4 else h
        return [int(h[i:i + 2], 16) for i in (0, 2, 4)], int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    if c == 'transparent':
        return [0, 0, 0], 0.0
    sep = r'(?:\s*,\s*|\s+)'
    num = r'\d+(?:\.\d+)?|\.\d+'
    alpha_part = rf'(?:\s*[,/]\s*((?:{num})%?))?'
    m = re.fullmatch(rf'rgba?\(\s*((?:{num})%?){sep}((?:{num})%?){sep}((?:{num})%?){alpha_part}\s*\)', c)
    # with commas: all numbers or all percent - CSS takes no mix (as theme.ts)
    if m and ',' in c and len({v.endswith('%') for v in m.groups()[:3]}) > 1:
        return None
    if m:
        rgb = [min(255.0, float(v[:-1]) * 2.55 if v.endswith('%') else float(v)) for v in m.groups()[:3]]
    else:
        m = re.fullmatch(rf'hsla?\(\s*(-?(?:{num}))(?:deg)?{sep}({num})%{sep}({num})%{alpha_part}\s*\)', c)
        if not m:
            return None
        hue, sat, light = float(m.group(1)) % 360, min(1.0, float(m.group(2)) / 100), min(1.0, float(m.group(3)) / 100)
        k = lambda n: (n + hue / 30) % 12
        f = lambda n: light - sat * min(light, 1 - light) * max(-1, min(k(n) - 3, 9 - k(n), 1))
        rgb = [f(0) * 255, f(8) * 255, f(4) * 255]
    alpha = m.group(4)
    a = 1.0 if alpha is None else min(1.0, float(alpha[:-1]) / 100 if alpha.endswith('%') else float(alpha))
    return rgb, a


def to_hex(color, over='#ffffff'):
    """A colour -> #rrggbb; a semi-transparent one as it looks on `over` (the page, white by default).
    None for transparent and for what it cannot read (see unread_colours)."""
    if not color:
        return None
    try:
        parsed = _rgba(color)
    except ValueError:  # a number the pattern let through but float() does not take
        parsed = None
    if parsed is None or parsed[1] == 0:
        return None
    rgb, a = parsed
    base = [int(over[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(a * v + (1 - a) * b):02x}' for v, b in zip(rgb, base))


def unread_colours(ex):
    """The colours in extracted.json to_hex cannot read - main() warns about them."""
    values = [ex.get(k) for k in ('background', 'text', 'headerBackground')]
    for key in ('ctaBackgrounds', 'ctaTexts', 'links', 'surfaces'):
        values += [v for v, _ in ex.get(key) or []]
    return sorted({v for v in values if isinstance(v, str) and v.strip() and _rgba(v) is None})


def luminance(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in (r, g, b)]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def is_greyish(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return max(r, g, b) - min(r, g, b) < 18


def pick_primary(ex):
    """The most frequent coloured CTA background, else the most frequent coloured link colour."""
    for key in ('ctaBackgrounds', 'links'):
        for value, _ in ex.get(key) or []:
            h = to_hex(value)
            if h and not is_greyish(h):
                return h
    return None


SYSTEM = {'-apple-system', 'blinkmacsystemfont', 'system-ui', 'segoe ui', 'roboto', 'helvetica neue', 'arial', 'noto sans',
          'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'helvetica'}


def font_stack(family, headings=()):
    """The site's font as a stack of system fonts: the named font first (if a visitor has it), then a
    generic fallback - in the bank zone there are no web fonts from outside. A body in the system
    stack is `sans`; then the brand font of the headings (if any) goes first."""
    if not family:
        return None
    names = [f.strip().strip('"\'') for f in family.split(',') if f.strip()]
    if all(n.lower() in SYSTEM | GENERIC for n in names):
        brand = next((h for h in headings if any(n.strip().strip('"\'').lower() not in SYSTEM | GENERIC for n in h.split(','))), None)
        # one level only: brand has a non-system name, so the call does not come back here
        return font_stack(brand) if brand else 'sans'

    generic = next((n for n in names if n.lower() in GENERIC), None)
    named = [n for n in names if n.lower() not in GENERIC][:2]
    if not named:
        return {'serif': 'serif', 'monospace': 'mono', 'ui-monospace': 'mono'}.get((generic or '').lower(), 'sans')
    fallback = ['Georgia', 'serif'] if (generic or '').lower() in ('serif', 'ui-serif') else ['Arial', 'Helvetica', 'sans-serif']
    stack = named + [f for f in fallback if f.lower() not in {n.lower() for n in named}]
    return ', '.join(f'"{n}"' if ' ' in n else n for n in stack)


def radius(px_values):
    for value, _ in px_values or []:
        m = re.match(r'([\d.]+)px', value or '')
        if m:
            px = float(m.group(1))
            return 'none' if px < 1.5 else 'sm' if px < 5 else 'md' if px < 10 else 'lg' if px < 16 else 'xl'
    return None


LOGO_TYPES = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'}


SVG_NS = 'http://www.w3.org/2000/svg'


def parse_svg(data):
    """An SVG from the bank's site (untrusted) as a tree - no DOCTYPE or entities (they could expand to
    gigabytes in the parser), and without what an SVG could run or load from outside: <script>,
    <foreignObject>, <style> (it could @import or url(http…)), SMIL animation (<set>, <animate…>),
    on* handlers, javascript:/data: values, links and style attributes pointing elsewhere than a
    #fragment. A blocklist of the known ways - the guarantee is that the app shows the logo only as
    <img>, which runs and loads nothing."""
    import xml.etree.ElementTree as ET
    ET.register_namespace('', SVG_NS)
    ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
    # UTF-8 only: in UTF-16 (or another encoding) the DOCTYPE check below would not see the declaration
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        sys.exit('Das SVG ist nicht in UTF-8 - so wird es nicht gelesen.')
    if re.search(r'<!(DOCTYPE|ENTITY)', text, re.I):
        sys.exit('Das SVG hat eine DOCTYPE- oder ENTITY-Angabe - so wird es nicht gelesen.')
    if re.search(r'<\?xml[^>]*encoding\s*=\s*["\'](?!utf-?8)', text[:200], re.I):
        sys.exit('Das SVG erklärt eine andere Kodierung als UTF-8 - so wird es nicht gelesen.')
    try:
        root = ET.fromstring(text.encode('utf-8'))
    except ET.ParseError as e:
        sys.exit(f'Das Logo ist kein SVG: {e}.')
    # also SMIL animation: <set attributeName="href" to="javascript:…"> or <animate> could change links later
    removed = ('script', 'foreignObject', 'style', 'set', 'animate', 'animateMotion', 'animateTransform', 'discard',
               'image', 'feImage')  # the same as theme.ts svgDropsElement (an imported logo is cleaned there)
    dangerous = {f'{{{SVG_NS}}}{t}' for t in removed} | set(removed)
    outside = re.compile(r'url\(\s*[\'"]?(?!#)|@import|expression\(', re.I)
    for parent in list(root.iter()):
        for child in list(parent):
            if child.tag in dangerous:
                parent.remove(child)
    for el in root.iter():
        for name in list(el.attrib):
            local = name.split('}')[-1].lower()
            value = el.attrib[name]
            if local.startswith('on') or (local == 'href' and not value.startswith('#')) or outside.search(value) \
                    or re.match(r'\s*(javascript|data|vbscript):', value, re.I):
                del el.attrib[name]
    return root


def _without(tree, element):
    """A copy of `tree` without `element` (and what is in it)."""
    import copy
    clone = copy.deepcopy(tree)
    for parent in clone.iter():
        for child in list(parent):
            if child.get('id') is not None and child.get('id') == element.get('id'):
                parent.remove(child)
    return clone


def svg_symbol(data, symbol_id):
    """One <symbol> (or element) of an SVG sprite as an SVG of its own - with the sprite's <defs> it may
    reference (gradients, clip paths). A sprite of symbols alone draws nothing: as a logo it is blank."""
    import xml.etree.ElementTree as ET
    root = parse_svg(data)
    found = next((el for el in root.iter() if el.get('id') == symbol_id), None)
    if found is None:
        sys.exit(f'Kein Element mit id «{symbol_id}» in der Sprite-Datei.')
    svg = ET.Element(f'{{{SVG_NS}}}svg')
    # what sizes and fits it: of a <symbol> its viewBox and preserveAspectRatio, of a bare element also
    # its width and height
    keep = ('viewBox', 'preserveAspectRatio') + (('width', 'height') if found.tag != f'{{{SVG_NS}}}symbol' else ())
    for name in keep:
        if found.get(name):
            svg.set(name, found.get(name))
    # the sprite's <defs> - without the logo itself, if it sits in one (it is added below, drawn)
    for defs in list(root.iter(f'{{{SVG_NS}}}defs')):
        if found in defs.iter():
            defs = _without(defs, found)
        svg.append(defs)
    if found.tag == f'{{{SVG_NS}}}symbol':
        for child in list(found):
            svg.append(child)
    else:
        svg.append(found)
    return ET.tostring(svg, encoding='utf-8')


def sniff_image(data):
    """The type of an image by its first bytes - None if it is none the app takes (the extension of a
    downloaded file says little)."""
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    head = data[:1024].lstrip(b'\xef\xbb\xbf \t\r\n')
    if head.startswith((b'<svg', b'<?xml', b'<!--')) and b'<svg' in data[:4096]:
        return 'image/svg+xml'
    return None


def logo_uri(path, symbol_id=None):
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError as e:
        sys.exit(f'Das Logo {path} lässt sich nicht lesen: {e.strerror}.')
    mime = sniff_image(data)
    if mime is None:
        sys.exit(f'{path} ist kein Bild, das die App nimmt (PNG, JPEG, GIF, WebP oder SVG - nach seinem Inhalt).')
    if mime == 'image/svg+xml':
        import xml.etree.ElementTree as ET
        data = svg_symbol(data, symbol_id) if symbol_id else ET.tostring(parse_svg(data), encoding='utf-8')
    elif symbol_id:
        sys.exit(f'--logo-id gibt es nur für eine SVG-Sprite-Datei - {path} ist {mime}.')
    if len(data) > MAX_LOGO:
        sys.exit(f'Das Logo hat {len(data) // 1024} KB - bis 200 KB (z.B. als SVG oder kleiner skaliert).')
    return f'data:{mime};base64,{base64.b64encode(data).decode()}'


def data_uri_bytes(uri):
    """The size of the image in a base64 data: URI - the decoded bytes (as theme.ts dataUriBytes)."""
    b64 = re.sub(r'\s', '', uri[uri.find(',') + 1:])
    return len(b64) * 3 // 4 - (2 if b64.endswith('==') else 1 if b64.endswith('=') else 0)


def problems(theme):
    """What orch-spec's themeProblem would reject in a theme this script writes - an empty list if none.
    A stricter subset: the script writes colours only as #rrggbb (themeProblem also takes rgb()/hsl())."""
    found = []
    for k in ('primary', 'onPrimary', 'background', 'surface', 'text'):
        if k in theme and not re.fullmatch(r'#[0-9a-f]{6}', theme[k]):
            found.append(f'theme.{k} ist keine Farbe #rrggbb: {theme[k]!r}')
    # font names only (as theme.ts FONT_ALLOWED): nothing loads from outside, nothing escapes CSS
    if 'font' in theme and not re.fullmatch(r'[\w\s,"\'.-]+', theme['font']):
        found.append(f'theme.font ist kein Schrift-Stapel: {theme["font"]!r}')
    if 'radius' in theme and theme['radius'] not in ('none', 'sm', 'md', 'lg', 'xl'):
        found.append(f'theme.radius ist nicht none, sm, md, lg oder xl: {theme["radius"]!r}')
    if 'mode' in theme and theme['mode'] not in ('light', 'dark'):
        found.append(f'theme.mode ist nicht light oder dark: {theme["mode"]!r}')
    logo = theme.get('logo')
    if logo is not None:
        if not re.match(r'data:image/(png|jpeg|gif|webp|svg\+xml);base64,', logo):
            found.append('theme.logo ist keine data:-URI eines Bilds')
        elif len(payload := logo[logo.find(',') + 1:]) % 4 or not re.fullmatch(r'[A-Za-z0-9+/]*={0,2}', payload):
            found.append('theme.logo ist kein gültiges base64')
        elif data_uri_bytes(logo) > MAX_LOGO:
            found.append('theme.logo ist grösser als 200 KB')
    return found


def color_arg(name, value):
    """An override from the command line as #rrggbb - an invalid one stops with a clear message."""
    if value is None:
        return None
    h = to_hex(value)
    if not h:
        sys.exit(f'--{name} {value!r} ist keine Farbe (#rgb, #rrggbb oder rgb(…)).')
    return h


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('extracted')
    ap.add_argument('--name', required=True)
    ap.add_argument('--logo')
    ap.add_argument('--logo-id', help='the symbol in an SVG sprite file (logoSpriteId of extract.js)')
    ap.add_argument('--primary')
    ap.add_argument('--background')
    ap.add_argument('--text')
    ap.add_argument('--font')
    ap.add_argument('--radius', choices=['none', 'sm', 'md', 'lg', 'xl'])
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    with open(a.extracted, encoding='utf-8') as f:
        ex = json.load(f)

    primary = color_arg('primary', a.primary) or pick_primary(ex)
    background = color_arg('background', a.background) or to_hex(ex.get('background')) or '#ffffff'
    text = color_arg('text', a.text) or to_hex(ex.get('text')) or '#1a1a1a'
    theme = {
        'primary': primary,
        'background': background,
        'text': text,
        'font': a.font or font_stack(ex.get('font'), ex.get('headingFonts') or []),
        'radius': a.radius or radius(ex.get('ctaRadius')),
        'mode': 'light' if luminance(background) > 0.5 else 'dark',
    }
    # a surface for cards: as light (or as dark) as the background - not a footer or a teaser band
    surfaces = [to_hex(v) for v, _ in ex.get('surfaces') or []]
    light = luminance(background) > 0.5
    surface = next((s for s in surfaces if s and s != background and (luminance(s) > 0.75 if light else luminance(s) < 0.1)), None)
    if surface:
        theme['surface'] = surface
    warnings = []
    if primary:
        cta_text = next((to_hex(v) for v, _ in ex.get('ctaTexts') or [] if to_hex(v)), None)
        on = cta_text if cta_text and contrast(primary, cta_text) >= 4.5 else (
            '#ffffff' if contrast(primary, '#ffffff') >= contrast(primary, '#000000') else '#000000')
        theme['onPrimary'] = on
        if contrast(primary, on) < 4.5:
            warnings.append(f'Text auf der Primärfarbe hat nur Kontrast {contrast(primary, on):.1f}:1 (WCAG: 4.5).')
    else:
        warnings.append('Keine farbige Primärfarbe gefunden - mit --primary setzen.')
    if contrast(background, text) < 4.5:
        warnings.append(f'Text auf dem Hintergrund hat nur Kontrast {contrast(background, text):.1f}:1.')
    unread = unread_colours(ex)
    if unread:
        warnings.append('Farben der Seite nicht gelesen (übergangen): ' + ', '.join(unread[:5]))
    if a.logo:
        theme['logo'] = logo_uri(a.logo, a.logo_id)
    theme = {k: v for k, v in theme.items() if v}
    found = problems(theme)
    if found:
        sys.exit('Das Theme nähme orch-spec nicht an:\n  ' + '\n  '.join(found))

    out = {'kind': 'orch-theme', 'version': 1, 'name': a.name, 'source': ex.get('url'),
           'extracted': date.today().isoformat(), 'theme': theme}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    shown = {k: (v if k != 'logo' else f'data:… ({len(v) * 3 // 4 // 1024} KB)') for k, v in theme.items()}
    print(json.dumps(shown, indent=2, ensure_ascii=False))
    for w in warnings:
        print('WARN', w)


if __name__ == '__main__':
    main()
