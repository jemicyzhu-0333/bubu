# 验证与交付

本文记录可复用检查与当前限制，不把某次旧构建的测试数量、截图或环境日志当作当前版本的通过证明。结果必须绑定同一源码版本、运行环境与命令。

## 交付结论的四个层级

1. **代码与合同**：Node 行为测试、语法、依赖方向、IPC、资源生成检查。
2. **实际绘制**：生产 painter、Canvas/Path2D、离屏帧与连续回放。
3. **原生运行**：Electron 窗口、操作系统输入、透明合成、DPI、通知与持久化重开。
4. **发布**：目标平台安装包、签名、公证、升级与正式分发。

每层只能证明自己的范围。合成端口测试不证明真实 Provider；离屏截图不证明 GPU 或原生交互；构建入口不证明安装成功。结果分为通过、失败、跳过、未运行，不能合并成“全部通过”。

## 自动化门禁

要求 Node.js 22.12.0+（提供 `node:sqlite`）及锁文件对应的完整开发依赖：

```bash
npm ci
npm run check
npm run test:integration
git diff --check
```

`check` 包含全量 Node 测试、语法、IPC/preload 边界、架构与所有权棘轮、图标、Dango 栅格、Usagi 衣柜和应用图标检查。缺依赖或环境能力导致的失败是阻塞；可选层的设计性 skip 单列，不补写为通过。不能用仓库外的未跟踪依赖或伪造模块替代验证。

### 按改动类型

| 改动 | 至少追加的检查 |
| --- | --- |
| 持久化 | current-only schema19 准入、拒绝前零写入/零 proof、DB/身份/WAL/SHM 原字节、未知提交核对、损坏/未来版本、重开与故障注入。另获授权的库迁移须核验逐字节备份和二次启动固定点 |
| IPC / preload | sender、闭合 payload、非法输入、surface allowlist 与最小 preload |
| workflow / 状态投影 | 单次提交、写集、回执/幂等、effect 失败隔离、publication revision 与断档恢复 |
| 遗留入口 | `architecture/manifest.json` 棘轮同步收紧，不新增职责 |
| AI | 授权/披露、预算、取消、迟到响应、来源新鲜度、Provider 故障、关闭/无密钥的本地路径 |
| 面板 | 实际 UI 草稿、保存失败、重开、重复点击、关闭与取消、焦点返回、长文本及键盘操作 |
| 桌宠 | 舞台边界、动作相位、图层/接触、冷加载/失败、生产 renderer 帧、原生尺寸与多 DPI |
| 感官/动效 | DND、低刺激、Reduce Motion、专注/休息、吸附、隐藏/退出与运行中策略切换 |
| 打包 | 本机平台/架构选择、活动资源包含和 sources 排除、ASAR/原生 helper、安装与同档重开 |

### AI 持续协作验证合同

- 手动连接测试仅用合成密钥与 mock HTTP：验证草稿不保存、AI 关闭时只因显式按钮发送、变更地址不复用已存密钥、模型文本结构、三请求/32-token/20秒边界、401/403/429/5xx 不重试、错误不带密钥或正文，以及重复点击、取消、输入修改、设置关闭、窗口隐藏/销毁和迟到结果。浅/深主题与中/英状态均需检查；mock 结果不证明真实服务商可用。

- 共享执行器保留场景上限；协作与一次性调用、自动餐分别检查实际 HTTP 次数、repair、读取、字节和总期限。零读取/零 repair 不能被默认值放宽。
- Provider 返回、每次 await 后及 owner apply 前重核活性与授权；关闭 AI、修改 Provider/密钥、关闭会话或来源变化使旧请求失效。
- 场景与当次 grant 的交集限制读取。来源文本不提供权限，工具不能使用动态 SQL、路径、IPC 或通用 store。
- 建议与业务提交分开。修改、记忆、遗忘及安排偏好分别走真实预览与确认；同身份重试不重复应用。
- SQLite 回执、outbox 与业务结果核对；unknown 不显示为未应用或成功，不借 UI 关闭/重开生成新身份。
- 来源删除、遗忘账本、传递依赖及摘要不能复活已失效正文；管理列表和 Provider 召回权限不同。
- 临时会话、持久会话、记忆使用与自评历史是独立选择；日志不记录正文或密钥。发送字段必须与界面披露一致。
- 真实 Provider 的连通性、协议兼容、费用和端到端表现需独立验证，不能从 fake-port 测试推定。

