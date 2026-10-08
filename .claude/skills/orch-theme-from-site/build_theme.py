#!/usr/bin/env python3
"""Builds an orch-spec theme file from what extract.js read on the bank's website.

    python3 build_theme.py extracted.json --name "Acme Bank" [--logo logo.svg] [--primary "#004b87"] -o acme-theme.json

extracted.json is the object extract.js returned. The choices (primary colour, font, corners) are
taken from it; --primary / --background / --text / --font / --radius override them. The output is
{ kind: 'orch-theme', version: 1, name, source, theme }, checked like orch-spec's themeProblem
(04-orch-spec/src/pages/runtime/theme.ts): colours as #rrggbb, the logo as a data: URI up to 200 KB.
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


def to_hex(color):
    """rgb(…)/rgba(…)/#rgb/#rrggbb -> #rrggbb, None for transparent or unknown."""
    if not color:
        return None
    c = color.strip().lower()
    m = re.fullmatch(r'#([0-9a-f]{3}|[0-9a-f]{6})', c)
    if m:
        h = m.group(1)
        return '#' + (''.join(ch * 2 for ch in h) if len(h) == 3 else h)
    m = re.fullmatch(r'rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)', c)
    if not m:
        return None
    alpha = m.group(4)
    if alpha is not None and float(alpha.rstrip('%')) == 0:
        return None
    return '#' + ''.join(f'{min(255, round(float(v))):02x}' for v in m.groups()[:3])


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
        return font_stack(brand) if brand else 'sans'
    
    generic = next((n for n in names if n.lower() in GENERIC), None)
    named = [n for n in names if n.lower() not in GENERIC][:2]
    if not named:
        return {'serif': 'serif', 'monospace': 'mono', 'ui-monospace': 'mono'}.get((generic or '').lower(), 'sans')
    fallback = 'Georgia, serif' if generic in ('serif', 'ui-serif') else 'Arial, Helvetica, sans-serif'
    return ', '.join(f'"{n}"' if ' ' in n else n for n in named) + ', ' + fallback


def radius(px_values):
    for value, _ in px_values or []:
        m = re.match(r'([\d.]+)px', value or '')
        if m:
            px = float(m.group(1))
            return 'none' if px < 1.5 else 'sm' if px < 5 else 'md' if px < 10 else 'lg' if px < 16 else 'xl'
    return None


def logo_uri(path):
    data = open(path, 'rb').read()
    if len(data) > MAX_LOGO:
        sys.exit(f'Das Logo hat {len(data) // 1024} KB - bis 200 KB (z.B. als SVG oder kleiner skaliert).')
    mime = 'image/svg+xml' if path.endswith('.svg') else mimetypes.guess_type(path)[0] or 'image/png'
    if not mime.startswith('image/'):
        sys.exit(f'{path} ist kein Bild ({mime}).')
    return f'data:{mime};base64,{base64.b64encode(data).decode()}'


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
    ex = json.load(open(a.extracted))

    primary = to_hex(a.primary) if a.primary else pick_primary(ex)
    background = to_hex(a.background or ex.get('background')) or '#ffffff'
    text = to_hex(a.text or ex.get('text')) or '#1a1a1a'
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
    if a.logo:
        theme['logo'] = logo_uri(a.logo)
    theme = {k: v for k, v in theme.items() if v}

    out = {'kind': 'orch-theme', 'version': 1, 'name': a.name, 'source': ex.get('url'),
           'extracted': date.today().isoformat(), 'theme': theme}
    json.dump(out, open(a.out, 'w'), indent=2, ensure_ascii=False)
    shown = {k: (v if k != 'logo' else f'data:… ({len(v) * 3 // 4 // 1024} KB)') for k, v in theme.items()}
    print(json.dumps(shown, indent=2, ensure_ascii=False))
    for w in warnings:
        print('WARN', w)


if __name__ == '__main__':
    main()
