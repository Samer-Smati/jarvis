export type BrainCategory = 'concept' | 'entity' | 'source' | 'session' | 'fact';

export interface BrainPage {
  path: string;
  title: string;
  category: BrainCategory;
  content: string;
  links: string[];
  createdAt: string;
  updatedAt: string;
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
