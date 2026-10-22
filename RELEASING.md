# 发版手册

给未来的自己看：版本号怎么定、发一次版要做哪些事。

## 一、版本号怎么定

采用语义化版本 `主版本.次版本.修订号`，Git 标签加 `v` 前缀，例如 `v1.1.0`。

| 这次的改动 | 版本怎么变 | 例子 |
| --- | --- | --- |
| 只修 bug，用户看到的功能没变 | 修订号 +1 | `1.0.0 → 1.0.1` |
| 加了页面/接口，老用法还能用 | 次版本 +1，修订号归零 | `1.0.0 → 1.1.0` |
| 破坏性改动：配置文件格式变了、最低 Node/TShock 版本变了、接口删了 | 主版本 +1，后面归零 | `1.1.0 → 2.0.0` |

判断口诀：

- 用户能察觉到“多了个新东西” → **次版本**
- 只是把坏的东西修好了 → **修订号**
- 旧的配置文件或旧的使用方式会坏 → **主版本**

### 兼容矩阵

| 面板 | TShock / Terraria | Node.js | 系统 |
| --- | --- | --- | --- |
| `1.x` | 6.2.1 / 1.4.5.8 | ≥ 22 | Windows |

TShock 跟着游戏更新时：如果面板要改接口才能用（属于破坏性）→ 主版本；
只是适配、用法不变 → 次版本。

## 二、发版的 7 步

1. 改 `TShockPanel/server.js` 顶部的 `const VERSION = 'x.y.z'`（帮助页「关于」显示的就是它）。
2. 在 `CHANGELOG.md` 最上面加一节，写清楚**新增 / 修复 / 破坏性变更 / 已知限制**。
3. `node tools/run-tests.js` 全绿；有条件的话再用完整发布包跑一次 `tools/smoke.ps1`。
4. 提交：`git commit -am "release: vX.Y.Z"`。
5. 打标签（带说明的标签）：`git tag -a vX.Y.Z -m "vX.Y.Z"`。
6. 推送：`git push origin main && git push origin vX.Y.Z`。
7. 到 GitHub 仓库的 **Releases → Draft a new release**，选刚推的标签，
   标题写 `vX.Y.Z`，正文把 CHANGELOG 对应小节粘过去，发布。

## 三、版本号的单一事实来源

- 代码里：`TShockPanel/server.js` 的 `VERSION` 常量 → `/api/state` → 帮助页「关于」
- 仓库里：Git 标签 `vX.Y.Z`

两者必须一致；不一致时以标签为准，并把 `VERSION` 对齐后补一个修订版本。

## 四、这些千万别推上去

| 内容 | 原因 |
| --- | --- |
| `TShock.Server.exe`、`ServerPlugins/`、`dotnet/`、`bin/`、`x64/`、`i18n/`、`GeoIP.dat` | 是 TShock / .NET 的产物，再分发要履行 GPL-3.0 的源码义务；`.gitignore` 已排除 |
| `TShockPanel/panel.json` | 含 TShock REST 令牌和明文的服务器密码 |
| `tshock/` | 含服务器配置、账号库、玩家 IP 日志 |
| `TShockPanel/dsh.ui.json` | 本机外观偏好（含个人配色），对别人没意义 |
| 本地内部标签 `arch-*` | 是重构期的工作标签，不是发布版本 |

推送只用 `git push origin main` 和 `git push origin vX.Y.Z`，
**不要用 `git push --tags`**（会把本地那一批内部标签一起推上去）。
