import type { Model } from './types';

// Startpunkt für einen leeren Ordner. Der Service-Katalog wird im Admin aus
// den Camunda **element-templates** des Projekts befüllt — dort steckt das
// vorbereitete Mapping.
export const DEFAULT_MODEL: Model = {
  version: 1,
  company: '',
  services: [],
};
