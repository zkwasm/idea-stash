# idea-stash

Jot an idea during a long Claude Code session **without interrupting Claude** — it's handed to Claude automatically on your next message.

In a long session you keep having new thoughts, but you don't want to interrupt Claude's current work. `/idea <thought>` stores it — no turn is triggered, Claude isn't interrupted. The next time you actually send a message, every unread idea rides along as hidden context so Claude folds them into the work.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install idea-stash --marketplace zkwasm/idea-stash
```

Answer `y` to *Add marketplace?*, then press Enter to accept the **user** scope. It's active immediately, and loads in every session you start afterward.

In the desktop app (where `/plugin` isn't available): click the `+` next to the prompt box → Plugins → Add marketplace `zkwasm/idea-stash` → Add plugin.

## Usage

| Command | What it does |
|---|---|
| `/idea <text>` | Stash an idea without interrupting Claude |
| `/idea` | Open the ideas menu: ↑↓ select, Enter delete, Esc close |
| `/idea del <n>` | Delete one idea by its list number |
| `/idea clear` | Clear every idea Claude has already read |
| `/idea off` / `/idea on` | Mute / resume **for the current session only** |

While you have unread ideas, a banner above the prompt and the status line show the unread count; both clear once Claude reads them.

### Global on, per-session off

Installed at **user** scope, idea-stash is enabled in **every** session. To turn it off in just one session, `/idea off` mutes the **current** session only (no injecting, no prompts) and resets automatically next session.

> Note: the native `/plugin` toggle disables a plugin **globally** (every session). For "just this one session", use `/idea off`.

## Platforms

- **Terminal** and **Claude Code Desktop**: full support, including the interactive `/idea` menu.
- **VS Code**: full support.
- **Mobile**: capture and injection work; the mobile surface has no picker, so `/idea` shows a read-only list and you delete with `/idea del <n>`.

## How it works

- `/idea` is handled by the plugin's `command.run` hook — it **never reaches the model**.
- Ideas are appended to your next real prompt as a hidden `context` block via a `prompt.submit` hook, then marked as read.
- Ideas live in session state; the `off` switch is session-scoped and resets next session.

## License

MIT — see [LICENSE](./LICENSE).
