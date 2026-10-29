export type Idea = {
  id: string
  text: string
  at: number
  delivered: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'idea-stash': {
      ideas: Shaped<Idea[]>
      autoNudge: boolean
      // Session-scoped mute: /idea off silences this session, resets next one.
      muted: boolean
    }
  }
}
