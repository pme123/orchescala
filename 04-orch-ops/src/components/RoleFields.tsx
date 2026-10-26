// The three Entra app roles as a list: level, what it may do, role value.
// Used in the setup dialog and under Admin → Anmeldung.
import { Copy, RotateCcw } from 'lucide-react';
import { DEFAULT_ROLES, ORCH_SPEC_ROLES, ROLE_KEYS, type RoleKey, type Roles } from '../auth';
import { cls } from '../ui';

const ROLE_INFO: Record<RoleKey, { label: string; can: string }> = {
  adminRole: { label: 'Admin', can: 'alles, inkl. Admin' },
  reviewerRole: { label: 'Bearbeiten', can: 'erfassen, ändern, zählen' },
  viewerRole: { label: 'Lesen', can: 'nur lesen' },
};

export default function RoleFields({ roles, onChange, isDark }: {
  roles: Roles; onChange: (r: Roles) => void; isDark: boolean;
}) {
  const c = cls(isDark);
  const same = (r: Required<Roles>) => ROLE_KEYS.every(k => (roles[k] ?? '') === r[k]);
  const link = `flex items-center gap-1 text-[10px] ${c.muted} hover:underline`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] uppercase tracking-wider ${c.muted}`}>Rollen (App-Rollen in Entra)</span>
        <span className="flex items-center gap-3">
          {!same(ORCH_SPEC_ROLES) && (
            <button type="button" onClick={() => onChange({ ...ORCH_SPEC_ROLES })}
              title="Dieselben Rollen wie orch-spec einsetzen — eine Rollenzuweisung in Entra für beide Apps" className={link}>
              <Copy size={10} /> wie orch-spec
            </button>
          )}
          {!same(DEFAULT_ROLES) && (
            <button type="button" onClick={() => onChange({ ...DEFAULT_ROLES })}
              title="Standard-Rollen (OrchOps.*) einsetzen" className={link}>
              <RotateCcw size={10} /> Standard
            </button>
          )}
        </span>
      </div>
      {ROLE_KEYS.map(k => (
        <div key={k} className="grid grid-cols-[6.5rem_1fr] sm:grid-cols-[6.5rem_9.5rem_1fr] items-center gap-x-2 gap-y-0.5">
          <span className={`text-[11px] font-semibold ${c.muted2}`}>{ROLE_INFO[k].label}</span>
          <span className={`hidden sm:block text-[10px] ${c.muted}`}>{ROLE_INFO[k].can}</span>
          <input value={roles[k] ?? ''} onChange={e => onChange({ ...roles, [k]: e.target.value })}
            placeholder={DEFAULT_ROLES[k]} aria-label={`Rolle ${ROLE_INFO[k].label}`}
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
        </div>
      ))}
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Der Wert muss genau dem «Wert» der App-Rolle in der App-Registrierung entsprechen.
        Ein leeres Feld = Stufe nicht verwendet; alle leer = jede angemeldete Person ist Admin.
      </p>
    </div>
  );
}
