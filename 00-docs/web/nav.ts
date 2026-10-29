// The navigation of the documentation: the sections and the order of their pages.
// A page is its markdown file in src/docs without `.md`. Pages that are not listed here are
// added at the end of the section of their folder - so a new page shows up without a change here.

export type NavSection = {
  title: string;
  /** the folder in src/docs ('' for the top level) */
  dir: string;
  pages: string[];
};

export const navigation: NavSection[] = [
  {
    title: 'Orchescala',
    dir: '',
    pages: ['index', 'specification', 'bpmnDsl', 'technologies', 'generalConcerns'],
  },
  {
    title: 'Functional DSLs',
    dir: 'functionalityDsls',
    pages: ['apiDoc', 'simulation', 'worker', 'dmnTester'],
  },
  {
    title: 'Engine Gateway',
    dir: 'gateway',
    pages: ['01-overview', '02-authentication', '03-impersonation', '04-engine-support'],
  },
  {
    title: 'Development',
    dir: 'development',
    pages: ['intro', 'initCompany', 'createProject', 'projectDev', 'migrationC7toC8', 'onboarding'],
  },
  {
    title: 'Company',
    dir: 'company',
    pages: [
      'intro', 'sbt', '00-docs', '02-bpmn', '03-api', '03-dmn', '03-simulation', '03-worker',
      '04-helper', 'development', 'postman',
    ],
  },
];

/** Pages that are only included in other pages (`<!-- include: x.md -->`) - no page of their own. */
export const partials = ['functionalityDsls/workers_advanced'];
