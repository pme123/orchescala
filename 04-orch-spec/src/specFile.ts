import type { StorageBackend } from './backend';
import type { ProcessSpec } from './types';

/**
 * Reads one specification file. null: the file is not there. A read error rejects, and so
 * does a file that is not valid JSON - with the path and the cause, so the view can say which.
 */
export async function readSpecFile(be: Pick<StorageBackend, 'read'>, path: string): Promise<{ raw: ProcessSpec; version: string } | null> {
  const read = await be.read(path);
  if (!read) return null;
  try {
    return { raw: JSON.parse(read.text) as ProcessSpec, version: read.version };
  } catch (e) {
    throw new Error(`${path} ist unlesbar (kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}).`);
  }
}
