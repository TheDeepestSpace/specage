import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { QuestionsSchema, TraceSchema, WorkSchema, } from './schemas.js';
function readYaml(p) {
    return existsSync(p) ? (YAML.parse(readFileSync(p, 'utf8')) ?? undefined) : undefined;
}
export function parseState(raw) {
    const issues = [];
    const run = (file, schema, v, dflt) => {
        const r = schema.safeParse(v ?? dflt);
        if (r.success)
            return r.data;
        for (const i of r.error.issues)
            issues.push({ file, message: `${i.path.join('.')}: ${i.message}` });
        return schema.safeParse(dflt).data;
    };
    return {
        state: {
            trace: run('trace.yaml', TraceSchema, raw.trace, {}),
            work: run('work.yaml', WorkSchema, raw.work, {}),
            questions: run('questions.yaml', QuestionsSchema, raw.questions, []),
        },
        issues,
    };
}
/** Load and validate a spec-state checkout directory. */
export function loadState(dir) {
    const r = parseState({
        trace: readYaml(join(dir, 'trace.yaml')),
        work: readYaml(join(dir, 'work.yaml')),
        questions: readYaml(join(dir, 'questions.yaml')),
    });
    // outbox entries
    return r;
}
