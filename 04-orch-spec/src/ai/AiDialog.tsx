// The AI mode (E19, E23): the studio turns it on - its key, its model, its costs. The dialog only
// says so; there is nothing to set in the browser. Opened with the AI icon in the header, which is
// there only when the AI is on.
import { Check, Minus, Sparkles } from 'lucide-react';
import { StartDialog } from '../components/StartCard';
import { cls } from '../ui';
import { AI_TASKS, TASK_LABEL, type AiConfig } from './config';

export function AiDialog({ isDark, ai, onClose }: { isDark: boolean; ai: AiConfig; onClose: () => void }) {
  const c = cls(isDark);
  const row = (label: string, value: string) => (
    <div className="flex gap-3 text-[11px]">
      <span className={`w-20 flex-shrink-0 ${c.muted}`}>{label}</span>
      <span className={`font-mono ${c.text}`}>{value}</span>
    </div>
  );
  return (
    <StartDialog isDark={isDark} icon={<Sparkles size={14} />} title="KI-Modus" onClose={onClose}
      lead="Vom Studio freigegeben – Key, Modell und Kosten liegen beim Studio, im Browser ist nichts einzustellen."
      primary={{ label: 'Schliessen', icon: <Check size={12} />, onClick: onClose }}>
      <div className="space-y-1">
        {row('Anbieter', ai.provider === 'anthropic' ? 'Anthropic (Claude API)' : ai.provider ?? '–')}
        {row('Modell', ai.model ?? '–')}
      </div>
      <div className="space-y-0.5">
        <div className={`text-[10px] uppercase tracking-wider ${c.muted}`}>Aufgaben</div>
        {AI_TASKS.map((t) => (
          <div key={t} className={`flex items-center gap-2 text-[11px] ${ai.tasks.includes(t) ? c.text : c.muted}`}>
            {ai.tasks.includes(t) ? <Check size={11} /> : <Minus size={11} />}
            <span>{TASK_LABEL[t]}</span>
            {!ai.tasks.includes(t) && <span className="text-[10px]">– noch kein Skill im Studio</span>}
          </div>
        ))}
      </div>
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Bei den Aufgaben mit Skill ändert Claude auf Wunsch die Spez als Entwurf; du übernimmst oder verwirfst. Die Anfragen gehen
        über das Studio an Anthropic – nur die Spezifikation (Seiten, Datenmodell, Service-Katalog) und der Chat,
        keine Kundendaten. Ein- und ausgeschaltet wird die KI auf dem Server (STUDIO_AI_ANTHROPIC_API_KEY).
      </p>
    </StartDialog>
  );
}
