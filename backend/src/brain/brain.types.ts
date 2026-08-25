export type BrainCategory = 'concept' | 'entity' | 'source' | 'session' | 'fact';

export interface BrainPage {
  path: string;
  title: string;
  category: BrainCategory;
  content: string;
  links: string[];
  createdAt: string;
  updatedAt: string;
  /** Best-effort semantic embedding of title+content, for similarity search/linking. */
  embedding?: number[];
}

export interface BrainVault {
  version: 1;
  hot: string;
  index: string;
  log: string;
  pages: Record<string, BrainPage>;
  updatedAt: string;
}

export interface BrainQueryHit {
  path: string;
  title: string;
  category: BrainCategory;
  score: number;
  excerpt: string;
}

export interface BrainGraphNode {
  id: string;
  label: string;
  category: BrainCategory;
  linkCount: number;
}

export interface BrainGraphEdge {
  source: string;
  target: string;
  kind: 'link' | 'wiki';
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  updatedAt: string;
  source?: 'vault' | 'pg' | 'seed';
  pageCount?: number;
  edgeCount?: number;
}
