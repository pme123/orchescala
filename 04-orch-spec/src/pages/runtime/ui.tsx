// Shared building blocks as in orch-spec and preview/ui: color classes per mode and small chips.
import { useEffect, useState } from 'react';

export const cls = (isDark: boolean) => ({
  // the colors from the app's theme (theme.ts - only set in the theme's mode), otherwise the z9nai style.
  // Muted things (title, muted, btn, icon, borders) stay black/white with opacity: that way they fit on any
  // background of the mode, as light and dark gray would
  bg: isDark ? 'bg-[var(--orch-bg,#0e0f11)]' : 'bg-[var(--orch-bg,#f5f4f0)]',
  panel: isDark ? 'bg-[var(--orch-surface,rgba(255,255,255,0.02))]' : 'bg-[var(--orch-surface,rgba(0,0,0,0.02))]',
  panelStrong: isDark ? 'bg-[var(--orch-surface,#16171a)]' : 'bg-[var(--orch-surface,#ffffff)]',
  top: isDark ? 'bg-[#0c0d0f]' : 'bg-[#eae9e5]',
  border: isDark ? 'border-white/8' : 'border-black/8',
  border2: isDark ? 'border-white/15' : 'border-black/15',
  text: isDark ? 'text-[var(--orch-text,#ffffff)]' : 'text-[var(--orch-text,#000000)]',
  title: isDark ? 'text-white/70' : 'text-black/70',
  muted: isDark ? 'text-white/40' : 'text-black/40',
  muted2: isDark ? 'text-white/60' : 'text-black/60',
  hover: isDark ? 'hover:bg-white/5' : 'hover:bg-black/5',
  icon: isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70',
  input: isDark
    ? 'bg-white/5 border-white/10 text-[var(--orch-text,#ffffff)] placeholder-white/20 focus:border-[var(--orch-primary,rgba(255,255,255,0.3))]'
    : 'bg-black/5 border-black/10 text-[var(--orch-text,#000000)] placeholder-black/20 focus:border-[var(--orch-primary,rgba(0,0,0,0.3))]',
  btn: isDark
    ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white'
    : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black',
  btnPrimary: isDark
    ? 'bg-[var(--orch-primary,#ffffff)] text-[var(--orch-on-primary,#000000)] hover:opacity-90'
    : 'bg-[var(--orch-primary,#000000)] text-[var(--orch-on-primary,#ffffff)] hover:opacity-85',
  error: isDark ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700',
  success: isDark ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800',
  info: isDark ? 'border-blue-500/30 bg-blue-500/5 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-800',
  selected: isDark
    ? 'border-[var(--orch-primary,rgba(255,255,255,0.6))] bg-white/10 text-[var(--orch-text,#ffffff)]'
    : 'border-[var(--orch-primary,rgba(0,0,0,0.6))] bg-black/5 text-[var(--orch-text,#000000)]',
});

export type Tone = 'green' | 'blue' | 'red' | 'amber' | 'neutral';

const TONE: Record<Tone, { light: string; dark: string }> = {
  green: { light: 'bg-emerald-50 text-emerald-700 border-emerald-300', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  blue: { light: 'bg-blue-50 text-blue-700 border-blue-300', dark: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  red: { light: 'bg-rose-50 text-rose-700 border-rose-300', dark: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  amber: { light: 'bg-amber-50 text-amber-700 border-amber-300', dark: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  neutral: { light: 'bg-slate-100 text-slate-700 border-slate-300', dark: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
};

export function Chip({ tone, isDark, children, title }: {
  tone: Tone; isDark: boolean; children: React.ReactNode; title?: string;
}) {
  return (
    <span title={title}
      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${isDark ? TONE[tone].dark : TONE[tone].light}`}>
      {children}
    </span>
  );
}

/** Where the browser remembers the user's choice (light/dark) for the pages - not `orch-ui.theme`: that
  * is written by orch-spec on the same origin on every load, so it is not a choice. */
export const CHOICE_KEY = 'orch-pages.theme';
/** The mode the app specified last - so that a dark app does not flash light until pages.json is there.
  * Per app (its path `/app/<projekt>/`): several live on one origin. */
export const appModeKey = (base: string): string => `orch-pages.app-mode:${base}`;

/** The tooltip of the sign-out button - with the name, if there is one (on the phone it is only shown here). */
export const logoutTitle = (name: string | undefined): string => (name ? `Abmelden (${name})` : 'Abmelden');

/** The logo of the app that the header shows - none if there is none or exactly this one did not load
  * (then the default icon and the byline only as text). */
export const effectiveLogo = (logo: string | undefined, failed: string | null): string | undefined =>
  logo && logo !== failed ? logo : undefined;

type Mode = 'light' | 'dark';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** A remembered mode - null without storage or value. */
export function storedMode(key: string, from: Store | null = store()): Mode | null {
  try {
    const v = from?.getItem(key);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function rememberMode(key: string, mode: Mode | undefined, to: Store | null = store()): void {
  try {
    if (mode) to?.setItem(key, mode);
  } catch {
    // no storage - only for this session
  }
}

/** Dark? The user's choice before the app's default; without either, light. */
export const isDarkMode = (chosen: Mode | null, preferred: Mode | undefined): boolean => (chosen ?? preferred) === 'dark';

/** Light/dark as in the z9nai apps: class `dark` on the html element. The browser remembers the user's
  * choice; without a choice the app's default applies (`theme.mode`). */
export function useTheme(preferred?: Mode): { isDark: boolean; toggleTheme: () => void } {
  const [chosen, setChosen] = useState<Mode | null>(() => storedMode(CHOICE_KEY));
  const isDark = isDarkMode(chosen, preferred);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);
  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    setChosen(next);
    rememberMode(CHOICE_KEY, next);
  };
  return { isDark, toggleTheme };
}
