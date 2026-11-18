# Domino

A local project tracker. It runs on this computer only. It does not use the network.

## Start

Double-click `Domino.command`, or run:

```bash
python3 server.py
```

The browser opens at `http://127.0.0.1:4777/`. Python 3 is the only requirement. There is nothing to install.

Options: `--port 5000`, `--data /path/to/folder`, `--no-open`.

## The idea

Most trackers show you lists. Domino shows you what to do next.

- **Blocked and ready are not statuses.** Domino calculates them from the dependencies. A task is blocked while a task it waits for is open.
- **"Do next" has a rank.** The task that unlocks the most work is at the top.
- **When you complete a task, Domino tells you which tasks became free.**
- **One line for everything.** The bar to add a task and the filter use the same words.

## One-line language

| Text | Meaning |
| --- | --- |
| `@ana` | Assignee |
| `#web` | Domain |
| `!urgent` `!high` `!low` | Priority |
| `due:fri` `due:+3d` `due:20nov` `due:2026-12-01` | Due date |
| `start:mon` | Start date |
| `after:12` | Waits for task 12 |
| `in:12` | Subtask of task 12 |
| `status:doing` | Status |
| `is:ready` `is:blocked` `is:overdue` `is:open` | Filter only |

Example: `Build the pricing page @dev #web !high due:fri after:6`

## Views

| View | Use |
| --- | --- |
| Dashboard | Counts for each status, the ranked "Do next" list, tasks due this week, work in progress, blocked work |
| Board | Drag a card to a column to change its status |
| List | Tasks and subtasks as a tree. Point at a row and click `+` to add a subtask below it |
| Timeline | Drag a bar to move it. Drag an end to change one date. A red dashed arrow shows dates that do not agree with a dependency |
| Map | The dependency graph. Drag from the dot on a task to a second task to make a link |

## A task

Click a task to open it. You can set the status, assignee, domain, priority, dates and parent task. You can add a description, links, subtasks and dependencies.

To attach a screenshot, open the task and press Cmd+V. You can also drop files on the task.

## Keys

| Key | Function |
| --- | --- |
| `N` | Add a task |
| `/` | Filter |
| `1` to `5` | Change the view |
| `Esc` | Close |
| `Cmd+Z` | Undo |

## Data

All data is in the `data` folder:

| Path | Contents |
| --- | --- |
| `data/domino.json` | All tasks. Plain JSON. |
| `data/files/` | Attachments |
| `data/backups/` | One copy of `domino.json` for each day, for the last 30 days |
| `data/trash/` | Attachments that no task uses |

To make a backup, copy the `data` folder. To move the project to a different computer, copy the `domino` folder.

## Files

| Path | Contents |
| --- | --- |
| `server.py` | Local server and storage. Python standard library only. |
| `app/index.html`, `app/app.css`, `app/app.js` | The interface. No libraries. |