## 隔离运行

仅用工具创建的可删除 schema19 或完整品牌schema18 SQL 合成档案，不拿真实用户档案或旧资料试开、迁移、修复或重置。历史 generic adapter 测试不授权当前生产读取旧档。

```bash
npm run dev:bench -- --scenario=level-up
npm run dev:bench -- --scenario=flame-near
npm run test:electron
npm run frames
npm run rig:check
npm run rig:preview
```

`dev:bench` 创建独立 SQL/身份，关闭 fixture 仓库后才启动 main，不创建 JSON 镜像。`level-up` 通过本人完成第一步验证成长与食票，父任务及重复点击不重复领取。`flame-near` 保留 CLI 名称，以当前等级规则验证火焰解锁。

`test:electron` 需要可用桌面；使用既有 scoped 投影与 IPC，正常关闭仓库后核对同一测试 SQL。Node 工具测试不会启动原生应用，不能代替这一步。

`tools/dev-bench/verify-daily-companion.js` 的食物断言仍待与当前目录重新核对，不能作为当前通过配方。恢复前先修正过时断言并保留场景覆盖。

### 原生复现规则

1. 记录源码身份、工作树状态、OS、Node/Electron、架构、显示器/DPR 和确切启动命令。
2. 运行已授权环境中的默认安全配置。sandbox 失败记录实际原因，不以关闭 sandbox、单实例锁或系统保护绕过。
3. 使用短的专用临时目录，避免 Unix socket 路径超限；保持 AI、自动更新与活动镜像关闭，除非这些正是被授权的测试对象。
4. 保持启动进程的监督与真实退出码。窗口消失不等于整个应用退出，不终止猜测的旧进程。
5. 真实 UI 先确认焦点与当前布局，瞬时菜单在有效期内连续操作；不要用 DOM/IPC 注入替代声称已验证的真实输入。
6. 同档重开先正常退出，再对同一测试 profile 设置 `userData/sessionData` 后加载生产 main；不能重新播种 fixture 来冒充持久化恢复。
7. 原图保留格式、范围与来源；截图只证明可见状态，闭库字节清单不等于 SQL 逻辑或物理断电证明。

## 原生检查清单

UI/UX 以 PRODUCT「界面语言」为判据，逐项记录主导航、每个子面板、抽屉和弹窗的覆盖及缺口。每项检查正常、空、在途、失败、过期/结果未确认和关闭重开；验证中文/英文、浅/深色、小窗口、键盘与减少动效。可省略无关状态，但说明原因。解释性文案检查不能删减删除、隐私、费用、权限与迁移警告；源码审查和 DOM 测试不能标成原生视觉验收。

下面是要求，不是已通过标记。每次验收应记录覆盖的平台及源码版本。

共享控件验收须在真实浏览器布局中记录数值和截图：320px、560px 视口宽度分别覆盖中文/英文与浅色/深色，并补充 200% 缩放、长选项/名称、键盘和减少动效。记录实际视口、缩放、控件边界及是否横向溢出；紧凑选择框默认 160px、可用空间允许时不少于 128px、不超过 220px，窄布局先换行且不挤掉相邻操作。测量顶级/次级折叠 SVG 分别为 12px/10px、描边 1.5px、命中区至少 24px，次级入口至少 32px；验证展开不改变占位、键盘操作和焦点不被裁剪。正常状态不出现多余叙事，错误与未确认状态仍能读取；悬停信息必须有键盘路径。

