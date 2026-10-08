// Die Seiten-Spezifikation (E15) – deklarativ, zur Laufzeit gerendert. Eine Seite liest und
// schreibt einen Zustand (state); Texte und Eingaben der Aktionen sind Vorlagen mit {{pfad}}.
//
// Im Zustand stehen zusätzlich: query (die Parameter der URL), user (name, email, roles) und
// was die Aktionen unter `result` ablegen.

/** Eine Bedingung: `pfad`, `!pfad`, `pfad == 'wert'`, `pfad != 'wert'`, `pfad == true` – verknüpft mit
  * `&&` und `||`. `!` nur vor einem Pfad, nicht vor einem Vergleich (`!a == 'x'` ist falsch: `a != 'x'`) –
  * der Designer und der Build melden es. Texte in '…' oder "…", ohne Escape (`"it's"` statt `'it\'s'`). */
export type Cond = string;

/** Fehlertexte nach HTTP-Status ("409") und `default` – der Gateway liefert öffentlich nur den Status. */
export type Errors = Record<string, string>;

export type Action =
  | { do: 'set'; path: string; value: unknown }
  /** Ein Worker/Service: POST /worker/{service} – mit `public` ohne Login über /public/worker */
  | { do: 'call'; service: string; public?: boolean; input?: unknown; result?: string; errors?: Errors; onError?: Action[] }
  /** Ein Prozess starten: POST /process/{process}/async */
  | { do: 'start'; process: string; public?: boolean; businessKey?: string; input?: unknown; result?: string; errors?: Errors; onError?: Action[] }
  /** Eine Message: POST /message/{name} – öffentlich nur mit businessKey */
  | { do: 'message'; name: string; public?: boolean; businessKey: string; input?: unknown; result?: string; errors?: Errors; onError?: Action[] }
  /** Einen Benutzer-Task abschliessen: POST /userTask/{taskKey}/{taskId}/complete */
  | { do: 'completeTask'; taskKey: string; taskId: string; input?: unknown; errors?: Errors; onError?: Action[] };

export type Field = {
  bind: string;
  label: string;
  input?: 'text' | 'email' | 'tel' | 'textarea';
  required?: boolean;
  placeholder?: string;
  visible?: Cond;
};

export type Option = { value: unknown; label: string; hint?: string };

type Base = { visible?: Cond };

export type Component = Base &
  (
    | { type: 'heading'; text: string }
    | { type: 'text'; text: string; tone?: 'muted' | 'success' | 'error' | 'info' }
    /** Eine Auswahl aus festen Werten – als Kacheln */
    | { type: 'choice'; bind: string; label?: string; options: Option[]; required?: boolean; onChange?: Action[] }
    /** Eine Auswahl aus einer Liste im Zustand (z.B. freie Termine), gruppiert */
    | {
        type: 'pick';
        bind: string;
        label?: string;
        items: string;
        groupBy?: { path: string; format?: string };
        itemLabel: string;
        itemHint?: string;
        empty?: string;
        required?: boolean;
      }
    | { type: 'fields'; label?: string; fields: Field[] }
    | { type: 'summary'; label?: string; items: { label: string; value: string; visible?: Cond }[] }
    /** Prüft mit `validate` die sichtbaren Pflichtfelder, dann die Aktionen nacheinander */
    | { type: 'button'; label: string; actions: Action[]; validate?: boolean; secondary?: boolean }
    | { type: 'section'; label?: string; body: Component[] }
    /** Ein Spinner, solange die Aktionen beim Laden laufen */
    | { type: 'loading'; text?: string }
  );

/** `public` ohne Login - sonst mit Login und einer der Rollen (ohne Rollen: jeder mit Login). */
export type Access = 'public' | { roles: string[] };

export type Page = {
  path: string;
  title: string;
  access: Access;
  state?: Record<string, unknown>;
  load?: Action[];
  body: Component[];
};

export type App = {
  title?: string;
  subtitle?: string;
  /** Die Seite für / */
  home?: string;
  /** Texte für Werte – {{wert|label:topic}} */
  labels?: Record<string, Record<string, string>>;
};

export type Pages = { app: App; pages: Page[] };
