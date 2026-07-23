export const RESPONSIVE_MARKER = '/* jarvis-responsive-v2 */';

export const RESPONSIVE_CHAT_SCSS_APPEND = `
${RESPONSIVE_MARKER}
.chat-page {
  min-height: 100dvh;
  min-height: 100vh;
}

.composer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}

.messages {
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

@media (max-width: 900px) {
  .chat-page .composer {
    margin-left: 0.5rem;
    margin-right: 0.5rem;
  }

  .upgrade-panel {
    font-size: 0.92rem;
  }
}

@media (max-width: 600px) {
  .chat-page .hud-header {
    padding: 0.55rem 0.75rem;
  }

  .chat-page .composer {
    margin: 0 0.5rem 0.5rem;
    gap: 0.5rem;
  }

  .chat-page .composer textarea {
    min-height: 2.5rem;
    max-height: 6rem;
  }

  .bubble .tools {
    gap: 0.25rem;
  }
}
`;

export const RESPONSIVE_APP_SCSS_APPEND = `
${RESPONSIVE_MARKER}
.shell {
  min-height: 100dvh;
  min-height: 100vh;
}

@media (max-width: 768px) {
  .shell {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.65rem;
    border-right: none;
    border-bottom: 1px solid var(--jarvis-border);
    box-shadow: none;
  }

  .reactor-wrap {
    display: none;
  }

  .brand {
    .tagline {
      display: none;
    }

    .name {
      font-size: 0.85rem;
    }
  }

  .nav-links {
    flex-direction: row;
    gap: 0.35rem;
    width: auto;

    a span {
      display: none;
    }

    a {
      padding: 0.45rem 0.55rem;
    }
  }

  .sys-status {
    display: none;
  }

  .content {
    height: auto;
    flex: 1;
    min-height: 0;
  }
}
`;

export function applyPatch(existing: string, appendBlock: string, marker: string): string {
  if (existing.includes(marker)) {
    return existing;
  }
  return `${existing.trimEnd()}\n${appendBlock}`;
}

export const RESPONSIVE_PRESET_FILES = [
  {
    path: 'frontend/src/app/chat/chat.component.scss',
    append: RESPONSIVE_CHAT_SCSS_APPEND,
    marker: RESPONSIVE_MARKER,
  },
  {
    path: 'frontend/src/app/app.component.scss',
    append: RESPONSIVE_APP_SCSS_APPEND,
    marker: RESPONSIVE_MARKER,
  },
] as const;
