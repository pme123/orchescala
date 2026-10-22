// The page specification (E15) – declarative, rendered at runtime. A page reads and
// writes a state (state); texts and inputs of the actions are templates with {{pfad}}.
//
// The state additionally contains: query (the parameters of the URL), user (name, email, roles) and
// what the actions store under `result`.

/** A condition: `pfad`, `!pfad`, `pfad == 'wert'`, `pfad != 'wert'`, `pfad == true` – combined with
  * `&&` and `||`. `!` only in front of a path, not in front of a comparison (`!a == 'x'` is wrong: `a != 'x'`) –
  * the designer and the build report it. Texts in '…' or "…", without escapes (`"it's"` instead of `'it\'s'`). */
export type Cond = string;

/** Error texts by HTTP status ("409") and `default` – publicly the gateway only returns the status. */
export type Errors = Record<string, string>;

export type Action =
  | { do: 'set'; path: string; value: unknown }
  /** A worker/service: POST /worker/{service} – with `public` without login via /public/worker */
  | { do: 'call'; service: string; public?: boolean; input?: unknown; result?: string; errors?: Errors; onError?: Action[] }
  /** Start a process: POST /process/{process}/async */
  | { do: 'start'; process: string; public?: boolean; businessKey?: string; input?: unknown; result?: string; errors?: Errors; onError?: Action[] }
  /** A message: POST /message/{name} – publicly only with businessKey */
  | { do: 'message'; name: string; public?: boolean; businessKey: string; input?: unknown; result?: string; errors?: Errors; onError?: Action[] }
  /** Complete a user task: POST /userTask/{taskKey}/{taskId}/complete */
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
    /** A choice from fixed values – as tiles */
    | { type: 'choice'; bind: string; label?: string; options: Option[]; required?: boolean; onChange?: Action[] }
    /** A choice from a list in the state (e.g. free time slots), grouped */
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
    /** With `validate` checks the visible required fields, then runs the actions one after another */
    | { type: 'button'; label: string; actions: Action[]; validate?: boolean; secondary?: boolean }
    | { type: 'section'; label?: string; body: Component[] }
    /** A spinner while the actions run on load */
    | { type: 'loading'; text?: string }
  );

/** `public` without login - otherwise with login and one of the roles (without roles: anyone with login). */
export type Access = 'public' | { roles: string[] };

export type Page = {
  path: string;
  title: string;
  access: Access;
  state?: Record<string, unknown>;
  load?: Action[];
  body: Component[];
};

/** The appearance of the app - e.g. from the bank's website (skill orch-theme-from-site). Everything optional;
  * without it the z9nai style applies. In the banking zone there is no address from outside: the logo is
  * a data: URI, the font a stack of system fonts. */
export type Theme = {
  /** buttons, selected tiles, focus - `#0b5cab` */
  primary?: string;
  /** text on `primary` - if not given white or black, depending on brightness */
  onPrimary?: string;
  /** background of the page (light) */
  background?: string;
  /** surfaces: cards, sections (light) */
  surface?: string;
  /** text (light) */
  text?: string;
  /** `sans`, `serif`, `mono` or a CSS stack: `"Frutiger", Arial, sans-serif` */
  font?: string;
  /** corners: `none`, `sm`, `md`, `lg`, `xl` */
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  /** the logo in the header - a data: URI (up to 200 KB) */
  logo?: string;
  /** light or dark as default - the user can still switch */
  mode?: 'light' | 'dark';
};

export type App = {
  title?: string;
  subtitle?: string;
  theme?: Theme;
  /** The page for / */
  home?: string;
  /** Texts for values – {{wert|label:topic}} */
  labels?: Record<string, Record<string, string>>;
};

export type Pages = { app: App; pages: Page[] };
