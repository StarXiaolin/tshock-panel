# 重构日志

> 项目：**TShockPanel** —— TShock 6.2.1 / Terraria 1.4.5.8 的本地管理面板（Node.js，零第三方依赖）
> 基线：`arch-2026-10-19-baseline`（commit `6ba3c90`，原始代码一字未改）
> 分支约定：`main` 只放基线；重构在 `refactor/arch`；每个主题一条短生命周期分支，合回 `refactor/arch` 后删除
> 回滚约定：窗口收尾在 `refactor/arch` 打 `arch-YYYY-MM-DD-{noon|pm}` tag；出问题优先 `git revert`，不用 `reset --hard`

---

## 0. 审计快照（2026-10-19，基线状态）

### 0.1 项目实际形态

这个目录不是 C# 源码仓库，而是 TShock 的官方发布包：`TShock.Server.exe`、`ServerPlugins/*.dll`、
`bin/`、`dotnet/` 全是预编译二进制，没有 `.cs` / `.sln`，本机也没有 .NET SDK。
**可重构的代码 = `TShockPanel/` 这个 Node.js 面板**（约 8,100 行，零依赖）。
因此验收口径里 `dotnet build` 不适用，等价物见 `docs/verification.md`。

### 0.2 代码度量

| 文件 | 行数 | 问题概览 |
| --- | ---: | --- |
| `TShockPanel/server.js` | 2602 | 82 个函数 + 55 条路由 + 11 个跨域直改的模块级可变状态 |
| `TShockPanel/public/app.js` | 3030 | `handleAction` 一个函数 720 行、约 60 个 case |
| `TShockPanel/public/index.html` | 933 | 13 个手写 card-head、8 张表 |
| `TShockPanel/public/style.css` | 1387 | 令牌区外仍有 189 处颜色字面量 |
| `TShockPanel/lib/*.js` | 742 | 已经分层，质量明显好于上面四个 |

### 0.3 已确认的坏味道（按 收益/风险 排序）

| 编号 | 坏味道 | 证据 | 违反的原则 |
| --- | --- | --- | --- |
| B1 | 配置“读→改→备份→原子写”样板手抄 9 遍 | `server.js:800,861,875,899,1387,2031,2353,1414,2416` | 重复逻辑未提取；漏一处就丢备份 |
| B2 | 路径常量分散且迟到 | `ITEMS_PATH:1598`、`PLUGIN_DIR:2249`、`UI_STATE_PATH:2251`；`tshock.sqlite` 拼 4 次 | 配置读写未收敛 |
| B3 | 单文件混装全部业务域 | `server.js` 一个文件 = 日志总线 + 进程管理 + 配置 + 世界 + 备份 + HTTP + 路由 | 低内聚 |
| B4 | `handleAction` 巨型分派 | `app.js:1077-1800`，确认框/API/toast/跳页/重渲染全塞一处 | 低内聚，改一处碰全站 |
| B5 | `app` 全局无边界 | `app.js:17` 与 `:35` 都声明 `groups`，后者静默覆盖前者 | 状态无归属（且是真实缺陷） |
| B6 | 主题令牌未收口 | `style.css` 189 处颜色字面量，`rgba(47,214,165)` 出现 26 次；light/hc 各缺 12 个令牌 | 主题未集中化，浅色主题失真 |
| B7 | 命令拼接散落、转义不一致 | `/accountinfo ${user}`（无引号）、`/warp hide "${name}"`、`/group ... parts.join(' ')` | TShock 访问未集中 |
| B8 | 玩家查找/参数校验各写三份 | `server.js:1447,1655,1912`；`1647-1650` 与 `2016-2023` 几乎逐字相同 | 重复逻辑未提取 |
| B9 | rawcmd 成败判定有 4 套正则 | `1664`、`1872`、`2287`、`2176/2208` | 语义不统一 |

### 0.4 与 README 不符 / 待办（本轮不处理）

- README 第 153-160 行称“业务样式里不再出现硬编码颜色、三套主题覆盖全部令牌”—— 与 B6 实测不符。
- `/api/*` 无任何鉴权，仅靠绑定 `127.0.0.1`；而面板写入的 REST 令牌是 `superadmin`。本机任意进程可调用。**属安全问题，不属重构主题。**
- `TShockPanel/panel.json` 的 `launch.world` 已损坏为 `1_4_5_8寮€鑽?wld`（应为 `1.4.5.8开荒.wld`），是编码写坏，不是逻辑缺陷。修它属于数据修复，需单独确认。
- `writeFileAtomic` 无 fsync、异常时残留 `.tmp-<pid>` 文件（已在 B1 范围内，主题二顺手修）。

---

## 1. 2026-10-19 午间窗口（12:00–14:00）

### 1.1 计划（12:20 写定，先写后动手）

| 序号 | 主题 | 分支 | 目标文件 | 改动方式 | 预期结果 | 回滚点 |
| --- | --- | --- | --- | --- | --- | --- |
| T0 | 仓库基线 | `main` | `.gitignore` `.gitattributes` | 建库 + 入库边界 | 之后所有改动可回滚 | — |
| T1 | 文档与验证手段 | `refactor/arch` | `docs/*.md`、`tools/smoke.ps1` | 新建 | 每次提交 1 条命令验证 | T0 tag |
| T2 | 文件工具下沉 | `refactor/fs-utils` | 新 `lib/files.js`；`server.js` | 只搬运，不改逻辑 | 消除原子写/读 JSON/时间戳/建目录的散落 | T1 |
| T3 | 配置读写收敛 | `refactor/config-store` | 新 `lib/tshock-config.js`、`lib/paths.js`；`server.js` | 只搬运，不改逻辑 | 配置读改写只有一个入口，备份不再可能漏 | T2 合并点 |

**窗口内追加**：T4（前端通用工具层）是用户中途明确提出“前端也必须拆分解耦”后加做的，
原始计划里它排在下一窗口。追加时仍是“只搬运、不改行为”，并先补了前端验证手段再做拆分。

**本轮不做**（留给下一窗口，避免半成品）：前端状态层与页面层（B4/B5 的剩余部分）、
主题令牌收口（B6）、命令构造集中（B7）。

### 1.2 执行记录

| 主题 | 结果 | 提交 | 验证 |
| --- | --- | --- | --- |
| T0 仓库基线 | ✅ | `6ba3c90`，tag `arch-2026-10-19-baseline` | 13 个文件入库，270MB 二进制与含密钥文件全部排除 |
| T1 验证脚手架 | ✅ | `7ff9c76` | 本身即验证工具，首跑 17 接口全绿 |
| T1 文档 | ✅ | `8cfadb2` | — |
| T2 文件工具下沉 | ✅ | `7d12168` → merge `f4fe02b` | 6 JS `node --check` + 17 接口形状一致 + 3 个配置文件哈希未变 |
| T3 配置读写收敛 | ✅ | `d413db0` → merge `dd4822e` | 19 项单元断言 + 17 接口形状一致 + 哈希未变 |
| T4 前端工具层 | ✅ | 工具 `951d68f`；拆分 `67953c2` → merge `74816be` | 11 JS 语法 + 前端完整性/boot 双检 + 18 接口形状一致 |
| 修复 BOM | ✅ | `36542ce` | `git check-attr` 不再报错 |

