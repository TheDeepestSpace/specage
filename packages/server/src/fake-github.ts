// In-memory GitHub used by tests, the Playwright e2e server and `npm run dev:fake`.
// Simulates the data repo with one project `r` (code repo o/r) on specages/r/{spec,trail}.
import {
  Conflict,
  NotFound,
  PermissionError,
  specBranch,
  type GitHub,
  type RepoInfo,
} from './github.js';

export const SPEC0 = 'Shoot a burst @shoot.burst;\nLimit magazine @shoot.cap;\n';
export class FakeGitHub implements GitHub {
  installed = true;
  commits: { sha: string; spec: string }[] = [{ sha: sha(0), spec: SPEC0 }];
  cursor: string | null = null;
  repos: RepoInfo[] = [
    { full_name: 'o/r', private: true, default_branch: 'main' },
    { full_name: 'o/new', private: false, default_branch: 'main' },
  ];
  labels: string[] = [];
  issues: { repo: string; title: string; body: string; labels: string[] }[] = [];
  /** set to make repo-level calls fail as if the App lacked Issues access */
  noIssuesPermission = false;
  created: Record<string, Record<string, string>> = {};
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
    const old = this.commits.find((c) => c.sha === ref);
    if (old && path === 'r.specage') return old.spec;
    if (this.created[ref] && path in this.created[ref]) return this.created[ref][path];
    return this.files[`${ref}:${path}`] ?? null;
  }
  async getRef(ref: string) {
    if (ref === `heads/${specBranch('r')}`) return this.head().sha;
    return this.created[ref.replace(/^heads\//, '')] ? sha(99) : null;
  }
  async getCursor() {
    return this.cursor;
  }
  async setCursor(_p: string, sha: string) {
    this.cursor = sha;
  }
  async listInstallationRepos() {
    return this.repos;
  }
  async getRepo(repo: string) {
    return this.repos.find((r) => r.full_name === repo) ?? null;
  }
  async ensureLabels(_r: string, labels: string[]) {
    if (this.noIssuesPermission) throw new PermissionError('grant Issues write');
    this.labels.push(...labels);
  }
  async createIssue(repo: string, o: { title: string; body: string; labels: string[] }) {
    if (this.noIssuesPermission) throw new PermissionError('grant Issues write');
    this.issues.push({ repo, ...o });
    return this.issues.length;
  }
  async createOrphanBranch(project: string, kind: 'spec' | 'trail', files: Record<string, string>) {
    const b = `specages/${project}/${kind}`;
    if (this.created[b] || project === 'r') throw new Conflict('exists');
    this.created[b] = files;
    return sha(99);
  }
  async commitSpec(_p: string, o: { content: string; parentSha: string; message: string }) {
    if (o.parentSha !== this.head().sha) throw new Conflict('moved');
    this.lastMessage = o.message;
    this.commits.push({ sha: sha(this.commits.length), spec: o.content });
    return this.head().sha;
  }
  lastMessage = '';
}
const sha = (n: number) => n.toString(16).padStart(40, '0');