衣橱逐项检查当前完整套装、混搭、可用未穿、已穿、待解锁及保存中/失败/结果未确认。名称始终位于形象下方，为 13px/500、18px 行高和两行预留；完整名称可访问，下隔 4px，操作/状态行 32px，切换不挤掉名称或改变占位。只有可执行换装为按钮，只有实际装备投影确认后显示「已搭配」。通过真实布局及交互检查长名称、连续浏览、重开和迟到回执，不能只检查源码含有相应类名或文案。源码正则、模拟 DOM、浏览器测量和 Windows/macOS 原生验收分别记录，前几项不得替代原生通过证明。

- 单实例、托盘/菜单栏、主面板/快捷面板/提醒/桌宠的首次显示、退出和重开。
- 主副屏、负坐标、不同 DPI、屏幕变化后工作区钳制、拖动及菜单/食物面板可达。
- 全局快捷键及冲突回退；单击、长按、拖动互斥，右键/Control-click/菜单键/Shift+F10 与 Esc。
- 任务日期属性正交、独立编辑草稿、取消/失败/重试、重复任务范围、完成终态和明确撤销窗口。
- 开始、调整时长、暂停/恢复、两分钟选择、休息、落点、跨午夜、系统睡眠、离线到点确认与幂等结算。
- 日常到点一次、跨午夜生命周期、撤销、历史不可用的真实提示；能量校准边界不写入。
- 手动成长、食票、喂食、基础餐限额、商店只扣食票、独立角色默契与三端投影。
- 真实桌宠抚摸、拖动、预览/确认形态、穿脱配饰、冷加载/失败、左右及各朝向、裸身和代表重穿搭。
- 通知实际送达回执、会议/未知前台降级、DND、低刺激/减少动效、隐藏与恢复。
- 键盘与屏幕阅读器、焦点圈、隐藏区域不可 Tab、长文本、浅深色对比与正常尺寸可读性。
- 同档正常退出/重开；完整字段、异常终止、睡眠及物理断电另列，不能从一轮 UI 恢复推定。

## 构建与发布验证

```bash
npm run build                 # 本机系统与 Node 架构
npm run pack                  # 本机应用目录
npm run build:win -- --x64
npm run build:mac -- --arm64   # 仅 macOS
npm run build:linux
npm run validate:mac          # 仅 macOS：check + arm64 pack + 包验证
npm run verify:mac-install -- <DMG路径>
npm run release:preflight
```

`validate:p6:sandbox` 仅是 `validate:mac` 的兼容别名，不再表示 Linux 交叉构建 macOS。macOS 需要 Xcode Command Line Tools，活动 helper 与包架构一致；签名/公证检查不能降级为未签名通过。

手动 Actions 工作流生成 Windows x64 未签名测试包与 macOS arm64 ad-hoc 签名候选，禁自动 publish。macOS 候选文件名含 `adhoc-test`，与旧未签名 DMG 区分；源码 SHA 与 DMG SHA256 须一同交付。两个 job 都成功才是同源码双端构建通过。

macOS 构建门禁必须对产出 app 和 DMG 复制出的 app 分别执行 `codesign --verify --deep --strict`，再使用可删除测试档案执行真实启动、正常退出与 SQL 保存核验。签名无效即拒绝启动验收，不移除 quarantine、不关闭 Gatekeeper、不改变 sandbox 或系统策略。独立 `spctl` 诊断先读取策略状态，再记录本机接受／拒绝；CI 策略未确认启用时必须写明未评估。ad-hoc 仅提供代码完整性，不建立 Developer ID 身份或公证。无互联网 quarantine 的 CI 二进制启动不是浏览器下载后 Finder 启动验收，不能据此承诺默认 Gatekeeper 可运行；公开分发的正式信任仍需 Developer ID 与公证。

安装验证使用可删除新 profile，检查 ASAR、资源过滤、原生 helper、正常退出、同档重开和安装器清理。正式发布还需签名、公证/Gatekeeper/SmartScreen、各架构及跨版本更新证据。

