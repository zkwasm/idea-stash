import { expect, test } from 'claude-code/testing'

// The last context blocks the engine-stand-in saw on a submitted prompt.
let seen: readonly string[] | undefined
// The latest status-line text the mod set (undefined = cleared).
let status: string | undefined

// The engine sits beneath the plugin: these hooks stand in for it.
const seat = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  seen = undefined
  status = undefined
  on('command.register', () => ({ value: { command: 'idea' } }))
  on('clock.now', () => ({ value: Date.now() }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    status = e.text
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    seen = e.context
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))
}

const hasIdea = (re: RegExp): boolean =>
  (seen ?? []).some(block => re.test(block))

test('a captured idea is injected once, then marked delivered', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Capturing an idea must not reach the model — it returns its own text.
  const ran = await $.command.run({ command: 'idea', args: 'extract auth module' })
  expect(ran.text).toContain('extract auth module')
  // The status line now shows the unread count.
  expect(status).toContain('1')

  // Next real prompt: the idea rides in a hidden context block.
  await $.prompt.submit({ text: 'continue' })
  expect(hasIdea(/extract auth module/)).toBe(true)
  // Read now, the status line is cleared.
  expect(status).toBe(undefined)

  // A later prompt no longer carries it — it was marked delivered.
  await $.prompt.submit({ text: 'keep going' })
  expect(hasIdea(/extract auth module/)).toBe(false)
})

const BAND = {
  plugin: 'idea-stash',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false },
} as const

test('the band shows the unread count until ideas are read', async ($, on) => {
  seat(on)
  // The engine draws beneath us when we show nothing.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'idea', args: 'extract auth module' })

  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await before.find({ type: 'Text', text: /unread idea/ }))?.text).toContain(
    '1',
  )
  await before.unmount()

  // After the idea is delivered, the band yields to the engine.
  await $.prompt.submit({ text: 'continue' })
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await after.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await after.unmount()
})

const PANE = {
  plugin: 'idea-stash',
  component: 'Pane',
  requestId: 'idea-stash',
  props: {
    title: '💡 Ideas',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the pane renders an interactive Select of the ideas', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: 'test idea A' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Select' })).toBeTruthy()
  await ui.unmount()
})

test('/idea del <n> removes the numbered idea', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: 'test idea A' })
  await $.command.run({ command: 'idea', args: 'test idea B' })

  // Delete #1 (A); B shifts up to #1; a third delete finds the list empty.
  const del1 = await $.command.run({ command: 'idea', args: 'del 1' })
  expect(del1.text).toContain('test idea A')
  const del2 = await $.command.run({ command: 'idea', args: 'del 1' })
  expect(del2.text).toContain('test idea B')
  const del3 = await $.command.run({ command: 'idea', args: 'del 1' })
  expect(del3.text).toContain('No #1')
})

test('/idea clear removes only the read (delivered) ideas', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: 'old idea' })
  // Reading it marks it delivered; a second idea stays unread.
  await $.prompt.submit({ text: 'continue' })
  await $.command.run({ command: 'idea', args: 'new idea' })

  const cleared = await $.command.run({ command: 'idea', args: 'clear' })
  expect(cleared.text).toContain('Cleared 1 read idea')

  // The unread one survives and still injects.
  await $.prompt.submit({ text: 'keep going' })
  expect(hasIdea(/new idea/)).toBe(true)
  expect(hasIdea(/old idea/)).toBe(false)
})

test('/idea off mutes injection for the session, /idea on restores it', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: 'idea before mute' })

  // Muted: the next real prompt carries no idea, and the status line clears.
  await $.command.run({ command: 'idea', args: 'off' })
  expect(status).toBe(undefined)
  await $.prompt.submit({ text: 'continue' })
  expect(hasIdea(/idea before mute/)).toBe(false)

  // Unmuted: the still-undelivered idea injects again.
  await $.command.run({ command: 'idea', args: 'on' })
  await $.prompt.submit({ text: 'keep going' })
  expect(hasIdea(/idea before mute/)).toBe(true)
})

test('bare /idea opens the menu and adds nothing of its own', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'idea', args: 'test idea A' })
  // Bare /idea opens the interactive menu; it stores no idea of its own.
  const ran = await $.command.run({ command: 'idea', args: '' })
  expect(ran.text).toContain('menu opened')

  // The one real idea still injects on the next prompt.
  await $.prompt.submit({ text: 'continue' })
  expect(hasIdea(/test idea A/)).toBe(true)
})
