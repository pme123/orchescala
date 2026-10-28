## Orchescala Documentation

The documentation on https://pme123.github.io/orchescala/ -
a small Vite/React app renders the markdown pages, one prerendered HTML file per page.

### Content

The content is markdown - in [src/docs](src/docs):

- One page per `.md` file; its first heading is its title.
- The navigation (sections and order) is in [web/nav.ts](web/nav.ts). A page that is not listed
  there is added at the end of the section of its folder.
- Links to other pages use the markdown file: `[Worker](../functionalityDsls/worker.md#mocking)`.
- Images and other files (`images/…`, `exampleApi/…`) are served unchanged under their path.
- Callouts are GitHub alerts - they look the same on GitHub:
  ```markdown
  > [!NOTE]
  > Some info.
  ```
  `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` are supported.
- `<!-- include: other.md -->` (on its own line) puts the content of another page there - such a
  page is listed as a partial in [web/nav.ts](web/nav.ts). It must be in the same folder as the page
  that includes it (its relative links and images are resolved from there).
- `@VERSION@` is replaced with the version from the `version` file.
- Raw HTML works too (`<img src="images/x.png" width="800">`, `<details>` …).

### Development

```bash
cd 00-docs
npm install
npm run dev     # http://localhost:3020/orchescala/
npm run build   # dist/ - what GitHub Pages serves
npm test        # vitest - links, includes, callouts …
npm run lint    # tsc
```

The build fails on a broken include, a link to a page or file that does not exist, a missing image
and an entry in `web/nav.ts` without a page; it warns about a page without a description (the first
paragraph of text) and a code block in a language without highlighting (see `web/markdown.tsx`).

The Scala snippets marked ` ```scala mdoc ` are compiled with [mdoc](https://scalameta.org/mdoc/):
`sbt docs/mdoc` (the release runs it as well).

### Releasing

GitHub Actions deploys the site on each push to `master` ([deploydocu.yml](../.github/workflows/deploydocu.yml)).
