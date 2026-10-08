// Die Eigenschaften des ausgewählten Bausteins - oder der Seite.
import type { Access, Component, Field, Option, Page } from '../runtime/spec';
import ActionsEditor from './ActionsEditor';
import { CheckField, Group, JsonField, PathField, RowList, SelectField, TextField } from './fields';
import type { Targets } from './model';

export const BLOCK_LABELS: Record<Component['type'], string> = {
  heading: 'Überschrift',
  text: 'Text',
  choice: 'Auswahl (fest)',
  pick: 'Auswahl aus Liste',
  fields: 'Eingabefelder',
  summary: 'Zusammenfassung',
  button: 'Button',
  section: 'Abschnitt',
  loading: 'Laden-Anzeige',
};

type Ctx = { isDark: boolean; targets: Targets; paths: string[] };

export function BlockProps({ block, onChange, ...ctx }: Ctx & { block: Component; onChange: (b: Component) => void }) {
  const { isDark, paths } = ctx;
  const set = (patch: Partial<Component>) => onChange({ ...block, ...patch } as Component);
  const visible = (
    <PathField isDark={isDark} label="Sichtbar, wenn" hint="leer: immer" placeholder="step == 'choose'" value={block.visible}
      suggestions={paths} onChange={(v) => set({ visible: v || undefined })} />
  );
  switch (block.type) {
    case 'heading':
      return (
        <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
          <TextField isDark={isDark} label="Text" value={block.text} onChange={(text) => set({ text })} />
          {visible}
        </Group>
      );
    case 'text':
      return (
        <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
          <TextField isDark={isDark} label="Text" hint="{{pfad|format}} wird eingesetzt" multiline value={block.text} onChange={(text) => set({ text })} />
          <SelectField isDark={isDark} label="Art" value={block.tone ?? 'muted'} onChange={(tone) => set({ tone })}
            options={[
              { value: 'muted', label: 'normal' },
              { value: 'info', label: 'Hinweis' },
              { value: 'success', label: 'Erfolg' },
              { value: 'error', label: 'Fehler' },
            ]} />
          {visible}
        </Group>
      );
    case 'choice':
      return (
        <>
          <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
            <TextField isDark={isDark} label="Bezeichnung" value={block.label} onChange={(label) => set({ label: label || undefined })} />
            <PathField isDark={isDark} label="Wert nach" hint="ein Pfad im Zustand" value={block.bind} suggestions={paths} onChange={(bind) => set({ bind })} />
            <CheckField isDark={isDark} label="Pflichtangabe" checked={block.required} onChange={(required) => set({ required: required || undefined })} />
            {visible}
          </Group>
          <Group isDark={isDark} title="Optionen">
            <OptionsEditor isDark={isDark} options={block.options} onChange={(options) => set({ options })} />
          </Group>
          <Group isDark={isDark} title="Bei einer Änderung">
            <ActionsEditor {...ctx} actions={block.onChange} onChange={(onChange) => set({ onChange: onChange.length ? onChange : undefined })} />
          </Group>
        </>
      );
    case 'pick':
      return (
        <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
          <TextField isDark={isDark} label="Bezeichnung" value={block.label} onChange={(label) => set({ label: label || undefined })} />
          <PathField isDark={isDark} label="Liste aus" hint="das Ergebnis eines Service" value={block.items} suggestions={paths} onChange={(items) => set({ items })} />
          <PathField isDark={isDark} label="Gewählter Eintrag nach" value={block.bind} suggestions={paths} onChange={(bind) => set({ bind })} />
          <TextField isDark={isDark} label="Eintrag" hint="Felder des Eintrags: {{start|time}}" mono value={block.itemLabel} onChange={(itemLabel) => set({ itemLabel })} />
          <TextField isDark={isDark} label="Zusatz" mono value={block.itemHint} onChange={(itemHint) => set({ itemHint: itemHint || undefined })} />
          <div className="grid grid-cols-2 gap-2">
            <TextField isDark={isDark} label="Gruppieren nach" mono value={block.groupBy?.path}
              onChange={(path) => set({ groupBy: path ? { path, format: block.groupBy?.format } : undefined })} />
            <SelectField isDark={isDark} label="Format" value={block.groupBy?.format ?? ''}
              onChange={(format) => block.groupBy && set({ groupBy: { ...block.groupBy, format: format || undefined } })}
              options={[{ value: '', label: 'wie er ist' }, { value: 'day', label: 'Tag' }, { value: 'date', label: 'Datum' }]} />
          </div>
          <TextField isDark={isDark} label="Wenn leer" multiline value={block.empty} onChange={(empty) => set({ empty: empty || undefined })} />
          <CheckField isDark={isDark} label="Pflichtangabe" checked={block.required} onChange={(required) => set({ required: required || undefined })} />
          {visible}
        </Group>
      );
    case 'fields':
      return (
        <>
          <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
            <TextField isDark={isDark} label="Bezeichnung" value={block.label} onChange={(label) => set({ label: label || undefined })} />
            {visible}
          </Group>
          <Group isDark={isDark} title="Felder">
            <RowList isDark={isDark} items={block.fields} addLabel="Feld" onChange={(fields) => set({ fields })}
              add={(): Field => ({ bind: 'feld', label: 'Feld' })}
              render={(f, setF) => (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <TextField isDark={isDark} label="Bezeichnung" value={f.label} onChange={(label) => setF({ ...f, label })} />
                    <SelectField isDark={isDark} label="Eingabe" value={f.input ?? 'text'} onChange={(input) => setF({ ...f, input })}
                      options={[
                        { value: 'text', label: 'Text' },
                        { value: 'email', label: 'E-Mail' },
                        { value: 'tel', label: 'Telefon' },
                        { value: 'textarea', label: 'mehrzeilig' },
                      ]} />
                  </div>
                  <PathField isDark={isDark} label="Wert nach" value={f.bind} suggestions={paths} onChange={(bind) => setF({ ...f, bind })} />
                  <TextField isDark={isDark} label="Platzhalter" value={f.placeholder} onChange={(placeholder) => setF({ ...f, placeholder: placeholder || undefined })} />
                  <PathField isDark={isDark} label="Sichtbar, wenn" value={f.visible} suggestions={paths} onChange={(v) => setF({ ...f, visible: v || undefined })} />
                  <CheckField isDark={isDark} label="Pflichtfeld" checked={f.required} onChange={(required) => setF({ ...f, required: required || undefined })} />
                </>
              )} />
          </Group>
        </>
      );
    case 'summary':
      return (
        <>
          <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
            <TextField isDark={isDark} label="Bezeichnung" value={block.label} onChange={(label) => set({ label: label || undefined })} />
            {visible}
          </Group>
          <Group isDark={isDark} title="Zeilen">
            <RowList isDark={isDark} items={block.items} addLabel="Zeile" onChange={(items) => set({ items })}
              add={(): { label: string; value: string; visible?: string } => ({ label: 'Bezeichnung', value: '' })}
              render={(item, setItem) => (
                <>
                  <TextField isDark={isDark} label="Bezeichnung" value={item.label} onChange={(label) => setItem({ ...item, label })} />
                  <TextField isDark={isDark} label="Wert" hint="{{pfad|format}}" mono value={item.value} onChange={(value) => setItem({ ...item, value })} />
                  <PathField isDark={isDark} label="Sichtbar, wenn" value={item.visible} suggestions={paths} onChange={(v) => setItem({ ...item, visible: v || undefined })} />
                </>
              )} />
          </Group>
        </>
      );
    case 'button':
      return (
        <>
          <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
            <TextField isDark={isDark} label="Beschriftung" value={block.label} onChange={(label) => set({ label })} />
            <CheckField isDark={isDark} label="Pflichtangaben prüfen" checked={block.validate} onChange={(validate) => set({ validate: validate || undefined })} />
            <CheckField isDark={isDark} label="zweitrangig (umrandet)" checked={block.secondary} onChange={(secondary) => set({ secondary: secondary || undefined })} />
            {visible}
          </Group>
          <Group isDark={isDark} title="Aktionen – nacheinander">
            <ActionsEditor {...ctx} actions={block.actions} onChange={(actions) => set({ actions })} />
          </Group>
        </>
      );
    case 'section':
      return (
        <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
          <TextField isDark={isDark} label="Titel" value={block.label} onChange={(label) => set({ label: label || undefined })} />
          {visible}
        </Group>
      );
    case 'loading':
      return (
        <Group isDark={isDark} title={BLOCK_LABELS[block.type]}>
          <TextField isDark={isDark} label="Text" value={block.text} onChange={(text) => set({ text: text || undefined })} />
          {visible}
        </Group>
      );
  }
}

