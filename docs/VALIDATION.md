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
| 持久化 | current-only schema18 准入、拒绝前零写入/零 proof、DB/身份/WAL/SHM 原字节、未知提交核对、损坏/未来版本、重开与故障注入。另获授权的库迁移须核验逐字节备份和二次启动固定点 |
| IPC / preload | sender、闭合 payload、非法输入、surface allowlist 与最小 preload |
| workflow / 状态投影 | 单次提交、写集、回执/幂等、effect 失败隔离、publication revision 与断档恢复 |
| 遗留入口 | `architecture/manifest.json` 棘轮同步收紧，不新增职责 |
| AI | 授权/披露、预算、取消、迟到响应、来源新鲜度、Provider 故障、关闭/无密钥的本地路径 |
| 面板 | 实际 UI 草稿、保存失败、重开、重复点击、关闭与取消、焦点返回、长文本及键盘操作 |
| 桌宠 | 舞台边界、动作相位、图层/接触、冷加载/失败、生产 renderer 帧、原生尺寸与多 DPI |
| 感官/动效 | DND、低刺激、Reduce Motion、专注/休息、吸附、隐藏/退出与运行中策略切换 |
| 打包 | 本机平台/架构选择、活动资源包含和 sources 排除、ASAR/原生 helper、安装与同档重开 |

### AI 持续协作验证合同

- 共享执行器保留场景上限；协作与一次性调用、自动餐分别检查实际 HTTP 次数、repair、读取、字节和总期限。零读取/零 repair 不能被默认值放宽。
- Provider 返回、每次 await 后及 owner apply 前重核活性与授权；关闭 AI、修改 Provider/密钥、关闭会话或来源变化使旧请求失效。
- 场景与当次 grant 的交集限制读取。来源文本不提供权限，工具不能使用动态 SQL、路径、IPC 或通用 store。
- 建议与业务提交分开。修改、记忆、遗忘及安排偏好分别走真实预览与确认；同身份重试不重复应用。
- SQLite 回执、outbox 与业务结果核对；unknown 不显示为未应用或成功，不借 UI 关闭/重开生成新身份。
- 来源删除、遗忘账本、传递依赖及摘要不能复活已失效正文；管理列表和 Provider 召回权限不同。
- 临时会话、持久会话、记忆使用与自评历史是独立选择；日志不记录正文或密钥。发送字段必须与界面披露一致。
- 真实 Provider 的连通性、协议兼容、费用和端到端表现需独立验证，不能从 fake-port 测试推定。

## 隔离运行

仅用工具创建的全新可删除 schema18 SQL 档案，不拿真实用户档案或旧资料试开、迁移、修复或重置。历史 generic adapter 测试不授权当前生产读取旧档。

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

下面是要求，不是已通过标记。每次验收应记录覆盖的平台及源码版本。

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

## 签名测试更新发布与恢复门禁

