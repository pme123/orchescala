// Runs in the page of the bank's website (browser tool: javascript_exec). Reads what a visitor sees:
// computed colours, font, corners, and the logo - and returns raw values for SKILL.md to turn into an
// orch-spec theme. No network: the logo comes back as its address (or as small inline SVG markup).
(async () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  };
  const isColor = (c) => c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c);
  const count = (values) => {
    const m = new Map();
    for (const v of values.filter(Boolean)) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  };

  const body = getComputedStyle(document.body);
  const html = getComputedStyle(document.documentElement);
  const background = isColor(body.backgroundColor) ? body.backgroundColor : html.backgroundColor;

  // call-to-action buttons: the strongest hint for the primary colour
  const ctas = [...document.querySelectorAll('button, a, input[type=submit], [role=button]')]
    .filter(visible)
    .filter((el) => /btn|button|cta|primary|action/i.test(`${el.className} ${el.getAttribute('role') ?? ''}`) || el.tagName === 'BUTTON');
  const ctaBackgrounds = count(ctas.map((el) => getComputedStyle(el).backgroundColor).filter(isColor));
  const ctaTexts = count(ctas.map((el) => isColor(getComputedStyle(el).backgroundColor) ? getComputedStyle(el).color : null));
  const ctaRadius = count(ctas.map((el) => getComputedStyle(el).borderTopLeftRadius));
  const links = count([...document.querySelectorAll('a')].filter(visible).slice(0, 200).map((el) => getComputedStyle(el).color));
  const headings = [...document.querySelectorAll('h1, h2')].filter(visible).slice(0, 5).map((el) => getComputedStyle(el).fontFamily);
  const header = document.querySelector('header, [role=banner], .header, #header');
  const surfaces = count([...document.querySelectorAll('section, article, .card, [class*=card], [class*=teaser]')]
    .filter(visible).slice(0, 80).map((el) => getComputedStyle(el).backgroundColor).filter(isColor));

  // the logo: scored - a link to the home page, «logo» in class/id/alt/src/aria-label, near the top, not an
  // icon, not a hero image; an <img>, an <svg> or a CSS background image; else og:image / touch icon
  const isHome = (href) => {
    if (!href) return false;
    try {
      const u = new URL(href, location.href);
      return u.origin === location.origin && /^\/([a-z]{2}(-[a-z]{2})?\/?)?$/i.test(u.pathname);
    } catch {
      return false;
    }
  };
  const bgUrl = (el) => getComputedStyle(el).backgroundImage.match(/^url\("?([^")]+)"?\)$/)?.[1] ?? null;
  const score = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.width > 400 || r.height < 12 || r.height > 160 || r.top > 300) return -1;
    const a = el.closest('a');
    const text = [el.className?.baseVal ?? el.className, el.id, el.getAttribute('alt'), el.getAttribute('aria-label'), el.getAttribute('src'),
      bgUrl(el), a?.className, a?.getAttribute('aria-label'), a?.getAttribute('title'), el.parentElement?.className].join(' ').toLowerCase();
    let s = 0;
    if (/logo/.test(text)) s += 5;
    if (/icon|help|search|menu|burger|close|arrow|flag/.test(text)) s -= 6;
    if (isHome(a?.getAttribute('href'))) s += 4;
    if (el.closest('header, [role=banner]')) s += 2;
    return s + Math.max(0, 3 - r.top / 100);
  };
  const candidates = [...document.querySelectorAll('img, svg, a *, header *, [class*=logo], [class*=logo] *')]
    .filter((el) => el.tagName.toLowerCase() === 'img' || el.tagName.toLowerCase() === 'svg' || bgUrl(el))
    .filter(visible);
  const logoEl = [...new Set(candidates)].map((el) => ({ el, s: score(el) })).filter((x) => x.s > 4).sort((a, b) => b.s - a.s)[0]?.el;
  // the address of the logo (SKILL.md fetches it with curl) - an inline SVG as markup, if it is small
  let logoUrl = null;
  let logoSvg = null;
  if (logoEl?.tagName.toLowerCase() === 'svg') {
    const svg = logoEl.cloneNode(true);
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // what it references elsewhere in the page (<use href="#logo">, fill="url(#grad)") - into its own
    // <defs>, else the data URI is a blank image; a sprite in another file is left to logoUrl
    const refs = (el) => [...el.querySelectorAll('*'), el].flatMap((n) => [
      ...['href', 'xlink:href'].map((a) => n.getAttribute(a)).filter((h) => h?.startsWith('#')).map((h) => h.slice(1)),
      ...[...n.attributes].flatMap((at) => [...at.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)].map((m) => m[1])),
    ]);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const seen = new Set();
    for (let todo = refs(svg); todo.length; ) {
      const id = todo.shift();
      if (seen.has(id) || svg.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
      seen.add(id);
      const target = document.getElementById(id);
      if (!target) continue;
      const copy = target.cloneNode(true);
      defs.appendChild(copy);
      todo.push(...refs(copy));
    }
    if (defs.childNodes.length) svg.insertBefore(defs, svg.firstChild);
    const external = [...svg.querySelectorAll('use')].map((u) => u.getAttribute('href') || u.getAttribute('xlink:href'))
      .find((h) => h && !h.startsWith('#'));
    if (external) logoUrl = new URL(external.split('#')[0], location.href).href; // the sprite file - SKILL.md step 4
    logoSvg = svg.outerHTML.length < 40000 ? svg.outerHTML : `TOO LARGE (${svg.outerHTML.length} chars)`;
  } else {
    logoUrl = (logoEl && (logoEl.currentSrc || logoEl.src || bgUrl(logoEl)))
      || document.querySelector('meta[property="og:image"]')?.content
      || document.querySelector('link[rel*=apple-touch-icon]')?.href
      || null;
  }

  return {
    url: location.href,
    title: document.title,
    background,
    text: body.color,
    font: body.fontFamily,
    headingFonts: headings,
    headerBackground: header ? getComputedStyle(header).backgroundColor : null,
    ctaBackgrounds,
    ctaTexts,
    ctaRadius,
    links,
    surfaces,
    logoUrl,
    logoAlt: logoEl?.getAttribute?.('alt') ?? null,
    logoSvg,
  };
})();