### 1.3 改动摘要

**新增模块**

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `TShockPanel/lib/files.js` | 63 | 原子写、跨盘移动、读 JSON、时间戳、建目录（纯 IO，无业务） |
| `TShockPanel/lib/tshock-config.js` | 201 | `tshock/*.json` 唯一读写入口：备份 → 原子写 → 保留未知字段 |
| `TShockPanel/public/js/00-core.js` | 171 | 前端通用工具层：DOM 选择、格式化、fetch 封装、toast、模态框（不读业务状态） |
| `tools/smoke.ps1` | 302 | 启动面板 → 18 个接口形状比对 → 关闭 → 现场哈希校验 |
| `tools/config-store.test.js` | 127 | 配置层 19 项零依赖单元断言 |
| `tools/frontend-check.js` | 129 | 脚本顺序、跨脚本重复声明、基线符号丢失检查 |
| `tools/frontend-boot.js` | 195 | vm + DOM 桩 + 真实 fetch，验证 boot() 跑通 |

**行数变化**

- `server.js`：2602 → 2439（-163），删掉 7 个函数，改由 `createConfigStore(...)` 注入
- `public/app.js`：3030 → 2870（-160），工具层搬进 `js/00-core.js`

### 1.4 验证记录（本窗口最后一次）

```
node --check（11 个 JS）          全部通过
node tools/config-store.test.js   19 项断言全部通过
node tools/frontend-check.js      脚本顺序正确 · 无重复声明 · 基线 114 个符号零丢失
node tools/frontend-boot.js       boot() 在真实面板上跑完，app.state 已加载
tools/smoke.ps1 -CompareTo before 18/18 接口形状与基线一致
                                   tshock/*.json 与 panel.json 未被改写
```

**UI 未真人验证**：本机 dsh 内置浏览器不可用（没有可 spawn 的 Electron），
T4 只能做到 `frontend-check`（静态）+ `frontend-boot`（用 DOM 桩把 boot() 跑通，
app.state 确实加载成功）。**真机点页面必须由用户按 `docs/verification.md` 第 3 节走一遍**，
这是本窗口唯一没有闭环的验证项。

### 1.5 遗留问题（下一窗口的输入）

| 编号 | 问题 | 证据 / 位置 | 建议 |
| --- | --- | --- | --- |
| L1 | 配置备份文件名只精确到秒，同一秒内两次写入互相覆盖 | `lib/tshock-config.js` `backupFile()`；单测第 3 步已复现 | 加毫秒或冲突自增后缀，单独主题，需验证轮转逻辑 |
| L2 | `writeFileAtomic` 无 fsync、失败残留 `.tmp-<pid>` | `lib/files.js` | 与 L1 合并成一个“写入可靠性”主题 |
| L3 | `app` 对象重复声明 `groups`（`[]` 与 `null` 并存） | `public/app.js`，`frontend-check` 会打印 WARN | 搬 `10-state.js` 时清掉，但必须保持“生效值是 null” |
| L4 | `app.js` 仍有 720 行 `handleAction`；样式 189 处硬编码颜色 | `public/app.js`、`public/style.css` | 见 1.6 的 T6/T7 |
| L4b | 前端只拆了工具层，状态层/页面层仍在 app.js | `public/app.js` 2870 行 | 18:00 窗口继续 |
| L5 | `/api/*` 无鉴权 | 全站 | 安全问题，非重构主题，需单独确认 |
| L6 | `panel.json` 的 `launch.world` 已被写成乱码 `1_4_5_8寮€鑽?wld` | `TShockPanel/panel.json` | 数据修复，需用户确认后再动 |
| L7 | `tools/smoke.ps1` 是 PowerShell 5.1 脚本，**每次编辑后必须重新补 UTF-8 BOM**，否则中文串被按 ANSI 读、整脚本语法炸 | 本窗口已被坑两次 | 下次编辑后立刻跑一次 BOM 修复命令，或改用纯 ASCII 提示语 |

### 1.6 下一窗口建议（18:00 窗口）

> 窗口内追加说明：用户明确要求“前端也必须拆分解耦”，所以 T4 已在本窗口内完成第一批
> （`js/00-core.js`）。下列顺序据此更新。

1. **T5 前端状态层**：把 `app`、`appUi`、`warpState`、`dropdown` 四个全局状态收拢到
   `js/10-state.js`，`index.html` 插在 `00-core.js` 之后、`app.js` 之前。
   同时清掉 `app` 里重复声明的 `groups` 键（L3）——但必须保持“生效值是 `null`”的现状，
   否则会改变启动前的行为。
2. **T6 前端页面层**：按 `30-dashboard / 31-worlds / 32-players / 33-settings /
   34-give-events / 35-warps-groups-plugins` 逐块搬，一次一块；`handleAction` 那 720 行
   留到最后（`40-actions.js`），因为它是所有页面的汇合点，风险最高。
3. **T7 主题令牌收口（只补缺失令牌）**：`--radius`/`--danger`/`--success`/`--warning`/
   `--selection` 等 12 项，让三套主题都不再靠继承；189 处字面量替换另开一轮。
4. 有余力再做 L1+L2 的“写入可靠性”小主题（备份同名覆盖、无 fsync）。

**前端验证的现实约束**：本机 dsh 内置浏览器不可用，只能用 `frontend-check.js` +
`frontend-boot.js` 做静态与启动级验证；**真人点页面这一步只能由用户完成**，
对应 `docs/verification.md` 第 3 节 10 条路径。每轮汇报里要如实写明“UI 未真人验证”。

---

## 2. 2026-10-19 晚间窗口（18:00–23:30）

### 2.1 审计（18:00–18:20，不动代码）

- `git status` 干净；HEAD = `50fd4c3`；回滚锚点 `arch-2026-10-19-noon`。
- 前端 `app.js` 仍有 4 个模块级可变状态散落在业务代码中间（不是集中在文件头）：
  `app`（13–44 行）、`dropdown`（1742）、`appUi`（2316–2323）、`warpState`（2450）。
  这正是“状态没有归属”的典型症状：任何页面都能读写别人的状态。
- 后端 `server.js` 的 REST 访问仍是 5 个平铺函数，且 11 处手拼 `?a=...&b=...` +
  `encodeURIComponent`，成功判定同时看 HTTP status 与 body.status 两套语义。

### 2.2 计划（先写后做）

