import { createHash, createPublicKey, verify } from 'node:crypto';

export class SshsigError extends Error {}

class Reader {
  pos = 0;
  constructor(private b: Buffer) {}
  u32(): number {
    if (this.pos + 4 > this.b.length) throw new SshsigError('truncated');
    const v = this.b.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  str(): Buffer {
    const n = this.u32();
    if (this.pos + n > this.b.length) throw new SshsigError('truncated');
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  raw(n: number): Buffer {
    if (this.pos + n > this.b.length) throw new SshsigError('truncated');
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  done() {
    return this.pos === this.b.length;
  }
}

const lp = (b: Buffer | string) => {
  const x = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const l = Buffer.alloc(4);
  l.writeUInt32BE(x.length);
  return Buffer.concat([l, x]);
};

/** Extract the raw 32-byte Ed25519 key from an OpenSSH public key line. */
export function parseOpenSshEd25519(line: string): Buffer {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'ssh-ed25519' || !parts[1])
    throw new SshsigError('OWNER_PUBKEY must be an ssh-ed25519 key');
  const r = new Reader(Buffer.from(parts[1], 'base64'));
  if (r.str().toString() !== 'ssh-ed25519') throw new SshsigError('bad key blob');
  const k = r.str();
  if (k.length !== 32 || !r.done()) throw new SshsigError('bad key blob');
  return k;
}

function armorBody(armored: string): Buffer {
  const m = /-----BEGIN SSH SIGNATURE-----([\s\S]+?)-----END SSH SIGNATURE-----/.exec(armored);
  if (!m) throw new SshsigError('not an SSH signature');
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
}

/**
 * Verify an `ssh-keygen -Y sign` signature (Ed25519 only, sha512 only) over `message`
 * in `namespace`, made by `ownerPubkey` (OpenSSH format). Throws SshsigError on any mismatch.
 */
export function verifySshsig(opts: {
  armored: string;
  message: Buffer | string;
  namespace: string;
  ownerPubkey: string;
}): void {
  const owner = parseOpenSshEd25519(opts.ownerPubkey);
  const r = new Reader(armorBody(opts.armored));
  if (r.raw(6).toString() !== 'SSHSIG') throw new SshsigError('bad magic');
  if (r.u32() !== 1) throw new SshsigError('unsupported version');
  const pub = new Reader(r.str());
  if (pub.str().toString() !== 'ssh-ed25519') throw new SshsigError('not an Ed25519 signature');
  const key = pub.str();
  if (!pub.done()) throw new SshsigError('bad public key blob');
  const ns = r.str();
  r.str(); // reserved
  const hashAlg = r.str().toString();
  const sigBlob = new Reader(r.str());
  if (!r.done()) throw new SshsigError('trailing data');
  if (ns.toString() !== opts.namespace) throw new SshsigError('wrong namespace');
  if (hashAlg !== 'sha512') throw new SshsigError('unsupported hash algorithm');
  if (!key.equals(owner)) throw new SshsigError('signed by a different key');
  if (sigBlob.str().toString() !== 'ssh-ed25519') throw new SshsigError('not an Ed25519 signature');
  const sig = sigBlob.str();
  const msg = Buffer.isBuffer(opts.message) ? opts.message : Buffer.from(opts.message);
  const signed = Buffer.concat([
    Buffer.from('SSHSIG'),
    lp(ns),
    lp(''),
    lp(hashAlg),
    lp(createHash('sha512').update(msg).digest()),
  ]);
  const pk = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.toString('base64url') },
    format: 'jwk',
  });
  if (sig.length !== 64 || !verify(null, signed, pk, sig)) throw new SshsigError('bad signature');
}

export const SIGNUP_PURPOSE = 'specage-signup';
export const signupNamespace = (host: string) => `${SIGNUP_PURPOSE}@${host}`;

export interface SignupChallenge {
  purpose: string;
  host: string;
  nonce: string;
  expires: string;
}

export function challengeText(c: SignupChallenge): string {
  return `${c.purpose}\nhost: ${c.host}\nnonce: ${c.nonce}\nexpires: ${c.expires}\n`;
}

export function parseChallenge(text: string): SignupChallenge | null {
  const m = /^(specage-signup)\nhost: (\S+)\nnonce: ([0-9a-f]{64})\nexpires: (\S+)\n$/.exec(text);
  return m ? { purpose: m[1], host: m[2], nonce: m[3], expires: m[4] } : null;
}
