import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, type Spec } from '@specage/core';

export class CliError extends Error {
  constructor(
    message: string,
    public code: 1 | 2 | 3 = 2,
  ) {
    super(message);
  }
}

export interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

const BOOL = new Set(['json', 'dry-run', 'upgrade', 'rulesets', 'help']);

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-m') {
      out.flags.m = argv[++i] ?? '';
    } else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) out.flags[k] = v;
      else if (BOOL.has(k)) out.flags[k] = true;
      else {
        const nxt = argv[++i];
        if (nxt === undefined) throw new CliError(`--${k} needs a value`);
        out.flags[k] = nxt;
      }
    } else out._.push(a);
  }
  return out;
}

export const str = (a: Args, k: string): string | undefined =>
  typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined;

export function git(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e: any) {
    throw new CliError(`git ${args.join(' ')}: ${String(e.stderr ?? e.message).trim()}`, 3);
  }
}

export function gh(args: string[], input?: string): string {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  if (r.status !== 0) throw new CliError(`gh ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`, 3);
  return r.stdout;
}

export function repoRoot(): string {
  // dist/ -> cli -> packages -> repo root
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export function readSpecFile(p: string): Spec {
  if (!existsSync(p)) throw new CliError(`file not found: ${p}`);
  return parse(readFileSync(p, 'utf8'));
}

export function listDispatchTags(cwd?: string): string[] {
  return git(['tag', '-l', 'dispatch/*'], cwd).split('\n').filter(Boolean).sort();
}

/** Tag preceding `before` (exclusive), or the latest tag if `before` is omitted. */
export function cursorTag(before?: string, cwd?: string): string | null {
  const tags = listDispatchTags(cwd).filter((t) => !before || t < before);
  return tags.length ? tags[tags.length - 1] : null;
}

export function specFileAt(ref: string, hint: string | undefined, cwd?: string): string {
  if (hint) return hint;
  const files = git(['ls-tree', '--name-only', ref], cwd).split('\n').filter((f) => f.endsWith('.specage'));
  if (files.length !== 1) throw new CliError(`cannot find a single .specage file at ${ref}`, 3);
  return files[0];
}

/** Resolve `empty`, a file path, `dispatch/latest`, or a git ref to a Spec. */
export function loadSpecRef(ref: string, opts: { specFile?: string; to?: string; cwd?: string }): Spec {
  if (ref === 'empty') return { roots: [], diagnostics: [] };
  if (existsSync(ref)) return readSpecFile(ref);
  let r = ref;
  if (ref === 'dispatch/latest') {
    const c = cursorTag(opts.to && opts.to.startsWith('dispatch/') ? opts.to : undefined, opts.cwd);
    if (!c) return { roots: [], diagnostics: [] };
    r = c;
  }
  const file = specFileAt(r, opts.specFile, opts.cwd);
  return parse(git(['show', `${r}:${file}`], opts.cwd));
}

export function listFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

export const templatesDir = () => join(repoRoot(), 'templates');
export const protocolDir = () => join(repoRoot(), 'protocol');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
