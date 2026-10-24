# 本机运行

本机 macOS arm64 需从[官方 v1.0.0-rc.46 发布页](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.46)下载 `new-api-macos-v1.0.0-rc.46`，保存为项目 `.local/bin/new-api-v1.0.0-rc.46`，校验 SHA-256（见 `BASELINE.md`），再赋执行权限。工具与数据库不纳入 Git。其他系统应使用对应官方包或 Go 1.26.10 源码构建。

1. 在项目根目录将 `.env.beacon.example` 复制为 `.env.beacon.local`，用 `openssl rand -hex 32` 生成固定的 `SESSION_SECRET`；不要在聊天或 Git 中发送该值。
2. 运行 `./scripts/beacon-local.sh`。
3. 打开 [http://localhost:3000](http://localhost:3000)。当前 Mac 已初始化本地管理员 `beaconadmin`；初始密码仅保存在 Git 忽略且权限为 600 的 `.local/admin-credentials.txt`，请本人登录后更改。换电脑或新数据库时按初始化向导创建管理员。停止时按 Ctrl+C。

SQLite 在 `data/new-api.db`，日志在 `logs/`。本地 API 基址是 `http://localhost:3000/v1`。默认程序监听所有本机网卡的 3000 端口；不要映射公网。未配置真实上游、邮件或支付。

前端开发使用 Bun，当前 Mac 的便携版在 `.local/bun-darwin-aarch64/bun`。在 `web/` 目录运行 `../.local/bun-darwin-aarch64/bun install --frozen-lockfile`、`../.local/bun-darwin-aarch64/bun run dev`；本机因后端占用 3000 端口，前端位于 [http://localhost:3001](http://localhost:3001)，并将 API 代理到 3000。首页为 Beacon 样板，控制台样板在 `/beacon-preview/dashboard`，站内接入文档在 `/docs`。官方后端发布包内嵌原版前端，定制版需通过开发服务器预览，或安装 Go 1.26.10 重新编译并嵌入新 `web/dist`。

本机基础业务冒烟检查：在后端启动后，从项目根目录运行 `python3 scripts/beacon-basic-smoke.py`。脚本只连接 `127.0.0.1:3000`，读取 Git 忽略的 `.local/admin-credentials.txt` 中当前本地管理员凭据，创建一个零额度测试 Key，核对列表脱敏，再删除并确认消失；不会打印密码或密钥，不调用上游。若已更改管理员密码，先在本机更新该凭据文件，保持 600 权限且不要提交。此检查不代表真实上游调用、扣费或多用户隔离已通过。

备份与恢复操作待实测：停止服务后复制 `data/new-api.db`，恢复前先另存当前库。升级前须同时备份数据库和上传文件，评估迁移和回退。生产部署、三种数据库兼容矩阵与正式备份恢复均未验证。