| 序号 | 主题 | 分支 | 改动方式 | 预期结果 | 回滚点 |
| --- | --- | --- | --- | --- | --- |
| T5 | 前端状态层收拢 | `refactor/state-layer` | 4 个全局状态搬进 `js/10-state.js`，`index.html` 插入 | 状态只在一个文件里定义，页面不再各自持有 | `arch-2026-10-19-noon` |
| T6 | 后端 REST 客户端 | `refactor/rest-client` | 新建 `lib/rest.js`；`server.js` 只保留调用 | 11 处手拼 URL 收敛为 query 构造 + 统一超时/令牌 | T5 合并点 |
| T7 | 前端页面层第一批 | `refactor/page-dashboard` | 搬 `30-dashboard.js` | 验证“一页一文件”的节奏可行 | T6 合并点 |

**验证口径（缺一不可）**：`node --check` 全部 JS、`node tools/config-store.test.js`、
`node tools/frontend-check.js`、`node tools/frontend-boot.js`、
`powershell -File tools\smoke.ps1 -CompareTo before`。
UI 真人验证仍只能由用户完成，汇报里必须如实写明。

### 2.3 执行记录

（随进度追加）

**T5 前端状态层** ✅ `7175c69` → merge `4fe0a03`

- `app` / `dropdown` / `appUi` / `warpState` 收拢到 `js/10-state.js`（56 行）。
- 顺手修 L3：`app.groups` 原来声明两次（`[]` 与 `null`），保留生效值 `null`、删掉死声明；
  `frontend-check.js` 现在会守着“当前 app 不许有重复键”。
- 同时修正验证工具两处误报：数组长度不再进入接口形状；boot 冒烟增加前置探活。

**T6 后端 REST 客户端** ✅ `facb784` → merge `e6e6e69`

- 新增 `lib/rest.js`（85 行）：`createRestClient({getPort,getToken})` + `appendQuery`。
- `server.js` 删掉 5 个 REST 函数，调用点零改动；`rawcmd` 参数改由 `appendQuery` 统一编码。
- 新增 `tools/rest-client.test.js`：16 项断言（编码、令牌追加、错误文案、返回值归一）。

**T7 前端页面层** ✅ `1fa50b9`、`f8297af`

- 第一批：仪表盘 / 控制台 / 世界 / 玩家 四页 → `js/30–33`。
- 第二批：其余全部 → `js/20-shell`、`34-settings`、`35-ssc`、`36-misc`、`37-theme`、
  `38-give-events`、`39-warps`、`40-groups`、`41-plugins`、`42-actions`、`90-boot`；
  `app.js` 删除。
- 结果：前端 = 17 个模块脚本（3146 行，含文件头注释），最大单文件 `42-actions.js` 825 行。
- 验证：17 个脚本 `node --check` 通过；`frontend-check` 114 个基线符号零丢失；
  `frontend-boot` 17 个脚本依次执行且 `boot()` 跑通；17 个 `/js/*.js` HTTP 全 200；
  API 形状 18/18 一致；`config-store` 19 项、`rest-client` 16 项断言全过。

### 2.4 本轮遗留

| 编号 | 问题 | 位置 | 下轮处理 |
| --- | --- | --- | --- |
| L8 | `42-actions.js` 仍 825 行，`handleAction` 一个函数约 720 行、60 个 case | `public/js/42-actions.js` | 按页面拆成 `actions/*.js`，每个页面自己注册 case |
| L9 | `server.js` 仍 2399 行，55 条路由内联 | `server.js` | 抽 `routers/*.js`，每域一个 register |
| L10 | 日志总线（logBuffer/SSE/行读取）与进程管理仍在 server.js | `server.js` | 抽 `lib/logbus.js`、`lib/process.js` |
| L11 | `style.css` 189 处硬编码颜色、三套主题缺 12 个令牌 | `public/style.css` | 主题令牌收口 |

### 2.5 下轮建议

1. **T8 `lib/logbus.js` + `lib/process.js`**：先把后端里“与 HTTP 无关”的两块搬走，
   `server.js` 才能只留路由与启动。
2. **T9 `42-actions.js` 拆成按页注册**：`handleAction` 变成查表，
   每个页面模块自己 `registerActions({...})`，消灭 720 行的 switch。
3. **T10 主题令牌**：补 12 个缺失令牌 → 先用 `--danger/--success/--warning/--selection`
   替换 26 处重复的 `rgba(47,214,165)` 一类字面量。
4. 之后再做 `routers/*` 与 L1/L2 写入可靠性。

### 2.6 晚间窗口第二批（T8 / T9）

**T8 日志总线下沉** ✅ `d302171` → merge `721b91f`

- 新增 `lib/logbus.js`（124 行）：`createLogBus()` 返回 `logBuffer/sseClients/addLog/broadcast/queueLogUpdate`；
  另导出纯函数 `decodeLine` / `makeLineReader` / `ANSI_RE`。
- `server.js` 整块替换为一行解构（2409 → 2312 行），调用点零改动。
- 新增 `tools/logbus.test.js`：21 项断言（折叠、200 层截断、缓冲上限、断线清理、
  CRLF 分块解析、GBK 回退、ANSI 剥离）。
- 说明：本轮把 T5/T6/T7 的分支一起并入了 `refactor/arch`（分支建在了 `refactor/page-dashboard`
  之上），历史看起来是链式的，但内容与顺序正确，`refactor/page-dashboard` 已删除。

**T9 物品库与发放校验下沉** ✅ `f3d130f` → merge `50438a8`

- 新增 `lib/items.js`（62 行）：`createItemService({itemsPath})` → `load/find/validateGive`，
  区间常量 `COUNT_RANGE` / `PREFIX_RANGE` 成为唯一出处。
- 校验顺序与 5 条错误文案逐字不变；`server.js` 的 itemsCache/itemsIndex/loadItems/findItem 实现删除。
- 新增 `tools/items.test.js`：17 项断言。
- **过程中发现一处理解偏差**：`-15` 铜短剑其实**在** `data/items.json` 里（`special: true`），
  所以负数 ID 也要带回 item 对象；已按原行为对齐，并把这条写进测试，防止以后“想当然”地跳过查询。

### 2.7 窗口收尾状态

- 4 套单元测试：`config-store` 19 项、`rest-client` 16 项、`logbus` 21 项、`items` 17 项，全过。
- 冒烟：32 个 JS `node --check` 通过、18 个接口形状与基线一致、配置文件未被意外改写。
- 前端：17 个模块脚本，`frontend-check` 基线 114 符号零丢失，`frontend-boot` 在真实面板跑通 boot()。
- 代码量：`server.js` 2602 → 约 2295；前端 1 个 3030 行文件 → 17 个模块（3146 行）。
- README 第七节已按新结构重写，并补了“加新功能时改哪里”对照表。
- **UI 仍未真人验证**（内置浏览器不可用），需要用户按 `docs/verification.md` 第 3 节走一遍。

