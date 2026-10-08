// Die Form einer Seite und der Einstellungen der App - eine Datei von Hand (oder eine ältere) wird
// beim Lesen geprüft: der Renderer verlässt sich auf body als Liste und auf bekannte Bausteine.
import type { Component } from './spec';
import { themeProblem } from './theme';

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
  return themeProblem(raw.theme);
}

function bodyProblem(body: unknown, at: string): string | null {
  if (!Array.isArray(body)) return `«${at}» ist keine Liste`;
  for (const [i, b] of body.entries()) {
    const here = `${at}[${i}]`;
    if (!isObject(b)) return `${here} ist kein Baustein`;
    if (!TYPES.has(b.type as Component['type'])) return `${here}: unbekannter Baustein «${String(b.type)}»`;
    // was der Renderer als Text liest (interpolate, evaluate) - eine Zahl dort bräche die ganze Seite
    const problem = (() => {
      switch (b.type) {
        case 'heading':
          return texts(b, here, ['text']);
        case 'text':
          return texts(b, here, ['text'], ['tone']);
        case 'section':
          return texts(b, here, [], ['label']) ?? bodyProblem(b.body, `${here}.body`);
        case 'choice':
          return texts(b, here, ['bind'], ['label'])
            ?? listProblem(b.options, `${here}.options`, (o, at) => texts(o, at, ['label'], ['hint']))
            ?? actionsProblem(b.onChange, `${here}.onChange`);
        case 'pick':
          return texts(b, here, ['bind', 'items', 'itemLabel'], ['label', 'itemHint', 'empty'])
            ?? (b.groupBy === undefined || (isObject(b.groupBy) && typeof b.groupBy.path === 'string') ? null : `${here}.groupBy: { path: … } erwartet`);
        case 'fields':
          return texts(b, here, [], ['label'])
            ?? listProblem(b.fields, `${here}.fields`, (f, at) => texts(f, at, ['bind', 'label'], ['input', 'placeholder', 'visible']));
        case 'summary':
          return texts(b, here, [], ['label'])
            ?? listProblem(b.items, `${here}.items`, (it, at) => texts(it, at, ['label', 'value'], ['visible']));
        case 'button':
          return texts(b, here, ['label']) ?? actionsProblem(b.actions, `${here}.actions`, true);
        case 'loading':
          return texts(b, here, [], ['text']);
        default: return null;
      }
    })();
    if (problem) return problem;
  }
  return null;
}

function listProblem(list: unknown, at: string, each?: (item: Record<string, unknown>, at: string) => string | null): string | null {
  if (!(Array.isArray(list) && list.every(isObject))) return `«${at}» ist keine Liste von Objekten`;
  for (const [i, item] of list.entries()) {
    const problem = each?.(item, `${at}[${i}]`);
    if (problem) return problem;
  }
  return null;
}

/** Pflicht- und freiwillige Texte eines Objekts - `visible` gilt bei jedem Baustein als freiwillig. */
function texts(o: Record<string, unknown>, at: string, required: string[], optional: string[] = []): string | null {
  for (const k of required) if (typeof o[k] !== 'string') return `${at}.${k} ist kein Text`;
  for (const k of [...optional, 'visible']) if (o[k] !== undefined && typeof o[k] !== 'string') return `${at}.${k} ist kein Text`;
  return null;
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
