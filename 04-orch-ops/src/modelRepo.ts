// Opening a folder's model.json — the logic behind the store, without React,
// so it can be tested against a MemoryBackend (like errorRepo.ts).
//
// A folder without model.json gets one. Its sign-in settings take the IDs of
// this browser and — only if the user connected the folder — the roles chosen
// in the setup dialog (pending roles, see auth.tsx); otherwise the defaults.
import type { StorageBackend } from './backend';
import { DEFAULT_MODEL, DEFAULT_STATUSES } from './defaultModel';
import { newFolderRoles, pendingRolesAfterLoad, type Roles } from './auth';
import type { Model, StatusDef } from './types';

/** how the folder came in: the user connected it (picked, SharePoint link,
 *  setup link) or it was restored / re-read without a user choice */
export type FolderOrigin = 'connected' | 'restored';

export type OpenModelResult =
  | { kind: 'ok'; model: Model; version: string; created: boolean; pendingRoles: 'clear' | 'keep' }
  | { kind: 'error'; message: string; pendingRoles: 'keep' }
  /** another folder became active meanwhile: nothing written, nothing to show */
  | { kind: 'stale'; pendingRoles: 'keep' };

export function normalizeModel(raw: unknown): Model {
  const r = (raw ?? {}) as Partial<Model>;
  const statuses = Array.isArray(r.statuses) && r.statuses.length
    ? (r.statuses as StatusDef[]).filter(s => s && typeof s.label === 'string')
    : DEFAULT_STATUSES;
  return { ...DEFAULT_MODEL, ...r, statuses };
}

export async function openModel(be: StorageBackend, opts: {
  origin: FolderOrigin;
  /** Tenant/client ID of this browser — without them a new model.json gets no sign-in settings */
  ids: { tenantId: string; clientId: string } | null;
  pendingRoles: Roles | null;
  /** false = the user switched to another folder meanwhile */
  active?: () => boolean;
}): Promise<OpenModelResult> {
  const connected = opts.origin === 'connected';
  const active = opts.active ?? (() => true);
  try {
    // twice at most: if someone else creates the model.json right now, read theirs
    for (let attempt = 0; attempt < 2; attempt++) {
      const read = await be.read('model.json');
      if (!active()) return { kind: 'stale', pendingRoles: 'keep' };
      if (read) {
        let model: Model;
        try {
          model = normalizeModel(JSON.parse(read.text));
        } catch {
          // do NOT overwrite a broken file
          return { kind: 'error', message: 'model.json ist unlesbar (kein gültiges JSON).', pendingRoles: 'keep' };
        }
        // an existing folder keeps its own roles
        return { kind: 'ok', model, version: read.version, created: false, pendingRoles: pendingRolesAfterLoad(connected, 'existing') };
      }
      const ids = opts.ids;
      const fresh: Model = ids
        ? { ...DEFAULT_MODEL, auth: { enabled: false, tenantId: ids.tenantId, clientId: ids.clientId, ...newFolderRoles(opts.pendingRoles, connected) } }
        : DEFAULT_MODEL;
      const w = await be.write('model.json', JSON.stringify(fresh, null, 2), { createOnly: true });
      if (w.ok) {
        // the roles are only used up if they were written (needs the IDs)
        return {
          kind: 'ok', model: fresh, version: w.version, created: true,
          pendingRoles: pendingRolesAfterLoad(connected, ids ? 'created' : 'createdWithoutAuth'),
        };
      }
      if (w.reason === 'exists') continue; // someone else just created it
      return {
        kind: 'error', pendingRoles: 'keep',
        message: w.reason === 'forbidden'
          ? 'model.json fehlt und kann nicht angelegt werden (keine Schreibberechtigung).'
          : 'model.json fehlt und konnte nicht angelegt werden.',
      };
    }
    return { kind: 'error', message: 'model.json konnte nicht gelesen werden.', pendingRoles: 'keep' };
  } catch (e) {
    console.error('[orch-ops] loadModel:', e);
    return { kind: 'error', message: `model.json konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`, pendingRoles: 'keep' };
  }
}
