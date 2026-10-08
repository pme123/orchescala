// Gemeinsame Bausteine wie in orch-spec und preview/ui: Farbklassen je Modus und kleine Chips.
import { useEffect, useState } from 'react';

export const cls = (isDark: boolean) => ({
  bg: isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]',
  panel: isDark ? 'bg-white/2' : 'bg-black/2',
  panelStrong: isDark ? 'bg-[#16171a]' : 'bg-white',
  top: isDark ? 'bg-[#0c0d0f]' : 'bg-[#eae9e5]',
  border: isDark ? 'border-white/8' : 'border-black/8',
  border2: isDark ? 'border-white/15' : 'border-black/15',
  text: isDark ? 'text-white' : 'text-black',
  title: isDark ? 'text-white/70' : 'text-black/70',
  muted: isDark ? 'text-white/40' : 'text-black/40',
  muted2: isDark ? 'text-white/60' : 'text-black/60',
  hover: isDark ? 'hover:bg-white/5' : 'hover:bg-black/5',
  icon: isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70',
  input: isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30',
  btn: isDark
    ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white'
    : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black',
  btnPrimary: isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80',
  error: isDark ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700',
  success: isDark ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800',
  info: isDark ? 'border-blue-500/30 bg-blue-500/5 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-800',
  selected: isDark ? 'border-white/60 bg-white/10 text-white' : 'border-black/60 bg-black/5 text-black',
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

/** Hell/Dunkel wie in den z9nai-Apps: Klasse `dark` am html-Element, im Browser gemerkt. */
export function useTheme(): { isDark: boolean; toggleTheme: () => void } {
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem('orch-ui.theme') === 'dark';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
    try {
      localStorage.setItem('orch-ui.theme', isDark ? 'dark' : 'light');
    } catch {
      // kein Speicher - nur für diese Sitzung
    }
  }, [isDark]);
  return { isDark, toggleTheme: () => setIsDark((d) => !d) };
}
