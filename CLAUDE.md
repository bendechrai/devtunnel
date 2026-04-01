# Claude Code Instructions

## Commit messages

This repo uses semantic-release to auto-publish to npm. Commit messages MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat` - a new feature (triggers minor version bump)
- `fix` - a bug fix (triggers patch version bump)
- `docs` - documentation only
- `chore` - maintenance, dependencies, CI config
- `refactor` - code change that neither fixes a bug nor adds a feature
- `ci` - CI/CD changes
- `test` - adding or updating tests

### Breaking changes

Append `!` after the type or include `BREAKING CHANGE:` in the footer to trigger a major version bump:

```
feat!: remove support for Node 16
```

### Examples

```
feat: add CDN cache-control headers to traefik middleware
fix: correct port detection for multi-service compose files
docs: add releasing section to README
chore: install semantic-release dependencies
```

Commits with types like `chore`, `docs`, `ci`, `refactor`, and `test` do NOT trigger a release. Use `feat` or `fix` when the change should result in a new npm version.