### 2.8 下一窗口建议

1. **T10 `42-actions.js` 拆解**（825 行 / 79 个 case）：按页面拆成 `actions/*.js`，
   每个页面导出自己的处理函数，`handleAction` 变成顺序尝试 + 短路。
   注意：每个 case 都以 `return` 结尾，拆分时必须保证“已处理/未处理”可区分，
   否则会漏执行后面的 case。建议先加一个“case 集合对比”检查（基线 79 个 action 名字集合）。
2. **T11 主题令牌**：补 light/high-contrast 缺失的 12 个令牌，再替换重复字面量。
3. **T12 后端路由分域**：先把域服务（plugins/backups/warps）抽成模块，再把 `routers/*` 拆开；
   直接搬 handler 会因为闭包依赖 server.js 局部变量而失败，必须先服务化。
4. L1/L2 写入可靠性（备份同名覆盖、无 fsync）可与 T12 并行排期。

---

## 3. 2026-10-20 午间窗口（12:00–14:00）

### 3.1 审计（12:00–12:20）

- 依赖状态：工作区干净，HEAD = `139d9f0`，回滚锚点 `arch-2026-10-19-night`。
- 前端 25 个脚本里，`42-actions.js` 仍是 826 行的单块：`handleAction` 一个函数 730 行、79 个 case。
  它和页面渲染代码是两套组织方式——页面已经一页一文件，动作却还在一个大 switch 里，
  加一个按钮必须先在大文件里找到“该插在哪一页的 case 后面”。
- 后端 `server.js` 2299 行、55 条路由内联；这条线的前置是“域服务化”，不在本窗口。

### 3.2 计划与执行

| 序号 | 主题 | 分支 | 结果 |
| --- | --- | --- | --- |
| T10 | 动作分发按页拆分 | `refactor/split-actions` | ✅ `1f880a6` → merge `cf347c0` |

### 3.3 做了什么

- 把 79 个 case 按页面切成 8 个文件：`43-actions-shell` / `44-actions-warps` /
  `45-actions-plugins-theme` / `46-actions-give-events` / `47-actions-groups-ssc` /
  `48-actions-settings` / `49-actions-worlds-players` / `50-actions-backups-misc`。
  每个文件导出 `async function xxxActions(action, el)`，未命中时 `default: return false`。
- `handleAction` 改为顺序尝试（数组在函数体内现取，避免加载期引用未定义函数）。
  **为什么“命中后继续尝试下一组”也安全**：action 名称全局唯一，命中的 case 自己 `return`，
  后续组一律走 default 返回 false，不会重复执行；拆分脚本最后断言了 79 个 case 全覆盖、无重复。
- `42-actions.js`：826 → 118 行，只剩调度器与 `saveConfig` / `sendCommand` / `showPlayerDetail`。
- `frontend-check.js` 新增两道守卫：
  1. 基线 79 个 action 名称必须全部仍在且不重复；
  2. 页面里 78 个 `data-action` 必须都有对应 case —— 专防“按钮点了没反应”这类拆分事故。

### 3.4 验证

```
node --check              40 个 JS 全部通过
frontend-check            25 脚本顺序正确 · 114 符号零丢失 · 79 action 齐全 · 78 data-action 有分支
frontend-boot             25 脚本依次执行 · boot() 跑通 · app.state 已加载
smoke -CompareTo before   18 个接口形状一致 · 配置文件未被改写
```

### 3.5 遗留与下轮

| 编号 | 事项 | 说明 |
| --- | --- | --- |
| L12 | 主题令牌未收口 | light/high-contrast 各缺 12 个令牌，189 处硬编码颜色 |
| L13 | 后端路由未分域 | 前置是 plugins/backups/warps 服务化，不能直接搬 handler |
| L8 | ~~42-actions 825 行~~ | 本窗口已解决（826 → 118 行 + 8 个按页模块） |

下轮建议：**T11 主题令牌**（纯 CSS，可静态校验，但需要用户看一眼配色）→
**T12 域服务化**（plugins/backups/warps）→ 再谈 `routers/*`。

---

## 4. 2026-10-20 晚间窗口（18:00–23:30）

### 4.1 审计与计划

- 起点：工作区干净，HEAD = `4d5fb98`，锚点 `arch-2026-10-20-noon`。
- `server.js` 仍有 55 条路由内联。上一窗口的结论是“直接搬 handler 会因闭包依赖失败，
  必须先服务化”——本窗口就是按这个顺序执行的：先拔业务，再拔路由。

### 4.2 执行记录（4 个主题）

| 主题 | 分支 | 提交 | 说明 |
| --- | --- | --- | --- |
| T11 备份服务化 | `refactor/backups` | `eb31034` → `50aa671` | `lib/backups.js` + 15 项单测；顺手修了“同秒备份互相覆盖导致还原变空操作”的真 bug |
| T12 世界存档服务化 | `refactor/worlds-store` | `08b871a` → `3da64a7` | `lib/worlds-store.js` + 16 项单测 |
| T13 插件路由分域 | `refactor/routers-plugins` | `d57df96` → `ba596df` | `routers/plugins.js`（6 条）+ 15 项单测，第一个路由样板 |
| T14 备份路由分域 | `refactor/routers-backups` | `c937c4d` → `2c771cb` | `routers/backups.js`（4 条）+ 11 项单测 |
| T15 世界路由分域 | `refactor/routers-worlds` | `0000f0d` → `a823afc` | `routers/worlds.js`（5 条）+ 14 项单测 |
| T16 传送点域 | `refactor/routers-warps` | `22f5d33` → `085754e` | `lib/warps-db.js` + `routers/warps.js`（5 条）+ 18 项单测 |

### 4.3 成果

- `server.js`：**2122 → 1822 行**（相对最初基线 2602 行已降 30%）。
- 新增 `routers/` 层：plugins / backups / worlds / warps 共 **20 条路由**迁出，
  路由只做 HTTP 形状，依赖由 server.js 显式注入（`ctx`），模块不 require server.js。
- 新增 4 个 lib 模块：`backups.js`、`worlds-store.js`、`warps-db.js`。
- 单元测试：**10 套、162 项断言**（config-store 19 / rest-client 16 / logbus 21 /
  items 17 / backups 15 / worlds-store 16 / routers-plugins 15 / routers-backups 11 /
  routers-worlds 14 / routers-warps 18）。
- **修掉一个真实数据风险**：备份目录名只到秒，`restore()` 的“还原前自动备份”会与
  正在还原的快照撞名并覆盖它 —— 结果是“点了还原但什么都没发生”。现在撞名自动加后缀，
  单测把这条钉死。

### 4.4 验证

