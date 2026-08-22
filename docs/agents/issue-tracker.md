# Issue tracker

Issues and specs live in GitHub Issues for `ThatXliner/Quillium`. Use the `gh`
CLI from this repository.

## Operations

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open`
- Comment: `gh issue comment <number> --body "..."`
- Close: `gh issue close <number> --comment "..."`
- Add a label: `gh issue edit <number> --add-label "..."`
- Remove a label: `gh issue edit <number> --remove-label "..."`

Infer the repository from the current clone.

## Pull requests as a request surface

**PRs as a request surface: no.**

## Skill language

When a skill says "publish to the issue tracker," create a GitHub issue.

When a skill says "fetch the relevant ticket," read the GitHub issue and its
comments.