`verify:win-install` 仅在可删除的 Windows Actions runner 上运行实际 NSIS 安装，启动安装后的生产 exe；`verify:mac-install` 在 DMG 副本的播种数据保留检查之外，另跑真正空目录首次启动及原档重开。两者以仅回环地址、随机端口的子进程 inspector 观察可见本地窗口完成加载并请求正常 `app.quit()`，闭库后只读检查 BUBU 身份、READY、绑定、候选当前 schema 的完整 canonical payload 和提交版本。同档重开不得更换 authority。Windows 还记录原生单实例零字节 lockfile。此为带观测的安装后启动检查，不代表真人输入、SmartScreen 或 Gatekeeper 认可。

安装后升级检查在真正空档门禁通过后另建含 task/step/inbox、opaque marker 和遗留 WAL/SHM 的合成 BUBU18 档。仅在已核对源码哈希的安装版 main 入口暂停，尚未运行 createApplication 时替换本次子进程的精确 consent/report 对话框端口；未知标题、消息、按钮、顺序一律失败。检查决定前与取消后的文件字节/mtime、不释放的同档单实例锁、原生私有备份及其独立副本重开、重启前只有 schemaVersion/locale/theme 的添加。批准分支记录并抑制该测试子进程的 app.relaunch，再以安装版 exe 独立重开检查 authority、任务/步骤/收件箱、System 默认值和单次迁移回执。它证明原生运行、文件系统/SQLite 与 Windows DACL 或 POSIX 权限端口，不证明真人对话框输入、自动原生重启或可访问性。整体超时给真实权限检查留余量，不缓存或绕过检查。

手动 `Diagnose released Windows first launch` workflow 固定 r4 官方 EXE 字节数及 SHA-256，顺序安装旧版、记录独立空档失败、卸载旧版，再安装候选并尝试同一失败档；另验候选空档与重开。诊断仅上传合成目录的名称、类型、长度、哈希和有界错误事实，不上传档案原文。候选仍拒绝旧版残留时必须单独报告恢复未解决，不得把新档成功当作现有用户恢复成功，也不得自动清除残留或放宽身份准入。

### 测试版 AI 诊断门禁

`npm run pack -- --test-diagnostics`（或相应 `pack:win` / `pack:mac`）显式生成具备诊断能力的测试包；开发验证同样使用此解包构建。macOS此类包用 `npm run verify:mac-app -- --test-diagnostics` 验证；省略参数时拒绝含已启用诊断capability的包，两种模式都保留arm64/不发布/签名/ASAR范围门禁。
普通 `npm run pack` / `build` 显式关闭能力，不凭dev版本或 `BUBU_LLM_LOG`开启。构建参数不改源码package.json，需验证普通→测试→普通序列与实际builder类型解析。
检查 `ai-diagnostics-runtime`、`ai-diagnostics-pipeline`、`ai-diagnostics-ui`、`llm-diagnostic-observation` 与 `build-app` 测试；所有Provider测试用假POST，不使用真实凭据/档案。
覆盖原始/整理/校验分离、原有请求次数、低置信度与失败、提交拒绝/未知、来源删除（含任务步骤与全库标签）、授权撤回、UTF-8容量、到期/停止/清空、迟到详情与导出不复活。
原生GUI/安装验收单列；Node及合成DOM测试不代表已在Windows/macOS安装运行。

## 当前验证范围与仍未关闭的项

已有有限 Linux 原生运行观察覆盖新测试档案中的任务/步骤、首步成长、暂停/恢复、多窗口可见投影、部分形态/穿戴与喂食，以及一次正常退出后的同档可见状态恢复。这不是完整 SQL 字段、全部配饰、到期结算、异常终止或目标平台安装验收。

### 0.0.2-dev.3 已发布测试包的证据边界

