// Auftritt: Kunde und Logo in der Kopfzeile.
//
// Beides liegt in der `model.json` — das Logo als Data-URI. Eine zweite
// Datei im geteilten Ordner wäre umständlicher (SharePoint, Rechte,
// Verweise), und eine Adresse von aussen gäbe es in der Bankenzone nicht.
// Dafür muss die Datei klein bleiben; grosse werden abgewiesen.
import { useRef, useState } from 'react';
import { Image, Trash2, Upload } from 'lucide-react';
import type { Model } from '../types';
import { cls } from '../ui';

/** Grenze für das Logo. Ein PNG dieser Grösse ist für eine Kopfzeile üppig. */
const MAX = 200 * 1024;
const TYPES = /^image\/(png|jpeg|svg\+xml|webp|gif)$/;

export default function BrandingForm({ model, isDark, onSave }: {
  model: Model;
  isDark: boolean;
  onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const [company, setCompany] = useState(model.company ?? '');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const speichern = async (patch: Partial<Model>) => {
    const res = await onSave({ ...model, ...patch });
    setMsg(res.ok ? 'Gespeichert.' : res.message);
  };

  const logoWaehlen = async (file: File) => {
    setMsg('');
    if (!TYPES.test(file.type)) {
      setMsg(`«${file.name}» ist kein Bild (PNG, JPEG, SVG, WebP oder GIF).`);
      return;
    }
    if (file.size > MAX) {
      setMsg(`Das Bild ist ${Math.round(file.size / 1024)} KB gross — mehr als ${MAX / 1024} KB passen nicht in die model.json.`);
      return;
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    await speichern({ logo: dataUri });
  };

  return (
    <div className={`rounded border p-4 space-y-3 ${c.border2} ${c.panel}`}>
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Name und Logo stehen links in der Kopfzeile. Ohne Namen heisst die App dort schlicht «Orch Spec».
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>Kunde</label>
          <input value={company} onChange={e => setCompany(e.target.value)}
            onBlur={() => { if (company !== (model.company ?? '')) void speichern({ company: company.trim() || undefined }); }}
            placeholder="z. B. Valiant Bank AG"
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
        </div>
        <div className="flex-shrink-0">
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>Logo</label>
          <div className={`flex items-center gap-2 px-2 py-1 rounded border ${c.border2}`}>
            {model.logo
              ? <img src={model.logo} alt="" className="h-6 max-w-[8rem] object-contain" />
              : <Image size={14} className={c.muted} />}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void logoWaehlen(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
              <Upload size={11} /> {model.logo ? 'Ersetzen' : 'Wählen'}
            </button>
            {model.logo && (
              <button onClick={() => void speichern({ logo: undefined })} title="Logo entfernen"
                className={`p-1 ${c.muted}`}><Trash2 size={11} /></button>
            )}
          </div>
        </div>
      </div>
      {msg && <p className={`text-[10px] ${c.muted2}`}>{msg}</p>}
    </div>
  );
}