function OptionsEditor({ isDark, options, onChange }: { isDark: boolean; options: Option[]; onChange: (o: Option[]) => void }) {
  // ein Wert true / false / eine Zahl bleibt einer - sonst ein Text
  const parse = (text: string): unknown => (text === 'true' ? true : text === 'false' ? false : /^-?\d+$/.test(text) ? Number(text) : text);
  return (
    <RowList isDark={isDark} items={options} addLabel="Option" onChange={onChange}
      add={() => ({ value: `option${options.length + 1}`, label: 'Option' })}
      render={(o, set) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <TextField isDark={isDark} label="Wert" mono value={String(o.value)} onChange={(v) => set({ ...o, value: parse(v) })} />
            <TextField isDark={isDark} label="Text" value={o.label} onChange={(label) => set({ ...o, label })} />
          </div>
          <TextField isDark={isDark} label="Zusatz" value={o.hint} onChange={(hint) => set({ ...o, hint: hint || undefined })} />
        </>
      )} />
  );
}

export function PageProps({ page, onChange, ...ctx }: Ctx & { page: Page; onChange: (p: Page) => void }) {
  const { isDark } = ctx;
  const roles = page.access === 'public' ? [] : page.access.roles;
  const setAccess = (access: Access) => onChange({ ...page, access });
  return (
    <>
      <Group isDark={isDark} title="Seite">
        <TextField isDark={isDark} label="Titel" value={page.title} onChange={(title) => onChange({ ...page, title })} />
        <TextField isDark={isDark} label="Pfad" hint="unter /app/{projekt}/" mono value={page.path} onChange={(path) => onChange({ ...page, path })} />
        <SelectField isDark={isDark} label="Zugang" value={page.access === 'public' ? 'public' : 'login'}
          onChange={(v) => setAccess(v === 'public' ? 'public' : { roles: roles.length ? roles : ['kundenberater'] })}
          options={[{ value: 'public', label: 'öffentlich – ohne Login' }, { value: 'login', label: 'mit Login und Rolle' }]} />
        {page.access !== 'public' && (
          <TextField isDark={isDark} label="Rollen" hint="durch Komma getrennt - eine davon genügt, leer: jeder mit Login" mono value={roles.join(', ')}
            onChange={(v) => setAccess({ roles: v.split(',').map((r) => r.trim()).filter(Boolean) })} />
        )}
      </Group>
      <Group isDark={isDark} title="Anfangszustand">
        <JsonField isDark={isDark} label="Zustand" hint="dazu kommen query und user" rows={5} value={page.state}
          onChange={(state) => onChange({ ...page, state: (state as Record<string, unknown>) ?? undefined })} />
      </Group>
      <Group isDark={isDark} title="Beim Laden">
        <ActionsEditor {...ctx} actions={page.load} onChange={(load) => onChange({ ...page, load: load.length ? load : undefined })} />
      </Group>
    </>
  );
}
