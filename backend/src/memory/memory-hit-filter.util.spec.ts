import {
  filterFactMemoryHits,
  filterStaleMemoryHits,
  isConversationTurnHit,
  isStaleFastPathBoilerplate,
} from './memory-hit-filter.util';

describe('memory-hit-filter', () => {
  it('flags relational mapping confirmations', () => {
    const text =
      'User: link my brain pages\nJARVIS: Relational mapping complete, sir — wrote 1 new link pair(s). Graph now has 4 notes and 6 links.';
    expect(isStaleFastPathBoilerplate(text)).toBe(true);
  });

  it('keeps ordinary conversation turns for conversationHits', () => {
    const text = 'User: what is my favorite tea?\nJARVIS: You prefer Earl Grey in the mornings.';
    expect(isStaleFastPathBoilerplate(text)).toBe(false);
    expect(isConversationTurnHit(text)).toBe(true);
  });

  it('filters stale hits from retrieval lists', () => {
    const hits = [
      'User: consolidate\nJARVIS: Relational mapping complete, sir — wrote 1 new link pair(s).',
      'User: tea\nJARVIS: Earl Grey.',
    ];
    expect(filterStaleMemoryHits(hits)).toEqual(['User: tea\nJARVIS: Earl Grey.']);
  });

  it('drops turn transcripts from fact recall lists', () => {
    const hits = [
      'User: What do you know about me?\nJARVIS: From memory, sir: User: My name is Samer',
      'user.name: Samer Smati',
      'User: tea\nJARVIS: Earl Grey.',
    ];
    expect(filterFactMemoryHits(hits)).toEqual(['user.name: Samer Smati']);
  });
});