```
10 套单元测试                     162 项断言全过
smoke -CompareTo before          53 个 JS 语法通过 · 19 个接口形状一致 · 配置文件未被改写
node TShockPanel/server.js        启动正常，GET /api/warps 返回真实 worldId
```

### 4.5 遗留与下轮

| 编号 | 事项 | 说明 |
| --- | --- | --- |
| L13 | 仍有 35 条路由内联在 server.js | players/bans/users/groups/events/items/config/ui/server 控制等域 |
| L14 | `lib/warps-db.js` 的 sqlite 路径尚未单测 | 需要 Node 22 + 真实库文件，留给“集成测试”主题 |
| L12 | 主题令牌未收口（189 处硬编码颜色） | 纯视觉，需要用户看一眼配色后再动 |
| L1 | 配置备份同名覆盖（秒级时间戳） | 备份服务已修；`lib/tshock-config.js` 的 `backupFile` 同样问题仍在 |

下轮建议：继续 `routers/`（players 与 groups 是最大两块）→ 然后是
`lib/process.js`（服务器启停与日志跟踪，timer 归属要小心）→ 最后收 CSS 令牌。



## 5. 2026-10-21 午间窗口（12:00–14:00）

### 5.1 审计（12:00–12:20）

- 起点：工作区干净（仅一个未跟踪的 `.idea/`，IDE 目录，需加入 `.gitignore`），
  HEAD = `a969076`，锚点 `arch-2026-10-20-night`。
- `server.js` 1822 行，仍内联 **42** 条路由（`grep -c '^route('`）：
  state/events/logs/server 控制 7 条、config/sscconfig/text 6 条、players/bans/users 12 条、
  groups 5 条、items 2 条、world-events 2 条、ssc inventory 2 条、ui 2 条、misc 4 条。
- 观测到的耦合点（决定拆分顺序的关键）：
  1. `listGroupsDetailed()` 同时被“用户组”与“用户账户改组”两处使用 —— 必须先下沉成服务，
     否则两个路由模块要互相依赖。
  2. `parseAccountInfo` / `maskIp` / `playerDisplayName` 是纯函数，天然可单测，
     但现在埋在 1800 行文件里，只能靠起服务测。
  3. 配置读写已经全部走 `configStore`，`config/sscconfig/text` 六条路由只差“搬家”。
  4. `L1`（配置备份同秒覆盖）与昨晚修掉的备份 bug 同源，属于真缺陷，优先级高于纯搬家。

### 5.2 计划（开工时定 3 个主题 + 1 个顺带修复，实际执行 9 + 2）

开工计划：T17 用户组、T18 玩家/封禁/账户、T19 配置与文本、T20 修 L1。
执行中因为每个主题都比预算小（单测好写、搬运机械），按同样节奏扩到 9 个主题，
把“内联路由”清零；扩范围的前提是每个主题独立验证、独立提交，随时可回滚。

| 主题 | 内容 | 验证 |
| --- | --- | --- |
| T17 用户组域 | `lib/groups.js`（组详情/加权限/改父组/建组/删组/组名列表）+ `routers/groups.js`（6 条）+ 单测 | 单测 + smoke |
| T18 玩家/封禁/账户域 | `lib/players.js`（纯展示函数 + 账户信息解析）+ `routers/players.js`（12 条）+ 单测 | 单测 + smoke |
| T19 配置与文本域 | `routers/config.js`（6 条），只搬不改 | smoke 形状比对 |
| T20 修 L1 | `lib/tshock-config.js` 备份同秒覆盖加后缀 + 单测 | 单测 |

后来追加（风险从低到高）：T20 外观偏好、T21 物品发放、T22 SSC 初始物品、
T23 世界事件、T24 sqlite 测试 + 修 L14、T25 服务器控制、T26 静态文件。

不做：`lib/process.js`（风险最高，需要整块时间，留给晚间窗口）、CSS 令牌（需用户看配色）。

### 5.3 执行记录（本轮 9 个主题 + 2 项顺带修复）

| 主题 | 分支 | 提交 | 结果 |
| --- | --- | --- | --- |
| T17 用户组域 | `refactor/groups-domain` | `9f53f8c` | `lib/groups.js` + `routers/groups.js`（6 条）+ 26 项断言 |
| T18 玩家/封禁/账户域 | `refactor/players-domain` | `56bc8d6` | `lib/players.js` + `routers/players.js`（12 条）+ 39 项断言 |
| T19 配置与文本域 | `refactor/routers-config` | `1656b87` | `routers/config.js`（6 条）+ 19 项断言 |
| T20 外观偏好 | `refactor/ui-state` | `045cd5b` | `lib/ui-state.js` + `routers/ui.js`（2 条）+ 27 项断言 |
| T21 物品发放 | `refactor/routers-items` | `bdb5cab` | `routers/items.js`（2 条）+ 18 项断言 |
| T22 SSC 初始物品 | `refactor/routers-ssc` | `1386b07` | `lib/ssc-inventory.js` + `routers/ssc.js`（2 条）+ 24 项断言 |
| T23 修 L1 | `fix/config-backup-collision` | `7058e9f` | 配置备份同秒撞名加后缀 + 4 项断言 |
| T24 世界事件 | `refactor/world-events` | `18758d4` | `lib/world-events.js` + `routers/world-events.js`（2 条）+ 40 项断言 |
| T25 修 L14 | `test/warps-db` | `263090d` | sqlite 访问层单测（15 项）+ 库备份同秒撞名修复 |
| T26 服务器控制 | `refactor/server-control` | `fd42291` | `routers/server-control.js`（10 条）+ 39 项断言 |
| T27 静态文件 | `refactor/static-files` | `c2ddc5c` | `lib/static-files.js` + 18 项断言（含穿越防护） |

关键判断：

1. **先把 `listGroupsDetailed` 下沉再拆路由。** 它被「用户组页」与「用户账户改组」两处共用，
   不先下沉，两个路由模块会互相 `require`；下沉后只注入同一个实例。
2. **封禁时间换算是本轮最容易被“顺手优化”改坏的地方。** ticks 是 1e17 量级，超过双精度
   整数上限（9.007e15），往返换算天生有 ±1ms 误差；单测用 ±2ms 容差并固定基准时刻，
   否则会偶发失败（真实踩过，连跑 8 次挂 2 次）。
3. **服务器控制只搬 HTTP，不搬进程。** `startServer`/`stopServer` 仍是 server.js 的能力，
   路由通过 ctx 显式注入——这是下个窗口抽 `lib/process.js` 的接口清单。
   附带把 SSE 心跳定时器与延时退出改成可注入，测试才能断言“连接关闭时定时器被清掉”
   （“面板退不出去”的典型成因）。
4. **静态文件的穿越防护从“靠眼睛”变成“靠测试”。** 用 `../`、`%2e%2e`、`..%5c`
   三种写法实测，断言读不到 public 之外的文件。

