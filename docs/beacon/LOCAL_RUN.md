# 本机运行

本机 macOS arm64 需从[官方 v1.0.0-rc.46 发布页](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.46)下载 `new-api-macos-v1.0.0-rc.46`，保存为项目 `.local/bin/new-api-v1.0.0-rc.46`，校验 SHA-256（见 `BASELINE.md`），再赋执行权限。工具与数据库不纳入 Git。其他系统应使用对应官方包或 Go 1.26.10 源码构建。

1. 在项目根目录将 `.env.beacon.example` 复制为 `.env.beacon.local`，用 `openssl rand -hex 32` 生成固定的 `SESSION_SECRET`；不要在聊天或 Git 中发送该值。
2. 先运行 `sh scripts/beacon-build.sh`，构建定制前端、类型检查并编译 `.local/bin/beacon-dev`，再运行 `./scripts/beacon-local.sh`。当前便携 Go 缓存可通过 `GOCACHE=/private/tmp/beacon-go-cache GOMODCACHE=/private/tmp/beacon-go-mod` 传入。重新修改源码后需要重新构建后端。
3. 打开 [http://localhost:3000](http://localhost:3000)。当前 Mac 已初始化本地管理员 `beaconadmin`；初始密码仅保存在 Git 忽略且权限为 600 的 `.local/admin-credentials.txt`，请本人登录后更改。换电脑或新数据库时按初始化向导创建管理员。停止时按 Ctrl+C。

SQLite 在 `data/new-api.db`，日志在 `logs/`。本地 API 基址是 `http://localhost:3000/v1`。默认程序监听所有本机网卡的 3000 端口；不要映射公网。未配置真实上游、邮件或支付。

前端开发使用 Bun，当前 Mac 的便携版在 `.local/bun-darwin-aarch64/bun`。在 `web/` 目录运行 `../.local/bun-darwin-aarch64/bun install --frozen-lockfile`、`../.local/bun-darwin-aarch64/bun run dev`；本机因后端占用 3000 端口，前端位于 [http://localhost:3001](http://localhost:3001)，并将 API 代理到 3000。首页为 Beacon 样板，站内接入文档在 `/docs`。官方后端发布包内嵌原版前端，定制版需通过开发服务器预览，或安装 Go 1.26.10 重新编译并嵌入新 `web/dist`。

本机基础业务冒烟检查：在后端启动后，从项目根目录运行 `python3 scripts/beacon-basic-smoke.py`。脚本只连接 `127.0.0.1:3000`，读取 Git 忽略的 `.local/admin-credentials.txt` 中当前本地管理员凭据，创建一个零额度测试 Key，核对列表脱敏，再删除并确认消失；不会打印密码或密钥，不调用上游。若已更改管理员密码，先在本机更新该凭据文件，保持 600 权限且不要提交。此检查不代表真实上游调用、扣费或多用户隔离已通过。

人工账务入口为 `/beacon-ledger`，也可从超级管理员侧栏进入。只记录已确认的站外收款/退款，额度按原始单位独立填写；本页不执行真实转账。当前只支持无 Redis、无批量更新的同步额度模式，每笔操作要求二次验证。若结果未知，使用“重试同一笔记录”，不要刷新后另建记录。

隔离调用链验证：先构建当前 `.local/bin/beacon-dev`，再从项目根目录运行 `python3 scripts/beacon-relay-smoke.py`（Python 3 标准库，无额外依赖）。脚本自建临时 SQLite、管理员及三个普通用户、测试渠道和模拟上游；不读取 `.env.beacon.local` 或现有管理员凭据。网关使用随机临时端口，模拟上游只监听回环地址；继承底座网关监听规则，请勿把测试端口映射公网。测试注册/登录、Key 权限、JSON/SSE、失败释放预留、渠道重试、并发扣费、余额不足与改价历史保护，并自动停止进程、删除临时数据及凭据。所有价格和回复明确为模拟，不代表真实供应商已通过验证；当前覆盖同步 SQLite 钱包模式，不覆盖断连、异步任务或其他数据库的完整转发链。

同页“资金总览”按北京时间提供今日、本月至今、历史累计与自定义日期，汇总全部客户在本人工账本内的实收、退款、冲正与登记现金净额。选择时段后点“应用时段”；“刷新汇总”更新当前结果。结束日期包含当日，今天截至查询时刻。尚未登记的业务不会自动出现，消费收入、上游成本与利润仍待接入。此只读汇总不修改任何客户余额。

启动脚本默认运行定制包。如需对照官方基线，可显式设置 `BEACON_LOCAL_BINARY=.local/bin/new-api-v1.0.0-rc.46`；官方包没有新增账务接口，不应用来预览新账务页。上游版本仍固定，定制构建显示 `v1.0.0-rc.46-beacon-dev`。

本机现有库在本轮升级前已备份至 `.local/backups/before-ledger-20261025.db`（600 权限，SQLite 完整性检查 ok）。SQLite/MySQL/PostgreSQL 账务及官方旧版升级矩阵已通过，详见 `PROGRESS.md`。正式恢复演练与生产部署仍待实测；升级前须另行备份数据库和上传文件，恢复前保存当前库，不能将测试矩阵视为业务恢复演练。
