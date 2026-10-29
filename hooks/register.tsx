import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Idea } from '../types'

const PANE = 'idea-stash'

// Bump the shape tag whenever Idea's fields change: it discards what an
// earlier version stored, which outlives a reload.
const ideas = atom({ plugin: 'idea-stash', key: 'ideas' } as const, [], {
  shape: 'ideas-1',
})
const autoNudge = atom(
  { plugin: 'idea-stash', key: 'autoNudge' } as const,
  false,
)
// Session-scoped (a plain atom lives in $.state): /idea off silences this
// session only, and the next session starts fresh with it off.
const muted = atom({ plugin: 'idea-stash', key: 'muted' } as const, false)

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? '' : 's'}`

// Time of day, prefixed with MM-DD when the idea is not from today.
const hhmm = (ms: number): string => {
  const d = new Date(ms)
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay ? time : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`
}

// A persistent status-line entry that stays until the ideas are read.
// Muted this session: show nothing passive.
const refreshStatus = async ($: EngineInterface): Promise<void> => {
  if (await read($, muted)) {
    $.ui.status(undefined)
    return
  }
  const left = (await read($, ideas)).filter(one => !one.delivered).length
  $.ui.status(left > 0 ? `💡 ${plural(left, 'unread idea')}` : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'idea',
      description:
        'Jot an idea without interrupting Claude. `/idea` opens the menu; `del <n>`/`clear` remove; `off`/`on` mute this session.',
    })
    // Opened on demand via /idea as a focused dialog, not auto-docked.
    await refreshStatus($)

    return next(e)
  })

  // Capture / browse / delete, handled entirely by the mod — never the model.
  on('command.run', { command: 'idea' }, async ($, e) => {
    const text = e.args.trim()

    // `/idea` (empty): open the focused interactive menu.
    if (text === '') {
      const list = await read($, ideas)
      if (list.length === 0) {
        return { text: 'No ideas yet. Jot one with `/idea <text>`.' }
      }
      void $.ui.open({
        id: PANE,
        title: '💡 Ideas',
        focus: true,
        closeOnEscape: true,
        rows: Math.min(list.length + 2, 14),
      })
      return { text: 'Ideas menu opened: ↑↓ select · Enter delete · Esc close.' }
    }

    // `/idea off` / `on`: mute this session only (no injecting, no prompts).
    if (/^(?:off|mute)$/i.test(text)) {
      await update($, muted, () => true)
      await refreshStatus($)
      return {
        text: 'idea-stash muted for this session: no injecting, no prompts. Ideas are still captured, and it resumes next session. Run `/idea on` to resume now.',
      }
    }
    if (/^(?:on|unmute)$/i.test(text)) {
      await update($, muted, () => false)
      await refreshStatus($)
      return { text: 'idea-stash resumed for this session.' }
    }

    // `/idea del <n>`: delete one idea by its list number.
    const del = text.match(/^(?:del|rm|delete)\s+(\d+)$/i)
    if (del) {
      const n = Number(del[1])
      const list = await read($, ideas).then(l => l.slice(-30))
      const target = list[n - 1]
      if (!target) {
        return { text: `No #${n}. Run \`/idea\` to see the list numbers.` }
      }
      await update($, ideas, l => l.filter(one => one.id !== target.id))
      await refreshStatus($)
      return { text: `Deleted #${n}: “${target.text.slice(0, 40)}”` }
    }

    // `/idea clear`: remove every idea Claude has already read.
    if (/^clear$/i.test(text)) {
      const before = (await read($, ideas)).length
      await update($, ideas, l => l.filter(one => !one.delivered))
      const removed = before - (await read($, ideas)).length
      await refreshStatus($)
      return { text: `Cleared ${plural(removed, 'read idea')}.` }
    }

    const idea: Idea = {
      id: `${await $.clock.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      at: await $.clock.now(),
      delivered: false,
    }
    await update($, ideas, list => [...list, idea].slice(-500))
    await refreshStatus($)
    $.ui.toast(`💡 Stashed: ${text.slice(0, 40)}`)

    return {
      text: `Stashed. Claude will read it automatically on its next turn:\n  “${text}”`,
    }
  })

  // Feed undelivered ideas into each real prompt as a hidden context block,
  // and mark them delivered on the way down. A security plugin ahead of us
  // short-circuits prompt.compose, so inject here instead.
  on('prompt.submit', async ($, e, next) => {
    // Skip our own /idea command submission and engine-injected meta prompts.
    if (e.command || e.isMeta) {
      return next(e)
    }
    // Gating hook: any failure of ours must never block the user's prompt, so
    // compute the (possibly rewritten) event defensively and call next once.
    let event = e
    try {
      // Muted this session: do not inject; ideas stay undelivered for later.
      if (!(await read($, muted))) {
        const pending = (await read($, ideas)).filter(one => !one.delivered)
        if (pending.length > 0) {
          const lines = pending
            .map((one, i) => `${i + 1}. [${hhmm(one.at)}] ${one.text}`)
            .join('\n')
          const block =
            'The user jotted these ideas while you were working. Take them into account as you continue the current and following work:\n' +
            lines

          const done = new Set(pending.map(one => one.id))
          await update($, ideas, l =>
            l.map(one => (done.has(one.id) ? { ...one, delivered: true } : one)),
          )
          await refreshStatus($)
          event = { ...e, context: [...(e.context ?? []), block] }
        }
      }
    } catch {
      event = e
    }

    return next(event)
  })

  // Optional nudge: ideas jotted mid-turn (not injected this turn) get a toast.
  on('turn.complete', async ($, e, next) => {
    if (await read($, autoNudge)) {
      const left = (await read($, ideas)).filter(one => !one.delivered).length
      if (left > 0) {
        $.ui.toast(
          `💡 ${plural(left, 'idea')} stashed while working — handed to Claude next turn`,
        )
      }
    }

    return next(e)
  })

  // A persistent row above the prompt: stays as long as ideas are unread,
  // so a captured idea is never just a toast that flashes by.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pending = (await read($, ideas)).filter(one => !one.delivered)
    if (e.props.hasSurvey || pending.length === 0 || (await read($, muted))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    // pending is non-empty (guarded above), so the last item is defined.
    const latest = pending[pending.length - 1]!

    return (
      <Box>
        <Text>💡 {plural(pending.length, 'unread idea')}</Text>
        <Text dimColor> · {latest.text.slice(0, 48)}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    const list = await read($, ideas)
    const pending = list.filter(one => !one.delivered).length

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No ideas yet. Jot one with /idea &lt;text&gt;.</Text>
        </Box>
      )
    }

    const options = list.slice(-50).map(one => ({
      value: one.id,
      label: `${one.delivered ? '✓' : '•'} [${hhmm(one.at)}] ${one.text}`,
    }))

    const remove = async (id: string): Promise<void> => {
      const victim = (await read($, ideas)).find(one => one.id === id)
      await update($, ideas, l => l.filter(one => one.id !== id))
      await refreshStatus($)
      if (victim) {
        $.ui.toast(`🗑 Deleted: ${victim.text.slice(0, 30)}`)
      }
      if ((await read($, ideas)).length === 0) {
        void $.ui.close({ id: PANE })
      }
    }

    const header = (
      <Text dimColor>
        {list.length} total · {pending} unread · ↑↓ select · Enter delete · Esc
        close
      </Text>
    )

    // Select is the native picker; a surface without it (mobile) falls back
    // to a plain read-only list.
    if (!('Select' in t)) {
      return (
        <Box flexDirection="column">
          {header}
          {options.map(opt => (
            <Text key={opt.value}>{opt.label}</Text>
          ))}
        </Box>
      )
    }

    const { Select } = t

    // Key the Select on the current ids so a delete rebuilds it with the new
    // options — a stable key would keep showing the just-removed row.
    const selectKey = `ideas-${options.map(o => o.value).join(',')}`

    return (
      <Box flexDirection="column">
        {header}
        <Select
          key={selectKey}
          autoFocus
          options={options}
          onSelect={(id: string) => void remove(id)}
        />
      </Box>
    )
  })
}
