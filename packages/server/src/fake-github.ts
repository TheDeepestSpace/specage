// In-memory GitHub used by tests, the Playwright e2e server and `npm run dev:fake`.
import { Conflict, NotFound, type GitHub } from './github.js';

export const SPEC0 = 'Shoot a burst @shoot.burst;\nLimit magazine @shoot.cap;\n';
export class FakeGitHub implements GitHub {
  installed = new Set(['o/r']);
  commits: { sha: string; spec: string }[] = [{ sha: sha(0), spec: SPEC0 }];
  tags = new Map<string, { sha: string }>();
  files: Record<string, string> = {
    'spec:.specage/config.yaml': 'specage_version: v0\nproject: r\nspec_file: r.specage\nreviewer: o\nintern: {repo: o/the-intern}\npages: {mode: off, path: specage}\n',
    'spec-state:trace.yaml': 'retired_ids: [old.id]\nnodes:\n  shoot.burst: {spec_hash: 000000000000, status: implemented, evidence: []}\n',
  };
  calls: string[] = [];
  head() { return this.commits[this.commits.length - 1]; }
  async listEnabledRepos() { return ['o/r']; }
  async assertInstalled(o: string, r: string) { if (!this.installed.has(`${o}/${r}`)) throw new NotFound('x'); }
  async getFile(o: string, r: string, path: string, ref: string) {
    this.calls.push(`getFile ${path}@${ref}`);
    if (ref === 'spec' && path === 'r.specage') return this.head().spec;
    if (ref.startsWith('dispatch/') && path === 'r.specage') return this.commits.find((c) => c.sha === this.tags.get(ref)!.sha)!.spec;
    return this.files[`${ref}:${path}`] ?? null;
  }
  async getRef(_o: string, _r: string, ref: string) { return ref === 'heads/spec' ? this.head().sha : null; }
  async listDispatchTags() { return [...this.tags.keys()].sort(); }
  async commitSpec(_o: string, _r: string, o: { content: string; parentSha: string; message: string }) {
    if (o.parentSha !== this.head().sha) throw new Conflict('moved');
    this.lastMessage = o.message;
    this.commits.push({ sha: sha(this.commits.length), spec: o.content });
    return this.head().sha;
  }
  lastMessage = '';
  async createTag(_o: string, _r: string, tag: string, s: string) {
    if (this.tags.has(tag)) throw new Conflict('exists');
    this.tags.set(tag, { sha: s });
  }
}
const sha = (n: number) => n.toString(16).padStart(40, '0');

