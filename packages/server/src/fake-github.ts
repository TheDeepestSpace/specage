// In-memory GitHub used by tests, the Playwright e2e server and `npm run dev:fake`.
// Simulates the data repo with one project `r` (code repo o/r) on specages/r/{spec,trail}.
import { Conflict, NotFound, specBranch, type GitHub } from './github.js';

export const SPEC0 = 'Shoot a burst @shoot.burst;\nLimit magazine @shoot.cap;\n';
export class FakeGitHub implements GitHub {
  installed = true;
  commits: { sha: string; spec: string }[] = [{ sha: sha(0), spec: SPEC0 }];
  tags = new Map<string, { sha: string }>();
  files: Record<string, string> = {
    'specages/r/spec:.specage/config.yaml':
      'specage_version: v0\nproject: r\nrepo: o/r\ndata_repo: o/specage-data\nspec_file: r.specage\nreviewer: o\nintern: {repo: o/the-intern}\npages: {mode: off, path: specage}\n',
    'specages/r/trail:trace.yaml':
      'retired_ids: [old.id]\nnodes:\n  shoot.burst: {spec_hash: 000000000000, status: implemented, evidence: []}\n',
  };
  calls: string[] = [];
  head() {
    return this.commits[this.commits.length - 1];
  }
  async listProjects() {
    return ['r'];
  }
  async assertInstalled() {
    if (!this.installed) throw new NotFound('x');
  }
  async getFile(path: string, ref: string) {
    this.calls.push(`getFile ${path}@${ref}`);
    if (ref === specBranch('r') && path === 'r.specage') return this.head().spec;
    if (ref.startsWith('dispatch/') && path === 'r.specage')
      return this.commits.find((c) => c.sha === this.tags.get(ref)!.sha)!.spec;
    return this.files[`${ref}:${path}`] ?? null;
  }
  async getRef(ref: string) {
    return ref === `heads/${specBranch('r')}` ? this.head().sha : null;
  }
  async listDispatchTags(project: string) {
    return [...this.tags.keys()].filter((t) => t.startsWith(`dispatch/${project}/`)).sort();
  }
  async commitSpec(_p: string, o: { content: string; parentSha: string; message: string }) {
    if (o.parentSha !== this.head().sha) throw new Conflict('moved');
    this.lastMessage = o.message;
    this.commits.push({ sha: sha(this.commits.length), spec: o.content });
    return this.head().sha;
  }
  lastMessage = '';
  async createTag(tag: string, s: string) {
    if (this.tags.has(tag)) throw new Conflict('exists');
    this.tags.set(tag, { sha: s });
  }
}
const sha = (n: number) => n.toString(16).padStart(40, '0');
