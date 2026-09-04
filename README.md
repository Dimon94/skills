# Skills

个人 agent skill 库。`skills/` 是唯一真相源；本机 agent 目录里的条目全部是指向这里的 symlink。

## 安装 / 更新

```bash
scripts/link-skills.sh
```

把 `skills/` 下每个 skill 链接进 `~/.agents/skills` 和 `~/.claude/skills`。
新增或修改 skill 后直接改仓库文件即可，symlink 即时生效，无需重跑；
只有新增 skill 目录时才需要重跑一次。

## 别人的 skill

引用的第三方 skill（如 [mattpocock/skills](https://github.com/mattpocock/skills)）
不复制进本仓库。它们以各自上游仓库 clone 为准，同样通过 symlink 接入
`~/.agents/skills`，跟进上游只需在对应 clone 里 `git pull`。
