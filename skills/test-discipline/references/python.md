# Python 语言节模板

建档时为每个命中 `pyproject.toml` 或 `requirements*.txt` 的目录填写一节，同目录归并。下方占位符必须替换为证据或 Unknown；只将填写后的语言节追加到通用正文。

- 读取 CI 测试步骤及 `pyproject.toml` 的 `[tool.pytest]` 配置，保留真实命令的执行目录、路径与参数。配置节只能证明配置，不能凭它编造 `pytest` 或 `python -m pytest` 命令；找不到真实命令时写 Unknown。
- 命名采用 `test_*.py`。
- 只有项目已安装 pytest 时才填写 `tmp_path`、`monkeypatch`。未安装时沿用项目已有隔离手段，没有证据写 Unknown，不新增依赖。

---

### Python — <仓内目录，根目录写 .>

- 执行目录：<仓内目录>
- 测试命令：<CI 中真实命令或 Unknown>
- 命令来源：<repo://CI 文件 + 步骤行号；无则 Unknown>
- pytest 配置来源：<repo://pyproject.toml + 实际配置节；无则 Unknown>
- 命名约定：`test_*.py`
- 隔离手段：<已安装 pytest 的 tmp_path、monkeypatch，或项目已有手段；无证据为 Unknown>