### 5.4 验证

```
20 套单元测试                     430 项断言全过
smoke -CompareTo before          77 个 JS 语法通过 · 19 个接口形状一致 · 配置文件未被改写
server.js                        2602 → 1207 行（−54%），内联路由 42 → 0 条
```

本轮新发现并修掉的缺陷：

- 配置备份（`lib/tshock-config.js`）同一秒内互相覆盖 → 加 `-2` 后缀（L1）。
- tshock.sqlite 备份（`lib/warps-db.js`）同样撞名覆盖 → 同处理（写测试时暴露）。
- 单测里 `activeBans` 的日期断言存在毫秒漂移 → 固定基准时刻 + ±2ms 容差。

### 5.5 遗留与下轮

| 编号 | 事项 | 说明 |
| --- | --- | --- |
| L15 | `server.js` 已无路由，但仍持有进程启停、日志跟踪、`getState` | 下一窗口的主线：抽 `lib/process.js`（spawn/kill/pid/tail/timer 归属） |
| L2 | `writeFileAtomic` 无 fsync，失败时可能残留 `.tmp-<pid>` | 核心写路径，需要单独验证后再改 |
| L12 | 主题令牌未收口（189 处硬编码颜色） | 纯视觉，需要用户看一眼配色后再动 |
| L16 | `/api/*` 无鉴权（仅 localhost 可达） | 安全问题而非重构主题，需用户决策是否加 |
| L6 | `panel.json` 的 `launch.world` 曾出现乱码 | 已于本轮观察确认现值为 `1_4_5_8开荒.wld` 正常；保留观察 |

下轮建议（晚间 18:00–23:30，风险最高的一段，建议只开一个主主题）：

1. `lib/process.js`：把 spawn/kill/pid 探测/输出 tail/自动重启 timer 收进一个模块，
   `server.js` 只保留 `main()` 与依赖装配；这是本轮注入清单的直接延续。
2. 若时间允许：`lib/files.js` 的 fsync 与临时文件清理（L2），配一套写路径单测。
3. 只剩 CSS 令牌（L12）与鉴权（L16）两项需要用户参与决策的事项。

## 6. 2026-10-21 晚间窗口（18:00–23:30）

### 6.1 审计（18:00–18:20）

- 起点：工作区干净，HEAD = `a9bd999`，锚点 `arch-2026-10-21-noon`。
- `server.js` 1207 行，已无路由；剩下的都是“进程与装配”：
  - 152–631 行：**进程域**（proc 状态、spawn、pid 探测、控制台/日志双 tail、
    就绪监控、停止与强杀、自动重启、接管已运行服务器）≈ 480 行，没有任何单测；
  - 720–785 行：`getState()`（66 行），把 proc/state/配置文件拼成 `/api/state` 的响应；
  - 79–1207 行其余：路径常量、state 加载、依赖装配、`main()`。
- 风险点（决定测试怎么写）：
  1. **timer 归属**：就绪轮询 400ms、控制台 tail 250ms、外部日志 tail 1500ms、
     自动重启 5s、世界生成完成后延时 2.5s 关服——五处定时器散在同一段里，
     面板“退不出去 / 退了但服务器还在”都可能是这里的引用没清干净；
  2. **state 引用同一性**：`getState()` 直接读 `proc.*`，拆走后必须仍是同一个对象引用，
     否则仪表盘会一直显示“未运行”；
  3. **自动重启依赖“退出时的上下文”**（`wasReady`、`proc.worldPath`），
     顺序错了会变成“服务器崩了就再也不起来”；
  4. 现有 `restartRequested` 标志只被重置、从未置 true（历史遗留死代码），
     本轮**保持原样**，只记录，不顺带改行为。
- 结论：进程域可以整体搬走，但必须把 `spawn`、定时器、`now()` 做成可注入，
  否则单测只能“起真服务器”才能跑。

### 6.2 计划（本轮 3 个主题）

| 主题 | 内容 | 验证 |
| --- | --- | --- |
| T28 进程域 | `lib/process.js`：`proc` 状态对象、启停、双 tail、就绪监控、自动重启、接管；`buildArgs`/`parseUptime` 纯函数单独导出 + `tools/process.test.js` | 单测 + smoke（真实启动关闭面板） |
| T29 状态视图 | `lib/state-view.js`：把 `getState()` 拼装下沉，注入 proc/state/路径/配置读取 | 单测 + smoke 形状比对 |
| T30 写路径 | `lib/files.js` 的 fsync 与失败清临时文件（L2）+ 写路径单测 | 单测 + smoke 哈希比对 |

做不完 T30 就记待办，不硬赶；不做：CSS 令牌（需用户看配色）、鉴权（需用户决策）。

### 6.3 执行记录（实际 8 个主题）

| 主题 | 分支 | 提交 | 结果 |
| --- | --- | --- | --- |
| T28 进程域 | `refactor/process` | `eeceb3d` | `lib/process.js`（~480 行）+ 53 项断言；假 spawn/定时器/时钟驱动全部分支 |
| T29 状态视图 | `refactor/state-view` | `91dbd54` | `lib/state-view.js` + 26 项断言 |
| T30 写路径（L2） | `refactor/files-atomic` | `bd97cdf` | fsync + 失败清临时文件 + 18 项断言 |
| T31 面板设置 | `refactor/panel-state` | `395a3a2` | `lib/panel-state.js` + 18 项断言 |
| T32 HTTP 工具 | `refactor/http-utils` | `f482ada` | `lib/http-utils.js` + 18 项断言 |
| T33 端口顺延 | `refactor/listen` | `c2ec2ad` | `lib/listen.js` + 7 项断言（真实端口） |
| T34 冒烟探针 | `test/smoke-probes` | `15a249b` | 19 → 23 条（补 SSC 读接口、两个 400 负例、静态 404） |
| T35 数据与格式测试 | `test/worlds`、`test/catalog` | `35cf477`、`d470c4c` | `.wld` 解析 23 项 + 权限/事件目录 17 项 |

关键判断：

1. **进程域的测试策略是“注入而不是模拟”**：spawn、五个定时器、now()、sleep() 全部可注入，
   测试用假定时器断言“连接关闭时定时器被清掉”“自动重启的 5 秒回调真的又拉起一次”，
   不需要真的启动 TShock.Server.exe（也避免了误启游戏服务器）。
2. **自动重启的上下文容易错**：它依赖退出瞬间的 `wasReady` 与 `proc.worldPath`，
   所以 `startServer` 在排 5 秒定时器时先取一份 `launch` 快照，单测把这个顺序验证住。
3. **历史死代码`restartRequested` 保持不变**：它只被重置、从未置 true；因为“不改对外行为”，
   只记在这里，不顺带删。
