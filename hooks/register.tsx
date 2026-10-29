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
  $.ui.status(left > 0 ? `💡 ${left} 条未读想法` : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'idea',
      description:
        '记想法（不打断 Claude）；`/idea` 开菜单，`del <序号>`/`clear` 删除，`off`/`on` 本会话静音',
    })
    // Opened on demand via /idea as a focused dialog, not auto-docked.
    await refreshStatus($)

    return next(e)
  })

  // Capture / browse / delete, handled entirely by the mod — never the model.
  on('command.run', { command: 'idea' }, async ($, e) => {
    const text = e.args.trim()

    // `/idea`（空）：打开聚焦的交互菜单（↑↓ 选择 · Enter 删除 · Esc 关闭）。
    if (text === '') {
      const list = await read($, ideas)
      if (list.length === 0) {
        return { text: '还没有想法。用 `/idea <内容>` 记一条。' }
      }
      void $.ui.open({
        id: PANE,
        title: '💡 想法速记',
        focus: true,
        closeOnEscape: true,
        rows: Math.min(list.length + 2, 14),
      })
      return { text: '想法菜单已打开：↑↓ 选择 · Enter 删除选中 · Esc 关闭。' }
    }

    // `/idea off` / `on`：仅本会话静音（关掉注入与提示；下个会话自动复原）。
    if (/^(?:off|mute|静音|关闭|关)$/i.test(text)) {
      await update($, muted, () => true)
      await refreshStatus($)
      return { text: '已在本会话静音 idea-stash：不再注入、不再显示提示。想法仍会记下，下个会话自动恢复。`/idea on` 可立即恢复。' }
    }
    if (/^(?:on|unmute|取消静音|恢复|开启|开)$/i.test(text)) {
      await update($, muted, () => false)
      await refreshStatus($)
      return { text: '已在本会话恢复 idea-stash。' }
    }

    // `/idea del <序号>`：按清单编号删除一条。
    const del = text.match(/^(?:del|rm|delete|删除|删)\s+(\d+)$/i)
    if (del) {
      const n = Number(del[1])
      const list = await read($, ideas).then(l => l.slice(-30))
      const target = list[n - 1]
      if (!target) {
        return { text: `没有第 ${n} 条。先用 \`/idea\` 看看清单的编号。` }
      }
      await update($, ideas, l => l.filter(one => one.id !== target.id))
      await refreshStatus($)
      return { text: `已删除第 ${n} 条：“${target.text.slice(0, 40)}”` }
    }

    // `/idea clear`：一键清除所有已读（Claude 已读过的）想法。
    if (/^(?:clear|清除已读|清空已读|清除|清空)$/i.test(text)) {
      const before = (await read($, ideas)).length
      await update($, ideas, l => l.filter(one => !one.delivered))
      const removed = before - (await read($, ideas)).length
      await refreshStatus($)
      return { text: `已清除 ${removed} 条已读想法。` }
    }

    const idea: Idea = {
      id: `${await $.clock.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      at: await $.clock.now(),
      delivered: false,
    }
    await update($, ideas, list => [...list, idea].slice(-500))
    await refreshStatus($)
    $.ui.toast(`💡 已记下：${text.slice(0, 40)}`)

    return { text: `已记下想法，Claude 下次开始工作时会自动读到：\n  “${text}”` }
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
            '以下是用户在你工作期间随手记下的新想法/提示，请在继续当前及后续工作时主动纳入考虑：\n' +
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

  // B 模式：工作期间新记的想法（本轮没投递）弹个提醒。
  on('turn.complete', async ($, e, next) => {
    if (await read($, autoNudge)) {
      const left = (await read($, ideas)).filter(one => !one.delivered).length
      if (left > 0) {
        $.ui.toast(`💡 工作期间记了 ${left} 条想法，下次开始时会带给 Claude`)
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
        <Text>💡 {pending.length} 条未读想法</Text>
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
          <Text dimColor>还没有想法。用 /idea &lt;内容&gt; 记一条。</Text>
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
        $.ui.toast(`🗑 已删除：${victim.text.slice(0, 30)}`)
      }
      if ((await read($, ideas)).length === 0) {
        void $.ui.close({ id: PANE })
      }
    }

    const header = (
      <Text dimColor>
        共 {list.length} 条 · 未读 {pending} 条 · ↑↓ 选择 · Enter 删除 · Esc 关闭
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

    return (
      <Box flexDirection="column">
        {header}
        <Select
          key="ideas"
          autoFocus
          options={options}
          onSelect={(id: string) => void remove(id)}
        />
      </Box>
    )
  })
}
