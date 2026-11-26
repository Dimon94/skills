# lane 结束后的 pane 释放交给 agent 自觉

- 复发键：herdr-lane-pane-release-by-agent
- 症状：lane 收口后 pane 和 tab 堆满 workspace。DD-654 有 15 条 lane 已 `closed`，15 个 pane、6 张 tab 仍开着；JB-348 的 autopilot lane 被手改成 `done`，`closed_at` 为空。
- 证据：e00715e（autopilot done 只改账本）；delivery-pipeline 5a641dd（Herdr Driver 只注册 dispatch，pane 释放写在 pane-lifecycle-rules.md 和 child-monitoring.md）；~/.config/herdr-autopilot/default.json 的 jb348-carousel、jb348-fe-r1（备注“执行窗格关闭，证据工作树保留”）。
- 根因（已确认）：关 pane 写在文档里，由 merger 或 coordinator 手工执行；脚本收口路径不含 pane，或只给“全回收”一条路，要留证据树的 agent 只能绕过脚本手改账本。review lane 被 Driver 跳过收口，close_pending 也不让 Driver 停下。
- 与 herdr-layout-choice-by-agent 同型：Herdr 资源的生命周期规则写在文档里，靠 agent 自觉。
- 教训类型：复发模式。
- 教训：pane 由派发它的脚本在 lane 收口时关闭；每种合法的收口变体（保留树、保留 issue）都是同一条命令的参数，不留手改的理由；绕过收口的状态由巡检报出来。
- 强制：delivery-pipeline `skills/delivery-pipeline-herdr/scripts/driver_run.py` 的 `EXECUTORS["closeout"]` 与 `driver.py` 的 close_pending halt；herdr-autopilot `set-stage done --keep-tree` 与 poll 的 `unreleased`。
- 召回条件：给 Herdr lane 新增角色、收口变体或 transport 资源时；看到 workspace 里 pane 堆积时。