4. **fsync 的验证方式**：包装 `fs.fsyncSync` 计数（lib/files.js 与测试共享同一个 fs 单例），
   既能断言调用了 fsync，又不影响真实写入。
5. **冒烟探针变更必须重录基线**：接口集合变了就不能默默跳过，已用 `-Record before` 重录并在
   verification.md 同步为 23 条。

### 6.4 验证

```
28 套单元测试                     610 项断言全过
smoke -CompareTo before          88 个 JS 语法通过 · 23 个接口形状一致 · 配置文件未被改写
frontend-boot（真跑 boot()）      app.state 已加载 · app.view = dashboard
server.js                        2602 → 667 行（−74%），内联路由与进程逻辑全部为零
```

本轮修掉/补齐的遗留：

- L15（进程域无测试）→ `lib/process.js` + 53 项断言。
- L2（原子写无 fsync、失败残留临时文件）→ 已修并有测试。
- 新增认知：`getState()` 的兜底语义（REST 失败给 null/空数组、setup-code 缺失给空串）
  以前散在 1200 行中间，现在有 26 项断言。

### 6.5 遗留与下轮

| 编号 | 事项 | 说明 |
| --- | --- | --- |
| L12 | 主题令牌未收口（189 处硬编码颜色） | **本窗口未完成，已在本日追加节 §7 做完**：阴影/遮罩/分隔线令牌化、品牌色改 color-mix，并新增 css-theme 与 contrast 两个守卫测试 |
| L16 | `/api/*` 无鉴权（仅 localhost 可达） | 安全问题而非重构主题，需用户决策；若加，建议只加“本机 + 令牌”两层 |
| L17 | 前端 25 个模块的结构本轮未动 | 前几轮已拆完；本轮无前端改动，也无需用户重新点页面 |
| L18 | 进程域测试用假 spawn，未与真 TShock.Server.exe 联调 | 真启动会拉起游戏服务器，不适合自动测；建议用户实际启停一次确认 |

下轮建议：

1. 代码结构已经不是瓶颈：`server.js` 只剩装配与服务间的接线，改动点都有单测。
   下一阶段的收益主要在**人工验收 + 视觉/安全两项决策**上。
2. 若继续重构：建议做“前端 CSS 令牌收口”（L12）与“接口鉴权”（L16），两者都需用户在场。
3. 建议安排一次真人启停演练（L18）：启动 → 看仪表盘 → 停服 → 确认进程退出，
   覆盖“假 spawn 测不到”的真实进程行为。

## 7. 2026-10-21 追加：白色模式修复（用户反馈后）

用户结论：仪表盘看不出问题；白色模式有阴影仍是暗色模式；superadmin 暂不加。

### 7.1 根因

不是漏改某几处，而是**机制缺失**：业务样式里可以随手写 `rgba()`，这些值是照着
深色背景挑的，切到浅色主题不会自动变化。审计后确认业务样式区有 54 处品牌色字面量
与 11 处暗色阴影/遮罩/分隔线，全部是“深色模式专用”。

### 7.2 做法

| 改动 | 内容 |
| --- | --- |
| 主题令牌 | 三主题各补 5 个：`--shadow-pop`、`--shadow-modal`、`--mask-bg`、`--row-line`、`--fade-to`；白/高对比另补 `--selection` |
| 暗色硬编码 | 3 处黑阴影、弹窗遮罩、6 处深色分隔线、1 处吸顶渐隐 → 换成令牌 |
| 品牌色半透明 | 54 处 `rgba(47,214,165,…)` 等 → `color-mix(in srgb, var(--accent 等) N%, transparent)`，自动跟随各主题品牌色 |
| 守卫测试 | `tools/css-theme.test.js`（13 项）：三主题关键令牌齐全 / 业务样式零硬编码颜色 / var() 都有定义 / 括号注释成对 / 白色阴影不得照抄深色 |
| 可读性测试 | `tools/contrast.test.js`（50 项）：按 WCAG 算对比度，正文 ≥ 7:1、弱化文字与语义色 ≥ 4.5:1；时间戳刻意压暗，单列 2:1 下限 |

### 7.3 验证

```
30 套单元测试        全过（新增 css-theme、contrast）
smoke 23/23         面板启动正常、配置文件未被改写
frontend-check      结构检查通过（79 action / 78 data-action）
frontend-boot       真跑 boot() 通过
样式文件            200，43.5 KB
```

**未做视觉验证**：本机内置浏览器（Electron）不可用，浅色模式最终观感需要人工确认。

### 7.4 新增的长期收益

CSS 现在有两条硬约束，由测试保证：
1. 业务样式区不允许出现任何硬编码颜色（主题预览色块除外）；
2. 三套主题的关键令牌必须齐全，缺了就静默继承深色值。

这意味着以后加组件时，写 `rgba()` 会直接让测试失败，而不是等到有人切到白模式才被发现。

### 7.5 补齐：内置浏览器可用后的真人验证（22:40–23:00）

**浏览器问题已修**：DSH 桌面端的 `dsh-builtin-browser` 依赖 Electron 二进制，而
Electron 44+ 不再随 npm 安装自动下载。本机 `node_modules/electron` 缺 `dist/` 与
`path.txt`，所以 provider 一直报不可用。执行：

```
cd %USERPROFILE%\.dsh\profiles\desktop
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node node_modules/electron/install.js
```

GitHub 源在国内极慢（12 分钟无进展），换 npmmirror 后约 2 分钟完成。

**随后按 docs/verification.md 第 3 节实走（三套主题 + 13 个页面）：**

| 检查项 | 结果 |
| --- | --- |
| 首页仪表盘显示「服务器未运行」 | 通过 |
| 13 个页面逐个切换 | 通过（标题与内容都正确，无空白页） |
| 三套主题切换 | 通过；白色模式阴影已变柔和的蓝灰，高对比模式无阴影、纯白分隔线 |
| 字号 125% | 通过（自动换行，无溢出） |
| 物品搜索 天顶剑 / Zenith / 4956 与 Esc 关闭 | 通过（下拉正常，Esc 关闭） |
| 面板设置保存 | 通过（右下角「面板设置已保存」提示条，阴影柔和） |
| 世界备份创建 + 删除 | 通过（生成 10.73 MB 快照，删除后列表恢复原 5 条，测试数据已清理） |
| 浏览器控制台报错 | 无（13 个页面切换期间零 error / unhandledrejection） |
| 启停服务器（需开服） | **未做**：会真的拉起 TShock 服务器，留待用户演练 |

**发现一个待修的小问题（新遗留 L19）**：停服状态下进入「权限管理」，请求 `/api/groups`
失败后页面会一直停在「加载中…」，只在右下角弹一条「服务器没有运行。」。
应在请求失败时把左栏渲染成错误/空状态，而不是保留 loading 文案。
（2026-10-22 已修：失败时左栏显示「读取用户组失败：… 点上面的「刷新」重试」，
右栏标题变「读取失败」并提示先开服；不清空上一次成功读取的 `app.groups`。
打开页面、渲染失败（包括返回数据形状不对）都走这个分支。改动在 `public/js/40-groups.js`。）

