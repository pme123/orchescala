// Bestätigung vor dem Löschen — ein Dialog für die ganze App.
//
//   const confirm = useConfirm();
//   onClick={async () => { if (await confirm({ title: 'Typ «X» löschen?' })) remove(); }}
//
// Escape oder ein Klick daneben bricht ab. Der Fokus liegt auf «Abbrechen» —
// ein versehentliches Enter löscht nichts.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { cls } from '../ui';

export interface ConfirmOptions {
  /** die Frage, z. B. «Feld «clientKey» entfernen?» */
  title: string;
  /** was dabei passiert bzw. bleibt */
  text?: string;
  /** Beschriftung des Knopfs — Vorgabe «Löschen» */
  confirmLabel?: string;
}

type Confirm = (opts: ConfirmOptions) => Promise<boolean>;

// ohne Provider (z. B. eine Seite, die seit dem Einbau nicht neu geladen wurde)
// fragt der Browser — gelöscht wird nie ungefragt
const Ctx = createContext<Confirm>(async o => window.confirm(o.text ? `${o.title}\n\n${o.text}` : o.title));

export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { isDark } = useStore();
  const c = cls(isDark);
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>(opts => new Promise<boolean>(resolve => {
    resolveRef.current?.(false);          // ein offener Dialog gilt als abgebrochen
    resolveRef.current = resolve;
    setOpen(opts);
  }), []);

  const close = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setOpen(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-6" onClick={() => close(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
            className={`max-w-md w-full rounded-xl border p-5 ${c.border2} ${c.panelStrong}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <Trash2 size={14} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-rose-300' : 'text-rose-700'}`} />
              <div className="min-w-0">
                <h3 id="confirm-title" className={`text-sm font-semibold break-words ${c.text}`}>{open.title}</h3>
                {open.text && <p className={`text-[11px] leading-relaxed mt-1 ${c.muted2}`}>{open.text}</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button ref={cancelRef} onClick={() => close(false)}
                className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
              <button onClick={() => close(true)}
                className={`text-[11px] px-3 py-1.5 rounded font-semibold ${isDark ? 'bg-rose-500/80 text-white hover:bg-rose-500' : 'bg-rose-600 text-white hover:bg-rose-700'}`}>
                {open.confirmLabel ?? 'Löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
