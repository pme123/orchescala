// The app's data model. The shared folder holds:
//
//   model.json            settings: branding, status values, how-to, sign-in
//   errors/<id>.json      one file per recurring error
//
// One file per error, so that two people working on different errors at the
// same time do not get in each other's way (SharePoint locks and compares
// per file).

export interface AuthSettings {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  adminRole?: string;
  reviewerRole?: string;
  viewerRole?: string;
}

/** Color of a status — the same names as the Confluence lozenges */
export type StatusColor = 'neutral' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';

export interface StatusDef {
  label: string;
  color: StatusColor;
  /** counts as done — shown dimmed in the list */
  done?: boolean;
}

export interface Model {
  version: number;
  /** Company name — shown on the left of the header */
  company?: string;
  /** Logo as data URI (kept in model.json so it travels everywhere) */
  logo?: string;
  auth?: AuthSettings;
  /** the status values, in the order of the filter bar */
  statuses: StatusDef[];
  /** how-to infos for operations (Markdown) */
  howto?: string;
  [key: string]: unknown;
}

/** One occurrence — created with every click on the counter */
export interface Occurrence {
  at: string;
  by?: string;
}

export interface ErrorEntry {
  /** stable ID = file name without .json */
  id: string;
  /** process, e.g. acme-onboarding-onboardingV2 */
  process: string;
  /** short description (one line) */
  title: string;
  /** incident details — error message, log, request (Markdown) */
  details: string;
  /** activity in the process where the error occurs */
  activity: string;
  /** who reported the error */
  reporter: string;
  /** status tags (labels from model.statuses, several possible) */
  status: string[];
  /** ticket(s) — Markdown, typically links */
  ticket: string;
  /** comment / workaround (Markdown) */
  workaround: string;
  /** how often the error has occurred */
  count: number;
  /** the latest occurrences, newest first (limited) */
  occurrences?: Occurrence[];
  createdAt: string;
  createdBy?: string;
  /** last change: create, edit or count */
  updatedAt: string;
  updatedBy?: string;
  /** what happened last — for the «zuletzt …» display */
  lastAction?: 'created' | 'edited' | 'counted' | 'imported';
  /** order from the import (Confluence page), as a tie-breaker */
  seq?: number;
  /** hidden instead of deleted */
  archived?: boolean;
}

export const OCCURRENCE_LIMIT = 200;
