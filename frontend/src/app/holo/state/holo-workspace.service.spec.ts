import { HoloWorkspaceService, holoCommandFor } from './holo-workspace.service';

describe('holoCommandFor', () => {
  it('routes a spatial request to its source', () => {
    expect(holoCommandFor('Jarvis, show me my projects')).toEqual({
      kind: 'SHOW_WORKSPACE',
      source: 'projects',
    });
    expect(holoCommandFor('open my calendar')).toEqual({ kind: 'SHOW_WORKSPACE', source: 'calendar' });
    expect(holoCommandFor('pull up my reminders')).toEqual({ kind: 'SHOW_WORKSPACE', source: 'tasks' });
    expect(holoCommandFor('show me what you remember')?.source).toBe('memories');
  });

  it('prefers the more specific source when two could match', () => {
    // "second brain" must not be shadowed by a bare "brain", and a calendar
    // request naming meetings must not fall through to notes.
    expect(holoCommandFor('show me my second brain')?.source).toBe('brain');
    expect(holoCommandFor('show me my meetings')?.source).toBe('calendar');
  });

  it('opens the deck with no named source', () => {
    expect(holoCommandFor('open the holo deck')).toEqual({ kind: 'SHOW_WORKSPACE', source: 'brain' });
  });

  it('recognises organize and reset', () => {
    expect(holoCommandFor('organize the workspace')).toEqual({ kind: 'ORGANIZE_WORKSPACE' });
    expect(holoCommandFor('reset the workspace')).toEqual({ kind: 'RESET_WORKSPACE' });
  });

  it('leaves ordinary questions alone', () => {
    // The matcher must be conservative: these are questions for the assistant,
    // not requests to navigate away from the conversation.
    expect(holoCommandFor('how are my projects going?')).toBeNull();
    expect(holoCommandFor('remind me to call the bank')).toBeNull();
    expect(holoCommandFor('what did I do yesterday')).toBeNull();
    expect(holoCommandFor('')).toBeNull();
    expect(holoCommandFor('   ')).toBeNull();
  });

  it('does not fire on a spatial verb with nothing to show', () => {
    expect(holoCommandFor('show me')).toBeNull();
  });
});

describe('HoloWorkspaceService', () => {
  it('delivers commands to a live subscriber', () => {
    const service = new HoloWorkspaceService();
    const seen: string[] = [];
    service.command$.subscribe((command) => seen.push(command.kind));

    service.show('projects');
    expect(seen).toEqual(['SHOW_WORKSPACE']);
  });

  it('holds the last command for a deck that has not mounted yet', () => {
    const service = new HoloWorkspaceService();
    service.show('tasks');

    expect(service.takePending()).toEqual({ kind: 'SHOW_WORKSPACE', source: 'tasks' });
    // Consumed once: remounting the deck must not replay a stale instruction.
    expect(service.takePending()).toBeNull();
  });
});