截图证据（本次会话生成，未入库）：`%USERPROFILE%\Downloads\dsh-shots\` 下的 19 张
（夜间/日间/高对比、弹窗、下拉、提示条、设置、备份列表等）。

## 8. 2026-10-21 追加：自定义配色（新功能）

用户反馈“只有黑白太单调”，要求在面板里自由选颜色。

### 8.1 做法

| 层 | 改动 |
| --- | --- |
| 后端 | `lib/ui-state.js` 新增 `validateCustomThemes`：只接受 `custom` 一个槽位、16 个白名单令牌、`baseTheme` 三选一；颜色只允许 hex/rgb(a)/hsl(a)，尺寸必须带单位。`patch()` 收到 `customThemes` 就整体校验，不合法直接拒绝 |
| 前端 | `37-theme.js` 新增色板编辑器：10 个颜色选择器 + 实时预览；`applyCustomTheme` 支持部分令牌；`data-theme` 改为“底子主题 + 覆盖值”，所以自定义既能基于夜间也能基于日间 |
| 联动 | 主色变化时在 JS 里派生 `--accent-hover / --accent-2 / --accent-ink / --accent-text`，并把选区色算成同色半透明，避免“紫色主色 + 绿色按钮” |
| 入口 | `index.html` 外观页新增「自定义配色」卡片；`45-actions-plugins-theme.js` 增加 `apply-custom-colors` / `reset-custom-colors` 两个动作 |
| 样式 | `style.css` 新增 `.color-grid / .color-field`，只用令牌，通过 CSS 守卫测试 |

### 8.2 验证

```
node --check                92 个 JS 全过
30 套单测                    全部通过（ui-state 新增 8 项自定义配色校验断言）
frontend-check / boot       通过（新增 2 个 data-action 都有处理分支）
smoke 23/23                 接口形状与配置文件未变
真人操作（内置浏览器）       选色实时预览 → 应用 → /api/ui 落盘 → 刷新后保持 → 清除自定义恢复日间
```

实测截图：`%USERPROFILE%\Downloads\dsh-shots\20~24-*.png`（色板、实时预览、刷新后保持、自定义主题卡片）。

### 8.3 遗留

- 色板只开放 10 个实色令牌；`--selection` 这类带透明度的仍走 JSON 导入（color 输入框不支持 alpha）。
- 只支持一个自定义槽位（`custom`）。若以后要保存多套配色，把 `CUSTOM_THEME_NAMES`
  与前端 `customThemes` 的键扩成数组即可，校验逻辑已经按“多个主题名”写好。

## 9. 2026-10-21 追加：浅蓝配色（用户数据，无代码改动）

用户：“利用自定义主题调一个浅蓝色的主题，我不懂设计，不会配颜色”。
用 8.1 的自定义槽位配了一套浅蓝，**只写进 `TShockPanel/dsh.ui.json`（运行时状态，
不入库）**，代码零改动，所以 30 套单测 / smoke / 前端检查的结论与 8.2 相同。

### 9.1 取值与理由

| 令牌 | 值 | 落到的变量 | 选它的原因 |
| --- | --- | --- | --- |
| `baseTheme` | `light` | `data-theme` | 浅色底子，未覆盖的四十多个令牌仍用已校验过的日间值 |
| `background` | `#dbeafe` | `--bg` | 蓝 100；只给画布上色，卡片留白才有层次 |
| `surface` | `#ffffff` | `--panel` | 卡片纯白，和浅蓝画布拉开一档 |
| `foreground` | `#0f2440` | `--text` | 深藏蓝，代替纯黑，和蓝调同族 |
| `mutedForeground` | `#46617e` | `--muted` | 灰蓝；画布上 5.26:1、卡片上 6.42:1 |
| `accent` | `#2563eb` | `--accent` | 蓝 600；白字按钮 5.17:1（≥4.5 才敢用在按钮上） |
| `border` | `#bed6f5` | `--line` | 浅蓝描边，替代原来的冷灰 |
| `inputBackground` | `#ffffff` | `--input-bg` | 输入框和卡片同白，靠描边区分 |
| `danger` | `#d92d20` | `--rose` | 纯红；和蓝不撞色，卡片上 4.83:1 |
| `warning` | `#b45309` | `--amber` | 琥珀，卡片上 5.02:1 |
| `success` | `#1d4ed8` | `--accent-2` | 会和主色派生值一致，等于没改，写出来只为色板不留空 |
| `selection` | `rgba(37, 99, 235, 0.16)` | `--selection` | 选中/高亮跟主色同色半透明 |

主色派生（JS 现算，不落盘）：`--accent-hover #1451d8`、`--accent-2 #1249c1`、
`--accent-ink #ffffff`、`--accent-text #0a3696`。

### 9.2 对比度自测（AA 门槛 4.5:1）

```
12.78  主要文字 / 画布      15.59  主要文字 / 卡片
 5.26  次要文字 / 画布       6.42  次要文字 / 卡片
 5.17  按钮文字 / 主色      10.60  链接文字 / 卡片
 4.83  危险色 / 卡片         5.02  警告色 / 卡片
```

### 9.3 怎么恢复

外观页 →「自定义主题」→ 把下面这段粘进文本框 → 导入主题。
**导入按钮比 API 严**：它要求 16 个令牌齐全（包括字号/圆角），少一个就报错，
所以下面这份是「导出当前主题」生成的完整版，不是只写颜色的精简版（精简版
只有 `/api/ui` 能用）。

```json
{
  "background": "#dbeafe",
  "surface": "#ffffff",
  "foreground": "#0f2440",
  "mutedForeground": "#46617e",
  "accent": "#2563eb",
  "danger": "#d92d20",
  "success": "#1249c1",
  "warning": "#b45309",
  "border": "#bed6f5",
  "selection": "rgba(37, 99, 235, 0.16)",
  "inputBackground": "#ffffff",
  "fontFamily": "system-ui, -apple-system, \"Segoe UI\", \"Microsoft YaHei\", \"PingFang SC\", sans-serif",
  "baseFontSize": "14px",
  "radius": "16px",
  "spacing": "13px",
  "buttonMinHeight": "34px",
  "baseTheme": "light"
}
```

（`success` 导出时是主色现算出来的 `#1249c1`，和 9.1 里存的 `#1d4ed8` 不同——
因为主色派生总会在应用时覆盖它，存哪个值结果都一样。）

注意：点「清除自定义」会把 `customThemes` 清空，这套配色随之丢失，需要靠上面
这段 JSON 重新导入。
