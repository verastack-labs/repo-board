# repo-board

A Claude Code mod that shows every repo you own on GitHub in one pane: work that exists only on this machine, commits waiting to be pulled, and the pull requests that need you.

- **A pane**, opened with `/repos`: one row per repo with its branch, unpushed (`↑`), unpulled (`↓`) and uncommitted work, and the open pull request most needing attention, linked to GitHub. Repos you have not cloned show as "not cloned".
- **A status-line entry**: `1 failing · 2 unpushed · 1 dirty`, hidden when there is nothing to report.
- **Toasts** when a pull request's checks start failing, when your pull request is approved or gets changes requested, and when someone opens a new pull request in one of your repos.

## Install

In a terminal Claude Code session (Claude Code 2.1.295 or newer):

```
/plugin install repo-board --marketplace verastack-labs/repo-board
```

Answer `y` to add the marketplace, then pick a scope.

It needs `git` and the GitHub CLI (`gh`) signed in with `gh auth login`. Without `gh`, the pane still shows your clones' local state.

## Use

```
/repos
```

opens the pane and fetches every clone, and running it again closes it. **Refresh** fetches again. The status line and toasts update every 5 minutes, pane open or not.

## Settings

In `/config`:

- **Owners**: the GitHub organisations or users whose repos get rows. Default `verastack-labs`.
- **Include my account**: also list the repos of the account `gh` is signed in as. Default on.
- **Root folders**: where clones are searched for. Default `~/Documents`.
- **Scan depth**: how many folder levels below each root are searched. Default 3.

## Limits

The mod only reads: it never pulls, pushes or changes a branch. `git fetch` updates only the copies of GitHub's history on your machine. Unpulled counts are as fresh as the last fetch. A pull request's state is first recorded silently each session, so changes made while Claude Code was closed do not toast. Only repos on github.com are listed.
