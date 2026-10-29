# idea-stash

在 Claude Code 长时间工作时，随手记下想法而**不打断**它——下一轮开始时自动带给 Claude。

长会话里你常会冒出新思路，但不想打断 Claude 手头的活。`/idea <想法>` 把它存下来，不进对话、不触发回合；等你下一次真正发消息时，所有未读想法作为隐藏上下文一起带给 Claude，它会主动纳入考虑。

## 安装

在终端会话的输入框里：

```
/plugin install idea-stash --marketplace zkwasm/idea-stash
```

会先问 `Add marketplace?`（输入 `y`），再选安装范围（默认 **user**，回车即可）。装完立即在当前会话生效，之后每个新会话都会自动加载。

桌面 App 里（`/plugin` 不可用时）：点输入框旁的 `+` → Plugins → Add marketplace 填 `zkwasm/idea-stash` → Add plugin。

## 用法

| 命令 | 作用 |
|---|---|
| `/idea <内容>` | 记一条想法（不打断 Claude） |
| `/idea` | 打开想法菜单：↑↓ 选择、Enter 删除选中、Esc 关闭 |
| `/idea del <序号>` | 按清单编号删除一条 |
| `/idea clear` | 清除所有已读（Claude 已读过）的想法 |
| `/idea off` / `/idea on` | **仅本会话**静音 / 恢复 |

记下未读想法时，输入框上方会有一条提示条、状态栏也会显示未读数量；等 Claude 读到后自动消失。

### 全局开启、单会话关闭

以 user 范围安装后，idea-stash 在**所有会话**自动启用。某个会话不想用它时，`/idea off` 只静音**当前会话**（不注入、不显示提示），下个会话自动恢复。

> 注意：`/plugin` 面板里的禁用是**全局持久**的（关了所有会话都关）。要「只关当前这一个会话」，请用 `/idea off`。

## 工作原理

- `/idea` 由插件的 `command.run` 直接处理，**不经过模型**。
- 想法通过 `prompt.submit` 钩子，作为隐藏的 `context` 块追加到你下一条真实消息上，随即标记为已读。
- 想法存在会话状态里；`off` 开关是会话级的，下个会话自动复原。

## License

MIT，见 [LICENSE](./LICENSE)。
