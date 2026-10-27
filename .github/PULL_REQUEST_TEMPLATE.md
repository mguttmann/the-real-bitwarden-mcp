<!--
Thanks for the PR. A couple of things first:

- Discuss new features in an issue before writing code.
- Keep diffs small and focused: one concern per PR.
- Make sure your commits don't contain real org IDs, emails, or secrets.
-->

## Summary

<!-- One or two sentences. What changes, and why. -->

## Related issue

Closes #

## Type of change

- [ ] Bug fix
- [ ] New tool / feature
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Chore (deps, tooling, CI)

## Green-bar checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes (added tests for new behaviour; a bug fix has a test that failed before)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes
- [ ] `CHANGELOG.md` updated under `[Unreleased]`; caller-visible changes under "Behaviour changes" (skip for tooling-only)
- [ ] Tool names, parameter names and required parameters unchanged (`npm run test:contract`)
- [ ] No real organisation IDs, member emails, or secrets in the diff or commit history

## Notes for the reviewer

<!-- Anything that helped you and might help the reviewer: edge cases,
     deliberate non-changes, follow-up work to expect. -->
