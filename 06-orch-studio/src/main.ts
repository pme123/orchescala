// Orch Studio - `npm start` (in the image `node src/main.ts`): the settings from the environment
// (config.ts), the skills of the studio and of the company (skills.ts), then http://<host>:<port>/site/.
import { serve } from '@hono/node-server';
import { PROVIDER } from './ai.ts';
import { studioApp } from './app.ts';
import { configFromEnv, describeAi, type StudioConfig } from './config.ts';
import { consoleLog as log } from './log.ts';
import { appsSource, folderHints, folderSource, siteOf } from './site.ts';
import { BUILT_IN_SKILLS, loadSkills, skillLabel } from './skills.ts';

/** A setting or a skill that is wrong ends the start with one line that names it - no stack trace. */
function stop(what: string, error: unknown): never {
  log.error(`Orch Studio does not start - ${what}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const config: StudioConfig = (() => { try { return configFromEnv(); } catch (e) { return stop('the settings', e); } })();
const apps = appsSource(config.appsDir);
const skills = config.ai ? loadSkills(PROVIDER, [...(config.skillsDir ? [config.skillsDir] : []), BUILT_IN_SKILLS]) : [];
if (typeof skills === 'string') stop('a skill of the AI', skills);

const site = siteOf([
  folderHints([{ app: 'spec', dir: config.specDir }, { app: 'ops', dir: config.opsDir }]),
  apps,
  config.siteDir ? folderSource(config.siteDir) : undefined,
]);
const url = `http://${config.host}:${config.port}`;

const server = serve({ fetch: studioApp({ site, ai: config.ai, skills, log }).fetch, port: config.port, hostname: config.host }, () => {
  log.info(`Orch Studio on ${url}`);
  if (!apps) log.warn(`no orch-doc, orch-spec, orch-ops in ${config.appsDir} (STUDIO_APPS_DIR)`);
  log.info(`Documentation: ${config.siteDir ?? 'none (STUDIO_SITE_DIR)'}`);
  log.info(`  orch-doc  ${url}/site/`);
  log.info(`  orch-spec ${url}/site/spec/`);
  log.info(`  orch-ops  ${url}/site/ops/`);
  log.info(config.ai
    ? `AI: on - ${describeAi(config.ai)}, skills: ${skills.length ? skills.map(skillLabel).join(', ') : 'none - orch-spec shows no AI'}`
    : 'AI: off - without STUDIO_AI_ANTHROPIC_API_KEY orch-spec shows no AI');
});
// a port that is taken (or not allowed) - one line, as a wrong setting
server.on('error', (e) => stop(`the port ${config.port}`, e));
// `docker stop` sends SIGTERM to the studio (PID 1 in the image) - it ends at once, as the JVM did,
// instead of being killed after the grace period; a request still running ends with it
const shutdown = (signal: string) => {
  log.info(`Orch Studio stops (${signal})`);
  server.close();
  process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
