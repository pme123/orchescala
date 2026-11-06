// The types of orchSpecCore.js - the Scala.js build of 02-orch-spec-core, copied here by
// `sbt orchSpecCoreJS/linkToOrchSpec` (gitignored). JSON text in and out; unreadable JSON throws.

/** two pages (`Page`) - the differences (`PageChange[]`) */
export function pageDiffJson(before: string, after: string): string;
