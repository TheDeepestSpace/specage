// Approval evidence for merge-sweep. The bot cannot submit real approvals, so its review is a
// COMMENTED review whose body starts with `APPROVE`. Usage: approval.mjs <head-sha> < reviews.json
// (reviews = REST `pulls/N/reviews` array, possibly paginated/slurped). Exit 0 = approved.
import { Buffer } from 'node:buffer';
export const APPROVER = 'the-intern-bot';

export function isApproved(reviews, headSha, approver = APPROVER) {
  const mine = reviews
    .flat()
    .filter((r) => r?.user?.login?.replace(/\[bot\]$/, '') === approver && r.submitted_at)
    .sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at));
  const latest = mine.at(-1);
  return !!latest && /^\s*APPROVE\b/.test(latest.body ?? '') && latest.commit_id === headSha;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  process.exit(isApproved(JSON.parse(Buffer.concat(chunks).toString()), process.argv[2]) ? 0 : 1);
}
