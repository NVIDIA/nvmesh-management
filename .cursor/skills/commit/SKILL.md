---
name: commit
description: Commit current changes following the NVMesh Management commit message format (JIRA + type/scope + title + body). Use when the user asks to commit current changes with a JIRA reference, or mentions this commit format.
---

# Commit

Produces a commit that conforms to the project's commit message format and pushes it to a personal fork on request, optionally opening a merge request and transitioning JIRA tickets to "In Review".

The **format itself** (grammar, types, mandatory body, `Made-with:` policy, examples, JIRA-issue-type → commit-type mapping) lives in the **`commit-message-format`** rule:

- Project-level: `<repo>/.cursor/rules/commit-message-format.mdc`
- User-level: `~/.cursor/rules/commit-message-format.mdc`

Read that rule before composing a commit message. This skill is the procedure, not the spec.

## Required inputs

Ask only for what is missing:

1. **JIRA ticket(s)** — e.g. `NVMESH-1234`. Multiple are allowed. Use `[NO-REF]` if there is none.
2. **Component** — e.g. `BL`, `GUI`, `vpg`, `sanity`, `META`. For `back/port` commits, ask instead for the **original JIRA number** being ported.
3. **Title** — one-line summary. Mandatory for every non-ported commit.
4. **Body** — mandatory for every commit. If the user does not supply one, propose one (see below) and have them confirm/edit before committing.

The `<type>` is inferred from the JIRA issue type via the Jira MCP — do not ask unless the lookup fails, there is no JIRA, or the user explicitly overrides it.

## Suggesting a title or body

When the user omits the title or body and asks for a proposal:

1. **Anchor on the changeset, not on conversation context.** Always run `git diff --cached` (or `git diff` if nothing is staged), and `git diff --stat` first when the diff is large to pick hot files. The wording must describe **what the code actually does**, not what was discussed earlier in chat. Prior assistant reasoning is secondary.
2. **Use JIRA as supporting context only.** Fetch summary/description (`jira_get_issue` with `fields: ["summary", "description", "issuetype"]`) to disambiguate terminology and pick the type. Don't copy the JIRA summary verbatim if the diff tells a more specific story.
3. **If JIRA and the diff disagree, trust the diff.** Call out the discrepancy in one line (e.g. "JIRA talks about X, but the diff touches Y — used Y in the title; let me know if you want it changed.").
4. **Title**: imperative mood, ≤ 72 chars, concretely names the behavior changed by the diff.
5. **Body**: bullet the observable effects of the diff. Keep under ~5 bullets unless asked for more. Single-line is OK for a trivial commit, but never skip the body entirely.
6. **Always show the proposal and let the user edit it** before running `git commit`. Use the user's verbatim text whenever they supply any.

## Workflow

```
- [ ] 1. Collect inputs (JIRA, component|orig JIRA, title, body)
- [ ] 2. Look up JIRA issue type (skip for [NO-REF] or explicit override)
- [ ] 3. Map issue type → commit type per the commit-message-format rule
- [ ] 4. Assemble the commit message per the commit-message-format rule
- [ ] 5. Review git status; warn on secret-looking files before staging
- [ ] 6. Stage changes and commit
- [ ] 7. Strip Made-with trailer; verify with git status and git log -1
- [ ] 8. Ask whether to open merge request(s); if yes, push and offer to move the JIRA ticket(s) to "In Review"
```

### Step 2 — Look up the JIRA issue type

Use the `user-MaaS Jira` MCP server:

- Tool: `jira_get_issue`
- Arguments: `{ "issue_id": "<JIRA>", "fields": ["summary", "issuetype"] }`

For multi-ticket commits, look up the first JIRA and use its type.

### Step 3 — Map issue type → commit type

Use the table in the **`commit-message-format`** rule. If the issue type is unknown or ambiguous, ask the user to choose.

### Step 4 — Assemble the commit message

Build the message per the grammar in the **`commit-message-format`** rule. Common shapes:

- Standard: `[NVMESH-1234] feat(BL): <title>`
- Multiple JIRAs: `[NVMESH-1][NVMESH-2] fix(GUI): <title>`
- No JIRA: `[NO-REF] chore(BL): <title>`
- Back/port: `[NVMESH-4250] back/port[NVMESH-4000]: <title>`

Body is mandatory and separated by exactly one blank line.

### Step 5 — Review before staging

Run `git status` and inspect the change set. Warn the user and require confirmation before staging files that look like secrets or build artifacts (e.g. `*.key`, `*.crt`, `*.pem`, `.env`, `build/`, `node_modules/`, `public/javascripts/components_js/`).

### Step 6 — Stage and commit

Prefer `git add -A` for all current changes, unless the user has already staged a specific subset or asked to commit only staged changes.

Always pass the commit message via a HEREDOC so newlines in the body are preserved:

```bash
git add -A
git commit -m "$(cat <<'EOF'
[NVMESH-1234] feat(BL): add stripe alignment for striped EC

Round stripeSize up to the nearest block set for STRIPED_ERASURE_CODING
so per-chunk allocations are aligned to whole stripes.
EOF
)"
```

Git safety:

