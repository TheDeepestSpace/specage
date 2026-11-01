export type Level = 'error' | 'warn';

export interface Diagnostic {
  code: string;
  level: Level;
  message: string;
  line: number;
  column: number;
  node?: string;
}

export interface Marker {
  /** constraint | impl | invariant | proof | question | later */
  name: string;
  /** proof kind, only for `!proof <kind>:` */
  kind?: string;
  /** true if the marker word is not one of the known set */
  unknown?: boolean;
}

export interface SpecNode {
  id: string;
  /** true when the statement has no explicit ID and `id` is a derived hash name */
  derived: boolean;
  type: 'leaf' | 'block';
  marker: Marker | null;
  /** normalized own text (marker + prose), the hash input */
  text: string;
  hash: string;
  subtreeHash: string;
  parent: string | null;
  children: SpecNode[];
  lineage: string[];
  line: number;
  column: number;
  endLine: number;
}

export interface Spec {
  roots: SpecNode[];
  diagnostics: Diagnostic[];
}

export interface FlatNode extends Omit<SpecNode, 'children'> {
  children: string[];
}
