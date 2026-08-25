import {
  isNonPersonEntityPage,
  scoreUserEntityCandidate,
  selectUserEntityPage,
  stripWikiNoise,
} from './user-entity.util';

describe('user-entity.util', () => {
  const hf = {
    path: 'entities/hugging-face-models-list.md',
    title: 'Hugging Face Models List',
    category: 'entity' as const,
    updatedAt: '2026-07-30T06:30:53.935Z',
    content:
      '# Hugging Face Models List\n\nLinks to concepts: [[LLM Wiki Pattern]], [[User Profile]].\n\nRelated: [[im your owner so make in mind only me who can order stuff from you and now link ]]',
  };

  const jarvis = {
    path: 'entities/jarvis.md',
    title: 'JARVIS',
    category: 'entity' as const,
    updatedAt: '2026-07-30T06:30:53.935Z',
    content: '# JARVIS\n\nPersonal AI assistant for sir.\n',
  };

  const profile = {
    path: 'entities/user-samer-smati.md',
    title: 'Samer Smati',
    category: 'entity' as const,
    updatedAt: '2026-07-28T12:00:00.000Z',
    content: '# Samer Smati\n\nFull-stack engineer and JARVIS owner. Prefers French.\n',
  };

  it('rejects Hugging Face Models List even when body mentions User Profile / owner links', () => {
    expect(isNonPersonEntityPage(hf)).toBe(true);
    expect(scoreUserEntityCandidate(hf)).toBe(0);
    expect(stripWikiNoise(hf.content)).not.toMatch(/\[\[/);
  });

  it('selects the real user profile entity over Hugging Face and JARVIS', () => {
    const selected = selectUserEntityPage([hf, jarvis, profile]);
    expect(selected?.path).toBe('entities/user-samer-smati.md');
    expect(selected?.title).toBe('Samer Smati');
  });

  it('returns null when the vault has no real user profile entity', () => {
    expect(selectUserEntityPage([hf, jarvis])).toBeNull();
  });
});
