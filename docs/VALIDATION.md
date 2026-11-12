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
| 持久化 | current-only schema20 准入、拒绝前零写入/零 proof、DB/身份/WAL/SHM 原字节、未知提交核对、损坏/未来版本、重开与故障注入。另获授权的库迁移须核验逐字节备份和二次启动固定点 |
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

仅用工具创建的可删除 schema20 或完整品牌schema18/19 SQL 合成档案，不拿真实用户档案或旧资料试开、迁移、修复或重置。历史 generic adapter 测试不授权当前生产读取旧档。

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

### 0.0.2-dev.4 已发布测试包的证据边界

[v0.0.2-dev.4](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.2-dev.4) 指向 `e3e1e2a647be618eb2e11cf6dbdb9f607a73a917`，为已公开的 prerelease。安装包来自[双端 run 38048314336（#24）](https://github.com/jemicyzhu-0333/bubu/actions/runs/38048314336) attempt 1 的原始 artifact；Windows x64 与 macOS arm64 两个 job 均通过，未重新打包。原始 Actions ZIP 官方 digest、解包安装包 SHA-256 与 CI 记录一致；2026-10-10 对公开 EXE、DMG 与 SHA256SUMS.txt 的匿名完整下载均返回 HTTP 200，字节数与 SHA-256 和原始产物一致。

| 原始安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `bubu-0.0.2-dev.4-win-x64.exe` | 136201500 | `f238578de2b5c0b3983cd73760819d91108f0ef4d8f6af68b353fe8a860b7447` |
| `bubu-0.0.2-dev.4-mac-arm64-adhoc-test.dmg` | 148884509 | `6f0df9133219b55b4560889b239759b2cf7f387fd78bc9ec8bc5f27b3de391c1` |

- Windows 实际 NSIS 安装、Mac DMG 安装副本直接启动均通过；两端真正空目录首次启动、可见本地窗口就绪、正常退出与原档持久化重开通过，BUBU 身份、READY、schema19 与 authority 连续性已核验。Mac 包与安装副本的严格代码签名完整性通过。
- 两端独立合成 BUBU18 升级的同意前/取消检查、完整私有备份、原生 Windows DACL / POSIX 权限、备份副本重开、仅 schemaVersion/locale/theme 的添加式变化与升级档独立重开通过。它不证明真实用户档案恢复。确认框端口被精确注入，测试子进程的 app.relaunch 被记录并抑制；真人确认框交互、辅助技术、原生自动重启、真实凭据及系统信任警告接受仍未证明。
- 本轮包含界面简化、日常/任务/随手记交互修复、成长与套装呈现、AI 工具状态灯及分拣运行/原因反馈。公开截图为此前的代表性 Linux 界面，不是本次所有界面的截图或 Windows/macOS 人工 UI 验收。真实 Provider、真人输入/IME、Mac 网易云真实播放检测等未由本次安装门禁证明。
- 两端测试包显式具备 AI 诊断能力，记录默认关闭，需本人开启 30 分钟本机内存会话；停止、到期、退出或授权撤回清空。只覆盖新的一次性分拣、能量、拆解、补全和卡点运行；持续聊天协作及精确能量贡献尚未覆盖。不展示隐藏推理、不追加模型调用、不自动落盘或上传，只可主动导出无正文元数据。现有能量和情绪语义未改变。
- Windows 未签名，SmartScreen 可能警告或阻止安装。Mac 为 ad-hoc，无 Developer ID/公证；本次 Gatekeeper 策略确认启用后，本地 `spctl` 分发评估拒绝此包。浏览器下载/Finder 接受未验证，验证未添加或移除隔离标记；请勿关闭系统安全保护或移除隔离标记来安装。
- 仍只支持完整有效 BUBU18 经明确确认及完整私有备份后的 schema19 升级；旧品牌、无标记、损坏、孤立及其他不支持档案继续拒绝。仅支持 schema18 的旧版无法打开 schema19；备份仅可离线核验后解出到尚不存在的新目录，不自动回滚或切换活跃档案。testing-updates 未包含，应用内检查/自动安装更新未启用，安装与更新均手动进行。
- 以下 dev.3、dev.2、dev.1 与 r4 诊断是历史证据，不能代替本次源码验收；PET12 等开放项继续保留。

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

## V2 研究基础能力验证

### 实时桌宠分批验收（2026-11-01）

**空中表情迟滞候选（2026-11-12，基线 3751977）。** 纯控制器公开输入复现了
69/71 DIP/s 交替时 160 次采样、159 次表情切换。候选仅为持续空中表情意图增加
64/76 DIP/s 迟滞；初次或停顿后的运动段首次超过 70 即进入 T05，速度窗预热低速不锁存 01。
不改变物理模式、姿态、速度窗或动作时间参数，消费者读取 faceIntent，不能从 mode 推导表情。
研究包原始 npm test 19 项通过，包含双向阈值抖动、停止后 72 恢复、69/71 恢复抖动、
取消、释放、重抓和 30/60/120 帧调度；R4 物理/时间字段逐项一致。固定 R4 轨迹的
表情差异另限于 64–76 阈值带、01/T05 且至多一帧，此约束不外推到其他轨迹。
此前 71 项指根目录 npm run test:integration（IPC/main workflow/Electron security），
不是 shared-input-workbench-v2；当前 PROVENANCE 和包 SHA256SUMS 同步候选，历史 evidence 保留不改。
shared-input-workbench-v2 原始 npm test：19 个依赖哈希通过，62/62 测试通过；
从仓库归档按哈希恢复 full18/D2，使用锁定 Three 0.186.1。仅 CPU/Raycaster，不含 WebGL/OS。
这些阈值尚未通过目标角色视觉与原生输入验收，不能据此关闭 G2。

本节是当前实时路线的门禁与踩坑台账；后文旧计数、求解实验和帧率仅为历史证据。
最新 Windows 源码证据见下节；“首批”表中的状态只描述该批次，不覆盖后续原生采集。
首批从远端 `feature/pet-animation-v2` 的 `33a04d35ba66984663604961c0c619937d70ede0`
隔离创建，已交付底座提交为 `0a3a827d86a702938eba590e870e2b7ff0661d41`。
脚本采集批次在该不可变基线上使用独立本地分支 `dot/realtime-validation-scripts-20261101`；
不将历史默认 HEAD `1a66a0d3b7a51b19ac843b80f6629d0eb20eeb18` 或其他保留分支混作同一基线，
不覆盖用户工作。以下首批计数只证明该底座；脚本批次的最终提交/检查另记，不能沿用旧通过数字。

| 要求 | 首要门禁 | 必需证据与否决条件 | 当前状态 |
| --- | --- | --- | --- |
| 已批准角色身份/动态 rig | G0/G1 | source/parts SHA、七关节顺序、单 actor skeleton、四关节/wrapper 写权限；不可伪造替代 GLB | 恢复和 preflight 通过；实际渲染核验未运行 |
| 真正应用渲染链 | G1 | development 显式选项经 pet window/preload/scoped context/viewport 到最终 WebGL；默认路径不变 | 代码候选已接入；选择门禁初测通过；实际应用帧阻塞 |
| 单一时钟与状态所有者 | G1/G2 | 暂停不补播；隐藏/锁屏/低动效中断；失捕、取消、再抓取、重复恢复/销毁与迟到加载行为测试 | 本批 surface/指针端口定向测试通过；原生输入/显示未运行 |
| 拖动/提起/惯性/释放/落地 | G2 | 实际 OS 输入、窗口 DIP/渲染坐标一致、DPR 切换、同一手势互斥和回稳 | 复用既有窗口内 V2 owner；原生窗口移动/DIP 尚未实现，OS 验收未运行 |
| 长按抚摸/取消/再抓取 | G2 | 长按不会开菜单或误触拖动；pointercancel/失捕/隐藏后可再抓，不能复活旧指针 | 未运行 |
| 配件与轻量次级运动 | G3 | 既有 springbone 的实际可见几何、支撑与摆动；正常/中断/重抓，整帧增量成本 | 未运行；旧 Node 单项成本不是通过 |
| 换装和安全资源归属 | G3/G4 | 失败保留旧装，stale 不撤新装，装备/纹理/骨骼/场景/监听/RAF 精确释放；重建和资源增长 | 本批既有 CPU ownership 回归通过；canonical 换装映射、实际 GPU 释放/增长未运行 |
| 统一动作描述 | G4 | 同一动作身份与阶段编排 body/expression/accessory/props/particles；取消/切装/低动效撤销全部所有权 | 未运行 |
| 实际衣物/衣缝/握持/释放 | G4 | 最终渲染 mesh、接缝和接触意图检查；整套及动作/中断组合，保留真实反例 | 未运行；代理间隙、单帧或单件不可替代 |
| 60 fps 目标及 idle/增长 | G1→G5 | 标明设备/renderer 的 frame interval、CPU update/render submission P95/P99、超预算帧、idle 绘制/唤醒、资源增长与重建 | 未运行；目标约 16.7 ms，不承诺必达 |
| 原生桌面与默认功能/打包 | G5 | 透明合成、输入、显示器/DPI、可访问交互、2D/业务回归、包内活动资产及同档重开 | 原生目标硬件阻塞；其余待逐批运行 |

资产恢复无需重新生成模型：研究根目录既有 `npm run foundation:prepare` 使用跟踪的
`expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb.gz`，
归档大小 10,915,162 bytes，SHA256
`a0ce0c1acdca8d3d7240d91b7b2285a0de0e65c09e0ed7a9f221a5c905b5f839`。
预期恢复 `runtime-facepath05/fixtures/face-d2/asset.glb` 为 16,867,596 bytes、SHA256
`84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a`。
hybrid 为 `original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb`，3,540,376 bytes、
SHA256 `52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67`。
归档只读展开、正式 `foundation:prepare` 与 `foundation:preflight` 均已通过，
preflight 确认单一物理 Three.js 0.186.1；真实渲染启动仍未运行。
依赖沿用锁文件中的 Three.js 0.186.1、springbone 3.5.5，保持单一物理 Three 实例；
不升级工具链、不重装同库冒领修复、不为 G0/G1 启动 QP/长时布料研究。

首批底座的手工准备记录如下，仅保留复现依据；本批面向用户的首选入口见下方「脚本采集与回传」，不再要求依次执行这些步骤：

```bash
# 研究依赖及已完成的素材/合同准备
cd research/animation-0.1.0
npm ci --ignore-scripts --cache=/tmp/bubu-npm-cache
npm run foundation:prepare
npm run foundation:preflight
cd ../..
# 应用依赖（本次安装 237 packages；不等于测试或渲染通过）
npm ci --cache=/tmp/bubu-npm-cache
# 仅在已有 Electron 二进制默认缓存安装失败时，使用可写的项目外缓存
# 本次已按锁文件恢复 Electron 44.4.5；没有升级或关闭任何系统保护
electron_config_cache=/tmp/bubu-electron-cache node node_modules/electron/install.js
# 待有可用桌面时，经 dev-bench 的独立 SQL/身份 fixture 启动，绝不试开用户 profile
BUBU_DEV_REALTIME_PET=1 npm run dev:bench -- --scenario=all
```

首批 `0a3a827` 验证记录（Linux / Node v24.22.1 / npm 11.9.0；锁文件 Electron 44.4.5；不是本批脚本或 WebGL/GPU 帧率）：

| 命令 / 范围 | 当前结果 | 证据边界 |
| --- | --- | --- |
| `timeout 480s npm run check` 封板最终复跑 | exit 0；6,812 tests，6,783 pass / 29 skip / 0 fail；lint、151 条 IPC boundaries、805 模块 architecture、icons/raster/wardrobe/limbs/app-icons 均完成 | 封板代码的 aggregate 检查通过；29 skip 和 limb pixel 环境跳过单列，不代表实际 GUI/原生通过 |
| `node --test test/pet-realtime-*.test.js` | 41/41，0 skip | 指标/选择 15，真实窗口宿主/preload/scoped client/IPC 注册器 9，surface 15，指针端口 2；合成环境不等于真实 OS 输入 |
| `npm run test:integration` | 71/71，0 skip，约 456 ms | 应用 IPC/workflow/security 合同；不是原生 UI |
| 下列 120 秒上限的研究定向命令 | 55/55，0 skip，22.8 s | 实际恢复 D2 + hybrid 的 CPU/所有权回归，不是 GPU 或原生帧率 |

```bash
cd research/animation-0.1.0
timeout 120s node --test --test-isolation=none \
  animation-foundation-v1/body-runtime/approved-pointer.test.mjs \
  animation-foundation-v1/body-runtime/held-target.test.mjs \
  animation-foundation-v1/integration/frame-owner.test.mjs \
  animation-foundation-v1/integration/foundation-lifecycle.test.mjs \
  animation-foundation-v1/integration/equipment-ownership.test.mjs
```

最终定向 41/41 包含终态一次撤回运行态用例；旧的 36/36、40/40 和首轮全量结果不作为最终代码的替代证据。
首批封板 aggregate 的本机日志为 `/tmp/bubu-realtime-sealed-check.log`，最终交付证据需同时保留源码/文档哈希、提交身份与日志。
29 个 skip 和 `limbs:check` 中因未设置 `USAGI_CANVAS_PACKAGE` 而跳过的像素扫描单列，
不能写成该像素检查已通过。canonical 感官/context 接入不等于外观装备和业务 base 语义已完成；后两者在 G4。
G1 首批当时只达到应用接入代码候选，未完成实际应用帧及原生输入/显示证明，不能记作完成。
默认 sandbox 的 Chromium 探测在独立 `/tmp` profile 下因
`process_singleton: socket() Operation not permitted` 中止，环境同时无 DISPLAY/Xvfb。
未追加 `--no-sandbox`、未绕过策略；实际 WebGL、截图、帧时间及原生性能均无本轮证据。

性能取样必须固定源码、窗口/画布大小、DPR、可见状态、取样时长和交互轨迹，
区分准备/首帧/稳定运行；每个指标至少报告样本数、P95/P99 和最大值。
`renderer.render` 的客户端耗时仅称 CPU render submission，不称 GPU 执行时长。
有界 ring 的统计须标明保留窗口，不能把超出容量的整轮运行写成全程分位数；
丢帧、长任务、错误、idle 是否停止重绘及关闭后残留句柄/资源另列。
Linux Node、离屏 Chromium、云端 SwiftShader 与目标原生 Electron/物理 GPU 分开报告。
首批当时无已连接用户电脑（可用 environments 列表为空），目标硬件 60 fps、原生输入与透明合成
因此为 **blocked / 未运行**，不是 failed 或 passed；云端测量只能给出对应环境的结果。

| 坑 / 根因 | 决策或修复 | 复查与仍未覆盖的边界 |
| --- | --- | --- |
| 把高精度全局接触求解前置，研究精度挤占产品帧预算 | 移出在线前置，保留原研究/失败证据；先裸角色整帧，后既有 springbone，必要时才低分辨率布料 | 检查 G1 启动/帧链不依赖 QP；实际 mesh/衣缝/握持门禁仍保留 |
| 公开树未直接带 source GLB，被误判为素材丢失 | 找回既有、已跟踪的 lossless gzip 与 hash-checked materializer，不制造替代角色 | 归档展开、正式恢复和 preflight 通过；真实应用加载未运行 |
| hybrid GLB 静态部件被误判为运行时无骨骼 | 保留 mixed binding 与本 actor skeleton/bindMatrix 的七关节合同 | 要核验真实渲染身体/双脚，不以 GLB 静态元数据代替运行时结论 |
| 浏览器 demo、CPU 回放、录像采样 fps 被当成桌面实时通过 | 接入真正 pet 窗口边界，分开 frame interval/update/render submission/设备类别 | 当前目标原生硬件未连接；禁止将软件 WebGL 或 Node 数字改写为 native pass |
| 代理尾端安全被扩大为布面/接缝/握持安全 | 保留代理用于运行时近似，但由最终渲染几何和真实动作验收决定准入 | 每件、整套、动作及中断分别记录；零交叉采样不外推数学连续证明 |
| Electron 二进制默认缓存安装报 ENOENT | 保留首次失败，明确用 `electron_config_cache=/tmp/bubu-electron-cache` 重跑既有安装脚本 | 锁文件 Electron 44.4.5 二进制安装成功；未升级工具链，也不等于 GUI 可运行 |
| Chromium 的 process_singleton socket 被环境限制，且无 DISPLAY/Xvfb | 停止实际 GUI 验证，不关闭 sandbox、不换路径规避策略 | 实际帧/截图/WebGL 未运行，G1 未完成；准备工作和 Node 测试可独立继续 |
| dev surface 位于 src 就被当成可分发 3D 产品 | 当前包仍不含研究资源；显式开发选择也拒绝打包模式 | 转生产前须 runtime 边界抽取、批准素材/依赖/恢复构建和 artifact layout 测试；本批未运行 |
| 新 pet 页面未被原 IPC 精确文件授权承认 | 窗口与 pet IPC 共用闭合开发选择器；只在相同三重条件下替换 pet 文件身份，不扩成目录 allowlist | 真实 preload/scoped client/注册器测试拒绝旧页面、兄弟路径、popover、HTTP；原生发送者实际运行仍待验收 |
| pagehide 清理器先移除了自己依赖的 unsubscribe handler | viewport 订阅由独立 owner 显式释放，pagehide/dispose 不靠将被销毁的监听器触发后续释放 | surface 测试覆盖 pagehide、重复 dispose、失败和迟到资源清理；终态只发一次 visible/dragging=false 呈现撤回，不写业务、不重试 |
| 异步 hydration 先拒绝，而 stage 仍在加载 | 立即接拒绝处理；终态后迟到 stage 只清理，清理异常另记，不复活实例 | 早期拒绝、迟到成功/失败、抛错 cleanup 和帧失败回归通过 |
| cue ACK 携带多余 reason 被闭合合同拒绝 | G1 不支持的 cue 只用 `decisionId/status` 明确 rejected，释放原 Director 所有权 | 实际 codec/IPC 测试通过；没有增加自报成功或宽泛 ACK |
| 原身体宿主 blur 会冻结未聚焦桌宠 | surface 独占 blur 的手势取消，窄 pointerWindowPort 过滤身体宿主 blur/focus；可见 idle 继续 | 端口和 surface 用例通过；原生后台输入仍未验收 |
| sealed frame 后 leave/失捕/窗口外释放使用了旧时刻 | canvas leave/lostcapture 及 window 外 up/cancel 在 capture 阶段采样同一实际时钟，不造 epsilon | 定向时钟边界用例通过；真实 OS 失捕/再抓仍待验收 |
| 一个局部可运行结果被当作实时化完成 | G0→G5 保留完整范围，每批提交可审查的纵向结果与未关闭项 | 当前只是首批；未运行/失败/阻塞不折叠成“完成” |

### 最新 Windows 采集与 G2 输入空间边界（2026-11-07）

原生 Windows 采集的起止源码均为 `fe0cfe2dbe306e0a65e9c1a9eb49364a68553338`，
两端 `dirty=false`；runId 为 `7b75774a-7aeb-4e64-919a-603a64f9192d`。
结果包 139,695 bytes，SHA256 为
`ecddb7dfec1f3cf9a8dd16a41ee274fea16bcf177c137d3d5b0106b37cab85b2`。
实际应用采集完成 13 阶段、5,049 帧、60 事件和5张窗口截图，`errors=[]`；三个 renderer
实例的诊断日志均无错误，已发呈现操作结清。此无错误样本未触发新异常详情/去重的非零路径。

`capture.status=completed`，但顶层仍为 `capture-complete-cleanup-unverified`、CLI exit2。
Electron 根进程 code0、已 reaped；Windows 正常退出后 descendants 仍未由采集器证明，
自有目录保留。随后一次宿主只读检查未发现6个已记录 PID 或关联进程，属于该时刻观察，
不能改写原包的清理判定。输入明确为 `Electron-injected-not-OS`；`manualVisual`、
`nativeGPU`、`osInput` 均为 `not-accepted`，`productionAccepted=false`。
首帧 `startup.firstFrame.renderSubmissionMs=601.5` 仅指本次 CPU 侧 render 调用经过时间
（render submission）；不是测得的 CPU 消耗、GPU 执行、完整帧耗时或启动时间，不能从
历史单轮数字推断优化收益。

后续 G2 第一段只分离真实表面命中所用 client 坐标与拖动/惯性所用 motion DIP。
新增回归用批准 D2 实际 actor/骨骼和 FoundationPool，检查默认/显式相同运动源一致、
局部点固定仍能按合成 DIP 旅行产生惯性、相同 DIP 旅行不被局部偏移改变、复制采样、
异指针隔离、缺样取消、迟到/畸形输入原子拒绝和终态释放。所谓 DPR 字段变化仅是测试输入，
不是实际渲染/DPI 切换验收；当前 surface 尚未提供原生 motion 源或移动窗口。
不协调的大幅 viewport 变化仍保守取消待定接触，下一段必须用实际位移回执处理重定位。
素材、动作 profile、单一时钟/骨骼所有权不变；原生拖动、透明合成、多屏、长期资源增长和
G1/G5 未关闭门禁继续独立保留。

### 脚本采集与回传（采集协议；早期批次尚未取得 GUI 结果）

本批补齐“用户运行、dot 读包分析”的闭环，不把云端 CUA 或用户手工长测设为默认前置。
交付时必须给出**本批包含采集工具的完整提交 SHA**；先 fetch 并在独立 checkout/工作树
确认该 SHA，保留自己已有工作。`0a3a827` 只是脚本批次的输入基线，不包含此命令。
在给定提交的仓库根目录、已有 Node 22.12+（与 package.json engines 一致）/npm 的目标电脑上运行：

```bash
npm run pet:realtime:capture -- --prepare
```

必须通过该 `npm run` 入口传入已存在 npm 的固定 CLI 路径；直接执行
`node tools/pet-realtime-capture/run.mjs --prepare` 缺少该受限入口，不是有效 prepare 命令。

首次 `--prepare` 会下载锁文件依赖和锁定 Electron 二进制，并恢复批准的 D2 原始字节；
准备段独立上限 300 秒。依赖/素材齐备后后续可不加 `--prepare`：默认准备段只运行
preflight，不偷偷安装、下载、恢复或升级。缺项时返回失败包和原因，而不是换模型继续。
现在使用 Node 内建恢复适配器，无 Python 安装前置；旧 Python 工具保留供历史复查，
与 Node 共读同一 `approved-d2-source.json`。锁文件、archive/source/hybrid SHA 沿用上文身份。
脚本管理的 prepare 子进程使用私有空 npm userconfig/globalconfig，不继承用户 npm 配置；
若 root/research 存在项目 `.npmrc` 或 `npm-shrinkwrap.json` 则拒绝，不读取/收集其内容。
用户外层启动的 `npm run` 仍可能按 npm 的正常规则读取配置，这不属于脚本对子进程的隔离保证；
本工具不收集该外层配置。
不继承 NODE_OPTIONS、API/npm token；一次新铸的 handoff token 只用于本次受限子进程认证，
不序列化到 request、报表或日志。

命令结束会打印 `.json.gz` 的路径（默认 `dist/pet-realtime-capture/capture-<runId>.json.gz`），
只需回传该文件；失败、超时或中断也回传生成的失败包，不要为了成功反复改变系统设置。
dot 负责核验包、源码身份和每阶段数据、解释失败并继续修复。CLI 只有 `--prepare`、
`--out=NEW_FILE.json.gz`、`--no-screenshots`、`--help`；输出必须为新的本地文件，拒绝覆盖，
不接受 profile/session、URL、任意 duration、remote debugging 或 sandbox/webSecurity 开关。
GUI 采集前会聚焦它自己持有的 fixture pet 窗口以满足 Electron `sendInputEvent`，不会采集
其他窗口或整个桌面。没有可用 GUI 时保留 setup failure，不通过禁用 sandbox 来绕过。
脚本 exit0 仅表示 `completed`（或 `--help` 正常返回），不表示 native/GPU/OS/视觉准入；
exit2 表示 setup failure、中断、observations 或清理未验证等非完整通过结果，按包内 status 分析。

报告的 `sampleCoverage` 按全部阶段区间的并集核对记录数量，重叠阶段不会重复计数。
`unphasedSummary` 单列区间外的原始记录，包括可能的首帧、reload、截图与过渡开销，
不混入稳态阶段分位数；缺样、重复、乱序或已观察到的边界丢样使其分位数无效。
`firstObservedFrames` 最多保留 64 个 renderer instance/epoch 的首个已取得记录，并报告截断数量。
这些记录可能晚于真正初始化，不能据此宣称完整启动时间、显示帧耗时或 GPU 执行耗时。
surface 的合成回归还覆盖销毁后断开 stage 引用、保留复制的有界终态计数，以及状态文案
不变时 144 个模拟帧只写一次 DOM；暂停/低动效/恢复仍正常更新文案。这不证明目标机
帧率提升、原生进程回收或 GPU 内存释放。动作计划的 channel 由注册表的通道键决定，
轨道内的同名字段不能改写所有者；注册表尚未接入实际动作播放，不能据此关闭 G4。

| 固定阶段 | 采集内容 | 证据边界 |
| --- | --- | --- |
| 启动与 warmup 5s | 独立记录 startup/cold first-frame、预热和源码/环境身份 | 不计入稳定性能分位数 |
| idle 10s | 实际页面帧间隔、CPU update/render submission、主进程/渲染器可用计数 | 可见连续 idle 与暂停停止重绘分开，不伪造 GPU 执行时长 |
| longpress、pet release、drag、release、cancel/regrab | 固定 Electron 注入输入，检查可观察 mode 与事件顺序 | 标记 `Electron-injected-not-OS`；不等于真实鼠标/OS 输入，也不实现 G2 原生窗口移动/DIP |
| pause 2s / resume 2s | 时钟冻结、停止重绘、恢复及多余调度 | 原生前后台/锁屏/多 DPI 仍需独立验收 |
| 暂停期间自有窗口移动/恢复探针 | 一次 ≤32 DIP 同 workArea 往返，记录实际 bounds、renderer 几何、独立输入观察和恢复回读 | 独立非性能阶段；不是 actor 窗口拖动、逻辑 anchor 落点、历史事件匹配或 compositor ACK；未观察到移动、输入污染或恢复不明均记非通过 |
| dispose + 两次 reload | 每代独立 instanceId/epoch、CPU owner/pending/actor/claimed-byte 归零、重建后短 warmup/idle 与资源样本 | 代次检查拒绝迟到响应；WebGL 计数/CPU 清零不证明实体 GPU 内存释放 |
| 阶段外截图与 cooldown | 当前固定五张 fixture `capturePage()` PNG（上限六张），截图后 cooldown，不混入 performance phase | 只证明该窗口当时可见画面；未做人工视觉验收 |

应用采集总上限 180 秒，包含 startup、全部阶段、reload、退出和进程树清理；不以
“每阶段各 180 秒”放大预算。超时/取消须等待新建根进程实际 close 和自身进程树清理确认，
不能将普通 `stopReason=exited` 误判超时；不能按进程名或不明 PID 杀旧实例。
只有已确认回收才删除本次 profile/private HOME；清理 unknown 必须保留并报失败。
Windows 的窄例外仅允许 root 正常 code0/exited 且实际 reaped、唯一精确原因为 normal
Windows descendants unverified 时继续同一预算内的准备/采集；清理 unknown 整轮 sticky，
保留全部自有目录，最终 `capture-complete-cleanup-unverified`、exit2，不能算通过或断言泄漏。
非零退出、timeout、权限拒绝和其他未知原因仍立即停止，不启用通用忽略清理失败选项。

目录清理另记 `directoryCleanup: {confirmed:false, code}`：`fixture-cleanup-rejected` 表示
profile 清理拒绝，随后禁止递归删 runRoot；`run-directory-cleanup-incomplete` 表示 runRoot
删除异常，仍生成合法结果包并保留剩余目录。root rm 可能已经部分执行，
`retainedOwnedDirectories`/`fixtureRemoved=false` 不是“所有目录完整未删”的证明。
完成结果降为 `capture-complete-cleanup-unverified`/exit2，已有 partial 只保留原失败状态，不升级。

fixture 使用本次 runRoot 固定派生的 `fixture/profile-dev`；父端仅从已知 canonical empty/idle/
all-AI-off 配方铸造，不接受用户 profile。一次性 HMAC handoff 绑定请求、目录 inode 和
初始两 DB 哈希，原子 claim 拒绝重放/篡改/替换；子端只承认自己 consume 的精确 request
对象，不再提供任意 inode JSON 的开放所有权 API。后续只查目录/claim/凭据缺席，不读
已由应用接管的 SQL；对外部 proof 的路径访问必须在进入 FS 之前拒绝。

原始帧最多 18,000 行，renderer ring 为 600 行；每阶段用 seq cursor 取增量，记录 epoch、
覆盖/loss、事件序号与代次。按**本阶段原始样本**计算 nearest-rank P50/P95/P99/max，
同时给出超过 16.7/33.3/50/100 ms 的长帧计数，不平均分位数。任何样本丢失使该阶段
分位数无效；coldstart、warmup、截图/cooldown、暂停不混入稳定帧样本。
每代首个完成绘制的 `startup.firstFrame` 单独保留 `updateMs`、`renderSubmissionMs`、
`totalCpuMs`、RAF timestamp 到 update 开始的 `callbackDelayMs` 及 ready 到提交完成的耗时；
没有前帧就不伪造零间隔，不混入连续帧分布。`startup.stageLoadMs` 包含动态模块加载和舞台构造，
`readyMs` 还包含初始化/等待 hydration；舞台 `construction.actorCreateMs` 与 `shaderCompileWaitMs`
分别记录 actor 创建及 `compileAsync` 的经过时间。后者不是 GPU 执行时长；这些分段有包含关系，不能相加。
资源样本保留对应 `instanceId` 和独立 startup 副本；未完成/不可用的测量为 null，销毁后不保留资源对象。
renderer 的诊断仍为只读有限数据，不导出 context、业务内容或密钥；事件最多 512、包内错误详情最多 64。
`errorLog` 的序号区分真实异常与重复读取，最后8条以外的淘汰计数继续保留。
`rendererDiagnostics` 分代报告真实出现数、已观察行、错过详情及详情截断；`errorAccounting`
只统计报告观察项，不等于独立根因数。未知旧格式明确保留较弱证据，不把消息字符串去重当作次数证明。
所有详情先做有界秘密/凭据URL/路径脱敏；退出、迟到加载、各清理操作失败通过同一日志，
记录异常不能在关闭后改写UI。终止阶段记录 pendingOperations及结清状态，等待不延长原180秒预算。
应回归重复读取、同文异次、reload重置、ring淘汰、64条饱和、分页、意外关闭、迟到拒绝、未结清和脱敏往返。
PNG 验结构、宽高各不超过 4096、每张 1 MiB，上限六张；整个单一 gzip 包 decoded
不超过 16 MiB、compressed 不超过 8 MiB，日志合计 64 KiB，带 schema 和 canonical SHA256，
独占原子写入、读回核验且不覆盖历史结果；中断/setup failure 也走相同失败记录边界。

环境/身份只记录白名单：commit/tree/dirty、明确关键工具/锁文件/GLB 的前后摘要、
Node/Electron/OS/CPU/RAM、graphics 分类、窗口/DPR/刷新率、appMetrics/主进程 RSS 等可用项。
renderer heap 不可用时写 supported=false；不推算。源码摘要只覆盖明确关键文件集合，
不是所有未跟踪文件都已证明不变。graphics 为 software/unavailable/unknown 时不能写成
native pass；hardware-candidate 也不是自动 GPU 准入。包永远不自动授予 OS 输入、人工视觉
或发布资格。G1 实际应用帧/原生门禁仍未关闭，G2 的原生拖拽/DIP 桥尚未实现，G3/G4/G5 不跳过。

| 当前脚本批次结果（cleanup-finally 修复后的封板终态） | 状态 |
| --- | --- |
| `npm run check` 封板最终复跑 | exit0；6,899 total / 6,870 pass / 29 skip / 0 fail；lint、boundaries、architecture、全部资产及 app-icons 检查均通过。29 skip 不写成通过 |
| `npm run test:integration` | 封板 71/71 通过；应用合同，不是原生 UI |
| `node --test test/pet-realtime-*.test.js test/dev-bench-profile.test.js` | 封板 179/179 通过，包含两类末端清理失败注入及确定性计时器回归，不另行加总 |
| 独立审查与跨进程验证 | 最终 40-file manifest 审查 CLEAR；原 48 项定向与 canonical fixture 跨进程 HMAC 往返属于较早审查快照，不与封板 179 项另行加总 |
| 真实 D2 只读 hash/preflight、CLI `--help`、setup failure 包 | 通过；失败包可核验，不代表已经采到真实 GPU 帧 |
| 实际 `--prepare`/依赖下载、完整真实应用采集、截图、目标硬件帧率/资源增长 | 本脚本批次均为 **NOT RUN**；GUI/native/GPU/OS-input/视觉不得记通过 |
| 不可变版本 | 脚本批次输入基线为完整 `0a3a827d86a702938eba590e870e2b7ff0661d41`；交付时另给本批完整提交 SHA/manifest，采集包记录实际 commit/tree/dirty 与前后 critical digest；首批 6,812/41/71/55 不是本批计数 |

| 本批坑 / 根因 | 修复与复查要求 |
| --- | --- |
| cleanup finally 中 profile 清理拒绝后仍递归删 root，或 root rm 抛错导致结果包丢失 | profile 拒绝立即阻止后续 root rm；root 删除异常写固定 `directoryCleanup` 原因并继续合法出包，只承诺保留剩余项、不承诺未部分删除；完成降 exit2，partial 不升级。两类失败注入及封板受影响复跑通过，已计入 179 项，不另行加总 |
| 用真实墙钟等待 9ms 断言 supervisor 已完成 TERM→KILL，在并行负载下失效 | 改用 Node 内建 `mock.timers` 明确推进 3ms timeout + 2ms grace，继续检查 TERM→KILL 且必须收到 root close；生产期限不变，不降低清理断言 |
| 任意 inode JSON 可能把外部 profile 冒充本次 fixture | 删除旧开放 proof API；固定 runRoot 派生路径、窄 mint 配方、HMAC 一次 claim、精确 consumed-request WeakMap，并覆盖重放/篡改/外部路径先拒绝 |
| Windows 根已退出但后代无法在安全边界内验证 | 区分根实际 reaped 与 descendants unknown；仅正常0/exited的精确单原因允许预算内继续，sticky unknown/保留目录/最终exit2，拒绝权限失败旁路 |
| 用户 npm 配置、诊断自由文本可能携带副作用或秘密 | 私有空 user/global npmrc，拒绝项目配置存在、不继承外部 NODE_OPTIONS/token；console 只收固定code，其他诊断 secret/authURL/path 脱敏 |
| supervisor 的正常 `exited` 被当成异常停止 | 用 code/signal/明确 stopReason 和清理确认共同判断；分别测试正常退出、timeout、abort、启动失败与未知清理 |
| 只哈希角色而遗漏采集器自身 | critical allowlist 纳入 capture tools、共享恢复合同/适配器、锁文件和实际 GLB，前后重核；漂移不得作为稳定样本 |
| dispose 诊断缺少调度状态 | 闭合诊断纳入 `frameScheduled`，与 CPU owner 归零、代次、重复 dispose 一并测试，不以截图猜测无后台工作 |
| `sendInputEvent` 未聚焦时不能建立预期输入 | 只聚焦本次持有且身份通过的 fixture 窗口；阻塞就报失败，不操作未知窗口；注入源仍明确不是 OS 证明 |
| 截图耗时污染性能 phase | 截图放 phase 外，并设 cooldown/光标边界；实际采集后按原始帧序号复查，不从截图 fps 推断运行帧率 |
| 新 Node/旧 Python 恢复可能漂移或增加 Python 安装负担 | 共读已批准大小/hash 合同；正确不重写、错误不覆、独占原子发布、取消/超限/链接与身份反例测试 |
| 复用原 bench 会注册全局快捷键和其他 OS 副作用 | 先验证 owned fixture scope，再限制真实 app adapters 的 shortcut/tray/通知/开机启动/热重载和 IPC；正常应用未安装 scope 时保持不变 |

### Windows G1 基线与裸角色资源优化（2026-11-07）

原始捕获 `capture-b0c37a98-1550-4c2c-b495-f2530c2ed124.json.gz`：139,380 bytes，SHA256
`f8c3e42738d8bfe5586760f7dfd29beefa52d3482ccd028180f99773e1b737ba`；源码
`d41917157298474094a2678a4a010bc7a0638ea2`，Electron 44.4.5 / Chromium 152.0.7977.130 /
Three 186，ANGLE NVIDIA RTX 4080 Direct3D11。硬件字段仍为 unverified，不授予原生/GPU准入。

- 首个记录的间隔 659.8ms 对应的是**当前帧** update 3.7ms、submission 1.3ms；warmup 的
  298.6ms 对应 1.1/0.7ms。旧计量省略第一次 update/render，不能由长回调间隔断定 shader 编译或配件加载是根因。
  两次 reload 的首个间隔为 86.206/83.4ms；created→ready 为 1655.9/1022.3/1008.9ms。
  包内无 CPU/GPU trace，后续需要上述首帧及构造分段，而不是把间隔冒充当前帧 CPU 耗时。
- 初始 idle 1442个样本，间隔P95为7ms、max7.7ms；update/submission P95均0.7ms。
  四次资源样本的14 geometries、18 textures、17,702,629 accounted bytes、1 actor、0 mounts不变；
  renderer working set却从246,204增至339,364KiB（约90.98MiB）。固定应用计数不证明无泄漏，工作集增长也不能独立证明泄漏。
- G1现显式使用 bare actor，不预备六件当前未穿配件模板，保留身体、表情、尾巴和同一指针所有者。
  bare actor拒绝equip，研究衣柜默认预备方式不变；contact证据核验仍保留，不能宣称删除所有配件相关I/O。
  实际资产CPU对照每次从17,702,629降为15,610,448 accounted bytes，精确少2,092,181字节；
  这不等于进程工作集或GPU显存减少，也不能解释原90.98MiB增长。
- 独立Node v24.22.1实际资产CPU夹具12组交替测试，每次新建pool并在计时前显式GC；排除前2组后，
  prepared创建中位633.35ms（542.69–688.77），bare中位535.90ms（510.66–600.61），其中1组bare较慢。
  仅是有噪声的CPU夹具创建比较，不是Windows首帧改善证明；几何/材质/骨骼、拖动/抚摸/取消等价及所有者归零单独断言。
  优化后的Windows复采结果如下；macOS、真实OS输入、多DPI、GPU/长期工作集门禁仍未关闭。
- Windows后续包 `capture-b5ce8f24-9d82-4930-bb6d-43b5c3888b5b.json.gz`：138,595 bytes，SHA256
  `1177f939bca7bcdd05fe66c769976e17cada95f39b0aa36b32384f9993db619a`，源码
  `85fc75e45b5a8985fb61b324939233ed084d9d2d`。实际预算确认15,610,448字节（少11.82%），
  几何/纹理计数仍14/18；不是GPU显存或整个进程工作集降幅。
  初代/reload首帧submission为725.3/92.4/94.4ms，actor创建587.6/619.2/602.4ms，
  compileAsync等待321/342.5/358.5ms。首帧render调用是明确的阻塞段，但没有上传、驱动、
  shader、GPU执行或JS profile分解，不能擅定根因。计时是调用周围经过时间，不是纯CPU占用或GPU时间。
  原包没有首帧submission且Electron44.4.5→44.10.1、Chromium也变化，不做首帧回归或加速的受控A/B结论。
- 本次idle/longpress有采集期间本人确认的额外触碰/暂停干扰，保留原phase失败，不归咎代码或改写通过。
  包内64条错误达到上限，其中62条是采集器重复读取同一非空errors数组时生成的通用项，
  不是62次已证实独立异常。原message未写入包且现有日志无法恢复，真实原因与次数仍未知。
  后续改用上述序号日志及溢出计数；不能用修复后的解释回填旧包。该包CLI exit2且后代清理未完全确认，
  不授予native/GPU/OS-input准入。

### 历史研究验证与归档（不属于本批在线前置）

下面保留原研究入口与历史证据，用于有明确目的、范围和预算的离线复查。
G0/G1 按上面的定向命令推进，不自动运行包含长时接触/布料研究的全量入口；
需要重跑历史研究时先说明预期证据、运行上限和停止条件，不把旧方案重新设为启动依赖。

应用的 `npm test` 明确覆盖 `test/`、`tools/` 和 `docs/reviews/` 的现有行为测试。
`research/animation-0.1.0/` 是独立依赖与资产恢复包，不把旧快照自动混入应用测试。
两套验证都需要运行，研究测试通过不能替代应用检查。

在研究目录使用 Node 24+、Python 3、NumPy、SciPy：

```bash
npm ci --ignore-scripts
npm run foundation:verify -- --output /tmp/bubu-foundation-new-run
```

输出目录必须是尚不存在的外部目录。入口恢复 D2/full18、检查共享 Three.js 与模型
哈希，执行表情、输入、原始部件、主题账本、场景协调器、业务事件适配、
底座、锚点、次级运动、特效、道具释放与集成回放，并重现接触审计及源模型导出。
`summary.json` 分开记录功能结果与接触、性能、原生输入、GPU 门禁；源码哈希、
命令、退出状态和日志保留在同一输出目录。运行失败不能沿用旧通过报告。

`productionAccepted` 始终为 false，直到独立完成原生和视觉验收。披风/喝茶的
精确版本冲突、实验布料的实时成本及历史帧尖峰仍有独立阻塞；禁止将
`supported/blocked/untested` 的合同行为测试写成艺术资产已兼容。

2026-10-20 本轮证据保存在
`research/animation-0.1.0/animation-foundation-v1/verification/closure-20261020/`：
研究 27 阶段、775 用例通过；应用 `check` 6,742 通过、29 跳过、0 失败；
应用集成 71/71。`source-hashes.json` 绑定研究源码，`application-validation.json`
绑定本次应用验证入口；压缩日志保留实际输出。900 帧 CPU 回放本次 P95 3.058ms、
最大 16.150ms，单次结果不关闭稳定帧率或原生门禁。具体未通过/未运行项以
`summary.json` 的 `gates` 为准。

后续审计证据在同级 `verification/audit-20261020/`。统一入口可追加
`--browser /usr/bin/chromium --software`，执行真实 Chromium 的着色器、指针捕获、
拖拽释放、DPR 1/1.25/2、上下文恢复和每档三次资源重建；需要 Python Playwright
1.62.0 与已安装浏览器。软件渲染必须显式记录，不能替代硬件 GPU/原生透明窗口。
该浏览器入口只覆盖 D2 身体宿主，不代表完整衣柜已接入。

接触端点排除证据覆盖整圈手部刚体旋转及每个手根/握点 0.01 模型单位的偏移范围。
局部释放披风 10 个固定点的两组 60 步实验仍有实际高模接触、应变和实时成本失败；
它们不是可投入运行的布料适配器。完整穿搭和目标设备稳定帧率继续保留未关闭状态。
October 20 的历史总体验收状态保存在 `audit-summary.json`，不能将新增回归用例通过写成生产闭环。

完整浏览器组合的当前复查使用 `animation-foundation-v1/demo/capture.py --output NEW_EXTERNAL_DIRECTORY`
（需本机启动 `npm run foundation:demo`）。它验证实际 DOM 鼠标抚摸/拖动/释放、
18 种表情、完整装备与资源回收、喝茶中断、暂停、减少动效和上下文恢复。
`--record` 输出实际浏览器渲染的 24 fps 逐帧采样视频；视频的播放帧率不能充当实际运行帧率。
旧的身体路径浏览器验证仍保留，二者覆盖范围分别记录，不修改旧证据归档。

统一验证另运行 `contact/outfit-sweep.mjs`，以 60 Hz 采样整套穿搭的待机、抚摸、
拖动和落地，并保存实际三角面交叉见证。可以独立传入新的外部输出目录运行；
追加 `--reference` 重现五个挂点均未调整的组合。采样无交叉不能推导连续时间或包含关系通过。
`verification/demo-state-verify.py --output NEW_EXTERNAL_DIRECTORY` 检查实际浏览器的
换装表情释放、暂停后停止重复绘制、暂停期间换场输入隔离以及低动效/取消。
`verification/face-render-verify.py --output NEW_EXTERNAL_DIRECTORY` 是独立着色器实验；
612 组画面相等，但交错 RAF 计时没有建立稳定提速，因此稀疏着色器未启用到默认路径。
脚本中的 GL 调用耗时是客户端测量，不能充当物理 GPU 执行时长。
本次最终证据在 `verification/followup-20261024/`：33 阶段、799 Node 用例及 2 Python
用例通过；应用检查 6,742 通过/29 跳过，集成 71/71。完整穿搭 481 帧对照中，
光环/花瓣交叉已消除，其余 11 组表面交叉仍需处理和分类。CPU 最大 16.952 ms、
软件 WebGL 帧间隔 P95 206.6 ms，稳定帧率仍失败；原生桌面与硬件 GPU 未运行。
依赖哈希曾拒绝实验性 D2 样式修改；已恢复原始冻结源码并通过最终核验，旧失败日志保留。

后续剩余项修复将花与叶的两处挂点偏移纳入完整穿搭，481 帧中其余交叉降为 9 组。
`contact/fit-obstruction.mjs NEW_EXTERNAL_DIRECTORY` 验证闭合身体/手部体积中的穿搭内外见证，
并证明包体/肩带的两处穿插超出了现有平移范围；这不排除转动或变形方案。
统一入口另运行 `contact/tea-clearance-sweep.mjs`：0.0098 的持杯同步前移候选保留
啜饮端点，在完整动作及八种取消轨迹上检查杯体接触，并按冻结运动公式对固定扣件进行
自适应区间位移包围证明。该项单独记为 `cupClaspCandidate`，不开放披风/喝茶组合。
演示适配层只将不超过 1e-12 的单位区间舍入误差收回边界，原始控制器和严格资源校验保持不变；
大于此范围的异常仍拒绝，精确取消结束时刻有独立回归。

布料实验入口 `secondary-motion/cloth-probe/endpoint-probe.mjs --output NEW_EXTERNAL_DIRECTORY`
可用 `--profile` 记录 Rapier 内部耗时，`--obstacle-filter body|hands|cup|none` 只做成本分离，
完整原始高模接触检查不随过滤关闭。`--bounded-body-hull` 生成严格包围原身体顶点、
相对原凸包最大误差不超过 0.01 的私有碰撞代理；`--trimesh-body` 对比网格碰撞路径。
这些都是隔离研究，不进入默认动画，也不减少实际渲染几何。即使物理耗时下降，
接触、应变、自碰撞、完整动作链和每帧 16.667 ms 门禁仍须分别满足。

此前剩余项证据在 `verification/remaining-20261024/`：36 阶段、805 Node 用例及
2 Python 用例通过，验证前后源码未变；应用检查 6,742 通过、29 跳过，集成 71/71。
当前 CPU 回放最大 13.116 ms，软件 WebGL 帧间隔 P95 201.2 ms，稳定帧率仍未通过。
杯体/固定扣件候选通过 295 个连续区间的表面分离证明；这项局部结果不替代手部、
布料、身体及未覆盖取消时点的组合验收。失败诊断和原先检查点均保留在独立归档中。

最新收敛证据在 `verification/convergence-20261024/`：36 阶段、815 Node 用例及
2 Python 用例通过，源码校验一致；应用检查 6,742 通过/29 跳过，集成 71/71。
完整穿搭的 4 组动态交叉已在 481 帧中消除并保留摆动，仍有 5 组静态交叉。
拾取 BVH 在准备阶段执行一次原有 refit，单列准备耗时，不改原生交点等价要求。
独立 CPU 回放最大 16.678 ms，软件浏览器帧间隔 P95 199.5 ms，稳定帧率仍失败。
`endpoint-probe.mjs --trajectory --convex-hands --bounded-body-hull` 从无交叉姿态启动，
在 0.55 秒首次出现包边/身体交叉而模拟薄面仍无表面交叉。`--render-envelope` 的
统一半径使 40 个固定点碰撞球与身体重叠，并在第一步超出 1.2 拉伸上限；两者均未准入。
这些属于局部贴合/碰撞表示的实现缺口；原生桌面及物理 GPU 验收另记为未运行。

花饰局部贴合证据在 `verification/flower-fit-20261024/`。默认 Node/浏览器装配路径
只调整私有花瓣与小叶片的刚体局部矩阵，保留源 GLB、几何缓冲和原连接点。
完整 481 帧中三组花饰/身体交叉清除，实际三角面最小间隙分别为
0.004818/0.003365/0.007680；整套剩下包体/身体、肩带/右手两组交叉。
14 张最终默认路径的 1×/2×、浅深背景及动作画面与已审查候选逐像素一致。
一次截图元素稳定等待超时保留为失败记录；重试显式验证三个 RAF 的画布边界一致。
最终 36 阶段、831 Node 用例及 2 Python 用例通过，源码校验一致；应用检查
6,742 通过/29 跳过，集成 71/71。软件浏览器帧间隔 P95 217.5 ms，稳定帧率仍失败。
连续接触、包含关系、披风/喝茶、实时布料及原生/GPU 门禁没有因此转为通过。

挎包闭环证据在 `verification/satchel-fit-20261024/`：包体/翻盖/扣件共用私有刚体矩阵，
挎包与日常披风采用保留支撑原点的刚体标定，完整组合偏移仍在原挂点范围内。
原两组交叉在全部 481 帧中消除，未新增跨装备交叉；右手/肩带与包体/身体的最小
实际三角面间距约为 0.019338/0.038776。包体/肩带在每帧保留嵌接，最终 14 张默认
浏览器画面与候选逐像素一致。几何缓冲、GLB、控制器及最大摆角未改动；装配方向
改变后的挎包/披风最大次级位移为 0.200147/0.128897，不宣称波形与原装配完全相同。
独立距离诊断发现变形后包围盒未刷新，已校正并复测；三处花饰间距与前轮一致。
统一验证 36 阶段、838 Node 用例及 2 Python 用例通过，2014 个测试时源文件身份一致；
应用检查 6,742 通过/29 跳过，集成 71/71。CPU 回放 P95 2.555 ms，但软件浏览器
帧间隔 P95 248.4 ms，稳定帧率仍失败。`fullWardrobeContact` 为 `not-established`，
零交叉采样不替代连续接触、包含关系、意图接触分类或同件自碰撞验收。
round5 披风在 16 个原喝茶关键帧中仍有同一组 6 个固定支撑点被手包住，最大退出
距离约 0.11739；原 65 点合同与局部释放后的研究候选分别记录，后者仍有接触、
材料应变及 CPU 成本缺口。新包边胶囊表示仅通过静态覆盖与修订代理初始间隙检查，
未采用为默认；动力学、缝线和实时性未运行。原生桌面及物理 GPU 仍未运行。

后续绑定审计见 `verification/binding-continuity-20261024/`。完整喝茶采样发现
14 个固定点被手包住，旧 55 点候选仍固定其中 6 个；16 关键帧中的 6 点并非全部。
内部绑定版本 `tea-swept-51-v1` 释放这 14 点，保留原模型、粗网格及控制器。
解析运动上界对原动作/避让候选分别形成 60/64 个区间证书，覆盖剩余固定点及
原 0.003 半径在完整抬手/提杯参数域中的手臂间隙，也覆盖该时间线的取消路径。
这不把整套穿搭的离散采样升级为连续接触通过，也不覆盖自由布面或固定区域面积。
审计补齐薄布路径的实际渲染应变：0.06667 秒下摆截面压缩为 0.79473，低于 0.8。
局部刚性截面研究修复消除此反例，但 0.51667 秒自由布面压缩到 0.76196，仍失败；
其包边碰撞表示及全动作验收也未完成。无需为内部绑定另行请求用户解冻，亦不据此
改变用户要求保留的源模型与控制器。软件/原生 GPU 性能结论保持分开记录。

布面后续审计见 `verification/cloth-surface-20261024/`。同一 0.51667 秒粒子快照下，
body-frame 细节候选将实际布面最短边比例由 0.76196 改善到 0.87138；正常动作仍在
0.53333 秒出现后包边/身体交叉，候选不设为默认。接缝检查要求原本重合的布面边界
与包边截面圆心保持重合（数值误差 1e-5），此前未检查接缝的路径不能借旧结果通过。
0.2 秒取消路径在加入连接映射后完整运行 9 秒/540 步，接触、应变、固定点和接缝
采样均通过，仍不代表所有取消时刻或连续接触。区域实际包边碰撞方案在 60/120/240 Hz
对照中仍失败；较小时间步不作为碰撞表示或材料问题已解决的证据。原 0.8–1.2
应变阈值及动作时长均保留。静止边长缓存只移除重复计算，须用相同路径逐帧比较
全部应变结果、实际几何和整体耗时；不能把单独映射耗时当成整帧实时验收。
整套穿搭保持 481 帧零交叉，并对花/叶/光环三个组间配对给出共同刚体变换域的
连续分离证明。报告必须列出其前提与排除项；动态衣物、包含关系和自碰撞仍未闭环。

局部碰撞与接缝候选的后续证据见 `verification/seam-coupling-20261024/`。
封闭包边碰撞体保留原外表面，但仍在 0.56667 秒失败，未采用。共享边界的独立
wire 候选修复了固定粒子代理关节塌向原点、细化铰链无外力仍漂移的两个静止缺陷；
其完整动态检查仍在 0.01667 秒失败。240 Hz 下实际布边比例 0.7234–1.2317、
接缝约 2.10e-5，均不能通过原阈值，物理粗边通过不能代替实际渲染验收。
取消检查现按原控制器补齐晚取消的退出尾段，不再固定止于 9 秒；正常路径仍至少
9 秒，任何提前停止的失败或短诊断都不能取得最终端点通过。此修复未修改控制器。
后续同一 1/60 秒快照的四边位移映射通过局部应变/接缝/接触检查，但其完整动作
候选继续失败。直接前包边与真实截面圆心连接越过原前包边失败点后，后包边仍在
0.10417 秒超过 1.2。全区域三角代理连接在 0.11667 秒出现 NaN，已保留原始 f32
失败与上一有限状态；实际布边粒子连接越过此时刻，正常和 0.2 秒取消路径均在
0.21667 秒显示自由布面/身体交叉，虽当时应变 0.86664–1.18546、接缝 7.35e-7
均在原阈值内，仍不能通过。原始粗网格接触报告必须与候选实际原生碰撞面分开。
候选保持未采用；短失败前缀不能给出完整路径性能收益，新增诊断复制也不继承旧缓存基准。
共用原生皮肤比较使用 `author-shared-surface-cage.py --output NEW_EXTERNAL_JSON`
及 `endpoint-probe.mjs --shared-surface-cage JSON --trajectory --convex-hands
--local-body-proxy VALIDATED_PROXY --constraint-pgs 12 --output NEW_EXTERNAL_DIR`。
必须测试真实接缝粒子的位移响应，不能只检查静止重建误差；原生小单元反例曾在静止
通过后忽略三个接缝材料点位移。厘米换算必须同步重力、碰撞体和求解器 lengthUnit。
`--collect-failures` 保留首次失败快照并继续记录每帧失败，用于完整动作及取消尾段
审计；它不更改门槛或生产准入，非有限状态仍立即失败并保留上一有限状态。
共用皮肤的材料/应变、接缝和性能仍需单独通过；静止、重力隔离或实际画面可读均不
代表完整动作通过。实体 GPU 验收不能替代这些 CPU/物理实现缺口。
`--physics-diagnostics --snapshot-frame N` 保存步进前的完整原生状态及哈希，并记录
逐帧动能、重力势能变化、速度和有向体积；未包含弹性能、接触与外部驱动做功，
不可声称总能量守恒。`--particle-centroids` 显式比较自由圆心的原生粒子附着，
必须同时保留 201 条连接及全部网格/碰撞约束，覆盖正常动作、取消尾段、实际显示
面接触、应变和接缝。13 点真实失败反例与单步快照只证明局部数值缺陷及修复；
有限值或步长减半后不崩溃，均不构成完整布料、连续接触或实时性能验收。
共用网格的隔离实验默认步长为 1/120 秒；正常及 0.2 秒取消各 9 秒/1,080 步已保持
有限，但材料、应变、接缝和接触仍失败。显式 60 Hz 原反例保留；粒子附着比较在
完整正常路径 7.516667 秒再次失稳，不能由局部反例通过推导采用。
`--coupled-contact-stiffness` 是独立且默认关闭的失败对照：匹配接触与轴向材料
刚度后，0.216667 秒两条前包边/身体交叉清零，但正常路径在 2.158333 秒出现
非有限状态。必须保留此前短暂接触、应变、接缝与单元翻转失败，不能以这个局部
清晰帧升级生产准入；接触关闭或删除圆心连接的隔离试验也不能成为修复。

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

### 团子开眼与基础短句回归

当前眼睛修复使用同一生产 face sampler／raster painter 的离屏 Skia 对照，基线为 `7314c274`；其8个相关源文件／manifest与 `0.0.2-dev.4` 的 `e3e1e2a6` 相同。`tools/dango-eye-continuity/capture.mjs <baseline-root> <output>` 输出原尺寸／3×对照、完整开眼图册、单独隔离的基础短句对照、108帧时间序列、源码与图片 SHA256，以及真实黑瞳像素边界报告。

本次4种实际视角 × 8种完整开眼 × 1.5/3/4.5光栅倍率 × 双眼共192个像素量测，宽高误差最大0.831设备像素（容差1.5）；profile兼容朝向由行为测试确认映射到three-quarter。完整开眼统一真实黑瞳占位，neutral粉色边不参与尺寸；特殊惊讶／坚定／恳求形态保持素材身份。

相关 Dango、face-choreography与pet-renderer-smoke共242项：232通过、0失败、10个既有可选环境门禁项跳过。新增11项行为／真实像素／基础短句测试全部通过，覆盖眨眼与半闭形态、lookback矩阵、胜出语义立即打断、独立channel、静态及失效时钟、三种基础短句与真实renderer接收DND同步后的关闭链路。语法、boundary、architecture通过；最终整仓集成检查另由对应构建结果记录。

这些是实际生产画笔的离屏证据，未证明用户Windows/macOS原生窗口、透明合成或GPU验收通过；既有PET12原生门禁不因此关闭。基础短句图固定采用修正后的同一眼睛几何，不能把新增嘴形／目光变化当成几何修复效果。

## 桌宠动作打磨分支门禁

`feature/pet-motion-craft` 以 main `7314c274474c3f9af12c3617b3f00cbe3101f42c` 的已验证可读文件为基线；本轮仅改变动作、美术挂点及其测试，不代表原生发布验收。

- 新增两形态 `paper-return` 的准备、握持、放飞、回返、接回、收起与待机；真实手点与道具握点分别计算。动作前后、3570 ms 放飞与 7980 ms 接回边界必须用生产透明帧复核，不能以 pure-pose 的零误差替代像素或最终宿主呈现。
- `moonwalk` 分别验证交替支撑与移动脚的实际行程。生产外层只对匹配的 base 动作移除通用 bob / beat，保留更高优先级状态。两形态 30 fps 整段 270 帧的透明前景底边漂移为 0 设备像素（DPR=2）；旧基线为 12。该门禁不证明所有足底像素或原生窗口合成。
- `magic-trick` 星轨远离正脸并在 94% 前收回帽中；审阅其前后连续片段和脸部像素检查。其他旧动作的认证基线保留，仅明确排除本轮改变的 moonwalk 腿骨和 magic star 道具轨迹，新行为另有专项测试。
- 新增两件小奇 earwear：纸飞机信使夹、小指南针耳夹。复用既有槽位、等级规则与持久结构；四视图、明暗底、有限合法重装与音乐耳机组合均有生产渲染。团子没有新增配饰，全部衣柜交叉组合未穷尽。
- 首个功能 checkpoint 聚合 `npm run check` 通过，默认测试 5722 通过 / 26 跳过；集成 71 通过。设置 `PET_MOTION_CANVAS_PACKAGE` 单独运行 `test/pet-motion-craft.test.js` 的 8 项测试通过且无跳过。Canvas 专项单独运行，默认测试跳过不能称为像素验收。
- 真实 Node Canvas 生命周期录制覆盖两形态裸装 / 合法重装各 6 种情境，共 24 场景、7272 透明帧：完整、握持 / 飞行 / 接回时打断、动态 reduced、暂停时钟。低刺激稳定段保持固定图像，两个重装完整场景通过透明边缘裁切检查；这些有限门禁不代表动作审美自动通过。
- 本轮截图、视频、逐帧时间与哈希、离线 review HTML 和 source / asset seal 随独立审阅产物保留。须正常速度人工播放复核，且最终源代码变化后重封存。Windows/macOS 原生尺寸、GPU 合成、全衣柜、长运行内存及既有 PET12 风险仍开放。

### 手动打断收束与最终回归

后续修复 `paper-return` 手动替换时的握持 / 飞行 / 接回硬切：同一个 renderer 和连续时钟保留至多一个 420 ms 的收机快照，新的反馈表达即时生效。收机后在旧、新动作共同允许的视角进入新动作拿取起点，原业务截止时间不变；此次交接的喝茶在末段下放、收杯并回到同视角 idle，普通直接喝茶不改；强约束与取消即时清理，不扩大全局视角或持久协议。requested 行为与 renderer 公开的 observed 表达 / progress 分别记录；不把未公开的 action id 填成 idle。

最终代码候选聚合 `npm run check` 完整通过：默认 5732 通过 / 26 跳过，集成 71 通过；单条命令启用 Canvas 后，pose expansion、wardrobe、motion craft 与退出桥共 35 项全部通过、无跳过。曾出现的同步像素扫描 SIGKILL 已用无 bubu 的 Canvas 最小复现定位：长同步循环阻塞 native 像素缓冲回收。仅在测试每 10 个采样让出事件循环后，同进程保持全部采样和断言通过；无阈值放宽、无强制 GC、无扩大 heap。该测试调度问题已闭环，不再列为当前未解决测试失败；用户应用长期内存门禁仍独立开放。

新证据重新采集两形态共 24 场景、7272 帧，另有较长新动作保持的真实同宿主交接；旧错误标注与硬切样例单独保留为回归反例。正常速度独立浏览器播放、用户最终审阅及原生 Windows/macOS / GPU / 长运行门禁仍未完成。

最终关键案例的捕获已保存在仓库工具中：`capture-lifecycle.mjs --suite=full-tea` 重放两形态重装完整喝茶，`--suite=tea-boundaries` 重放末段取消与新请求；省略 `--seal` 时明确仅为未封存本地预览，不依赖临时脚本即可恢复验证流程。

### 日常发生时间与 schema20 门禁

- 保持原 owner 桶与 occurrence ID；19→20 的完整候选除 schemaVersion 外须与源值相等。原合法120条数据不可截断；容量已满时拒绝新增或跨实际日迁入，不删除其他记录。
- 覆盖今天与昨天双向更正、跨三天 owner 桶保留、实际发生日期清理、提醒原时段关联、稳定排序、重复确认、撤回、并发旧版本拒绝、事务未知核对。日期按本地日历计算，追加时区切换及 DST 正反跳检查。
- 两条升级路径分别核验完整备份、拒绝前原字节、源漂移、取消、损坏/未来版本、未知 COMMIT、恢复到新目录和二次启动固定点；18→19 的历史目标不能被 current-only20 自动接纳。
- 真实云浏览器的合成配置验证与 Node/SQLite 测试分别记证据。收件建议 UI 的合成响应不代表真实 Provider；现有原生 Windows/macOS schema19 发布记录不能证明这次 schema20 的原生升级、真人确认框或重启验收。
- 已保存记录仅支持用户改时间；模型只处理当前随手记文本的明确时间建议，不扩大既有日常历史披露。

### G2 原生移动观测的证据边界

`pet-realtime-native-movement` 行为回归覆盖实际回读与请求被 clamp 的区别、无操作平台、
超时/取消后的恢复、owner/同 URL 导航失效禁止迟到恢复、单次独占/并发拒绝、负坐标显示器、
工作区边界、非静止输入拒绝与 128 条观察上限。真实 surface 的只读几何回归检查复制和
viewportRevision；collector 将探针放在暂停非性能阶段。Node 模拟全部通过仍不是实机证据。
原生采集必须逐次核对 `capture.windowMovement` 的实际位移、`inputQuiescent`、restoration
和当次源码身份；原生输入流一律 unknown/unmatched，不因 Electron 注入或 isTrusted 升级。
没有共享事件身份前不将该独立 native 观察流接入 actor，也不把窗口当前位置或光标轮询充作历史输入。
Windows 进程树清理、人工视觉、GPU/OS-input 以及真实混合 DPI 门禁仍分别保留。

### G2 DOM 同事件坐标合同

`pet-realtime-event-motion` 验证精确运行时/单屏投影、负/小数坐标、client 与 screen 相互
独立、未观察到能力前的 client 兼容、旧时间戳拒绝、源 epoch 取消、永久撤销、不混回、
pointer lock、失效最终释放点和 32 条有界副本。真实 D2 的 `event-motion-adapter` 另核验
唯一 owner、惯性/落地、抚摸与拖动互斥、无关指针不能撤销接触、队列失效及松手/再抓。
这些测试的 trusted/time 字段是明确构造的测试信封，不能记为 OS 输入证据。

采集器现在为 Electron 注入显式提供 `globalX/globalY`，并保存
`caller-supplied-controlled-fixture-not-OS` 的坐标回执，避免把默认零 screen 坐标当实机点。
`capture.inputMotion` 保存实际运行的 source mode/capability 和最新最多 32 条同事件观察；
它证明采样源选择及本次送达的数据，不证明硬件来源、native capture 或混合 DPI。
能力变化到 renderer 撤销之间存在跨进程通知延迟，不声明与 OS 拓扑变化原子同步。
真正 OS 路径的窗外拖动、捕获丢失、Alt-Tab、release/regrab 和实际显示器变化仍需独立验证。

前一段 `74b02f7` Windows fixture 捕获为 5,060 帧/14 个完成阶段/零错误；
其 backing window 从 (1528,744) 实际移动 (-24,-16) DIP 后回读恢复，
renderer 窗口位置读数一致，native 输入观察为零。该结果仅证明自有窗口往返，
`eventMatched/compositorAcknowledged/actorMotionConnected` 均为 false，清理未知及三项准入门禁仍开放。

### G2 几何回执与旧视图输入屏障

`pet-presentation-view`、`pet-viewport` 检查不可变副本、事实不变不升 revision、负/小数坐标、
逻辑/backing/content 分离、clamp/noop、命令部分执行后抛错、缺失 content 与不稳定回读。
`pet-realtime-surface` 检查旧回执、同 revision 冲突、缺失回执降级、迟到异步 stage 与外层
几何不能绕过校验回执。`pet-realtime-event-motion` 覆盖 client/screen 视图观察时间屏障，
不可用后恢复及能力永久撤销不能被视图恢复绕过。

实际 D2 的 `body-runtime/pointer-view.test.mjs` 检查 queued down 尚无 owner、相同尺寸平移、
相机变化、无新输入时 frame 撤销、同一时间批次 motion/up 清空、缺坐标终止释放、DPR 与
backbuffer 变化不误撤销、视图副本及不重采运动、sealed-time 无 epsilon 的生命周期屏障。
这些均为 CPU/模拟原生端口证据，不证明 OS event matching、Win32 capture、live window travel
或 compositor ACK。`readWindowGeometry().presentationView` 是收到的 host 观测副本，
不能把它标为真实已呈现帧的确认。

G2C `e87eefb` 的 Windows 95 项非 GUI 测试通过、1 skip；由于采集入口会 focus 自有窗口，
非干扰要求下没有执行新实采，没有 G2C 的 raw 包、inputMotion 或实际 bounds。
本段同样不抢焦点，原生 foreground/OS-input/GPU/视觉及进程树清理门禁继续保留，
不拿 G2B 的旧数据替代新源码运行证据。

### G2 开发态点击穿透租约

`pet-input-lease` 与 `pet-input-lease-host` 覆盖闭合不可变字段、期限边界、tick前到期续租、
当前文档/mainFrame/webContents身份、同URL重载、单独pointerSpace变化、不可用几何、
blur/hide/crash/close、普通end后再抓、旧序号/旧contact拒绝和native调用抛错后的未知结果。
`pet-realtime-input-lease` 覆盖单在途请求、end优先、旧epoch不重贴、永久未结算请求、
不明结果只补一次终止、缺能力/时钟异常、terminal响应换epoch不重复end及原业务字段隔离。

真实 surface、闭合codec、bootstrap 和真实 viewport 代码通过模拟Electron端口组成往返，
核对租约期间不切穿透、blur撤销、无窗口移动/聚焦。实际 D2 的 `input-lease-owner` 验证
contactGeneration只在命中接纳时分配、同帧松手再抓复用pointerId仍不同代次，及迟到拒绝、
输入epoch改变与无主排队事件丢弃不破坏原landing/表情。原 approved-pointer 回归保持不改。
采集包新增 `capture.inputLease` 保存实际renderer请求状态；它不是OS捕获或native flag读回。

以上为CPU/模拟端口合同验证，没有执行本轮Windows前台采集。新租约的真实点击穿透、
初次异步接纳空隙、窗外释放、失焦/捕获被抢、GPU和进程树清理门禁保持开放。
同进程期限不是主进程挂死后的恢复保证，不以模拟TTL通过升级原生安全或正式产品验收。


### G2 捕获中受控窗口往返

`pet-fixture-transport` 验证严格同量平移、文档/profile/窗口身份、期限与sequence不变、
clamp/no-op/content偏移、partial-throw、同步blur/新contact/过期及清理边界。
`pet-realtime-fixture-transport` 和真实surface/host/publisher组合验证严格回执例外、
实际DOM/camera stamp、旧revision不撤销当前事务、失效先end不先renew、迟到终止不复活
租约或重置已释放尾段。实际D2的 `body-runtime/fixture-grip.test.mjs` 验证原owner内锁定、
惯性与实际grip投影、fence/down时间下界、立即松捕获、sealed-time和队列容量兜底。
既有approved-pointer、pointer-view和input-lease-owner测试继续保留。

`pet-realtime-held-transport` 通过模拟端口验证固定两步、同事件受控输入回执、原300ms
剩余租期、逐await身份、迟到/未知结果不重试、恢复失败不升级和无能力平台继续旧采集。
`capture.heldTransport` 单独记录setup、两步native与renderer实际抓握读数、局部抓握偏差、
全局位移及清理；正常up后需观察原landing与尾段，并等待无contact/queue、body idle及真实
interactionTailActive=false；face owner退出/回归也需结束。原up完成记录仍有效、contact
高水位未变才可通过，sealed-time取消、blur截断或轮询间新手势不能冒充自然完成。探针未运行、能力不足、途中失败分别报告，不用旧实采代替。

清理回归在旧诊断回复之后、实际pause/dispose任务之前插入已接纳新contact、尚未分配
代次的queued down、已结束的新contact和同URL新实例，验证实际renderer清理边界拒绝，
不改capture/queue、不恢复旧窗口。真实surface生命周期另验成功路径与拒绝路径。
原D2 owner与真实fixture transport组合覆盖末次terminal=false读取后到达的up/cancel/
lostcapture：取消、暂停、销毁均不能清除原终止队列；普通帧消费后，landing与body idle
但表情退出仍活跃的阶段继续受保护。完整尾段结束后才可清理。销毁实际执行但回执丢失
的测试仍保留attempted=null，不重试或伪报已确认。以上仍为CPU/模拟端口证据。

本段仅有CPU/模拟端口与实际模型算法验证，没有本轮Windows前台采集。新的原生往返
结果仍待运行，所有OS-input/GPU/人工视觉/进程树清理门禁保持开放。受控global坐标来自
采集器且native hop由程序固定发出，不能标为真实指针驱动窗口、OS事件匹配或compositor ACK。

## G1/G2 实机验收清单（目标 Mac/Windows，逐源码记录）

1. 在独立工作树取已交付的 `feature/pet-animation-v2` 精确提交，记录完整 HEAD 并确认工作树干净；
   不直接切换或覆盖已有工作。下一步的显式 `--prepare` 负责锁定依赖和已批准素材恢复。
2. 恢复 D2 素材并采集：`npm run pet:realtime:capture -- --prepare`（Node 22.12+；输出 `.json.gz` 结果包）。
3. 手动观察：macOS/Linux `BUBU_DEV_REALTIME_PET=1 npm run dev`；Windows PowerShell
   `$env:BUBU_DEV_REALTIME_PET=1; npm run dev`。
4. 分别记录窗口内拖动/提起/释放、长按抚摸，以及尚待接入的原生窗口移动；不能将前者记成后者。
   记录隐藏/锁屏、低动效、关闭重开、实际 OS 输入和多 DPI；性能记录设备、renderer、样本数、
   P95/P99/max，而不是只凭 P95 接近16.7ms判定全部通过。
5. 去掉环境变量重启，确认回到默认 2D。结果包、截图和逐项证据回传后分别判定各门禁；
   exit2/清理未知、注入输入或单轮帧率不升级为 native/GPU/OS-input 通过。