[v0.0.2-dev.3](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.2-dev.3) 指向 `1112b47abdcf96c6a772f03ac7b599cdccf0f993`。安装包来自[双端 run 38035697902](https://github.com/jemicyzhu-0333/bubu/actions/runs/38035697902) attempt 1 的原始 artifact；Windows x64 与 macOS arm64 两个 job 均通过，未重新打包。公开 EXE、DMG 与 SHA256SUMS.txt 已通过匿名完整下载核验，与原始产物一致。

| 原始安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `bubu-0.0.2-dev.3-win-x64.exe` | 136172193 | `5df19c2f5e975c9b47ac31309a0697ddcbf559b6a493e21a5a6e34c1bd733830` |
| `bubu-0.0.2-dev.3-mac-arm64-adhoc-test.dmg` | 148843050 | `e01e364ab15bec88107172201a4dc16decf827b4824de4e1bad00ec1758fe7b3` |

- 本轮修正 AI 工具结束通知后的状态清理、Mac 开发启动原生音乐检测组件准备、单一任务日历、收件箱无隐藏快速开始区域及随手记自适应输入。没有真实网易云播放、真实 Provider、人工双端 UI 或 IME 输入验证结论；Mac helper 准备成功不能证明真实音乐播放检测。
- Windows 实际 NSIS 安装、Mac DMG 安装副本直接启动均通过；两端真正空目录首次启动、可见本地窗口就绪、正常退出与原档持久化重开通过，BUBU 身份、READY、schema19 与 authority 连续性已核验。Mac 包与安装副本的严格代码签名完整性通过。
- 两端独立合成 BUBU18 升级的同意前/取消检查、完整私有备份、原生 Windows DACL / POSIX 权限、备份副本重开、仅 schemaVersion/locale/theme 的添加式变化与升级档独立重开通过。它不证明真实用户档案恢复。确认框端口被精确注入，测试子进程的 app.relaunch 被记录并抑制；真人确认框交互、辅助技术、原生自动重启、真实凭据及系统信任警告接受仍未证明。
- Windows 未签名，SmartScreen 可能警告或阻止安装。Mac 为 ad-hoc，无 Developer ID/公证；本次 Gatekeeper 策略确认启用后，本地 `spctl` 分发评估拒绝此包。浏览器下载/Finder 接受未验证，验证未添加或移除隔离标记；请勿关闭系统安全保护或移除隔离标记来安装。
- 仍只支持完整有效 BUBU18 经明确确认及完整私有备份后的 schema19 升级；旧品牌、无标记、损坏、孤立及其他不支持档案继续拒绝。仅支持 schema18 的旧版无法打开 schema19；备份仅可离线核验后解出到尚不存在的新目录，不自动回滚或切换活跃档案。testing-updates 未包含，安装与更新均手动进行。
- 以下 dev.2、dev.1 与 r4 诊断是历史证据，不能代替本次源码验收；PET12 等开放项继续保留。

### 0.0.2-dev.2 已发布测试包的证据边界

[v0.0.2-dev.2](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.2-dev.2) 指向 `dae2958b09dcfea20cccd4ef43ea5cf7d58dcc68`。安装包来自[双端 run 38025816837](https://github.com/jemicyzhu-0333/bubu/actions/runs/38025816837) attempt 1 的原始 artifact；Windows x64 与 macOS arm64 两个 job 均通过，未重新打包。公开 EXE、DMG 与 SHA256SUMS.txt 已通过匿名完整下载核验，与原始产物一致。

| 原始安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `bubu-0.0.2-dev.2-win-x64.exe` | 136170648 | `4eae4f44dbb44334be01ba53a3df7e2aab739e1b539c6cb163147fd6871cdc34` |
| `bubu-0.0.2-dev.2-mac-arm64-adhoc-test.dmg` | 148838028 | `54684aaff99405dc4c4aff65be68ed253eb5a55c8579d0584347fb21973eeada` |

- 本版覆盖设置排版、协作名称与头像、消息发送/失败重试、任务协作与原生日期选择，以及迟到 AI 建议不覆盖较新手工步骤的保护；自动化通过不等于这些功能已完成人工双端交互验收。
- Windows 实际 NSIS 安装、Mac DMG 安装副本直接启动均通过；两端真正空目录首次启动、可见本地窗口就绪、正常退出与原档持久化重开通过，BUBU 身份、READY、schema19 与 authority 连续性已核验。Mac 包与安装副本的严格代码签名完整性通过。
- 两端独立合成 BUBU18 升级的同意前/取消检查、完整私有备份、原生 Windows DACL / POSIX 权限、备份副本重开、仅 schemaVersion/locale/theme 的添加式变化与升级档独立重开通过。它不证明真实用户档案恢复。确认框端口被精确注入，测试子进程的 app.relaunch 被记录并抑制；真人确认框交互、辅助技术、原生自动重启、真实凭据及系统信任警告接受仍未证明。
- Windows 未签名，SmartScreen 可能警告或阻止安装。Mac 为 ad-hoc，无 Developer ID/公证；本次 Gatekeeper 策略确认启用后，本地 `spctl` 分发评估拒绝此包。浏览器下载/Finder 接受未验证，验证未添加或移除隔离标记；请勿关闭系统安全保护或移除隔离标记来安装。
- 仍只支持完整有效 BUBU18 经明确确认及完整私有备份后的 schema19 升级；旧品牌、无标记、损坏、孤立及其他不支持档案继续拒绝。仅支持 schema18 的旧版无法打开 schema19；备份仅可离线核验后解出到尚不存在的新目录，不自动回滚或切换活跃档案。testing-updates 未包含，安装与更新均手动进行。
- 以下 dev.1 与 r4 诊断是历史证据，不能代替本次源码验收；PET12 等开放项继续保留。

### 0.0.2-dev.1 已发布测试包的证据边界

[v0.0.2-dev.1](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.2-dev.1) 指向 `7e009653accf4894bb639384b6a07820623e204b`。公开 Windows EXE、Mac DMG 与 SHA256SUMS.txt 已通过匿名完整下载、字节数及 SHA-256 核验。发布的安装包均为[双端 run #21](https://github.com/jemicyzhu-0333/bubu/actions/runs/37982979937) 原始产物：macOS attempt 1 通过；Windows attempt 1 的原生权限探针超时保留记录，未修改探针的 attempt 2 通过。

- Windows：实际 NSIS 安装、真正空目录首次启动、正常退出、原档持久化重开与可见本地窗口就绪通过。Mac：DMG 副本直接启动、持久化、bundle 身份及严格签名完整性通过。
- 两端的独立合成 BUBU18 升级检查覆盖五个同意前/取消阶段，七个原文件字节及 mtime 均保持原样；同意后完整私有备份、原生 Windows DACL / POSIX 权限、权威及凭据身份连续性、仅 schemaVersion/locale/theme 的添加式变化通过。升级档另用安装版程序独立重开通过，不能与真正空档首次启动混为一谈。
- 确认框端口被精确注入，测试子进程的 app.relaunch 被记录并抑制；真人确认框交互、辅助技术、原生自动重启、真实凭据及系统信任警告接受仍未证明。
- [独立 r4 诊断](https://github.com/jemicyzhu-0333/bubu/actions/runs/37986211557) 复现旧包就绪失败后，在同一合成目录中不重新播种地启动候选；该目录在旧进程清理后为空。因此不能声称已恢复持久化损坏用户数据，具体原生错误框内容也未捕获。独立新档启动/重开通过。诊断重建了同一源码，未替换发布的 run #21 原始产物。
- Windows 未签名，SmartScreen 可能警告或阻止安装；Mac 为 ad-hoc，无 Developer ID/公证，Gatekeeper 本地分发评估拒绝此包。浏览器下载/Finder 接受未验证；未添加或移除隔离标记，不应关闭系统安全保护或移除隔离标记来安装。
- 只支持完整有效 BUBU18 经明确确认、完整私有备份后的 schema19 升级；旧品牌、无标记、损坏、孤立及其他不支持档案继续拒绝。旧版不能打开19；核验后的备份仅可离线解出到尚不存在的新目录，不是自动回滚，也不会切换活跃档案。testing-updates 仍是独立功能，本版不包含，未启用应用内更新通道，安装与更新均手动进行。

### PET12：Linux 偶发横条呈现异常

在 Linux/Electron 的真实透明窗口中，从动效 balanced 切为 reduced、再将刺激 balanced 切为 low 后，粉色桌宠曾变成持续黄绿色横条，角色不可见而主面板仍可用。恢复 balanced 设置未立即恢复，普通右键打开桌宠菜单后恢复；随后重走相同步骤未复现。

这是已观察、未定位、未修复的间歇异常。不能将 libnotify/D-Bus 告警或 GPU 直接认定为根因，也不能把后续未复现当作修复。应在同源码、默认安全设置下保留原始窗口证据并继续区分渲染、合成与生命周期因素。

### 其他开放门禁

- 每次源码变化均须重新运行聚合与集成检查；已发布版本的固定源码及原生产物证据不能替代后续树的检查。
- Windows/macOS 完整原生输入、系统通知、声音/活动探针、AI 工具 hook、VoiceOver、多屏及缩放仍需绑定同构建的验证。
- 多小时稳定性、CPU/内存基线及长换肤离屏内存增长风险未关闭；短时与缓存上限检查不证明整体内存安全。
- 上述安装与持久化重开证据不覆盖全部原生异常终止及物理断电保证，不能由合成故障测试推定。
- 真实 Provider、Developer ID/Windows 可信签名、公证、Gatekeeper/SmartScreen 用户接受、Universal、稳定正式版及应用内更新分发仍未完成；本次公开 prerelease 下载核验不替代这些门禁。
- Secure Input 下的热键、时间线跨午夜“接着上一天”提示及遗留组合根抽取仍有独立工作。
- 角色与美术权利范围见根目录 LICENSE-SCOPE 及各资产 USAGE；项目代码的非商业许可不建立第三方授权。

## 结果记录格式

交付中写明源码身份、平台/工具版本、命令、通过/失败/跳过/未运行范围、可重放步骤及剩余风险。测试日志和一次性截图按相应测试或发布保留，不持续堆入本文。

## 语言与外观功能分支门禁

- 使用同一feature源码验证locale/theme闭合枚举、单次事务、保存失败不改变选择、fresh/reopen保留设置及其他完整字段。五个surface只读窄投影，只有popover能改设置；未知payload/来源拒绝。
- 检查浅/深/系统模式、显式模式不受系统事件覆盖、所有现有和新开窗口一致、陈旧读回/推送、关闭后监听清理，以及角色画笔不被工具主题改色。
- 中文→英文→中文的标签、aria/title/placeholder、键盘Tab/方向键/焦点圈、长文案和小尺寸。带SVG/计数的标签保留子节点；用户中文任务、英文输入、伙伴名、Provider回复与实际错误详情保留原文。
- 设置在途重复操作合并，关闭/重开不接受旧保存反馈；语言切换不能清空任务/快捷草稿、重置会话计时、撤销确认或制造第二条命令。
- 普通schema18拒绝及全部原文件字节保留继续验证。另运行 `node --test test/preferences-profile-upgrade.test.js test/preferences-upgrade-recovery.test.js test/preferences-upgrade-bootstrap.test.js` 覆盖显式18→19；不得用普通拒绝测试代替升级。
- 升级分别核验原writer前byte/mtime完全相等、writer后回滚逻辑不变及完整备份、DB+identity+live-WAL、opaque凭据/嵌套文件、partial/foreign/malformed/future/权限/空间失败、consent绑定、同事务证据、COMMIT未知、进程中断恢复、重复/重开固定点及显式解出拒绝逃逸/覆盖。
- 在同源码Windows/macOS真实构建上验证升级确认框默认退出、取消不写源档、源锁一直持有且第二实例不能写入、同意成功后以原profile参数重启、业务与凭据身份保留。端口mock和Node崩溃测试不等于原生验收；本版本只合入语言/主题与Windows首次启动修复，安装版门禁按上面的真实空档与独立合成18路径执行，并明确自动化对话框注入的限制。自动更新feature继续独立，未完成它自己的同源码签名包跨版本门禁前，不启用自动更新通道。
- Node对比度/事件测试不代表原生VoiceOver/NVDA、Windows/macOS或系统外观实时切换验收。英文覆盖范围与遗漏必须随交付列明。
