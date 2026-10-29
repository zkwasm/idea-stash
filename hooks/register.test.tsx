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
  const ran = await $.command.run({ command: 'idea', args: '抽出登录模块' })
  expect(ran.text).toContain('抽出登录模块')
  // The status line now shows the unread count.
  expect(status).toContain('1')

  // Next real prompt: the idea rides in a hidden context block.
  await $.prompt.submit({ text: '继续' })
  expect(hasIdea(/抽出登录模块/)).toBe(true)
  // Read now, the status line is cleared.
  expect(status).toBe(undefined)

  // A later prompt no longer carries it — it was marked delivered.
  await $.prompt.submit({ text: '再继续' })
  expect(hasIdea(/抽出登录模块/)).toBe(false)
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

  await $.command.run({ command: 'idea', args: '抽出登录模块' })

  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await before.find({ type: 'Text', text: /未读想法/ }))?.text).toContain(
    '1',
  )
  await before.unmount()

  // After the idea is delivered, the band yields to the engine.
  await $.prompt.submit({ text: '继续' })
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await after.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await after.unmount()
})

const PANE = {
  plugin: 'idea-stash',
  component: 'Pane',
  requestId: 'idea-stash',
  props: {
    title: '💡 想法速记',
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
  await $.command.run({ command: 'idea', args: '测试想法A' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Select' })).toBeTruthy()
  await ui.unmount()
})

test('/idea del <n> removes the numbered idea', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: '测试想法A' })
  await $.command.run({ command: 'idea', args: '测试想法B' })

  // Delete #1 (A); B shifts up to #1; a third delete finds the list empty.
  const del1 = await $.command.run({ command: 'idea', args: 'del 1' })
  expect(del1.text).toContain('测试想法A')
  const del2 = await $.command.run({ command: 'idea', args: 'del 1' })
  expect(del2.text).toContain('测试想法B')
  const del3 = await $.command.run({ command: 'idea', args: 'del 1' })
  expect(del3.text).toContain('没有第 1 条')
})

test('/idea clear removes only the read (delivered) ideas', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: '旧想法' })
  // Reading it marks it delivered; a second idea stays unread.
  await $.prompt.submit({ text: '继续' })
  await $.command.run({ command: 'idea', args: '新想法' })

  const cleared = await $.command.run({ command: 'idea', args: 'clear' })
  expect(cleared.text).toContain('已清除 1 条')

  // The unread one survives and still injects.
  await $.prompt.submit({ text: '再继续' })
  expect(hasIdea(/新想法/)).toBe(true)
  expect(hasIdea(/旧想法/)).toBe(false)
})

test('/idea off mutes injection for the session, /idea on restores it', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: '静音前的想法' })

  // Muted: the next real prompt carries no idea, and the status line clears.
  await $.command.run({ command: 'idea', args: 'off' })
  expect(status).toBe(undefined)
  await $.prompt.submit({ text: '继续' })
  expect(hasIdea(/静音前的想法/)).toBe(false)

  // Unmuted: the still-undelivered idea injects again.
  await $.command.run({ command: 'idea', args: 'on' })
  await $.prompt.submit({ text: '再继续' })
  expect(hasIdea(/静音前的想法/)).toBe(true)
})

test('bare /idea opens the menu and adds nothing of its own', async ($, on) => {
  seat(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'idea', args: '测试想法A' })
  // Bare /idea opens the interactive menu; it stores no idea of its own.
  const ran = await $.command.run({ command: 'idea', args: '' })
  expect(ran.text).toContain('菜单已打开')

  // The one real idea still injects on the next prompt.
  await $.prompt.submit({ text: '继续' })
  expect(hasIdea(/测试想法A/)).toBe(true)
})