- Never update git config.
- Never use `--no-verify` or skip hooks unless the user explicitly asks.
- Never amend or force-push unless the user explicitly asks (Step 7's `Made-with:` strip is the one scoped exception).
- If a pre-commit hook modifies files or the commit fails, fix the underlying issue and create a **new** commit.
- Don't create an empty commit; if there is nothing to commit, report it and stop.

### Step 7 — Strip the `Made-with:` trailer; verify

After the commit succeeds, strip any `Made-with:` trailer (e.g. `Made-with: Cursor`) injected at the porcelain layer. Keep `Change-Id:` and `Signed-off-by:` intact.

`Made-with: Cursor` is injected by the Cursor agent itself, not by a repo `commit-msg` hook — so a plain `git commit --amend` from within this session will just re-inject it. Use git **plumbing** to rewrite the message without going through the porcelain wrapper. This is an exception to the "never amend" rule, scoped to this single trailer, and runs once automatically right after the commit:

```bash
if git log -1 --pretty=%B | grep -q '^Made-with:'; then
    NEW_MSG=$(git log -1 --pretty=%B | grep -v '^Made-with:')
    TREE=$(git rev-parse HEAD^{tree})
    PARENT_ARGS=$(git rev-parse HEAD^@ 2>/dev/null | awk '{print "-p", $1}' | xargs)
    NEW_SHA=$(printf '%s' "$NEW_MSG" | git commit-tree "$TREE" $PARENT_ARGS)
    git update-ref HEAD "$NEW_SHA"
fi
```

Notes:

- `git commit-tree` does not run `commit-msg` hooks and is not wrapped by the porcelain layer, so `Made-with:` is not re-added. `Change-Id:` / `Signed-off-by:` are preserved because they were already in the captured `$NEW_MSG`.
- `HEAD^@` expands to all parents so it works for merge commits too. For the common single-parent case it resolves to `HEAD^`.
- Cleanup runs **before** Step 8, so any subsequent push sees the cleaned commit on the first push — no force-push needed.
- Do **not** use `--no-verify`. It would also suppress `Change-Id` / `Signed-off-by`, which we want to keep.

Then run `git status` and `git log -1 --pretty=%B`, and show the final commit subject and body to the user. Confirm `Made-with:` is no longer present.

### Step 8 — Optionally open merge request(s)

After a successful commit, always ask the user whether to open a merge request. Do **not** push or open MRs without an explicit "yes".

1. **Ask:** "Push this commit and open a merge request?" (Yes / No). If No, stop.
2. **Ask for target branch(es):** one or more (e.g. `master`, `release/3.5`, `release/3.4`). Multiple targets are common for `back/port` commits, where the same change is submitted to several release branches. Accept a comma/space-separated list.
3. **Source ("private fork") remote:**
   - Prefer the remote literally named `private`.
   - Otherwise list `git remote -v` and ask the user to pick the fork remote (URL points at the user's personal namespace, not the team-shared `upstream`).
4. **Target ("upstream") remote and project:**
   - Prefer the remote literally named `upstream`.
   - Otherwise list remotes and ask which one is the team/target project.
5. **Source branch name:** default to the primary JIRA key (e.g. `NVMESH-1234`); fall back to a short slug of the title if the commit is `[NO-REF]`. Confirm if in doubt.
6. **Push** `HEAD` to `<private-remote>:<source-branch>`:

   ```bash
   git push <private-remote> HEAD:<source-branch>
   ```

   Do **not** use `--force` or `--force-with-lease` unless the user explicitly asks. If the push is rejected as non-fast-forward, stop and ask the user how to proceed.
7. **Build one "New MR" URL per target branch** (cross-project, source = fork, target = upstream). Use the GitLab MCP (`user-MaaS GitLab`, tool `gitlab_get_project_details`) to resolve the upstream project ID when possible:

   ```
   https://<gitlab-host>/<fork-path>/-/merge_requests/new
     ?merge_request[source_branch]=<source-branch>
     &merge_request[target_project_id]=<upstream-id>
     &merge_request[target_branch]=<target-branch>
   ```

   URL-encode the `[` and `]` as `%5B` and `%5D` in the actual link. If the upstream project ID can't be resolved, fall back to the URL GitLab prints at push time (source branch only) and tell the user to pick the target project/branch in the UI.
8. **Report** each MR creation URL, plus any URL GitLab itself printed during the push. The current GitLab MCP is read-only (no `create_merge_request` tool), and `glab` may not be installed, so MR creation is completed by the user in the browser unless a writable tool is available.
9. **Offer to move the JIRA ticket(s) to "In Review".** Skip this step entirely when the commit was `[NO-REF]`. Otherwise:
   1. Ask: *"Move `<JIRA>` to In Review?"* (Yes / No). For multiple JIRAs, ask once for the set ("Move all N tickets to In Review?") and apply the same answer to each, unless the user says otherwise.
   2. On **Yes**, for each JIRA:
      1. Call `user-MaaS Jira` / `jira_get_transitions` with `{ "issue_key": "<JIRA>" }` to list available transitions.
      2. Pick the transition whose destination matches "In Review" case-insensitively (common names: `In Review`, `Code Review`, `Start Review`). If none match, show the available names to the user and ask — do not guess.
      3. Call `jira_transition_issue` with the resolved transition id. Ask for required fields first (e.g. resolution) if any.
      4. Report success/failure per ticket; continue on partial failure.
   3. On **No**, skip and continue.

## Edge cases

- **Jira MCP lookup fails** — ask the user for the commit type directly and proceed.
- **User provides an explicit type** — honor it and skip the Jira lookup.
- **Empty working tree** — do not commit; tell the user there is nothing to commit.
- **Mixed staged / unstaged state** — ask whether to commit only the staged subset or all current changes before running `git add`.
- **Push rejected (non-fast-forward)** — stop. Don't force-push without explicit consent.
- **No `private`/`upstream` remotes** — list `git remote -v`, ask the user to pick which remote is the personal fork and which is the team/target project.
- **Back/port to multiple releases** — create one MR URL per target branch from the same pushed source branch, not separate source branches, unless the user asks otherwise.
- **`Made-with:` re-added after amend** — Cursor injects it at the porcelain layer, not via a repo hook. Use the `git commit-tree` + `git update-ref` plumbing path in Step 7 instead of repeatedly amending. Don't try `--no-verify`.
