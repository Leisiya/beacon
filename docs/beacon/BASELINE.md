# 上游与授权基线

- 官方项目：[QuantumNous/new-api](https://github.com/QuantumNous/new-api)。
- 固定发布：[`v1.0.0-rc.46`](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.46)，提交 `7d8b91268dab69d7150f345c448b5e250163146a`，本地分支 `beacon/v0.1`。这是 2026-10-24 核实时官方标记的最新发布，但版本仍是 `rc`；发行说明包含安全修复并要求 Go 1.26.10。
- 许可证：根目录 `LICENSE` 为 AGPLv3，附第 7 条额外要求；保留 `NOTICE`、`THIRD-PARTY-LICENSES.md`。修改版界面须保留 `Frontend design and development by New API contributors.` 署名及可见的[原项目链接](https://github.com/QuantumNous/new-api)。原版 Footer 已包含这些内容，定制时不得删除。
- 经网络向用户提供修改版服务时，须按 AGPLv3 履行对应源码提供义务；正式上线前再按实际形态审查。本地开发不是上线合规结论。
- 栈：Go 1.26.10、React 19、TypeScript、Rsbuild、Bun；主库支持 SQLite/MySQL/PostgreSQL，Redis 可选。
- 本机为 macOS arm64，未发现系统 Go、Bun、Node、Docker。官方 macOS 发布包 SHA-256 为 `12191843bba29f42b00cde67e40a81e440135f768532ecfe4507c0f6ce764459`，已与官方校验文件比对；本地便携版工具放在 Git 忽略的 `.local/`。

升级须先备份、阅读发行说明、核对迁移和回退；不使用浮动 `latest` 作为可复现版本。
