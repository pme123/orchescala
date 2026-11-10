// The model of the open folder in React - the catalog with what the folder brings (folderCatalog): its
// collections, service orchestrations and processes, usable before they are released. The same for
// every view, `except` the spec that is open.
import { useMemo } from 'react';
import { folderCatalog } from './folderCatalog';
import { useServices } from './services/store';
import { isCollection } from './services/types';
import { useStore } from './store';
import type { Model } from './types';

export function useFolderModel(except?: string): Model | null {
  const { model, specs } = useStore();
  const { services } = useServices();
  const collections = useMemo(() => services.map((x) => x.data).filter(isCollection), [services]);
  const folderSpecs = useMemo(() => specs.map((x) => x.data), [specs]);
  return useMemo(() => folderCatalog(model, { specs: folderSpecs, collections }, except), [model, folderSpecs, collections, except]);
}
