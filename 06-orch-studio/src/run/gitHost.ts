// The Git platform as an interface (P10): what «Übergeben» needs of it - the pull request of a work
// branch, and its merge for a project with `autoMerge`. GitHub first, GitLab later. The token is the
// studio's (`STUDIO_GIT_TOKEN`), never orch-spec's, and never in a message or the log.
export type PullRequest = { url: string; number: number; merged: boolean };

export type GitHost = {
  /** The open pull request of `head` into `base` - created, or its title and text brought up to date. */
  pullRequest(o: { head: string; base: string; title: string; body: string }): Promise<PullRequest>;
  merge(number: number): Promise<void>;
};

export const GITHUB_API = 'https://api.github.com';

type Json = Record<string, unknown>;

/** GitHub over its REST API - `repo` is `<owner>/<name>`. */
export function gitHub(o: { repo: string; token: string; api?: string; fetchFn?: typeof fetch }): GitHost {
  const api = (o.api ?? GITHUB_API).replace(/\/+$/, '');
  const owner = o.repo.split('/')[0];
  const call = async (method: string, path: string, body?: Json): Promise<unknown> => {
    const r = await (o.fetchFn ?? fetch)(`${api}/repos/${o.repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${o.token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await r.json().catch(() => undefined)) as unknown;
    if (!r.ok) {
      const message = json && typeof json === 'object' && typeof (json as Json).message === 'string' ? (json as Json).message : r.statusText;
      throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${r.status} ${String(message)}`);
    }
    return json;
  };
  const of = (pr: unknown): PullRequest => {
    const p = pr as Json;
    return { url: String(p.html_url), number: Number(p.number), merged: p.merged === true };
  };
  return {
    async pullRequest({ head, base, title, body }) {
      const found = (await call('GET', `/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`)) as unknown[];
      return Array.isArray(found) && found.length
        ? of(await call('PATCH', `/pulls/${Number((found[0] as Json).number)}`, { title, body }))
        : of(await call('POST', '/pulls', { head, base, title, body }));
    },
    async merge(number) {
      await call('PUT', `/pulls/${number}/merge`, {});
    },
  };
}
