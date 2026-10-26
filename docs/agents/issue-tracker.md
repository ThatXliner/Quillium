# Issue tracker

Issues and specs live in `ThatXliner/Quillium` GitHub Issues. Use `gh` from the
repository root so it infers the repository from the clone. Track requests and
specs in issues; use pull requests for implementation review.

## Read and find work

```bash
gh issue list --state open
gh issue view <number> --comments
```

When a workflow asks for the relevant ticket, read the issue and its comments.
When it asks to publish a spec to the issue tracker, the destination is an issue.

## Write when the task calls for it

For multiline bodies, write the exact Markdown to a temporary file and use
`--body-file` so newlines and shell-sensitive text are preserved:

```bash
gh issue create --title "Short description" --body-file /tmp/issue-body.md
gh issue comment <number> --body-file /tmp/comment-body.md
gh issue edit <number> --add-label "label-name"
gh issue edit <number> --remove-label "label-name"
gh issue close <number>
```
