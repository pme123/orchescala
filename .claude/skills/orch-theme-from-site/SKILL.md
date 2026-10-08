---
name: orch-theme-from-site
description: Create an orch-spec theme (colours, font, corners, logo) for the pages of an app from a bank's or company's public website, as a JSON file to import in orch-spec (Admin → «Theme der App»). Use when someone wants the app's pages to look like the bank's site, or asks for an "orch theme", "Theme der App", "Auftritt aus der Website".
---

# orch-theme-from-site

Turn the public website of a bank (or any company) into a theme for the pages of an orch-spec app:
the primary colour of its buttons, background, text colour, font, corners and logo. The result is one
file, `<slug>-theme.json`, which the user imports in orch-spec under **Admin → Theme der App** (or
**Seiten → App → Auftritt**) and saves. It ends up in `pages/app.json` as `theme`.

The format is defined in `04-orch-spec/src/pages/runtime/spec.ts` (`Theme`) and checked by
`themeProblem` in `04-orch-spec/src/pages/runtime/theme.ts`:

```json
{ "kind": "orch-theme", "version": 1, "name": "Acme Bank", "source": "https://www.acme.example/",
  "theme": { "primary": "#004b87", "onPrimary": "#ffffff", "background": "#ffffff", "surface": "#f4f6f8",
             "text": "#1a1a1a", "font": "\"Frutiger\", Arial, Helvetica, sans-serif", "radius": "sm",
             "logo": "data:image/svg+xml;base64,…", "mode": "light" } }
```

Two rules of the bank zone shape it: the logo is a `data:` URI (at most 200 KB) - the app must not
load anything from outside - and the font is a stack of system fonts, not a web font.

## Steps

1. **Ask for the URL** if the user gave none, and the name for the theme (e.g. «Acme Bank»). Use the
   public home page; never log in, never fill forms, accept no cookies beyond the minimum (decline
   non-essential consent).

2. **Open the page in a browser** - the built-in browser pane (`mcp__Claude_Browser__*`) unless the
   user asks for Chrome. Wait until it has rendered (a few seconds), close a cookie banner by declining.

3. **Read the styles**: run the contents of `extract.js` (next to this file) with the browser's
   `javascript_exec`. It returns the computed background, text colour, font, the colours of the call-to-
   action buttons and links (with counts), button corners, card surfaces, and the logo as `logoUrl`
   or small inline `logoSvg`. Save the returned object as `extracted.json` in the scratchpad.

   If the browser is not available, fall back to fetching the HTML and its main CSS and read the same
   values by hand (fewer guarantees; say so).

4. **Get the logo** into the scratchpad:
   - `logoSvg`: write it to `logo.svg`.
   - `logoUrl`: `curl -sL -o logo.<ext> "<logoUrl>"` (the extension from the URL or content type).
   - Prefer an SVG; a PNG over 200 KB needs a smaller variant (look for another `img` or an
     `apple-touch-icon`) - do not try to recompress it.
   - If none fits, leave the logo out and say so.

5. **Build the file** with `build_theme.py` from the folder of this skill - `.claude/skills/orch-theme-from-site/`
   in the Orchescala repo, or `~/.claude/skills/orch-theme-from-site/` when installed personally:
   ```bash
   python3 <skill folder>/build_theme.py extracted.json --name "<Name>" --logo logo.svg -o <slug>-theme.json
   ```
   It picks the primary colour (the most frequent coloured button, else link colour), maps the font to
   a system stack and the corners to `none/sm/md/lg/xl`, chooses the text on the primary colour by
   contrast, and prints the theme and any `WARN` lines (contrast below 4.5:1, no primary colour found).

6. **Check the choice** with the user before they import it: show the colours (hex), font and corners
   and mention any warning. If the primary colour is clearly wrong (e.g. a promo banner colour), rerun
   with `--primary "#…"`; the same for `--background`, `--text`, `--font`, `--radius`.

7. **Hand over**: tell the user where the file is and how to import it:
   orch-spec → **Admin** → **Theme der App** → «Theme importieren (JSON)» → check the sample → **Speichern**.
   The designer's preview and the app (`/app/<projekt>/`, after `build:pages`, or at once on the
   `dev:pages` server) then show it.

## Notes

- Only the visual identity is taken: colours, font name, corner size, logo. No texts, images or
  layout of the site.
- The theme applies to the light mode; the primary colour, font and corners also to the dark mode.
  `mode` only sets the default - each user can still switch.
- Keep the file next to the project (e.g. `spec/pages/` of the project or the customer's folder) so
  it can be imported again.
