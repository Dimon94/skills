# Dverity CLI and Skills

The CLI owns installation lifecycle only:

```bash
dverity install   --global | --project <absolute-path>
dverity migrate   --global | --project <absolute-path>
dverity verify    --global | --project <absolute-path>
dverity uninstall --global | --project <absolute-path>
dverity --help
dverity --version
```

Exactly one scope is mandatory for every lifecycle command. `verify` is
read-only; invalid or ambiguous scope is a zero-mutation error.

Invoke workflow Skills directly:

- `dverity-repair`
- `submit-remote-review`
- `merge-remote-review`

Their complete shared product contract is [DVERITY.md](../../DVERITY.md).
