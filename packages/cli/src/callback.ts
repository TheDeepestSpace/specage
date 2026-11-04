import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

/** Set the state of the work item for an issue/PR in `<dir>/work.yaml`. Returns false if none matches. */
export function setWorkState(
  dir: string,
  at: { issue?: number; pr?: number },
  state: string,
): boolean {
  const file = join(dir, 'work.yaml');
  if (!existsSync(file)) return false;
  const doc = YAML.parseDocument(readFileSync(file, 'utf8'));
  const items = doc.get('items') as YAML.YAMLSeq | null;
  if (!items || !YAML.isSeq(items)) return false;
  let hit = false;
  for (const it of items.items) {
    if (!YAML.isMap(it)) continue;
    const issue = it.get('issue');
    const pr = it.get('pr');
    if ((at.issue && issue === at.issue) || (at.pr && pr === at.pr)) {
      it.set('state', state);
      if (at.pr && !pr) it.set('pr', at.pr);
      hit = true;
    }
  }
  if (hit) writeFileSync(file, String(doc));
  return hit;
}
