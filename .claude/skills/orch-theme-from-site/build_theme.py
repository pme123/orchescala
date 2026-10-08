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
import mimetypes
import re
import sys
from datetime import date

MAX_LOGO = 200 * 1024
GENERIC = {'serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace'}


UNPARSED = []  # colours of the site to_hex could not read - main() warns about them


def to_hex(color, over='#ffffff'):
    """#rgb/#rrggbb, rgb(…)/rgba(…), hsl(…)/hsla(…) -> #rrggbb; a semi-transparent colour as it looks on
    `over` (the page, white by default). None for transparent - and for what it cannot read (e.g.
    color(…), a name), which is noted in UNPARSED."""
    if not color:
        return None
    c = color.strip().lower()
    m = re.fullmatch(r'#([0-9a-f]{3}|[0-9a-f]{6})', c)
    if m:
        h = m.group(1)
        return '#' + (''.join(ch * 2 for ch in h) if len(h) == 3 else h)
    if c == 'transparent':
        return None
    sep = r'(?:\s*,\s*|\s+)'
    alpha_part = r'(?:\s*[,/]\s*([\d.]+%?))?'
    m = re.fullmatch(rf'rgba?\(\s*([\d.]+%?){sep}([\d.]+%?){sep}([\d.]+%?){alpha_part}\s*\)', c)
    if m:
        rgb = [min(255.0, float(v[:-1]) * 2.55 if v.endswith('%') else float(v)) for v in m.groups()[:3]]
    else:
        m = re.fullmatch(rf'hsla?\(\s*(-?[\d.]+)(?:deg)?{sep}([\d.]+)%{sep}([\d.]+)%{alpha_part}\s*\)', c)
        if not m:
            UNPARSED.append(color)
            return None
        hue, sat, light = float(m.group(1)) % 360, min(1.0, float(m.group(2)) / 100), min(1.0, float(m.group(3)) / 100)
        k = lambda n: (n + hue / 30) % 12
        f = lambda n: light - sat * min(light, 1 - light) * max(-1, min(k(n) - 3, 9 - k(n), 1))
        rgb = [f(0) * 255, f(8) * 255, f(4) * 255]
    alpha = m.group(4)
    a = 1.0 if alpha is None else min(1.0, float(alpha[:-1]) / 100 if alpha.endswith('%') else float(alpha))
    if a == 0:
        return None
    base = [int(over[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(a * v + (1 - a) * b):02x}' for v, b in zip(rgb, base))


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
    fallback = ['Georgia', 'serif'] if generic in ('serif', 'ui-serif') else ['Arial', 'Helvetica', 'sans-serif']
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


def logo_uri(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) > MAX_LOGO:
        sys.exit(f'Das Logo hat {len(data) // 1024} KB - bis 200 KB (z.B. als SVG oder kleiner skaliert).')
    mime = 'image/svg+xml' if path.lower().endswith('.svg') else mimetypes.guess_type(path)[0] or 'image/png'
    if mime not in LOGO_TYPES:
        sys.exit(f'{path} ist kein Logo, das die App nimmt ({mime}; PNG, JPEG, GIF, WebP oder SVG).')
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
    # font names only: nothing that loads from outside (url(…), @import) or escapes CSS (backslash)
    if 'font' in theme and re.search(r'[;{}<>\\@]|url\s*\(', theme['font'], re.I):
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
        if data_uri_bytes(logo) > MAX_LOGO:
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
    if UNPARSED:
        warnings.append('Farben der Seite nicht gelesen (übergangen): ' + ', '.join(sorted(set(UNPARSED))[:5]))
    if a.logo:
        theme['logo'] = logo_uri(a.logo)
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