1. 更新分支固定`electron-updater 7.0.0-alpha.9`与`electron-builder 27.0.0-alpha.10`。执行`npm ci`、`npm audit --audit-level=low`、`npm run check`与`npm run test:integration`。变更依赖时核对lock integrity及真实Electron主进程的CJS→ESM载入，不以Node mock替代。
2. 执行`node --test test/testing-update-channel.test.js test/update-artifacts.test.js test/update-release-config.test.js test/build-schema.test.js test/update-network-bounds.test.js test/update-install-admission.test.js`。这些测试使用官方provider、版本比较、builder metadata生成与官方Ed25519验签，HTTP/原生下载安装边界仍是合成端口，fixture密钥来自公开RFC8032测试向量，不可用于发布。覆盖dev.1→dev.2、equal/older、稳定版拒绝测试版、篡改/缺签名/错公钥、错架构/data19、缺文件/缺size/超512MiB、路径或外域替换、签名公钥轮换、2MiB metadata与下载流上限、超时/取消/404清理、在途/已准入异步工作、冻结期的新操作、延迟native及unknown恢复、SQL事实重开。
3. 在两个原生构建host执行`npm run verify:update-runtime`。它使用新的可删除临时目录，加载真实Electron中的官方更新组件与验签，并用仅本机HTTP fixture测试真实net响应流、重定向、流大小/下载摘要、404清理和截止；另检查原生窗口停用/恢复时fixture输入不变，不连接更新源或执行安装。无显示服务器的Linux可运行`electron --ozone-platform=headless scripts/verify-update-runtime.cjs --loader-network-only`，明确跳过窗口输入检查；这不替代Win/Mac原生安装证据，也不能加入`--no-sandbox`或关闭系统签名政策。
4. `npm run release:updates`仅打包不发布。必须提供`RELEASE_REPOSITORY=jemicyzhu-0333/bubu`、`RELEASE_CHANNEL=testing`、`RELEASE_VERSION=0.0.1-dev.2`和精确`RELEASE_PREVIOUS_VERSION=0.0.1-dev.1`；第一次基线可用previous `0.0.1-dev`。正式版使用stable及实际递增稳定semver。源package/lock版本保持开发版本，产物内版本由extraMetadata明确设置并重新核验。
5. 先由所有者独立批准并配置签名材料，命令本身不生成或配置：manifest使用官方`ELECTRON_BUILDER_UPDATE_SIGN_KEY`或`ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE`；macOS选择`CSC_NAME`的Developer ID Application身份、既有证书及Apple公证配置；Windows选择`WINDOWS_PUBLISHER_NAME`与匹配证书。没有材料即失败，禁止以空签名、`updateManifest:false`、ad-hoc或关闭Authenticode替代。不得把密钥放进仓库、fixture、日志或产物报告。
6. `.github/workflows/build-signed-updates.yml`为手动、只读仓库的候选构建，默认testing，固定Win x64/Mac arm64。它引用尚可为空的受控vars/secrets，不建立凭据；这些缺失时job应失败。两端都通过完整检查、签名构建和`verify:update-artifacts`后，收集EXE、DMG、Mac ZIP、各自blockmap及签名size/data18文件名一致的`dev.yml`/`dev-mac.yml`（stable对应latest）。Mac同时通过codesign、公证stapler和spctl。不得将开发工作流的unsigned/ad-hoc包混入此候选。
7. 发布仍须明确授权。先锁定同一源码commit、实际包版本、签名身份、公钥ID和全部摘要，创建`v<version>`草稿Release；testing标记prerelease，stable不可标记prerelease。先放完整payload及blockmap，核对下载字节，再放两端签名YAML，最后一次发布该Release。不可覆盖已经公开版本的任何payload字节，不用同版本rN修补。少一端、Mac ZIP、签名或摘要不符时不公布metadata；旧版本可保留作显式恢复。
8. 真实验收安装N，创建专用合成任务、偏好、已保存会话与未提交草稿，再从设置下载N+1、取消/重试、显式重启。特别核验Squirrel在明确确认后已stage、随后error/普通退出/下次启动的实际行为，不能从合成event推断已取消；验收未完成前阻止发布该链路。证明实际可执行版本、bubu身份、资料/偏好/凭据后端及再次重开不变；证明专注/休息/待落点/AI在途/保存unknown拒绝重启。负例包括离线、断下载、磁盘满、错误SHA-512/签名、错误架构、安装失败、关机和旧缓存。Windows需真实NSIS/Authenticode/SmartScreen，Mac需真实浏览器下载/Finder/Gatekeeper、公证和Squirrel替换；CI直接启动或Linux验证都不算。
9. 若发现坏版本，立即停止后续发布并撤下其公开更新入口（保留制品与诊断证据），发更高版本修复。不可自动降级或恢复快照。需要资料恢复时先停止写入，保留完整profile并核对备份来源与schema，再由用户明确选择恢复目标；18→19之前必须另行通过ARCHITECTURE「桌面更新」中的迁移/备份/中断恢复门禁。

上游合同：[7.0.0-alpha.9发布](https://github.com/electron-userland/electron-builder/releases/tag/electron-updater%407.0.0-alpha.9)、[签名manifest](https://www.electron.build/features/signed-update-manifests/)、[自动更新](https://www.electron.build/docs/features/auto-update/)。安装依赖源码与schema才是本固定组合的最终依据；不能把未来文档API当作旧版本支持。

## 当前验证范围与仍未关闭的项

已有有限 Linux 原生运行观察覆盖新测试档案中的任务/步骤、首步成长、暂停/恢复、多窗口可见投影、部分形态/穿戴与喂食，以及一次正常退出后的同档可见状态恢复。这不是完整 SQL 字段、全部配饰、到期结算、异常终止或目标平台安装验收。

### PET12：Linux 偶发横条呈现异常

在 Linux/Electron 的真实透明窗口中，从动效 balanced 切为 reduced、再将刺激 balanced 切为 low 后，粉色桌宠曾变成持续黄绿色横条，角色不可见而主面板仍可用。恢复 balanced 设置未立即恢复，普通右键打开桌宠菜单后恢复；随后重走相同步骤未复现。

这是已观察、未定位、未修复的间歇异常。不能将 libnotify/D-Bus 告警或 GPU 直接认定为根因，也不能把后续未复现当作修复。应在同源码、默认安全设置下保留原始窗口证据并继续区分渲染、合成与生命周期因素。

### 其他开放门禁

- 当前公开候选树须重新运行聚合与集成检查；旧树结果不能替代。
- Windows/macOS 完整原生输入、系统通知、声音/活动探针、AI 工具 hook、VoiceOver、多屏及缩放仍需绑定同构建的验证。
- 多小时稳定性、CPU/内存基线及长换肤离屏内存增长风险未关闭；短时与缓存上限检查不证明整体内存安全。
- 新 SQL profile 的目标平台安装、保存/重开、异常终止及物理断电保证不能由合成故障测试推定。
- 真实 Provider、签名、公证、Gatekeeper、SmartScreen、Universal、正式 Release 与更新分发未在本次文档整理中验证。
- Secure Input 下的热键、时间线跨午夜“接着上一天”提示及遗留组合根抽取仍有独立工作。
- 角色与美术权利范围见根目录 LICENSE-SCOPE 及各资产 USAGE；项目代码的非商业许可不建立第三方授权。

## 结果记录格式

交付中写明源码身份、平台/工具版本、命令、通过/失败/跳过/未运行范围、可重放步骤及剩余风险。测试日志和一次性截图按相应测试或发布保留，不持续堆入本文。
