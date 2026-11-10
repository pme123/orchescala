// A process in service mode: how its `Out` is filled at the end — per field a FEEL expression
// against the process variables (empty: the variable of the same name), an `Out` with cases
// per case. The `Out` itself is the one of the data model (role «Out»).
import { useMemo } from 'react';
import { expectedFor, processVariables } from '../feel';
import type { Field, Mapping, Model, ProcessSpec } from '../types';
import { cls } from '../ui';
import { MappingRow, OutCasesEditor } from './CollectionView';
import type { ServiceProcess } from './serviceProcess';

/** A mapping list with one expression changed — an empty one removes it. */
function upsert(list: Mapping[] | undefined, name: string, expression: string): Mapping[] | undefined {
  const rest = (list ?? []).filter(m => m.name !== name);
  const next = expression.trim() ? [...rest, { name, expression }] : rest;
  return next.length ? next : undefined;
}

export default function ServiceOutSection({ spec, model, isDark, canEdit, onChange, onEditType }: {
  spec: ServiceProcess; model: Model | null; isDark: boolean; canEdit: boolean;
  onChange: (spec: ProcessSpec) => void;
  onEditType: (typeId: string) => void;
}) {
  const c = cls(isDark);
  const types = spec.types ?? [];
  const out = types.find(t => t.processOut);
  const vars = useMemo(() => processVariables(spec, model), [spec, model]);
  const same = (name: string) => vars.some(v => v.name === name);
  // without a mapping: the variable of the same name - otherwise the one of its type (as the export takes it)
  const ofType = (f: Field): string | undefined => {
    const label = expectedFor(f, types, model)?.label;
    const all = label ? vars.filter(v => v.label === label) : [];
    // of several the one a script sets
    const hits = all.length > 1 ? all.filter(v => v.source.startsWith('Ergebnis von')) : all;
    return hits.length === 1 ? hits[0].name : undefined;
  };
  const implicit = (f: Field): string | undefined => (same(f.name) ? f.name : ofType(f));
  const setService = (patch: Partial<ServiceProcess['service']>) => onChange({ ...spec, service: { ...spec.service, ...patch } });
  return (
    <div className="space-y-1.5">
      <h3 className={`text-[10px] uppercase tracking-widest ${c.text}`}>Out — was der Worker zurückgibt</h3>
      {!out ? (
        <p className={`text-[10px] ${c.muted}`}>
          <span className="font-mono">type Out = NoOutput</span> — im Datenmodell ein Out anlegen, wenn der Worker etwas zurückgibt.
        </p>
      ) : (
        <>
          <p className={`text-[10px] ${c.muted}`}>
            Je Feld des <button onClick={() => onEditType(out.id)} className="font-mono hover:underline">Out</button>, woher es kommt —
            FEEL auf die Prozessvariablen; leer: die Variable gleichen Namens, sonst die eine ihres Typs.
          </p>
          {out.kind === 'enum' ? (
            <OutCasesEditor type={out} cases={spec.service.outCases} types={types} vars={vars} canEdit={canEdit} isDark={isDark}
              placeholderOf={f => (same(f.name) ? `= ${f.name}` : '= …')}
              requiredOf={f => !same(f.name)}
              noMatch={<>trifft keiner zu, scheitert der Worker mit <span className="font-mono">CustomError</span></>}
              onChange={outCases => setService({ outCases: outCases.length ? outCases : undefined })} />
          ) : (out.fields ?? []).filter(f => f.name).map(f => (
            <MappingRow key={f.id} target={f} types={types} placeholder={implicit(f) ? `= ${implicit(f)}` : '= …'}
              value={(spec.service.outMappings ?? []).find(m => m.name === f.name)?.expression ?? ''}
              vars={vars} canEdit={canEdit} isDark={isDark} required={!implicit(f)}
              onChange={expression => setService({ outMappings: upsert(spec.service.outMappings, f.name, expression) })} />
          ))}
          {out.kind !== 'enum' && !(out.fields ?? []).some(f => f.name) && (
            <p className={`text-[10px] ${c.muted}`}>Das Out hat noch keine Felder.</p>
          )}
        </>
      )}
    </div>
  );
}
