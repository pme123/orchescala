import type { Model } from './types';

// Starting point for an empty folder. The service catalog is filled in the admin from
// the Camunda **element-templates** of the project — that is where the
// prepared mapping is.
export const DEFAULT_MODEL: Model = {
  version: 1,
  company: '',
  services: [],
};
