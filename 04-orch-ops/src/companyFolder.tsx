// The company's folder for this app. The local docs preview (prepareDocs) serves it as
// `folder.json` next to index.html - by convention `00-docs/testdata/ops` of the company project.
// A browser cannot be handed a folder, so it is only shown as a hint on the start screen:
// the path to paste into the folder dialog. Without the preview there is no such file.
// Keep in sync with ../../04-orch-spec/src/companyFolder.tsx (the two apps share no package).
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** The path from `folder.json` - or null for anything else (e.g. the dev server's index.html). */
export function parseFolderJson(json: unknown): string | null {
  const path = (json as { path?: unknown } | null)?.path;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

export function useCompanyFolder(): string | null {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('folder.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setPath(parseFolderJson(j)); })
      .catch(() => { /* no preview - no hint */ });
    return () => { alive = false; };
  }, []);
  return path;
}

/** The company folder with a copy button - for the folder dialog (macOS: ⌘⇧G, then paste). */
export function CompanyFolderHint({ path, muted }: { path: string; muted: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (s: 'copied' | 'failed') => {
    setState(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };
  const copy = () => {
    // no clipboard (insecure context) or permission denied: say so instead of nothing
    (navigator.clipboard?.writeText(path) ?? Promise.reject(new Error('no clipboard')))
      .then(() => show('copied'), () => show('failed'));
  };
  return (
    <span className="block mt-2">
      Ordner der Firma:{' '}
      <span className="font-mono break-all">{path}</span>{' '}
      <button type="button" onClick={copy} title="Pfad kopieren — im Ordner-Dialog mit ⌘⇧G einfügen"
        className={`inline-flex items-center gap-1 align-middle hover:underline ${muted}`}>
        {state === 'copied' ? <Check size={10} /> : <Copy size={10} />}{' '}
        {state === 'copied' ? 'kopiert' : state === 'failed' ? 'nicht kopiert — Pfad markieren' : 'kopieren'}
      </button>
    </span>
  );
}
