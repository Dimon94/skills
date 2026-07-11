# Dverity CLI 与 Skills

CLI 只负责安装生命周期：

```bash
dverity install   --global | --project <absolute-path>
dverity migrate   --global | --project <absolute-path>
dverity verify    --global | --project <absolute-path>
dverity uninstall --global | --project <absolute-path>
dverity --help
dverity --version
```

每个 lifecycle command 必须且只允许一个 scope。`verify` 严格只读；scope 非法或含糊时
必须 zero mutation。

工作流直接调用三个 entry Skill：

- `dverity-repair`
- `submit-remote-review`
- `merge-remote-review`

完整共享产品契约只在 [DVERITY.md](../../DVERITY.md)。
