// Die Form einer Seite und der Einstellungen der App - eine Datei von Hand (oder eine ältere) wird
// beim Lesen geprüft: der Renderer verlässt sich auf body als Liste und auf bekannte Bausteine.
import type { Component } from './spec';

const TYPES: ReadonlySet<Component['type']> = new Set([
  'heading', 'text', 'choice', 'pick', 'fields', 'summary', 'button', 'section', 'loading',
]);
const ACTIONS = new Set(['set', 'call', 'start', 'message', 'completeTask']);

const PAGE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Ein Dateiname für eine Seite (pages/{slug}.json), kein Pfad - und nicht die Einstellungen der App (app.json). */
export function pageSlugProblem(slug: string): string | null {
  if (!PAGE_SLUG.test(slug)) return `«${slug}» ist kein Name für eine Seite (a-z, 0-9, -).`;
  if (slug === 'app') return '«app» ist für die Einstellungen der App reserviert.';
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Was an einer Seite nicht stimmt - null, wenn der Renderer sie zeigen kann. */
export function pageProblem(raw: unknown): string | null {
  if (!isObject(raw)) return 'keine Seite (kein Objekt)';
  if (typeof raw.path !== 'string') return '«path» fehlt';
  if (typeof raw.title !== 'string') return '«title» fehlt';
  if (raw.access !== 'public' && !(isObject(raw.access) && Array.isArray(raw.access.roles))) return '«access» ist weder "public" noch { roles: [...] }';
  if (raw.state !== undefined && !isObject(raw.state)) return '«state» ist kein Objekt';
  return actionsProblem(raw.load, 'load') ?? bodyProblem(raw.body, 'body');
}

/** Was an den Einstellungen der App nicht stimmt. */
export function appProblem(raw: unknown): string | null {
  if (!isObject(raw)) return 'keine Einstellungen (kein Objekt)';
  for (const k of ['title', 'subtitle', 'home'] as const)
    if (raw[k] !== undefined && typeof raw[k] !== 'string') return `«${k}» ist kein Text`;
  if (raw.labels !== undefined && !(isObject(raw.labels) && Object.values(raw.labels).every(isObject))) return '«labels» ist nicht { name: { wert: text } }';
  return null;
}

function bodyProblem(body: unknown, at: string): string | null {
  if (!Array.isArray(body)) return `«${at}» ist keine Liste`;
  for (const [i, b] of body.entries()) {
    const here = `${at}[${i}]`;
    if (!isObject(b)) return `${here} ist kein Baustein`;
    if (!TYPES.has(b.type as Component['type'])) return `${here}: unbekannter Baustein «${String(b.type)}»`;
    const problem = (() => {
      switch (b.type) {
        case 'section': return bodyProblem(b.body, `${here}.body`);
        case 'choice': return listProblem(b.options, `${here}.options`) ?? actionsProblem(b.onChange, `${here}.onChange`);
        case 'fields': return listProblem(b.fields, `${here}.fields`);
        case 'summary': return listProblem(b.items, `${here}.items`);
        case 'button': return actionsProblem(b.actions, `${here}.actions`, true);
        default: return null;
      }
    })();
    if (problem) return problem;
  }
  return null;
}

function listProblem(list: unknown, at: string): string | null {
  return Array.isArray(list) && list.every(isObject) ? null : `«${at}» ist keine Liste von Objekten`;
}

function actionsProblem(actions: unknown, at: string, required = false): string | null {
  if (actions === undefined && !required) return null;
  if (!Array.isArray(actions)) return `«${at}» ist keine Liste`;
  for (const [i, a] of actions.entries()) {
    if (!isObject(a) || !ACTIONS.has(a.do as string)) return `${at}[${i}]: unbekannte Aktion «${isObject(a) ? String(a.do) : ''}»`;
    const nested = actionsProblem(a.onError, `${at}[${i}].onError`);
    if (nested) return nested;
  }
  return null;
}
