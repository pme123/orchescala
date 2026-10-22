// The AI mode (E20): the key of the Claude API is the switch - personal, only in this browser.
// Opened with the AI icon in the header; without a key that icon is the only trace of AI.
import { Save, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { StartDialog } from '../components/StartCard';
import { cls } from '../ui';
import { aiEnabled, looksLikeKey, maskKey, readWorkspace, useAiKey, writeKey, writeWorkspace } from './key';

export function SettingsDialog({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const c = cls(isDark);
  const key = useAiKey();
  const [input, setInput] = useState('');
  const value = input.trim();
  const [workspace, setWorkspace] = useState(() => readWorkspace() ?? '');
  const workspaceChanged = workspace.trim() !== (readWorkspace() ?? '');
  const save = () => {
    if (value) writeKey(value);
    if (workspaceChanged) writeWorkspace(workspace);
    onClose();
  };
  return (
    <StartDialog isDark={isDark} icon={<Sparkles size={14} />} title="KI-Modus" onClose={onClose}
      lead="Gilt nur für dich und nur in diesem Browser – nichts davon kommt in den Ordner der Spezifikationen."
      primary={{ label: 'Speichern', icon: <Save size={12} />, disabled: !value && !workspaceChanged, onClick: save }}>
      <div>
        <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.text}`}>API-Key der Claude API (KI-Modus)</label>
        {aiEnabled(key) && (
          <div className={`flex items-center gap-2 mb-2 text-[11px] ${c.muted2}`}>
            <span className="font-mono">{maskKey(key)}</span>
            <span className={c.muted}>– KI-Modus an</span>
            <button onClick={() => writeKey('')} title="Key löschen – der KI-Modus ist sofort aus"
              className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn} hover:text-rose-500`}>
              <Trash2 size={11} /> Löschen
            </button>
          </div>
        )}
        <input type="password" value={input} autoFocus spellCheck={false} autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (value || workspaceChanged)) save(); }}
          placeholder={aiEnabled(key) ? 'neuen Key eingeben' : 'sk-ant-…'}
          className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono ${c.input}`} />
        {value && !looksLikeKey(value) && (
          <p className={`text-[10px] mt-1 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Sieht nicht nach einem Key der Claude API aus (sk-ant-…).</p>
        )}
        <label className={`block text-[10px] uppercase tracking-wider mt-3 mb-1 ${c.text}`}>Workspace-ID <span className={`normal-case tracking-normal ${c.muted}`}>– nur wenn die API sie verlangt</span></label>
        <input value={workspace} spellCheck={false} autoComplete="off" onChange={(e) => setWorkspace(e.target.value)}
          placeholder="wrkspc_… (Console → Settings → Workspaces)"
          className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono ${c.input}`} />
        <p className={`text-[10px] mt-2 leading-relaxed ${c.muted}`}>
          Mit einem Key ändert Claude auf Wunsch Seiten als Entwurf; du übernimmst oder verwirfst. Der Key wird nur
          in diesem Browser gespeichert, die Kosten trägt, wem der Key gehört. An Anthropic gehen nur die Spezifikation
          (Seiten, Datenmodell, Service-Katalog) und der Chat – keine Kundendaten. Ohne Key bleibt orch-spec vollständig nutzbar.
        </p>
      </div>
    </StartDialog>
  );
}
