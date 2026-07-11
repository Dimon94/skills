# Dverity Security Policy

[中文版](./SECURITY.zh-CN.md) | [English](./SECURITY.md)

## Supported versions

Security fixes target the latest published Dverity release and the current
default branch. Older releases are best effort.

## What to report

Please report vulnerabilities affecting:

- `dverity install`, `migrate`, `verify`, or `uninstall` path boundaries;
- ownership-manifest validation or managed projection hashes;
- arbitrary file writes, traversal, symlink escapes, or cross-root mutation;
- command injection or unsafe subprocess execution;
- package contents, provenance, secrets, or unintended files;
- authenticated provider actions, review freshness, landing, or parity readback.

Ordinary bugs and documentation gaps belong in
[GitHub Issues](https://github.com/Dimon94/dverity/issues).

## Reporting

Use GitHub private vulnerability reporting when available. Otherwise contact
the maintainer through the least public channel on the GitHub profile. Include
the affected version or commit, environment, exact reproduction, observed
impact, and disclosure status. Do not publish exploit details before triage.

Maintainers aim to acknowledge valid private reports within seven days, verify
severity before disclosure, fix current code first, and publish an immutable
patched release when package users are affected.
