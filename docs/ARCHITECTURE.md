# I'm ADHDer 工程架构

本文是工程契约的唯一出处：分层、状态所有权、事务、持久化，以及各功能必须保持的数据规则。产品语义见
[PRODUCT.md](PRODUCT.md)，验证方法见 [VALIDATION.md](VALIDATION.md)，桌宠美术坐标见
[PET_VISUAL.md](PET_VISUAL.md)，长耳形态的分层 Rig 见 [PET_RIG.md](PET_RIG.md)。代码注释引用本文时写
`ARCHITECTURE「小节名」`，不写已删除方案文档的编号。

## 品牌与档案身份

产品和安装包使用 I'm ADHDer，npm 包和默认档案为 im-adhder，开发档位独立使用 im-adhder-dev。此次测试修订明确启用新空默认档案、应用标识与OS凭据身份，不迁移、导入或删除旧档案；显式指定的数据目录保持原样。默认路径需要规范化时，在单实例锁前一起设置 userData 与 sessionData。桥接名、事实数据库名和rig格式标识同步采用当前品牌，不提供旧别名。

## 分层与能力

I'm ADHDer 是**模块化单体 + 纵向能力切片 + 端口与适配器**：单用户、本地优先、单主进程事实源的 Electron
应用。不拆微服务，不用通用事件总线、服务定位器或目录扫描式自动注册。

```text
main.js（遗留组合根，冻结）
├── bootstrap/        profile 选择、实例锁、生命周期、create-application
├── application/      唯一 UoW、跨能力 workflow、只读 query、有界 AI 协作会话
├── capabilities/     work · execution · guidance · progress · companion · attention · routines · preferences · app-maintenance
├── platform/         Electron 宿主、SQLite 权威仓适配器、Provider、凭据
├── core/ content/    纯计算（日历、奖励账本、能量曲线、原生路径美术）与闭合内容表
└── surfaces/ renderer/  popover · impulse · pet · nudge 的 scoped client、feature 与页面入口
```

每个能力按 `contract → application → domain` 分层，外部只能 `require` 它的 `index.js`：

| 能力 | 职责 | 持久化所有权 |
| --- | --- | --- |
| `work` | 捕捉、任务、步骤、计划、重复、归档、历史 | `tasks`、`archivedTasks`、`recurrenceSeries`、`impulses` |
| `execution` | Now、专注/休息、暂停恢复、两分钟决定、落点 | `nowTaskId`、`focusSession`、`quickStartDecision`、`focusLandingPrompt` |
| `guidance` | 能量估计与校准、推荐、卡点策略、AI proposal、回顾 | `energyCheckIn`、`energySignals`、`wakeTimes`、`moodNotes`、`energyProfile`、`strategyFeedback`、`reviews` |
| `progress` | 奖励账本、XP、等级、统计、时间轴记账 | `xp`、`level`、`lastCompletedDate`、`stats`、`rewardLedger` |
| `companion` | 伙伴关系、喂食、商店、皮肤与形态、换装、惊喜、呈现 | `pet`、`companion`、`unlockedSkins`、`currentSkin`、`achievements` |
| `attention` | 提醒升级、延后、工作边界 | `lastWorkEndNotifyDate` |
| `routines` | 日常事项与两日记录 | `routines`、`routineLog` |
| `preferences` | 设置契约、默认值、按能力投影 | `settings` |
| `app-maintenance` | 启动迁移、每日维护、版本告知 | `schemaVersion`、`lastResetDate`、`migrationNotices` |

所有权以 `architecture/manifest.json` 为准：只有所有者的 domain/application 能构造该路径的新值；跨能力的
原子动作只能进 `application/workflows/`，并在 `workflowWrites` 登记完整写集；单能力 command 在
`capabilityWrites` 登记（无持久化写入的用例登记空数组）。

依赖方向：`bootstrap → workflow → 能力 facade`；`surface → surface adapter → preload → IPC → application`；
`platform → 内侧 port`；所有层可用 `core`、`content`、`shared`。禁止：跨能力深引用、domain 依赖外层、
surface 触碰 Electron、renderer feature 直接用 `window.imAdhder`、任何模块引用 `main.js`、新建
`utils/helpers/common/manager/service` 大桶。纯 domain 不读 Electron、DOM、文件、网络、墙钟和随机数，
时间、ID、随机由参数或窄 port 注入。

`src/main.js` 与 `surfaces/pet/controller.mjs`、`surfaces/pet/renderer.mjs`、`renderer/popover.mjs` 是冻结的遗留
热点：可以做必要缺陷修复和抽取，不能增加业务职责、依赖、IPC 家族、定时器或全局。`legacyRatchet` 记录
`main.js` 的行数、requires 与 IPC 注册数，双向精确相等：抽出代码后必须同步收紧。行数只作复核信号：
生产模块约 300 行、入口/门面约 180 行、函数约 50 行时复核内聚性，内聚就带理由保留。

能量估算、任务需求和排序由 guidance 的 `energy-estimate`、`task-demand`、`task-ranking` 领域模块负责。
时间与任务时间戳解析通过窄端口注入；应用查询保留原调用的默认值、时钟采样次序和返回对象身份。
guidance 的公开推荐投影经 application 适配器提供缺省时钟，领域模块不直接读取墙钟；生产共享采样仍传入明确时点。

禁止的重构捷径：按行数切 `part1/part2`；把 `main.js` 函数整体搬进新的 `AppService`；恢复通用 preload
或动态 IPC；迁移结构时顺手改 schema 或产品行为；长期保留两套实现靠开关分流；用源码正则测试代替行为测试；
用压缩格式、超长行或宽泛 allowlist 规避门禁。

## 事务、投影与 IPC

`unitOfWork.run()` 是唯一提交协议：读 canonical 快照与 revision → 建隔离 draft 并记录声明的可写路径 →
运行纯 transition（事务内不做网络、LLM 或 SQLite）→ 各能力校验自己的 slice、整份 schema 校验并二次规范化
验证幂等 → 检查未声明路径没变、以 expected revision 提交一次 → revision 加一并算最小 delta → 提交后才执行
通知、窗口、动画、时间轴记账等 effect。effect 失败不把已提交的命令变成可重试的失败。

长耗时 Provider 走 prepare / perform / apply：先在事务里捕获有界意图（目标 ID、`updatedAt` 或 revision、
允许字段、过期时间），事务外调用 Provider（密钥只在适配器内解密），返回后用一条新命令重新校验目标身份与
新鲜度再提交。目标已完成、删除或被改过就拒绝（`target-changed`），不做“尽力合并”。

renderer 只持有带 revision 的只读投影缓存。popover 通过 `state-channel` 按显式 dirty manifest 接收字段级
delta，发现断档时重新读取完整投影。快捷面板的完整替换投影可跨 revision 断档，不能将这个例外用于 popover 的部分 delta。
归档历史稳定排序、有界分页，不自动删除。

**三端发布。** application 的 `surface-read-composition` 为每次发布读取一次 canonical snapshot、
采样一次 wall time，历史计数也使用已采样的 impulses（过滤、重叠去重与不可用语义不变），以同一 canonical session 调用既有 rollback-safe runtime clock 和 session projection，再计算一份能量／推荐。
`popover-state.project(sample, dirty)`、quickPanel 与纯 `pet-context` 使用同一次样本；发布期间不能调用带维护的 pet getter。
bootstrap 的 `surface-publication` 独占进程内 publication revision，与 repository transaction revision 不同。它集中展开
energy／wellbeing／session／stats／settings／routines 对能量和推荐的依赖，并覆盖宠物消耗的 pet／companion／skin／appearance。
popover 收到部分 delta；quick 只收到 `{revision, dirty, delta:{quickPanel}}`；pet 只收到原 context 白名单与 `contextRevision`。
三端不共用宽泛 wire payload，quick／pet 不得携带 canonical snapshot、凭据状态、情绪历史或捕捉原文。
popover部分发布复用同一DIRTY_FIELDS，仅计算本次delta需要的AI凭据状态、外观选项与归档分页；完整初始查询及all发布仍返回全部普通数据字段。此优化不缓存跨revision结果，不改变snapshot、能量计算、quick完整投影或缺号恢复协议；合成基准只证明对应分支少读，不代表整体启动或大档案性能已解决。
提醒重核、共享采样、各端投影与发送、quick 尺寸、pet 后置策略及错误上报分别隔离；失败仅走已有完整读取恢复，不能重试业务 mutation。
共享采样失败时 popover／quick 仍收到 invalidation-only；popover 或 pet 单独投影失败不阻止其他合法投递。
所有既有 canonical pet 手工发送收口到共享发布，初始化加载使用相同纯 mapper；表达、speech、food、锁屏、开发与 cue 仍是独立呈现通路。
`session-start-publication` 保留，开始／暂停／恢复／结束不再先发无版本的 pet base。

pet:getState／pet:getFeedState现在都是纯查询，无维护事务、启动衰减或分钟计时写入。`surface-read-composition`从同一快照和时点计算
`companion-feed-state`，popover、pet context和getter复用其饱食／食票／库存／手动次数／基础餐剩余量。canonical食物更新只经已有共享版本发布器，
不再另发无版本food／coffee状态；独立呈现仍不拥有业务状态。petActivityMode作为闭合canonical呈现策略随同一版本投影，用于撤回已排队或已显示的自动餐反馈。成长、喂食、撤销和设置清理的各项提交后effect分别隔离，单一失败不阻止其他surface刷新。

每条 IPC 是一个静态 route descriptor（channel、command/query、surface allowlist、闭合 decoder、handler），
由各能力的 `contract/ipc-codec.js` 提供、`application/ipc/route-catalog.js` 聚合；启动时断言 channel 唯一、
surface 已知、decoder 与 handler 存在。通道目录是唯一清单。preload 每个窗口一份，只暴露该 surface 用得到的方法；
禁止暴露 `invoke(channel, payload)`、store 或 Electron 对象。新增通道要同时改 codec 的 surfaces 表和对应
preload：前者不加主进程拒收，后者不加 renderer 调不到。`npm run boundaries` 校验两边闭合。

## 持久化与迁移

业务状态的唯一权威为 `config.sqlite` 的完整JSON快照行（SQL user_version=1），包括业务数据、AI回执和outbox。
生产组合根使用 `sqlite-state-adapter`，复用现有CAS与持久性证明实现并强制关闭JSON镜像。当前payload `PERSISTED_SCHEMA_VERSION` 为 18。
已有 `config.json` 保留原字节但不读取作权威、不重写；只有JSON而没有初始化SQL身份的profile拒绝启动，等待显式导入。
启动顺序：

1. 先选择生产/开发数据目录，再取得profile单实例锁；失败的第二实例不接触持久化文件。
2. 全新profile建立独立INITIALIZING身份；仅JSON的旧profile失败关闭，不能隐式导入或清空。底层历史导入实现仅用于既有兼容测试，不是生产默认入口。
3. 配置SQLite完整快照、revision/hash CAS与业务receipt/outbox同一WAL/FULL事务提交，再核验绑定application_id并标记READY。
4. READY后只读SQL权威；丢失、替换、截断、未知schema或损坏保留DB/WAL/SHM并失败关闭，不能重新导入可能过时的JSON。
5. 生产只接受规范完整的payload18；旧版／未来版／损坏18在调用配置normalizer、迁移证据写入和启动proof前拒绝。拒绝保留SQL、身份、revision/hash、证据、proof计数和WAL/SHM。历史generic adapter兼容测试不构成生产导入／迁移入口。
6. 生产不构造JSON镜像writer；已有JSON文件不影响SQL成功，也不会触发镜像同步。凭据、资源、缓存和诊断文件不属于业务快照，不能宣称所有文件都在SQLite。
7. COMMIT异常后先按精确revision/hash核对，再执行不改变业务revision、payload或回执的verification_count FULL事务并重新读回；每次启动也先只读核验payload再做同类证明。证明失败保持unknown并阻止新写入，只重试原身份核对。应用退出先完成会话保存，再关闭所有仓库。

current-only的既有配置档先经`config-admission-copy`：在连接原配置库或原身份库前，仅捕获两者各自DB及存在的WAL/SHM，记录缺失成员，合计最多512 MiB，以1 MiB缓冲复制到独占私有临时目录（目录仅属主访问、文件创建模式0600）。普通文件、文件身份、长度与摘要均核对；不能只复制主DB，已提交的旧payload可能仅在WAL中。副本只读复用SQL／身份／证据／raw validator，不跑完整adapter、迁移或proof；拒绝及清理只触及自有副本，绝不恢复、删除、checkpoint或替换原侧车。清理失败也拒绝原库连接。通过后清理副本，再核对原目录／文件身份、成员存在性及摘要，才走原库既有重验和一次启动proof。
Windows不能用POSIX mode位证明私有权限：先以固定系统PowerShell的只读常量程序检查新建空目录，再以`wx`建立全部空副本、持有句柄并检查实际文件DACL，确认后才写入私有字节，复制完成后再次检查。路径只通过UTF-8 JSON标准输入传递，不拼入命令；禁止修改ACL、执行策略、提权或拒绝后的替代路线。owner及有效Allow仅接受当前SID、SYSTEM和Administrators；目录上仅允许可继承且InheritOnly的CREATOR OWNER模板，实际文件仍逐个重验。陌生Allow不能由Deny抵消；空／null DACL、未知ACE、reparse point、成员／身份变化、工具不可用、超时及无法确定的结果均失败关闭。三次子进程等待共享本次准入独有的15秒预算（原三次各5秒的总额），按单调时钟扣除实际等待，冷启动可使用剩余额度；每次仍重新取证，不重试、不缓存权限、不跨档共享。超限、时钟异常或余额耗尽均拒绝；复制与验证空档不计入该等待预算，进程终止及清理也可能增加开销，因此不承诺整个启动15秒内结束。三次批量权限检查保留精确目录成员和文件身份复核，不承诺防护同用户、SYSTEM或管理员的恶意替换；此信任边界也不能写成Windows chmod提供owner-only保证。
此准入以既有profile单实例锁、启动源静止及私有临时目录独占为前提；保留打开但无活动的句柄测试不构成并发复制授权。临时清理逐成员复查目录身份，异常立即停止；未取得初始身份时只尝试非递归删除空目录。Node路径操作并非原子inode条件删除，不承诺对恶意同UID进程在每次检查与unlink之间替换私有目录的防护；探针文件名独立于原六成员，不能用清理去恢复原档。摘要复查不是锁，不能阻止外部writer在检查之后竞写；发现漂移失败关闭，不重放旧侧车。字节合同覆盖六个成员的内容和存在性，不承诺atime等全部文件元数据不变。全新空档不复制；INITIALIZING仅按既有空库／缺主库及source binding恢复，已提交快照仍须完整校验。该有限临时探针不是备份、恢复或新兼容入口；超限资料保留原件并拒绝。

SQLite WAL/FULL是这里的跨平台普通事务合同，不以POSIX目录同步作为Windows功能开关，也不等于物理断电认证。
完整备份建议关闭应用后保留整个profile；至少包含配置SQLite及绑定身份、协作库、事实/记忆库、遗忘账本和任何仍存在的WAL/SHM。
旧JSON导入备份与SQL内迁移证据仍可能包含旧内容；应用删除不是备份范围的安全擦除。

生产 `sqlite-state-adapter` 在options之后强制current-only、版本18及严格raw validator；调用方不能改回兼容模式。
`assertCanonicalPersistedState`使用固定时点的纯canonical派生核对完整键和值，不调用注入的normalizer；非法18不能靠同版本legacy detector修补。
首次空档生成完整18；`autoCheckUpdates:false`重开不变，缺该键或`aiPetMealsEnabled`的18拒绝。提交候选也需严格canonical。
配置SQL user_version仍为1、奖励账本内部仍为3；协作SQL独立升级为4，见「可恢复会话存储」。这不放开配置payload18的current-only限制。
历史兼容测试不授权生产迁移旧用户资料；没有自动转换、删除、重置或替代档案入口。

历史与记忆不在这份文件里，见「事实流与长期记忆」。

## 收件分类与原文历史

schema 14 在 work 拥有的 `impulses` 条目上增加 `classification`（本人确认的 category / routineKind / level，缺省 null）和 `resolution`（action / category / at / targetId，缺省 null）。AI 的 `triage` 仍是建议；本人分类优先，低置信度与未开启 AI 时明确未分类。后台 apply 必须拒绝已处理或已经人工分类的目标。

原文与处理结果是用户数据：处理当下与目标（任务、日常、状态、情绪）在配置SQLite快照的同一次提交里写入，原子性不变。
提交之后，`archive-inbox-records` 工作流把已处理条目复制到事实存储的 `inbox_records` 表（SQLite user_version 2），
确认写入后再用第二次提交从 `impulses` 里释放**同一版本**（id 与 `resolution.at` 都匹配）的条目，所以
配置快照只保留待整理条目和尚未归档的少量已处理条目，不随历史增长；复制失败时原文继续留在文档里，下次提交或启动时重试。
表里只存历史需要的字段：原文、创建时间、最终分类（category / routineKind / level）、去向、处理时间和目标 ID；AI 的 `triage` 建议不归档。
JSONL 与不可用层没有归档仓，已处理条目留在配置快照，行为与引入归档前相同。库文件损坏、错配或失去已初始化权威时保留原件并明确不可用，不重建空仓；没有自动原文历史删除，显式删除同时移除文档和归档里的原文（`delete-inbox-record`）。删除情绪记录在提交后从归档里移除其来源。
历史查询 `application/queries/inbox-history` 把文档里未归档的已处理条目与归档分页合并，按创建时间倒序、ID 升序稳定排序，
游标是 `before:<createdAt>:<id>` 的键集游标（默认 30，最多 100），可按最终分类筛选；popover 状态只投影待整理条目和两处合计的历史总数。
`dayHadActivity` 只看文档里的条目，已归档的已处理闪念不再单独构成“昨天有活动”。

归档的 page/count/existing 读端口必须返回明确成功信封；关闭库、SQL异常、不可用层和畸形结果不能降为 `[]/0`。
历史query验证有序行与计数，成功时分别给分类total与全局globalTotal；任一归档读取不可靠时只返回canonical中可确认的局部行，
available=false、total/globalTotal=null、nextCursor=null。existing分批覆盖所有本地重叠ID；这不改变idsByTarget显式删除的500条上限。
popover历史总数附带独立inboxHistoryCountVersion，只有impulses脏位或完整投影携带；无关revision不让旧计数重新有效。

renderer的inbox-history模块只保留当前分类的查询缓存，分类、隐藏、销毁与明确删除使旧请求失效；失败保留已读行并显示不可用，
不显示完整空态或继续翻页。已确认的收件删除与情绪删除先移除相应缓存正文再读取，迟到页面不能重现已删除原文。
时间线与来源历史共用一个无正文删除控制器，保留原moodId及结果知识；来源入口只能绑定当前已验证加载的feeling来源ID、
精确targetId和来源版本，目标情绪缺失也必须重新两次确认。隐藏、换页、替换行只清未提交确认，不取消已发命令；
部分或未知结果按原ID重试，不能另起一份竞争操作。两处恢复栏在卡片/时间线重绘区域之外，只有当前可见面板公告。
重启不会保存renderer操作槽或自动续删；保留来源只是重新授权清理的入口，不是持久操作回执、失败证据或新状态权威。

`organize-inbox` 工作流声明 `impulses / routines / routineLog / energyCheckIn / energySignals`，经三个能力的公开 facade 处理分类、创建日常、记录发生与状态校准，再同一次提交封存原文。动作可以携带本人选择的分类（category / routineKind / level），分类与动作在同一次提交里生效，动作失败则分类也不落盘；渲染层改分类只是本地草稿，不再一改就写。log 在同类唯一时复用，多个时必须选择；缺少日常可以原子创建且不虚构提醒。超过日常日志两日窗口的收件拒绝补录，允许只留存；旧状态不能覆盖更新自评。日常时间轴通过已有 routine timeline effect 在提交后记录。`keepAll` 在一次提交里把最多 100 条待整理条目按当前标签留存。`resolve-impulse` 的任务创建和 `wellbeing` 的情绪保存同样封存原文，重复消费拒绝。情绪删除在canonical事务内移除尚未归档来源与关联回执详情；归档源由独立事实库删除。配置了归档仓时，必须先成功查询来源ID，失败不开始canonical删除。
不能把available=false当作没有来源；canonical删除后归档清理失败返回partial，按原目标ID重试剩余来源，不声称两库原子删除。

任务的 promote／next-step／schedule／someday 与情绪保存，在各自现有业务 UoW 内先规范化最终分类，再创建目标、封存来源并撤回该条 AI 信号；renderer 不先单独提交分类。私有 `classify-inbox-draft` 仅调用 work／guidance 公开 facade，不提交或发布，调用者声明完整写集；`resolve-impulse` 写集补入 `energySignals`，情绪保存写集不变。目标拒绝、策略抛错、校验／CAS／持久化失败都不保留草稿分类或信号撤回，显式重试才重新执行。原 capture.createdAt 与 mood.at 保留捕捉时间，任务 createdAt 与 resolution.at 共用一次命令时钟。归档确认后的第二笔 impulses-only 释放仍属提交后行为，日常事实保留原业务 revision。

成功的任务与情绪去向经原共享发布器使能量与推荐失效，并更新 popover、快捷面板与桌宠；共享 pet guard 识别 energy／wellbeing，明确自评不再额外直发一次相同 pet context。该 INBOX 语义在三端统一发布中保留；snapshot／publication revision／hydration 的合同见「事务、投影与 IPC」。

手动非状态分类移除该条对应的 AI energy signal，状态确认移除推测信号后采用本人自评，异步能量分析拒绝人工非状态分类。其他收件的信号、用户自评及日常曲线不受影响。`impulses:organize`、`impulses:history`、`impulses:keep-all` 仅允许 popover，闭合 decoder 限定动作、分类、日常类型、能量档位、游标与 ID 列表。
所有收件通道（promote / review / delete / organize / keep-all / history / keep-mood、`mood:delete`）由 `bootstrap/inbox-organization.js` 组装与注册，它只连线不含规则；`main.js` 只保留捕捉。

升级沿用逐字节备份和同版本严格固定点守卫；schema 13 原条目、原文和 triage 不变，两个新字段为 null。不尝试从已丢失的旧收件制造历史。备份不一致与同版本损坏元数据失败关闭；回退旧构建时必须恢复原备份，旧构建不得读取新 schema。

## 任务、会话与奖励

**任务模型。** 旧的 `category: daily | midterm | adhoc` 已拆成彼此独立的属性，业务逻辑不再读 `category`：

```text
Task
├── content: title, description, steps[]
├── lifecycle: done, completedAt, skippedAt, expired, archivedAt/archiveReason
├── planning: plannedFor, scheduledFor, deadline, expiresAt
├── recurrence: seriesId?, occurrenceDate?
├── organization: tags[]
├── effort: energy, energyAuto, estimateMinutes, estimateSource
└── execution: blocker, nextAction, focusedMs, focusSessions
RecurrenceSeries: state(active|paused|ended), rule(frequency, interval, weekdays?, strategy, anchorDate), template
```

`plannedFor` 只决定某日视图，`scheduledFor` 决定何时重新可执行，`deadline` 只表达外部截止，`expiresAt` 是
用户显式开启的自动失效；四者互不代替，新任务默认全空。`expired` 是主进程首次确认 `now >= expiresAt` 时
写入的单调标记，只有显式续期能清除。输入边界：标题 1–100、描述 ≤1000、步骤 ≤100 且每条 1–200、标签 ≤8
且每个 1–20（保序去重）、估时 1–1440 分钟。重复规则支持 daily/weekly/monthly、1–365 间隔、周规则 1–7 个
星期值、`fixed` 与 `after-completion`；月度规则按原锚日夹取短月；日期数学在 `core/recurrence-rule.js`，
work 与 routines 共用。每个系列同时最多一个开放 occurrence；完成或 `skip-occurrence` 在同一事务里封存当前
实例并生成带新任务/步骤 ID 的下一实例；漏掉多个周期只推进到一个合理的下一次，不批量制造逾期。编辑内容时
重复任务必须带 `scope: current | current-and-future`。

**完成是终态。** `done === true` 不可逆；有未完成步骤时 renderer 先确认，主进程一旦收到合法完成请求就在
同一事务里完成并结算。所有 update、步骤编辑、set-now、renew、start-session 入口都拒绝已完成任务，完成的
步骤也不可修改。继续类似工作只能复制为新任务；归档只是可见性转换。

**会话。** `focus-session` 保存 planned duration、已累计活跃时长、active segments、暂停与离线确认状态；
运行中用单调时钟推进，墙钟只用于落盘时间和本地日归属。开始、暂停、恢复、到点、两分钟三选、落点、健康收工
都走主进程事务；未处理的离线确认、快速启动决定或落点会阻止新会话。时长范围 5–120 分钟，
`execution/contract/session-duration.mjs` 是所有入口共用的纯 ESM 规范化函数。运行中调时长
（`pomodoro:adjust-duration`）沿用同一 `sessionId`，不能低于已投入时长，两分钟救援、休息和离线待确认会话
不可调。`settings.lastChosenFocusMinutes` 记住最近一次明确选择。

**暂停继续与到点确认。** application 的只读
`projectSessionResumeAction({ session, tasks, now })` 组合 execution / work 公开 facade，只有 paused 返回冻结的
`{ sessionId, intent, enabled, reason }`。普通 linked focus / quick-start 重验 canonical task 的 availability；
free focus 与 break 不受任务可执行性限制。held 标记或 remaining=0 只允许 `confirm-completion`；held 却仍有剩余
时间给出 `recovery-state-inconsistent`，不能解除 held 或恢复。确认已经投入的时间允许目标已完成或缺失，不能重开任务。
`resume-focus-session` 在原 UoW 内以同次 wallNow 重算动作，依次拒绝 not-paused、session-changed、
resume-intent-mismatch 与 disabled reason，然后才调用原 clock transition；写集仍为 focusSession / stats / rewardLedger。
到点返回原 `session-completed` envelope，不先写 idle 或 return；bootstrap 的窄 session-resume adapter 仍通过
既有 exact-session / completion settlement 一次提交，随后隔离 presentation/publication 失败并返回当前会话（可能已进入
linked break）。自动focus／quick-start／break结算的XP均为0，稳定事实ID、本地日活跃片段、完成／返回统计保持；成长只由本人后续确认。

既有 `pomodoro:resume` payload 改为闭合 `{ sessionId, intent: 'resume' | 'confirm-completion' }`，仍只允许 popover / impulse。
两端只提交实际渲染的动作，缺失或禁用不调用；结构键包含 sessionId、intent、enabled、reason。到点明确确认／放弃，
使用中性到点文案，不把任务完成引起的暂停一律称为离线。为防旧放弃请求结束新会话，本阶段新增防御：held UI 的
`pomodoro:stop` 携带闭合 optional `{ sessionId }`，原 stop UoW 先比对正在计时的身份；无参普通 stop / pause 保持原合同。
这项 stop 身份保护是新防御修复，不是已找回的历史 Git 字节。放弃保留 measured time、无完成奖励／落点／两分钟决定；
重复确认或放弃不得再次结算。

**快捷澄清与两分钟启动。** application 的只读
`projectQuickStartAction({ taskId, tasks, startState, now })` 从 canonical task、原启动状态与同次采样时间生成
`{ taskId, intent, enabled, reason, taskVersion }`。intent 为 `start` 或 `clarify-and-start`；taskVersion 复用原
`entityFingerprint` 的完整任务指纹，不取 recommendation 副本、updatedAt 或全局 revision。原 `pomodoro:kickstart`
仅增加成对 optional `nextAction` / `taskVersion`，闭合校验、两 preload 和 main 原路转发，allowlist 不变。
`start-focus-session` 在原 UoW 内重验 availability、handoff、完整指纹、既有下一动作、活动会话和步骤上限，
调用公开 `work.taskClarification` 保留 blocker，再以 `requireNextAction:true` 检查并启动 120 秒会话。
写集只在原 focusSession / quickStartDecision / nowTaskId / stats 上增加 tasks；失败零部分写入，重复任务只改当前 occurrence，
不覆盖下一动作或系列 template。原到点 completion envelope 和单调时钟路径保留，未加 writer 或 persisted 字段。
提交后的 notification、pet、timeline、publication 经窄 bootstrap `session-start-publication` 分别隔离；澄清成功额外发布
tasks / recommendations，effect 故障不能把已经提交的启动说成失败。main 仅接线；成长接线继续收紧三端抽取后的main棘轮，实际数字以manifest为准，未增加IPC。

**成长与食物。** `content/growth-policy.mjs`独占成长常量：级别成本min(30×level,450)，每日首次推进20、最多三个任务／自由单位各10、一次明确收口10。
`daily-growth`分别保存零XP真实source事实与独立growth-unit／first／close稳定ID；同任务同日的步骤、任务和确认专注共用单位，旧15XP lifetime预算不再阻挡新日进展。
`rewardLedger`内部version3、seenEventIds、dailyBucketTotals保持；裁剪5000条展示事件不归还资格。第四个任务仍计事实和统计。
`record-session-growth`是无提交draft helper，声明G=`xp/level/rewardLedger/pet/companion/unlockedSkins`，调用者一次UoW拥有其完整写集。
complete-step／item、resolve-focus-landing／quick-start、healthy-shutdown及start-break在同一次提交应用成长与收益。break必须有trusted bootstrap显式userInitiated；自动linked break不给收口。
任务终态／归档／失效／跳过只清Now，不抹未答落点；落点、会话和quick decision保留原taskId，真正自由专注才为null。缺失／已完成目标仍能确认已投入会话，不能保存新任务便条。
两个resolution IPC均要求显示中的sessionId和显式boolean progressMade（UI初始false），任务变化更新taskEditable投影，迟到响应不操作替换对话框。

`companion`独占pet和角色关系。新pet为satiation65、完整普通库存（berry2其余0）、foodTickets6、lastTicketDay、foodCommands、care、totalFeeds；旧衰减／dailyFeedXp／coffee字段删除。
关系为relationships.dango／usagi，加共享bondDay／advance-close-care claims，surprise／collection／appearance保留。成长收益的关系日使用reward有效日，真实互动时间单独保留。
仅firstAdvance给3票；close-only不领取资格。票数safe integer，库存≤999，溢出整笔拒绝。basic≤45才可取，独立最多3/day，饱食不超过55；零XP/票/关系/口味/手动计数。
`progress.basicMeals`以`basic-meal:<local-day>:1..3`持久ID领取，跨角色／手动自动共用且不受food receipt和展示trim影响。
`buy-companion-food`写pet；`feed-companion`写pet/companion/rewardLedger。闭合payload为foodId/commandId/issuedAt，ID绑定kind/food/time，成功回执最多200、TTL10分钟、未来偏差30秒。
已有回执先重放再查当前饥饿／额度，不重复effect；新ID不能早于保留成功回执的最大issuedAt，避免裁剪后时钟回拨复活。未知结果保留原ID；过期须权威刷新成功后显式重试，刷新失败不能释放身份。

**规则优先用餐。** meal-rhythm／meal-serving和advance-meal-care／resolve-meal-decision维持领域与UoW唯一业务边界。bootstrap/companion-meals拥有本地采样与有界Provider编排，复用application.requestScope；不存在第二scope。启动和电源／伙伴开关间断经companion/invalidate-meal-care的pet-only事务撤回建议并清观察锚点，不修改库存、饱食或额度。
care规定五分钟采样、六分钟连续容差、floor25、09:00/12:30/19:00的90分钟餐窗、一小时冷却、6自动餐/day，无离线饥饿补扣；保留小数。
普通候选为rice/milk/carrot/berry/fish/bone且最爱优先，特殊款仅手动；basic须独立额度允许，无候选不预留AI次数。
AI用餐默认off并要求master、模型和凭据，最多3预留/day，只允许当前可用食物、等0/5/10分钟、本地反应0/1/2。pet-meal任务闭合投影character/satiation/meal/foods/favorite并保留小数；输出最多1024字节且不修复。每次决策五秒共享deadline，beforeRequest封住协议／schema协商的第二次实际传输，maxRepairAttempts=0。共享lease保留到同步apply之后；撤权与普通失败分开，撤权不提交fallback餐。已接受wait在饥饿时就地执行，不再预留AI次数。
preferences旧单能力writer移为update-preferences workflow（settings/pet）；关闭meal或master flag时原子清decision/plan/nextMealAt，同值或无关合法patch也清；不退款或发益处，版本饱和仍能关闭。实际模型／地址／petEnabled变化同事务清建议；select-skin仍由companion拥有，写集追加pet以原子撤回旧角色计划。密钥成功变化通知runtime撤回，失败不通知。角色切换与手动喂食的成功提交后立即中止在途用餐transport，不能等待轮询后才撤回DNS期间的旧请求。
采样和清理的canonical变更只经共享surface publisher；selfMeal是独立提交后呈现事实，renderer不二次feed或更新canonical食物字段。没有meal／reminder不发空呈现事件。喂食模块独占仪式、可取消延迟短句及speech owner；隐藏／替换／dispose撤回，减少动效保留静态表达。自动反馈owner覆盖仪式结束后的短句余时，静默／关闭活动／DND／新会话会立即撤回其全部反馈而不清除其他speaker。自动餐不追加手动喂食的generic celebration，避免已结束的仪式遗留独立高优先级transient。电源中断接入既有process-lifecycle订阅，不能以第二powerHost.subscribe替换原会话监听。

**每日回顾。** 收口与启动卡由本地任务、账本、会话片段、落点和闪念确定性聚合，不调用 AI；每张卡有独立
幂等 ID（`review:<kind>:<dayKey>`）。前一天没有任何活动（专注、完成、落点、新任务、闪念）时不生成那一天的
收口卡。启动卡的 `picks`（最多 3 件）只有用户确认后才计划到当天，确认的第一件同一事务里写成 `nowTaskId`
（`resolve-review` 写集为 reviews、tasks、nowTaskId）。DND 或错过时机只保留待处理卡，中途退出保留进度。

## 快捷行动面板

全局热键（默认 `Alt+Shift+Space`）打开复用 `impulse` surface 的面板：执行中（当前任务、计时、全部
未完成步骤、追加或改写步骤、完成/暂停/继续/结束）、待启动（与主面板同一份推荐投影的候选）和兜底（只剩闪念）
三种互斥模式由投影决定，高度按候选/步骤数量计算并限制在屏幕工作区，超长列表内部滚动。随手记在最上面、是默认焦点，`Enter` 收下并关闭，
`Esc` 取消；`⌘/Ctrl + 1–3`（焦点不在输入框时光按数字也行）完成对应步骤，或对候选“先做 2 分钟”（`pomodoro:kickstart`，
待启动模式只提供这一种开始，整段专注回主面板接）。样式与主面板同一套原生语言，不再用像素字体与扫描线。

暂停动作在主面板 pomodoro 与 quickPanel.session 共用同一次 canonical query 的 resumeAction，快捷投影保留真实
kind（含 quick-start）、held flag 和 recoveryReason。break 不投影 actionable task / steps；已完成关联工作仅显示标题，
完成、追加、修改、旧步骤行及数字快捷键都不能继续写任务。两端限制重复点击，旧读取／回执不得覆盖新 visit 或 action；
快捷随手记只按 visit 绑定成功回执，同 visit 的普通状态刷新不能吞掉已保存结果。
任务 delta 仅在已 paused 时追加 pomodoro 字段以刷新 resumeAction，Today 原订阅和快捷面板原刷新所有者保持；
popover 的 partial delta 遇 revision gap 仍重新读取完整投影，重开仍由原 projection store 读取；读取代次阻止旧结果覆盖新结果。
quick 对通过闭合 shape 校验的完整 scope 立即替换，允许跨 gap，并废止旧 read。首次 mount／重开以及 invalidation-only／不可用
payload 保留完整读取；重复和旧 revision 不重复读取。已见 revision 下界与本 visit 真正应用的 complete revision 分开记录，
同 revision 的完整消息仍可修复先到 invalidation 或不完整读取。替代读取尚未完成时不释放等待中的 command；被 accepted complete
push 替代后可结束该次等待，不能解除另一 command token。默认焦点属于 visit，未变步骤编辑器保留实际输入节点与草稿。追加／改名的成功回执按 visit、session／task／step 与提交草稿版本认领，
自身 complete push 不吞回执；后续输入、Cancel、新编辑器与同外观替换会话不被旧回执清理。

快捷候选行只消费 canonical `quickStartAction`，缺失或 disabled 动作不能调用；缺少 kickstart 客户端明确失败，不能回退到普通时长。
`impulse/quick-start-editor.mjs` 独占临时输入与 draft 身份，未变任务的推送保留原文字／版本，变更只失效不重绑。
面板原刷新者以 request generation 和已见 revision 下界拒绝旧读；命令另绑定 draft / visit / token，own postcommit 推送不吞成功回执。
Cancel 收回 UI 所有权，已发送操作仍按原目标处理，不自动取消、补偿或重试；同 visit 新草稿、重开和 dispose 后的旧回执、
焦点、提示、hide 与 finally 均不可作用于新 owner。窗口关闭失败保留真实成功并刷新可见计时状态。
idle 窗口仅为可澄清候选增加表单空间，仍受 work area 限制并可滚动；不新增高度 IPC。

热键只经 `platform/electron/quick-panel-host.js` 的 `claim()`：被占用（`register` 返回 false）或无法解析
（抛 TypeError）都换到退级阶梯的下一个组合，配置值与实际生效值分开显示，退级不回写设置。`rebind` 失败回滚到
旧组合，`dispose` 只释放自己的热键。热键是用户主动动作，DND 期间仍然可用。面板落在
`resolveFocusDisplay()` 选出的屏幕（焦点窗口 → 光标 → 主屏，跳过自家窗口），与提醒共用这份逻辑。

面板不新增写路径：它调用的 `state:get`、任务、步骤与会话命令（含 `pomodoro:kickstart`）只把 `impulse` 加进各自 allowlist；
`pomodoro:start` 自己原子设置 `nowTaskId`。唯一新增通道 `quickPanel:describeShortcut` 是 popover 查询。
热键、主面板、菜单共用 quickPanelHost.open。`quick-panel-pet-cue` 通过 `pet:sync` 的闭合 notebook cue 协调 depart/arrive/ready/saved/step/completed/reset；记录和完成反馈来自提交成功后的 effect。平台只临时移动宠物，不写 settings.petPosition；取消、快速重开和手动拖动有独立保护。`notebook-visit.mjs` 仅拥有表现生命周期，`take-note` 动作复用 Rig 的 write、paper、pen，归档状态不增加字段。低刺激与减少动效下保持原位置。
`windows/panel-reveal` 在 ready-to-show 后等 renderer 布局任务完成再显示，并用代际取消阻止关闭后的延迟打开。Windows 工具面板使用不透明原生窗口，避免透明合成器与阴影重建；macOS 保留透明圆角。主面板定位策略由 popover-window 拥有，main 只接线。

## 事实流与长期记忆

### 有界记忆检索

`createMemoryContextReader`、`memory-service.contextReader` 和 core 的既有资格谓词提供非修复式读取基础。已打开的权威只向reader提供冻结且保留receiver的 `all/get`、非修复式ledger状态及pending判断；不调用原gate、list、prune、receipt、写入或durability proof，也不打开新权威。管理、启动、恢复与原mutation路径保持原owner。
端口仅有 `readContextSnapshot({ids})` 和无正文的 `readContextForgettingState()`。前者要求明确的own data `ids`：只有 `null` 表示可信本机发现；显式选择最多8个唯一ID，缺失或失格一项即整体拒绝。`[]`返回空投影但仍执行完整权威一致性检查，不能称为零查询；后续recall消费者可在无选择时不调用。先按完整记录集执行原projection，再应用原资格谓词，保留冲突、隐私、时效与aggregate到期语义。service严格验证闭合结果并返回分离副本；传给回调的ID副本与结果校验使用的固定ID集合分开，回调不能扩选。
reader固定执行两次分离数据采集，比较记录、正文、版本、来源谱系、undo、receipt/outbox和owner/ledger/pending；不一致直接失败，无重试、修复或回退。重复身份、孤立或版本／回执／到期不匹配的undo、错误事件种类均拒绝；健康但已到期的undo仍原样保留。ledger领先或命中待清理内容返回待清理状态，异常权威失败关闭，不伪装空集合。这依赖可信同步只读DB端口及既有单写者生命周期，不证明任意重入／ABA驱动或外部并发writer下的原子快照。
500条只限制记忆记录，不限制累计receipt/outbox/遗忘历史；检查成本随保留历史增长，永久移除路径不能套用普通提交的2000条receipt限制。生产ledger状态读取仍可能检查文件及PRAGMA，“非修复”不等于“不访问文件系统”。本步无schema、索引、后台维护或新权威计数器；合成端口证据不证明真实SQL、WAL、fsync、持久化或物理擦除。

`application/ai/memory-recall` 只组合此reader，冻结discovery、selected、getVersion、forgettingState四个窄方法；用reader的sampledAt，不另设时钟或权威。授权owner可传入同步invokeSource，在读取方法属性及调用前后复核身份并保留receiver；本机无owner调用使用直接调用。它不是动态方法名派发或通用服务代理。空selected不访问reader，且不变成discovery。getVersion只返回ID、语义版本与资格，forgettingState无正文。原repository/service.search没有生产消费者，已删除实现及导出，不保留scope／recency／skip-to-fit／UTF-16查询兼容策略；Provider工具 `memory.search` 保留，通过当前grant和此facade执行。
本机发现保持subject与body拼接后literal匹配、toLocaleLowerCase、ID顺序和20条offset分页；Provider保持subject或body各自匹配、同样大小写处理和ID顺序。Provider在过滤和分页前检查全部明确选择：最多8条、正文合计1200 Unicode码点；两种查询均最多200码点，不新增词法排序或语义模型。既有fingerprint与对外字段不变，明确选择的work/personal记忆不被旧global scope策略替换。历史消息来源及候选修改目标现在也经过memoryEligible；无expiresAt的aggregate等旧getVersion可能放行的引用会失败关闭，这是有意收紧，不声称完全等价。
协作每轮在初始读取前建立一个私有、无正文的固定完整选择见证，仅保存canonical grant绑定、已选ID／语义版本及owner／ledger／sequence。它不是新cache、计数器、持久回执或第二生命周期权威，读取／repair／协商重试不得重新基准化。读后、每次实际发送前（包括onContextSent尝试使用记账及观察回调之后，即使回调抛错）、模型返回及接受结果前重新验证；未被某次query命中的已选项失效也整体拒绝。无害usage计数不修改语义版本；独立ledger sequence变化采取保守失效。原attempt预算和使用记账仍保留，后续拒绝不声称回滚已提交记账。
来源版本及历史消息资格回调沿原turn owner传递窄调用guard；回调替换本轮后停止后续来源访问，旧run不能撤销或完成新run。见证不进入read envelope、Provider payload、sourceRefs、披露、对话、候选或日志；来源仍只按实际返回／实际发送记录计算。资格复核不递归调用reads.execute，也不增加模型工具读取预算；完整工程、真实Provider与原生持久化验收仍独立。

以下保留长期记忆边界及后续索引计划；FTS/hybrid尚未实现：

保留现有SQLite记忆权威、语义版本、来源谱系、确认回执、outbox、短期undo及独立遗忘账本；先统一检索，不新增schema或迁移。
纯读取recall通过两个窄facade服务：本机发现只提供有界选择projection；Provider recall只接受application解析的当前grant及已选ID，不持有凭据、Provider或业务写口。现有`memory-service.list()`会先执行`pruneRecycle()`，不能直接充当模型纯读取端口；原保留期清理由可信生命周期owner按既有同意处理，不扩大删除范围。
Provider读取保持当前资格规则和全部所选记录有效的要求：active/contextAllowed、时效、privacy、scope、冲突和来源资格均须满足；任一失效或超限整体拒绝，不换入高分记录。保持最多8条、正文共1200 Unicode字符、查询200字符及Harness总预算；空选择不变成全库查询。返回当前ID/version、闭合投影、sourceRefs、availability/coverage和实际披露字段，排名不代表事实置信度。
在读取后、发送前、模型返回后及预览/确认前复核来源与遗忘状态。update/forget仍须针对本轮已选且实际读过的目标，由现有本机流程生成diff、hash、版本和确认；无后台提取、自动激活或冲突合并。语义版本、短期undo和无正文回执不构成完整历史正文档案；会话恢复、检索命中或模型输出不能恢复旧grant。权威/遗忘账本异常失败关闭，不伪装为空结果。
未来FTS须先验证打包SQLite能力和双语质量，再另定同库派生索引schema/迁移；正文从canonical读取，坏索引仅在权威健康时回退有界scan。FTS表达式转义独立于SQL参数绑定，短中文保留有界literal路径。本机hybrid只在词法不足且收益可测时考虑，固定模型/维度/hash/记忆版本，先比较500条规模的精确向量；不隐式下载模型、远程embedding/rerank或索引敏感来源。
所有未来索引/cache/vector/摘要须登记来源依赖及清理/重建方法，沿原ledger-first失效与receipt重试身份处理，晚到结果不得复活遗忘内容。两库不宣称原子提交，unknown/partial仍由原协议核对；不承诺清除外部Provider、旧备份或物理介质副本。

配置SQLite快照拥有业务状态；按时间查询的普通历史、已处理收件原文和记忆放在独立的 `im-adhder.sqlite`。
归档原文和确认记忆是用户权威数据，不是可丢弃缓存。唯一驱动入口为sqlite-database；支持node:sqlite及已有better-sqlite3。
无既有SQL权威时普通历史可使用JSONL；既有SQL或身份标记存在后绝不静默降级为空库。独立INITIALIZING/READY与application_id绑定
保护缺失/替换，全表、索引、约束与schema核验先于可写打开。WAL/FULL/FK和同步事务负责确认写入，普通时间线发布失败仍不能回滚已提交业务。
JSONL不具备已确认事件精确验证与记忆权威写入能力，对应outbox保持pending、记忆明确不可用。没有跨config/记忆SQLite的全局原子声明。

**时间轴。** 表 `timeline_events(id, occurred_at, day_key, kind, task_id, session_id, duration_ms, payload)`。
事件 id 确定性构造（`<kind>:<稳定标识>:v1`），普通追加事件重放靠 `INSERT OR IGNORE` 幂等；找不到稳定标识的事件就不记。
`routine.logged` 是明确例外：同一occurrence使用原业务提交revision作entityVersion，专用CAS同时更新状态、发生时间与日期；旧revision拒绝，同revision只接受完全相同事实。收件归档后的新revision不得替代原业务身份。
该例外不扩展到AI回执或任意事件。撤销仍删除唯一行，没有跨删除的永久重放墓碑保证。
payload 按 kind 闭合白名单，≤1 KB。domain 函数只**返回** facts，唯一写入者是
`progress/application/record-timeline`，由提交后的 publish 钩子调用。普通记账包括：
`session.started`、`session.segment`、`session.completed`、`task.completed`、`routine.logged`、
`routine.reminded`、`routine.missed`、`energy.profile-calibrated`、`inbox.captured`、`inbox.resolved`；
确认修改另有task.changed/routine.schedule.changed/ai.change.applied/ai.change.reverted，使用精确验证与可重放outbox。其他未实现事件不凭空生成。`session.segment` 与
`stats.dailyFocus` 同一套 `accountingSegments` + `splitAcrossLocalDays` 切分，所以当日条形总时长等于标量；
这是本功能最重要的一条断言。撤销日常打卡时用唯一的 `remove(id)` 删掉对应事件，它不是通用删除接口。
保留期 `settings.timelineRetentionDays`（默认 400，30–3650），每日重置时一条 SQL 清理。

`timeline:getDay` 是唯一历史查询，返回当日不可变投影（轨道、标记、区间、总量、`energyCurve`）。未知 kind
画成中性标记而不报错。投影保留 eventId、sessionId、causationId、commandId；缺失的旧身份明确为 null。
会话点事件只按匹配的明确身份折叠，已知但不同的 sessionId 优先保留，不允许按相邻时间隐藏独立会话。区间的伙伴状态线索由 `intervalMood` 从事件派生，不存储，也不声称是桌宠当时真实
播放过的姿态。

**长期记忆。** 新权威为按ID/version管理的memory_records；旧agent_memories仅作为一次迁移输入，成功cutover后旧写入与注入路径关闭。
UI用candidate/active/paused/removed区分建议与已确认内容，subject≤200、body≤500、总数≤500，容量满拒绝而不静默淘汰。
移入回收区保留30天，恢复先暂停；到期的单条范围自动永久清理，涉及额外关联条目或故障时隐藏过期正文并标记待清理，扩大范围须再次确认。
永久移除的ID/来源账本独立于普通恢复快照，先失效再清理正文、版本与派生副本。用户另行确认的记忆不随源对话删除而删除，界面明确说明。

旧 `recentActivityDigest` 仅保留兼容测试/确定性查询能力，不再自动汇总写入新记忆。其旧查询不经模型也不存库：专注分钟读 `session.segment` 的时长（点事件
没有时长），会话按 sessionId 去重，任务标题由本机任务表解析，解析不到的任务不发送（不把任务 ID 当标题）。
它只读专注、任务完成、放弃和摩擦几类事件，`routine.*` 从不进入，所以日常与用药记录不会出现在发给模型的
摘要里。没有事件时返回全零结构而不是 null。每次注入都带 `disclosure`（记忆 id + 摘要字段名），界面必须
能说出这次发出去了什么；`settings.aiMemoryEnabled` 默认关闭。

## 换装与伙伴形态

**换装。** `companion.appearance.equipped[group]` 三态：键不存在 = 沿用自动规则（组内已解锁的最高
`exclusivePriority`），itemId = 用户选的，`null` = 明确不戴。缺省即自动，保证老用户升级后外观不变。规范化
时丢弃未知组、错组 itemId 和已删除的引用（外观是装饰，陈旧引用不该阻止启动）。可选性在 domain 判定：等级
配饰看 `level >= minLevel`，皮肤配饰看 `unlockedSkins` 是否拥有而不是是否正在穿；未解锁返回 `item-locked`。
`selectAppearance` 是可选性与渲染的唯一实现，同时产出 `worn`、橱窗 `choices` 与合并 `bleed`；穷举测试保证
任意合法组合四边并集 ≤40 美术像素。橱窗数据走 `pet:getContent` 的既有投影；`appearance:equip` /
`appearance:reset` 两条命令，写集只有 `companion`。

**伙伴形态。** companion 的只读 form registry 为每种形态给出 descriptor：renderer 类型、`bodySize`、
四视图 face/anatomy rig、配饰锚点与槽位、`artBounds` / `hitbox` / `bleed`、气泡布局、动作映射与回退。
`presentation/form-art.mjs` 按闭合 artist map 分派：团子兽默认走 `dango-raster-production.mjs` 的生成 PNG 分层画笔，
乌沙奇走 canonical SVG 编译的身体/脸 Rig，并叠加生成衣柜；pet renderer、
popover 形象、形态选择和换装只消费解析后的 form 与不可变 appearance 投影，不按 skin ID 分叉。命中矩形、
吸附可见矩形、四边 peek 与气泡布局都由 descriptor 派生；两种当前形态均按真实 CSS 尺寸 × DPR 栅格化。
团子兽原生矢量原稿与画笔保留作回退开发依据和参考，不是当前默认分派；历史 33 格画笔只供旧资产/对照测试。
默认形态的 `profile` 兼容选择被限制为双眼三分之四转身；55 项行为/会话采用显式允许朝向，不再强套完整侧脸。

换形态先按 `projectSkins` 投影的 `formId/formName` 选择种类，再在该种类的网格中预览解锁形象。
`unlockLevel` 只标等级条件，非等级奖励仍标成就；已有解锁规则不改变。预览不写状态，确认仍复用
`switchSkin`，写集只有 `currentSkin`。乌沙奇 2.0 使用已编译的四视图 rig。

Windows 拖动由 `platform/electron/pet-drag-session` 保存一次原生 DIP 光标与窗口原点；后续目标位置
以原生光标差值求出，禁止把 renderer 的 `screenX/screenY` 当成同一坐标系。取消、释放、窗口隐藏
均结束会话。菜单扩容按工作区裁定尺寸并保留半像素中心；renderer 串行处理扩容响应，面板限于视口。
Windows 的程序化改尺寸不切换 `resizable`，避免透明 HWND 原生边框重建的闪烁。

乌沙奇 2.0 的身体、脸与活动骨骼唯一来源是分层 Rig（`assets/companion/usagi/rig/usagi.rig.mjs`，见 PET_RIG）。
生成衣柜不重画 canonical 身体/五官：17 件生成款与 8 件经典路径款组成 25 个选择，沿用七槽、等级和装备三态。
`assets/companion/usagi/wardrobe/usagi.wardrobe.mjs` 由保存来源和运行时适配描述编译；80 张原始提取 PNG 与
4 张可逆星弧适配 PNG、61 张衣物深度修订 PNG 共保留 145 张，当前引用 105 张，旧层保留溯源。
衣物通过显式 `wrapsBody` 声明调整远手层级；近手在整套前层完成后只补画一次，不因每件配饰重复。
普通身体 sprite 继续缓存；团子兽活动肢根的 `bodyForeground` 使用静态栅格轮廓裁切后补入原始肢体像素，
不得把动作相位塞进缓存键或每帧复制可变离屏 canvas。
旧九帧适配器、退役角色矢量身体均移除；专属 support 仍只负责服饰、动作偏移与点缀。
乌萨奇与三件原有专属配饰 Lv.1 可用，
`skin-availability` 是唯一的可用性规则；形态仍写 `currentSkin`，不新增持久化路径。

**异步素材与缓存。** `raster/source.mjs` 按版本化资源 URL 管理 `loading/ready/failed`、解码预算、订阅和释放；
`ready()` 等待请求结束，不把失败隐瞒成可绘制，调用方仍检查 artwork 的 `ready/pending/missingAssets` 与失败统计。
团子兽分开报告 `layeredReady` 与完整 `ready`；加载中可画同源 neutral PNG，身体缓存键只跟原稿版本、
静止/跑步身体、核心加载状态和已被衣物替换的部件变化，不随时间、表情或无关资源完成次数增长。
乌沙奇衣柜只有当前选择的生成层全部 ready 后才替换经典服饰/隐藏原脚，失败或未完成保留 Rig 与经典画笔。
其 artwork 顶层必须透传衣柜 `ready/pending`，让静态预览注册冷启动重绘；只嵌在 `wardrobe` 下会留下旧画面。
身体缓存包含 `rig:id@version`、衣柜版本与隐藏骨骼，不能包含动作相位；有 Rig 时无活动动作也要绘制活动层。

**肖像 fit。** 身体、脸和服饰必须使用同一个实际穿搭并集；fit bounds 进入身体缓存键，按当前 DPR 重建画布。
肖像把静止 Rig 活动部件画进身体缓存，前层衣物之后再画相同静止手部；桌面由实时动作层盖回手部。
hero、缩略图与换装预览订阅素材完成事件，在 cold → ready 后重绘并在 dispose 时清理订阅，不能依赖下一次用户点击。
这些呈现变更不改变舞台、命中框、窗口尺寸、状态所有权、schema 或 IPC。

**来源与打包。** 公开树保留运行资源、编译输入与必要校验资料，不包含完整历史母图/参考/评审证据。不能承诺从公开树重建完整美术来源。Electron 的 `build.files` 排除
`assets/companion/dango/raster/sources/**/*` 和 `assets/companion/usagi/wardrobe/sources/**/*`，运行时 PNG 与编译 manifest 仍需打包。
`test/pet-raster-package.test.js` 用真实 electron-builder `FileMatcher` 检查两个 manifest 的所有活动 PNG 引用被包含、
两个来源树中存在的文件被排除；所有活动 PNG 引用必须包含。该资源过滤回归不等于已构建或验收原生应用包。

这不是任意角色零代码插件：新身体要登记 descriptor、专属 painter、skin/appearance 内容和两个 surface 的测试，
远程内容不得携带 painter 代码。Usagi 素材不由项目 PolyForm 许可重新授权；其 USAGE 与根目录 LICENSE-SCOPE 保留第三方权利限制，不据此确认权利人许可。

面板共同视觉变量和组件状态只由 `styles/theme.css` 的 theme 层定义；旧 refined/workspace/daily-companion 三份叠加主题已经移除。表单、日常、图鉴的结构归 features 层，样式层序保持不变。
`ui/panel-navigation.mjs` 拥有主导航、安排子导航、局部键盘漫游和返回位置；不写入持久化状态。`state/action-presentation.mjs` 从只读执行投影生成当前动作、状态标签，不结算会话。`features/inbox-preview.mjs` 只保留当前预览 ID，内容仍存在时不因新消息替换，不创建定时器。
`ui/energy-path.mjs` 将只读采样值转换为保形三次曲线路径，控制点不超过相邻采样范围；`energy-strip` 负责窗口对齐、已观测区域裁剪、未来虚线和事件标记，不修改能量估算。任务编辑的折叠日期与属性复用既有输入、差量 patch 和重复任务作用域，不新增状态契约。
`ui/surface-motion.mjs` 延迟加载生产依赖 GSAP 3.14.2，负责弹层与消息切换的 transform/opacity 入场；每个调用方拥有独立生命周期，以 matchMedia/context revert 清理，响应系统减少动效和产品低刺激设置。动画不阻塞表单提交，不需要 CDN。
收件箱在「安排 › 收件箱」管理，现在页「今天」一栏提供数量与捷径，底部输入负责捕捉。`features/today-overview.mjs` 只拥有「今天」三块（能量、日常、收件箱）的展开状态与收件箱捷径：同一时间只展开一块，有到时间的日常时默认展开日常，能量从不自行展开，本人选择后不再被投影覆盖；读数各归 energy-strip 与 routines。收件卡片的分类、日常类型、能量档位和目标日常都是本地草稿，主操作时随命令一起提交。`ai-configuration.mjs` 保存本地草稿与回执；模型/地址一次写入既有 settings 命令，密钥单独进入既有安全存储，任何部分失败都如实提示。
投影刷新不能覆盖未保存草稿；命令回执先于投影时保留已确认值，后续匹配投影到来后释放。
`features/task-editor.mjs` 独占编辑草稿及每次open的display身份，同task重开也不复用。任务、未来规则与系列状态保存共用本display的单轮operation owner；
在调用scoped client前捕获，只有仍属当前display的owner能处理success/error/finally及busy控件。open/close/dispose使旧owner失效，
关闭只撤销UI归属，不取消、重试或反向补偿已发出的业务命令。排队focus及步骤行回调绑定display，旧步骤列表重排/移除后也失效。
差量patch、remove→rename→reorder→add顺序、已完成步骤限制及显式recurrence scope沿用原合同；没有新的canonical状态、IPC、workflow或存储写入。
模块超过300行的既有提示仍保留，新增逻辑仅管理同一编辑器的草稿、提交和DOM归属，不抽成共享状态权威。
没有新增状态路径、schema 或 IPC。`aiClarifyEnabled` 继续由 guidance 设置契约拥有。
时长滑杆预览不落盘，松开后串行保存；启动等待保存回执，错误时恢复已保存值并阻止误启动。

## AI 与 LLM

### 有界执行

共享 runner 复用七个既有场景的预算与取消机制，不引入通用写工具、第二份状态或额外 Provider。静态只读 registry 的权限取注册能力、场景与当次 grant 的交集；相关性不等于允许读取或外发。模型输出是回答、受限读取请求或不可执行候选，业务写入仍由原 capability 的确认/opt-in 工作流拥有。外部 Agent/记忆框架、FTS、hybrid 检索、图片和新增长上下文 UI 均不是当前实现。

场景保留各自schema、prompt补充、字段披露、工具子集和fallback。协作保持6读取/5 HTTP/180秒、64KiB、8000字符及50来源；每次结构化生成最多一次校验反馈重试，不是整轮共享一次repair计数。一次性拆解/补全/卡住和capture使用0读取/最多5 HTTP/每次生成1次反馈重试，沿用既有超时且最多180秒；原协议阶梯另以实际client专项验证。pet-meal保持0读取/1 HTTP/0反馈重试/5秒，仅虚拟宠物字段，继续区分1024字符输出与纯格式修复的1024 UTF-8 bytes边界。补全无真实模型不填模板、capture的NO_FALLBACK及人工优先均保留。
预算基础组件允许`maxReadCalls`与`maxRepairAttempts`为0，其余字段仍要求正整数且不能超过原上限；默认值和会话存储常量不变。
零读取的预算消费立即拒绝并保持读取计数为零。零反馈重试不禁用首次纯格式修复或协议协商；所有真实HTTP尝试仍须各自计入请求预算。
这项表示能力本身不代表场景接入；以下分别说明已有协作与一次性场景的应用接线，pet-meal及最终聚合验收另列门禁。
`application/ai/run-execution` 提供执行基础组件：共享预算与期限、取消信号和每次异步操作的存活范围；
`check`只检查执行状态，调用方的新鲜度断言可调用它而不会递归。授权、来源校验、披露、回退、会话与业务写入仍归原拥有者。
操作控制在调用新鲜度断言前后检查取消与存活状态；结束边界是同步抛错、首次观察到Promise完成或中断，不承诺早于生产方已排队微任务。
guard的终止清理先封闭工作，再独立尝试取消定时器与移除监听，返回冻结且可重复读取的有界结果；`unconfirmed`不等于已释放。
初始化端口失败只给出有界阶段与清理状态，不复制任意错误正文。正常时钟顺序保持，终止与初始化回滚属于明确的防护增强。
协作入口已使用此执行组件管理读取／Provider操作。协作拥有者在接受用户消息后注册本轮身份，
在注入端口返回后、下一次取消／撤权／披露副作用前复核身份；旧操作的发送回调及用量回调在操作结束后失效。
这些调用前检查本身不证明会话内部重入安全；真实接受点的候选／票据核验、scope清理及设置／凭据协调见下文会话转换与「全局授权协调」合同。
成功完成会话后先固定已接受结果，元数据或清理异常不能再触发本地回退、第二次完成或本轮取消；合法的全局历史隐私撤回不受此限制。
开始后的执行初始化失败返回有界阶段和取消核对状态，保留已接受用户消息，不伪造助手回答；没有执行实例时用量各项为未知。
所有开始后的正常返回附带独立`cleanup`结果；初始化回滚或清理未确认不能说成资源已释放，也不能用来推断历史撤权或持久保存成功。
预算与执行组件的`counts()`只返回既有读取／Provider预算消费计数的冻结快照，不读取时钟或触发新鲜度检查，终止后仍可查询。
这不是实际HTTP完成证明，也不替代`usage()`；协作最终披露只采样一次时长，采样失败或非有限值使用`elapsedMs:null`，保留已知计数，不以零冒充未知。
上述容错只覆盖初始化与最终观察元数据：执行中及catch分类的重复时钟异常仍可能拒绝且未修复canonical generating状态；finally仍关闭本轮执行并只移除相同拥有者。

**一次性场景执行。** `application/ai/one-shot-provider-run`只承接breakdown／enrich／unstick／impulse-energy／capture-triage五个名称，
通过同一执行组件管理零读取、最多五次POST及每次生成一次反馈repair；显式零repair不丢失。bootstrap向proposal-preview／classifier注入它，core不反向依赖application。
旧core runWithFallback计时器／导出和classifier直接调用旁路移除。原requestScope lease、目标检查、proposalStore及workflow写入者保持原所有权，适配器不签发权限也不提交业务。
期限采用既有client.timeoutMs并保留180秒上限及更短配置；真实client的整数超时规范不改，畸形／小数测试端口值作为显式输入拒绝。
不把预算默认8000字符自动转发成新输出限制；仅转发明确提供的maxOutputChars，原传输大小限制、专用schema和本地规则不变。
每次发送只消费一次POST预算，消费前后核验owner与操作存活；消费时钟重入后新增一次owner断言是防护增强，不宣称旧断言次数完全等价。
owner失效／调用方取消／初始化失败不产生本地回退；远程期限到达仍可走原本地规则，使用原调用方signal与新鲜度检查，不能让已过期的远程guard禁止合法本地回退。
捕捉分类的NO_FALLBACK仍不给出猜测结果，补全的fallback标识仍阻止界面填入模板。迟到发送／usage回调失效，trace与usage观察失败不引发额外模型尝试。

一次性适配器返回闭合成功／失败union和冻结cleanup：成功保留proposal／provider／fallback／有界reason；失败只含有界reason与必要setupStage，不返回任意Error、cause、stack或验证器正文。
未知异常与旧原始reason后缀收敛为公开代码，属于明确的诊断合同变化。proposal／classifier及后续新鲜度拒绝保留cleanup；清理未确认不能触发重试或否认已完成的工作。
该报告只描述执行组件资源，不冒充外层lease或持久化证明；store／workflow异常仍按原owner处理，不能被包装成“未尝试写入”。
原trace拥有者也隔离sink、时钟和元数据反射失败，保留字段白名单；诊断时长未知时省略elapsedMs，不以零补齐，也不能让已验证输出因日志失败再次repair／fallback。

**用餐场景执行。** 实际companion-meals编排直接使用原advance／resolve workflow与共享执行组件，移除局部attempt计数、五秒Promise.race计时与取消等待器。
预算固定零读取、一次POST、零反馈repair、五秒；保留1024 Unicode码点输出与独立1024 UTF-8 bytes初次repair两道限制、五个虚拟宠物字段及原默认关闭设置。
调用后无有效beforeRequest的成功假client不被当作模型建议；协议协商也不能绕过一次POST限制。组件以受控微任务调用Provider，取消发生在进入前时不再触发客户端／凭据读取。
远程期限或普通模型失败可用原规则，owner／lease／配置／决策失效不能apply；先计算context，再在同步resolve入口前复核原请求、current和signal。workflow内部clock／UoW回调未由此补丁重写。
原250ms有效性观察和五分钟采样仍由runtime持有，不是第二份模型deadline；外层lease保留至resolve之后，预算消费后再次核验owner但不重复消费。
控制器、lease、组合signal、观察器和执行组件统一保护式获取，观察器即使登记后抛错也尝试清理；终态观察回调在读取任何owner前返回。
初始化失败返回闭合run-setup-failed／setupStage，不请求模型、不resolve、不回退；此前advance已提交的预留不退款，不被描述为零写入。
cleanup分开报告execution的timer／listener、observation、lease，以及controller的not-acquired／aborted／unconfirmed逻辑状态；一项失败不跳过其他清理。
cleanup.ok只描述这些追踪资源与控制器逻辑abort，不证明AbortSignal.any原生桥接监听全部释放。已成功resolve不因清理不确定而重试、补偿或改变库存／额度。
取消/撤权/来源失效不能成功回退，普通失败按场景原规则处理；未知提交只按原身份核对。日志仅白名单元数据，无正文、凭据或新trace出口。prompt中的来源是数据，不能替代主进程授权；3–7步等专用schema不能被共用短回复规则覆盖。
图片设计须opaque ID、受控读取、可见发送选择及来源删除，不自动读取剪贴板/外链或换Provider；长上下文区分完整transcript和有界prompt，先用确定性摘要并说明coverage，不隐藏模型压缩请求。列表复用catalog，不建第二库或默认模型标题；quick模式切换不提交/发送，保留Tab漫游与IME。hide后继续属于待定行为，当前close暂停/取消不变，重开不重复发送、重启不重放。

AI 是增强项，不是必需路径：默认关闭；关闭、无密钥、无模型名、超时、断网或校验失败时，拆解、补全、卡住和
澄清都落到确定性结果，给出真答案而不是一句道歉——**补全例外**：确定性结果只是对谁都一样的模板，渲染层不把它填进草稿
（`task-draft.applyEnrichSuggestion`），只提示先写下第一个看得见的动作。唯一开关是 `aiBreakdownEnabled`，不存在“半配置的网络调用”。
renderer 不直接访问任何模型服务。

`core/llm/` 分四层，应用层的Provider执行调用仍只经`index.js`。
`contracts.js`是显式的纯静态合同入口，仅按原对象身份导出`COLLABORATION_TASK`、`validateCollaborationResult`与`validateTaskDraft`；
它不创建client、不协商协议，也不导入传输层。应用读取这三个合同不必加载出网实现；其余内部执行模块仍不作为应用层入口。

| 层 | 文件 | 职责 |
| --- | --- | --- |
| L1 出网 | `transport.js` | HTTPS、SSRF 黑名单、DNS 预解析并钉死地址、仅 443、超时、响应上限 |
| L2 协议 | `openai.js` | Chat Completions 与 Responses 两种形状、两条降级阶梯、严格模式 schema 子集 |
| L3 编排 | `repair.js` + `generate.js` | 产物规范化、能力协商、校验失败回灌一次 |
| L4 任务 | `tasks.js` | breakdown / enrich / unstick / clarify / collaborate / impulse-energy / capture-triage / pet-meal 的 instruction、schema、披露字段、repair、validate |
| 观测 | `trace.js` | 编号、格式化、脱敏 |

**协商。** 路由与 schema 能力都在运行时探测，互相正交：404/405 表示路由不存在，换 `responses`；对面点名
拒绝 `response_format` / `json_schema` 时从 `json_schema` 降到 `json_object`（schema 整段贴进 system prompt）。
先看是否点名参数，再看是否路由缺失。401/403/429/5xx 与超时两条阶梯都不触发。谈成的协议记在内存 Map
（键 `baseUrl`），谈成的档位按协议分开记（键 `baseUrl#schema-mode:<protocol>`），都只在答案通过校验后写入，
不进 `config.json`，重启重新探测。

**严格模式。** 发 `json_schema` 前经 `strictSchema()`：去掉 `minLength` / `maxLength`，`const` 改单值 `enum`；
根节点必须是 object（clarify 因此把 need-more / ready 平铺成四个可空字段，`repair()` 再折回联合类型）。
被去掉的限制由本地校验器照样强制。`json_object` 档位贴进提示词的是完整 schema。

**失败处理。** 纯编码约定（下标从 0 还是 1、多余字段、字符串数字、代码围栏、枚举大小写）在 `repair.js`
修掉；产品承诺（标题不在 schema 里、标签锁在现有集合 enum、3–7 步、每步要有动作词）硬拒，给回灌重试留下
原话。回灌只有一次，并与协商共用同一条截止线：默认等待与硬上限都是 180 秒，两者保持为两个常量，
`IM_ADHDER_AI_TIMEOUT_MS` 不能越过上限。

**proposal。** `breakdown` 只给步骤，`enrich` 另给完成标准、能量、估时、标签；两者共用 client 选择、
`runWithFallback`、`ProposalStore`（按 kind 分发校验，最多 5 条、10 分钟）和披露接口。披露是任务的属性：
`fields` 与 `buildInput()` 在同一对象里，测试断言两者相等，并集常显在设置面。应用建议只有两条出口：带
`targetTaskId` 走与 `tasks:update` 同一个 `applyTaskUpdate`，否则走 `createTaskFromInput`；目标不一致即拒绝。
步骤 schema 由 `core/llm/validate-steps` 的纯工厂生成，每次返回独立的嵌套对象。临时建议缓存由
`application/ai/proposal-store` 拥有，经 application 门面注入；它不持有确认权限，也不替代 guidance 的确认票据存储。

**请求取消与代次（REV-PRIVACY-002，重新实现）。** `createApplication` 持有一个仅运行时的
`application/ai/provider-request-scope`，随应用关闭永久关闭；proposal preview、energy/triage通过注入的窄端口取得lease。
lease捕获Symbol代次，失效时同步取消所有旧请求；关后再开或模型/地址改回也不能复活旧结果。release只释放本次lease，
invalidate先快照旧集合再取消，避免abort回调重入误取消新代次。此scope不授予数据权限、不写业务状态，协作原有guard与授权代次继续独立执行。

设置更新成功且八个AI请求相关键（含aiPetMealsEnabled）实际变化才失效provider scope；原五键的成功patch仍执行原collaboration失效规则，
包括同值patch。energy/triage/meal用途开关不清conversation grants。密钥导入、替换、清除只有成功后才失效；失败提交、
非法或无关设置不取消仍合法的请求。删除、来源撤回、记忆权威、确认与回执的既有规则不在本次改动范围。

远程拆解、补全、卡住、能量与分拣均传signal和发送前assertCurrent；modal取消与scope取消合并，finally释放lease。
提案在异步生成返回后、入确认槽之前再次检查；energy/triage工作流另持同一scope的lease覆盖classifier返回至同步UoW的间隙，
提交前核对后再释放，不增加写集。取消不能变成本地fallback接受旧结果，普通失败与截止时间仍保留原本地fallback。
`beforeRequest`每次POST只调用一次，以保留协作尝试预算；POST前后检查signal不依赖callback是否存在，schema/协议/repair都服从取消。
传输等待从DNS起覆盖取消与180秒硬上限，取消立即结清，迟到DNS resolve/reject不能建立HTTP；HTTPS、公网检查、DNS钉住和响应大小上限不变。
现有Provider组合抽到`bootstrap/proposal-assistance`，main只注入共享scope，棘轮收紧为2486行/21个require/72处IPC注册。

**随手记分拣。** 面板底部的随手记和快捷面板写进同一个收件箱（`impulses:add`）。设置里开了“用 AI 分拣随手记”
（`aiCaptureTriageEnabled`，默认关，受 AI 总开关约束）时，`application/workflows/triage-capture` 在保存后发一次
`capture-triage`：只发这一句原文（`impulseText`），得到 task / routine / log / state / feeling / note 之一、
置信度和按类别才填的字段（标题、日常种类、五档状态）。置信度 ≥ 60 才以 `impulse.triage` 挂回这条闪念，写集只有
`impulses`；它只是建议，不改文字、不移动闪念。任务仍经 `impulses:review`，情绪经 `impulses:keep-mood`，日常和状态改由
`impulses:organize` 原子完成目标与原文历史，见「收件分类与原文历史」。不再使用 renderer 先建目标再删原文的两个独立请求。
模型不可用时没有本地猜测，闪念显示未分类，仍可人工选择；动作词本身不证明是任务或已完成日常。

卡住请求中的 `taskEnergyDemand` 只表示任务需要的投入，不表示当前自评或估计；未提供的当前状态不可从任务需求或情绪推断。

**共享协作。** 新任务与卡住入口共用 `features/draft-conversation` 及 `application/ai/conversation-sessions`。
默认仅本次；关闭暂停并取消生成，不销毁记录，用户明确选择后才把完整快照保存到独立的 `collaboration.sqlite`。
单条发送最多8,000个 Unicode 字符，尚未发送的本机草稿最多64,000；单段100个来回或512KiB，达到时带来源摘要分段，
不强制结束也不自动开启保存。第30轮只给一次可忽略的提示。保存会话默认30天，可固定；canonical快照最多32MiB，
达到容量时明确保留现有内容并请求另开会话，不静默裁剪。每条 assistant 回答和提案都以稳定消息ID/序号进入历史。

`bootstrap/ai-collaboration` 只组装静态 IPC、Provider、会话与读取端口。`context-grants` 在主进程签发绑定 profile owner、
会话、Provider指纹、授权代次、目标ID和日期范围的临时范围；运行时令牌绑定 turn/request/授权代次。关闭、取消、换模式、
撤权或更换Provider/密钥立即失效在途结果；恢复不恢复旧授权，旧来源依赖内容须重新获得当前读取证据才能进模型。
`context-reads.execute`必须接收同一grant拥有者，通过当前成员身份解析调用方的绑定字段；工具、目标ID和日期选择只取拥有者保存的冻结对象，
不信任传入投影中的selection。结构性的`authorizeRead`不能代替实时签发资格。解析时钟返回后仍须是原map对象，同ID重签也不能接续旧读取。
读取快照、资格时钟、每页记忆、时间轴及能量端口前后和最终返回前重新核验同一对象；端口抛错时也复核，撤权拒绝优先于unavailable回退。
已失效的本次读取不再调用后续来源，不返回正文；已经开始的来源操作无法撤回，原memory.list维护副作用仍存在，不能据此声称recall零写入。
这些检查沿用现有Provider指纹和会话绑定，不另建epoch；全局准入与提交后的撤权由下述单一应用协调器负责，专项证据不代替完整应用验收。

会话的撤权、取消／暂停及模式切换由原sessions拥有者先准备隔离候选和时间，复核entry／record／revision／授权代次／active身份，
再同步应用完整canonical记录并退役捕获的旧token，最后通知旧signal及尝试保存。abort观察者不能看到半写入状态，旧操作不在通知后再覆盖新记录。
通知后目标已被替换或推进时跳过旧保存；此调用前检查不替代既有持久化内部回调、pendingSave及精确提交核对协议。
已应用结果保持`ok:true`，独立`transition`报告applied／revision／notification／persistence；目标已移除时conversation为null，不返回脱离拥有者的旧正文。
复合access操作若已完成退役却未签发新scope，返回`scope-not-issued`并保留applied证据；界面清除旧grant／预览、保留输入，不能把它说成取消未确认或自动重试已完成动作。

撤权候选准备失败时，仅对仍相同的entry标记运行时`contextEligibilityPending`并退役旧请求，canonical记录和revision不由该失败候选改写。
本机历史仍可读，投影屏蔽旧来源上下文且新turn拒绝准入；open不自动重新签发grant。显式应用参考范围需先成功完成新的完整撤权准备，才解除标记。
标记仅属于现有有界entry，不新增存储schema、回执日志或第二权威；部分来源撤权不能清除完整隐私待处理状态，重启也不是失败保存或旧清理成功的证明。
上述候选准备不承诺owned／retention零副作用。begin／complete同样在候选准备后、真实canonical接受点复核entry和准入票据；
分段轮换仍保留原保存责任，已确认的保存不会因后续拒绝而被否认。已接受结果携带稳定的`acceptedMessageId`，通知不能从更新后的历史末项猜测本轮身份。

**全局授权协调。** `application/ai/collaboration-authorization`接管原providerEpoch，而非另加一套代次；bootstrap只注入同一实例及窄拥有者端口。
设置／凭据操作先暂缓新turn、grant和scope准入；这个提交前屏障不使既有请求或grant失效。成功后才按原规则推进代次、撤回权限，失败写入保留原工作。
设置workflow的可信第二参数`onSuccessBeforePublish`在成功结果规范化后、publisher之前执行，包括成功同值patch；它不是renderer payload字段。
五个协作键仍按提交键存在性失效，八个request-scope键仍按真实前后值变化处理；独立request-scope代次不与协作代次合并。
来源和ID／时钟端口返回后重新核验原票据；完整嵌套撤权结束也不能给旧准备过程换一张新票。现有请求／完成使用既有工作检查，新接受／签发使用准入检查。

协调器只捕获本次cached session、scope和run的身份集合，先取实际active-token匹配计数，再清grant一次并封闭所有捕获run和隐私目标，才执行任何可能重入的清理／通知。
每个去重conversation最多尝试一次隐私转换；run关闭不再自行取消／撤权会话，scope只移除相同捕获身份，旧skip-list二次撤权协议移除。
canonical已接受但turn结果尚未返回的回答不计为待取消请求，仍可合法撤回其历史模型资格。初始化尚未返回的执行不能被虚报已释放，返回后必须在继续作用前关闭。
捕获记录只在本次同步转换存活；没有历史receipt表、缓存pinning、第二持久化权威或自动重试。scope原集合无新增固定容量限制，不能把有限快照说成固定数量上限。

设置／凭据已成功时保持`ok:true`；`authorizationWarning`只含固定code、pendingConversations／unsavedConversations／unknownSaves／unconfirmedClosures／unconfirmedNotifications及authorityUnavailable。
计数为非负safe integer或未知null，不含会话ID、正文、端点或错误原文。运行时权限待处理、保存未知与资源清理未确认分别说明；保存未确认不等于实时撤权失败。
连续设置／凭据结果按同维最大值保守合并，null保留未知，不声称跨两次转换的唯一会话总数。凭据已提交而status读取失败用`credentialStatus:unavailable`，不编造configured:false。
两个设置界面以请求和生命周期身份约束异步结果；旧响应不覆盖新编辑／状态，销毁重建后旧设置响应不能继续提交捕获的凭据。
关闭时协调器只封闭运行时／grant／scope，canonical暂停与保存由sessions.dispose一次完成；不再先对每个scope额外持久化一次历史撤权。
因此磁盘contextAllowed字节不承诺与旧关闭序列相同；重开仍由原restored-source投影和全新授权约束，不能把重启当作旧保存／清理成功证明。
已发送的外部请求无法撤回，清理报告不是Provider确认、退款或持久保存证明；初始owned／retention、存储内部回调及真实bootstrap运行仍按独立门禁验证。
本轮可选任务、收件和普通日常，每类最多50条；默认仍仅当前任务，当天专注汇总须另行勾选。主进程列出本地候选并重新验证ID与版本；日常中的用药、兴奋剂与自定义敏感种类不进入此范围。
生产授权只覆盖今天，任务、收件、普通日常、专注汇总、明确选择的长期记忆和安排偏好共用6次读取预算。长期记忆仍须总开关与当次选择，完整store不在授权范围。活动读取使用失败可辨的queryRange适配器，不可用不能说成没有活动；JSONL可提供普通历史读取，但不能证明确认写入的可靠事件投递。

Provider新增闭合 `collaborate` envelope：answer、readRequest、changeProposal 的非活动字段为null。
每轮最多6次读取、5次真实HTTP尝试（协商与修复也计数）、180秒共享截止线、64KiB有界上下文；报告实际可得用量，未知则未知。
历史、摘要、工具结果都是引用数据，不能签发授权。模型不能调用commit、任意SQL、IPC或路径。模型可返回任务草稿或闭合operations候选，后者不可包含应用opId、hash、版本或确认字段；所有既有目标必须来自本轮真实读取。聊天不自动开始计时、不完成任务、不改奖励。
旧 `ai:draft-turn` / `ai:draft-discard` 兼容入口由同一协作组装承接；旧六轮会话仓与澄清编排已移除，恢复只走共享会话仓。

**确认变更与可靠回执。** `conversation-changes` 从拥有者的真实历史加载提案，重新核对Provider、权限代次、范围和来源版本；模型文本不是确认。`change-set-service` 在主进程分配稳定operation/group/change ID，以完整旧新差异生成operations/preview/disclosure三种hash。编辑或取消一项产生新proposalVersion，确认只能携带这版身份与hash，不得夹带新操作。预览15分钟有效，最多50份；关闭、换范围或撤权清掉待确认权威。重复确认先查持久回执，重启或丢响应不重做业务。

首批闭合操作为task.create、task.update、task.steps、inbox.convert-task、inbox.keep、routine.schedule。步骤不能借提案改变完成状态；任务保留当前/后续系列规则；日常只允许尚未到时的普通排程，不能写日志或用药参数。`apply-ai-change-set` 一次UoW写tasks/recurrenceSeries/impulses/routines/energySignals及guidance拥有的aiCollaboration；完整normalized候选必须与预览一致。config schema追加16。撤销先核对提交后版本，重做新差异和确认，只开放安全补偿；创建与收件消耗不假称可自动撤销。

回执、操作去重身份和metadata-only outbox与业务在同库提交。详情/撤销7天到期，启动、读取和30秒本机维护执行清理；清理失败也不能在查询中返回过期正文。去重身份不随详情过期删除，512回执/2048待发事件/8MiB容量到顶时明确拒绝，不静默丢权威。`change-outbox-publisher` 每次最多25项，SQL精确比对已有同ID事件后才独立确认；丢确认只重投同事件，绝不重跑业务。JSONL或故障保留pending。时间线只是可重放投影，不替代回执。

fact SQLite追加3并保留前两条迁移，确认事件含原始timezone/offset/day、因果ID及实体版本；旧行缺失字段保留null。损坏、未来版本、截断或备份失败保留DB/WAL/SHM，不能创建空SQL/JSONL冒充历史。协作SQLite语义版本追加2，既有v1数据先核验与逐字节备份，新增routine来源引用不改写既有历史。

**可恢复会话存储。** `profile-identity.sqlite` 在本机profile取得单实例锁后，通过SQLite FULL事务产生稳定不透明ownerId，不使用窗口sender身份替代。
独立SQLite权威仓使用 WAL / FULL / FK，闭合 load/listPage/saveSnapshot(expectedRevision)/reconcileSave(snapshot, expectedRevision)/delete/pruneRetention 端口；
只读预检拒绝未知未来版本、错误owner和损坏，迁移前逐字节备份主文件及WAL/SHM，失败不覆盖，不降级成空仓或JSONL。
新profile身份由独立SQLite FULL事务提交并只读重开核验，不依赖POSIX目录句柄。现有库升级先把主文件和WAL/SHM的精确字节、长度、hash与版本写入独立WAL/FULL备份容器并重新核验；失败不能打开源库写入。恢复读取只返回已验证字节，导出目的地必须由调用者明确提供，不使用备份metadata中的旧路径。Windows目录EPERM不再阻断此升级合同；macOS/Windows原生与物理断电恢复仍需专项验收。
协作SQL4仅追加`collaboration_durability`单行非负safe-integer计数器；会话快照仍为1，旧SQL1/2/3的原迁移不改。
旧版本按对应schema/owner/记录只读预检后，先核验`.schema-<old>-to-4.backup.sqlite`内原DB/WAL/SHM逐字节备份，才可打开源库写入；不拓宽兼容入口。
初始0只接受真正无schema对象的空库，READY所需文件或schema丢失仍拒绝。旧build拒绝4；回退须使用核验备份、显式选择目标，不能自动覆写源库。

COMMIT抛错后，repository私有保存不可变的精确before/after七列（含原序列化snapshot）和expectedRevision，先结清原事务，
再用独立只读连接核对committed／rolled-back。随后新连接验证WAL/FULL、BEGIN IMMEDIATE内重核同一结果、CAS递增计数、
成功COMMIT后再独立读回同一行和精确计数；任何一步失败保持unknown。相同revision但不同文本／元数据、无关高revision都不是原提交证据。
证明只改计数，不写业务行或逻辑revision；每次启动也对已保存行执行该证明。计数溢出拒绝，不重置。
`:memory:`仅为测试夹具复用handle，显式挡住原业务或证明事务的未结清rollback，不能把同连接未提交行当成持久证据。
unknown期间阻止新save／delete／prune，受影响load拒绝、saved列表明确不可用；被阻挡的其他会话不制造自己的pending回执。

逻辑revision、最近已证savedRevision、私有pendingSave={原snapshot,expectedRevision}分开；新内存编辑不会覆盖原待核对身份。
核对committed只推进到原尝试revision，rolled-back保持此前savedRevision，再以正确CAS保存当前最新内容一次；不重放旧文本、不恢复旧授权。
失败保留内存并显示尚未保存，不可驱逐，绝不宣称当前草稿可恢复。失败首次保存即使savedRevision=0，删除／改为仅本次也须先证明并删除已证行。
会话删除先由同一sessions owner验证owner与原expectedRevision，再同步失效在途turn和grants，随后才执行可失败的配置回执清理。
准备取消只改变运行时授权，不改会话逻辑revision／updatedAt／pendingSave；原确认身份可在清理恢复后重试，无需换成更高revision。
abort回调前先分离旧turn并撤回代次，准备及直接删除均在回调后核验原revision；改变revision的新输入及其新授权不能被旧确认删除／清退。
仅重开并签发grant而没有内容revision变化，不作为删除确认冲突；不新增授权代次删除协议。
配置红删未证明时保留会话行并明确pending／failure，不能继续旧Provider读取、格式修复或接收迟到回答；已发送的请求不承诺撤回或退款。
这是正常界面先取消后确认之外的后端防御，不新增持久删除intent、IPC、schema或来源授权。
到原已证期限立即中止并隐藏内容，只保留私有证明／删除意图；确认曾延长或固定的模糊保存后也按其精确revision删除，不再次保存过期文本。
dispose最终保存后重新计算清理状态，并固定最后结果，重复调用不能把未保存失败变成成功。
重启只能证明并读取磁盘canonical行；未保存的新草稿、pending内存意图及运行时授权不随进程恢复，没有自动重放队列。
只读SQLite可能改SHM读标记，不能声称live SHM拒绝前后总不变；备份仍必须等于打开前的精确捕获。
升级COMMIT前进程退出后，若SHM读标记导致既有备份与新捕获不符，继续拒绝并要求显式恢复，不能覆盖原备份来强行重试。
本切片不改变旧事实仓的长期记忆所有权；后续记忆迁移须单独原子导入并切换所有读写者，不能形成第二份权威记忆。

**密钥与日志。** API key 只经 `ai:credential-import` 写入 `safeStorage`，renderer 保存前清空输入框，投影只带
`{ available, configured }`，不进日志、报错或 canonical 状态。设置存 base URL，请求路径只由
`chatCompletionsEndpoint()` 一处拼接。诊断日志（`trace.js`）在所有环境均只输出白名单元数据：生成的请求编号、封闭操作与 Provider 枚举、计数、耗时、HTTP 状态和映射错误码。
任务标题、消息、收件、记忆、请求/响应正文、模型名、端点、原始异常和堆栈都不能进入日志。
HTTP外层响应先区分固定contentKind枚举（json/html/event-stream/text/other/unknown）；HTML、意外SSE、空体及非法JSON分别映射封闭错误码，不能把响应正文或任意Content-Type写入诊断，也不因外层非JSON盲目重试。UTF-8 BOM只作编码兼容，不是修补模型输出。已有非2xx状态的协议协商仍保留原边界。每条本地回退消息保留source与安全reason，重新打开对话仍可识别来源。
源码运行可默认显示这些安全记录，打包后默认关闭；`IM_ADHDER_LLM_LOG=1` 也不能开启内容日志。

提示词里的使用者描述（`START_FRICTION_CONTEXT`，只写行为：难启动、常被打断；不写、不问、不推断任何诊断）与“按真实场景拆”（`SCENARIO_CONTEXT`）是产品约束的复述，模型读不到
PRODUCT.md，所以约束必须在请求里再说一遍并由测试钉住。

## 日常与能量

Schema 13 为 custom 日常增加可选 `customLabel`（1–40 字）；仍由 routines 写入，其他种类不保留此字段。既有 schema 12 数据原样保留，仅升级版本；持久层在打开前逐字节备份，当前版本损坏拒绝覆盖，回退须使用升级前备份。新档食物库存仅浆果2颗；schema18生产路径拒绝旧档，不执行迁移。`routine-controls.mjs` 只拥有选择器草稿，提醒时间仍经关闭式 IPC 与领域验证；编辑排程保留已有窗口长度和未改动的能量效应。

**一个实体，一份记录。** “我 9:00 吃了药”既是提醒的完成，又是能量曲线的输入，所以只有 `routines`
（定义，≤40 条）与 `routineLog`（今天与昨天两天，每天 ≤60 条）两个顶层键，归 `routines` 能力。
`kind` 冻结为 medication、stimulant、meal、snack、movement、rest、meeting、custom，各自对应
`content/energy-effects.mjs` 里的默认效应（custom 无效应，纯提醒）。`schedule: null` 合法：只记录不提醒。
occurrence id 确定性构造（`<routineId>:<dayKey>:<HH:mm>`，随手记为 `…:free:<序号>`），同 id 即更新。
跨午夜仍在有效窗口内的前一日排程保留原occurrence身份，并由原日期桶记录提醒／回答；实际回答时间决定时间线日期。
前一日本已过期、未来、其他日常或非排程自由记录不能借此补入。星期规则按排程原日计算，日历加减不使用固定24小时。
仅已提醒且未回答、随后过窗的排程可形成missed见证；终态历史记录不重新当成未回答。此处不扩大保留历史的可更正范围。
两天窗口是为了让跨午夜的效应尾巴连续。文档里的 `routineLog` 是当前状态，SQLite 里的 `routine.*` 是历史
事实，写入顺序与会话一样：先提交文档，再记账。

**排程与提醒。** 日期规则复用 `core/recurrence-rule.js`，一天内的时刻由 `timesOfDay`（≤6 个 `HH:mm`）决定。
窗口（默认 60 分钟，5–240）内未应答且确实送达后提醒一次（写 `status: 'notified'` 作为按日单调守卫）；窗口过去就
悄悄视为未记上，不再提醒、不显示逾期、不进任何欠债列表。`routine.missed` 只记 App 亲眼看到过期的槽，
App 关着的那几天不补写“漏了”。提醒采样挂在既有 30 秒 `lifecycle.interval` 的 sampler 列表上，同步异常、异步拒绝及错误回报失败分别隔离，不新起周期。日常采样共用一个 in-flight Promise，每轮最多投递一项并轮转候选；日桶满60条且没有该occurrence时不呈现，后续采样按当前容量恢复。送达后重新读取开关、排程、记录和时钟，仍due且未回答才通过原writer记录实际level和时点，并消费真实提交结果；等待中回答或容量变化不能伪造notified或成功计数。

提醒走 attention 的 `type: 'routine'`：三个动作（已完成 / 稍后15分钟 / 今天跳过）。原生L1只提供完成与延后，角落卡可提供第三动作；“今天跳过”只跳当前occurrence。`bootstrap/nudge-actions`接现有命令，执行前按精确routineId/occurrenceId重新解析当前资格，缺ID或失效拒绝，不能落入自由记录或同日更正。资格检查和回答共用一次捕获的时点；成功提交才收起，拒绝/抛错保留重试。时间线仍由原postcommit effect先记账再发布，既有业务revision语义不变，写集仅routineLog。

`resolveRequest`从当前day-plan解析scheduled/due/unanswered槽；已notified未回答仍能显式延后。routine延后只保存内存身份、type/priority和owner，重放重建标题和设置；发布routines/settings后reconcile，并在前台等待后、接受送达、窗口ready、升级及动作前重验。被protected提醒阻挡的显式延后仅原owner每30秒重查，取消或替换后的旧await不能复活；不跨重启保存scheduler。

最高只到L3、默认L2。DND将本人排程的routine降为静音native L1，不走companion/角落/覆盖窗口，保留同一occurrence/instance及显式延后；非routine仍按原屏蔽策略。中途开DND关闭高等级表面和计时器后按当前资格降级。未知或白名单前台都仅native L1，失败不升级遮盖。`nudge-foreground`在初次投递、每次L2/L3/L4升级前及表面ready时各作有界可取消的前台查询；同一level同时ready的角落共用尚未结束的一次查询，较晚ready重新查询。跨每层await（包括probe批准返回外层timer之后）重核request/attempt、canonical资格、DND与probe owner，reset／重试／dispose取消旧查询；会议或unknown取消该次剩余升级，高等级已出现时降回native L1。切回安全应用不追补旧升级；显式延后仍经原owner与当前资格重新开始。

Windows使用独立的`native/windows/nudge-foreground.ps1`：固定PowerShell `-NoLogo -NoProfile -NonInteractive -File`参数，`execFile`不经shell、不拼接白名单/用户内容、不设ExecutionPolicy或任何绕过标志。仅用GetForegroundWindow、GetWindowThreadProcessId与ProcessName；读取后再核对窗口/进程身份，变化则unknown。一次输出`foreground-v1:<process>`，无循环、音频、窗口标题、路径、内容、持久化或遥测；与可选activity mirror及其helper完全分离。开发从仓库native/windows取helper，现有asar包从resources/nudge-foreground取helper；只补该资源声明，不新增Windows发布流水线。缺helper、策略拒绝、进程错误、超时、取消、未知平台、非唯一/错误/过长输出或非空stderr均unknown。

白名单默认词汇、100项上限和每项100字符上限由preferences契约拥有，attention只经其公开settings门面读取；Windows等价组仍归attention。settings:update、规范化与提醒求值使用同一容量。默认Teams词汇只影响新默认值，不补写已有显式数组、顺序或大小写；schema18、存储形状和writer不变。提醒宿主在balanced（含未知值回退）下的系统动效探测取任一明确true，缺失或抛错不覆盖另一探测的true；full/reduced显式选择保留原语义。

前台端口3秒超时、stdout/stderr各512字节上限，身份至多200个字符；Windows只接受保守ASCII进程名，规范为小写并去末尾`.exe`，其他身份视unknown。macOS保留固定lsappinfo name调用，但只接受一份完整LSDisplayName结果，等号周围仅允许空格/横向tab。两平台仅允许无终止符或一个LF/CRLF，裸CR及内部换行拒绝。白名单原有大小写不敏感substring策略保留；Windows另有显式等价组：tencent meeting/腾讯会议/wemeetapp/wemeet/tencentmeeting；钉钉会议/dingtalk；wechat/weixin；飞书/lark/feishu；obs/obs32/obs64；quicktime/quicktimeplayer；camtasia/camrecorder；powerpoint/powerpnt；teams/microsoft teams/ms-teams。只有本人白名单含组内条目才启用该组，默认名单补teams/microsoft teams。其余如zoom、steam、game及自定义项沿用substring。这是合成身份匹配合同，不推断本机安装、浏览器内会议、窗口内容或真实会议状态；原生验收另列。

**健康相关的硬约束**（写在对应代码上方，并有逐字段测试）：不给用药建议，只提醒用户自己设的时间、只记录
用户说发生了的事，没有剂量字段，也不说“现在补上”；日常完成永不产生 XP、不影响任何连续计数、不喂桌宠，
相关写集不含 `xp` / `pet`；日常记录（含 medication）不进任何模型请求——实现方式是
`recentActivityDigest` 只读白名单事件种类、`routine.*` 不在其中，事件 payload 也不带标题（标题可能是药名，
渲染时按 `routineId` 回查），并不存在一个 `aiVisible` 开关；每一笔都能 `routines:undo-log` 撤回，删除日常
连同它当天的记录；曲线必须自称“估计”，不出现单位、小数或生理词汇。

**能量曲线。** `core/energy-curve.js` 是纯计算，可见范围固定 10–90。基线采用睡眠双过程模型的**形状**：
清醒期稳态压力指数上升、睡眠期衰减（先解出 16h/8h 周期稳态，避免午夜重置），叠加 24 小时昼夜振荡、醒后
睡眠惯性和独立的午后低谷。依据只支持形状：Borbély 1982（PMID 7185792）、Achermann & Borbély 1994
（DOI 10.1007/BF00197314）、Achermann 2004（PMID 15018264）、Hilditch & McHill 2019（PMID 31692489）；
代码里的数值是透明的产品先验，不是这个用户的生理测量。

`curve(t) = clamp(baseline(t) + Σ效应 + Σ闪念信号 + 专注负荷 + 自评校正, 10, 90)`。效应是闭式凸包（ramp-decay、
dip-recover、quick-lift、delayed-lift、restore、drain），上升段用 smoothstep 保证导数连续；同类第 n 次振幅
乘 `1/(1 + 0.6n)`，正向总和封顶 +25；clamp 只在最后一步做，输入顺序不影响结果。输出每 15 分钟一个采样点，
带 `attribution`，各项之和加基线等于该点数值；`trend` 由解析导数给出，界面文案用趋势而不是分数。

**专注负荷**是曲线里唯一不需要手动记录的干预，输入是奖励账本里已结算的专注 / 两分钟启动（结束时间与实际专注
时长）加上正在进行的一段：急性部分在专注中按 smoothstep 加深（60 分钟到 −8），结束后 40 分钟半衰回收；累积部分
按当天专注每 20 分钟 −1、封顶 −8，只算当天开始的专注。**只有一个数**：头部读数、推荐、桌宠和快捷面板都读曲线
在此刻的值（`currentEnergyEstimate({ curveLevel })`，主进程经 `bootstrap/energy-reading`），不再另外混合自评、
不再有第二张专注分档表、不再取整到 5；“显示能量曲线”开关只决定画不画。

自评是因果 innovation。面板用五档绝对值（很低 / 低 / 一般 / 好 / 很好 → 20 / 35 / 50 / 65 / 80，走
`energy:check-in`），离当前读数最近的一档高亮，再点一次即“差不多”；`energy:adjust`（`lower | same | higher`，
±10 或锚定当前值，边界上继续向外点是零写入）保留给快捷入口。校正从观测时刻向未来按 180 分钟半衰期衰减，观测之前校正为零。
在较早观测仍留存且其他输入相同的前提下，后来的报告不因替换 latest 而改写更早的曲线。
个人校准只有四个参数（`wakeHour`、`chronotypeShift`、`morningRampMinutes`、`postLunchDipDepth`）和
效应缩放，跑在每日重置里：至少 10 次自评才动，每次每个参数最多 2%，钉在 content 表的 editable 边界内；
`energyProfile: null` 表示未校准，可一键重置。`lastResidualMae` 翻译成三档置信度，误差大就把曲线画淡。

**已留存自评的查询输入。** `energy-curve-view` 的
`collectCheckIns(latest, history, now)` 只读取 `energySelfReports.events` 有限数值 `{ at, level }`，再加入有限的
legacy latest `{ timestamp, level }`；按观测 timestamp 去重、升序生成新数组，历史同刻最后一项胜出，有效 latest 最后覆盖。
有限 injected now（含0）之后的记录排除，等于 now 纳入，不取墙钟、不把查询时点当观察时间；损坏或缺失 history 兼容 latest-only。
仍由原 core 处理10–90范围、因果 innovation、180分钟半衰期及 sample/anchor 各自时点的 trial 参数，不改算法或 canonical 数组。
history 默认关闭，只有原有明确 check-in／adjust 命令在授权下留存；停止采集不删除已有事实，本地查询仍可使用。
clear-history 清事件但保留 legacy latest；不从 inbox／routine 推断历史、不补写、扩容量或重建旧预测。
未保存、清除或容量淘汰的记录无法恢复；calibration／profile／wake／routine／trial 变化仍可改变重建曲线，此处不是历史快照系统。

**历史置信度 follow-up O。** 独立于上述漏输入根因，仅历史分支以
`Number(anchors.some(anchor => localDayKey(anchor.at) === dayKey))` 判断当天是否有自评，不再让其他日期的 anchor
在自身时刻的权重1提高该日置信度。today 分支、全部 sample 及较差 calibration MAE 门禁原样；日期归属复用 localDayKey。
这项元数据修正不另计入原22项缺陷闭环，也不代表23／25小时曲线采样已验收。

闪念能量信号走 prepare / perform / apply：闪念先由 work 正常提交，提交后 effect 只把 `impulseText` 发给
Provider；回答闭合为 `{ direction, delta(−12…+12), confidence, reason }`，置信度 ≥70、非中性且方向一致才在
第二笔事务写 `energySignals`（≤128 条，不复制正文）。写入前重新检查开关、闪念 ID、原文、创建时间和 30 分钟
新鲜度。信号按 120 分钟半衰期衰减，24 小时后归零。Provider 失败时不用关键词猜。

曲线成为 `currentEnergyEstimate` 的 prior，不替代它；`baseEnergyAt` 签名不变，曲线不可用时推荐退回原来的
低置信先验。今日曲线走 `state:get` 投影，历史某天走 `timeline:getDay` 并查前一天的事件；两处都不新开通道。
`settings.energyCurveEnabled=false` 时都不画。

## 表达呈现

桌宠controller的stop是终态且幂等；再次start不能重启已销毁实例，重建必须创建独立controller。pagehide调用同一stop。pet专属lifecycle只管理该实例的DOM/media监听、timeout/interval及rAF，取消后已排队回调也失效。sync和viewport使用既有preload事件返回的窄unsubscribe，不增加通道或开放invoke。pointer、menu、开发预览、notebook及food各自释放资源；迟到初始化、命令响应、焦点和speech不得写入新实例。已发送的喂食命令仍保留真实业务回执，dispose仅终止旧呈现，不重发命令或改变canonical状态。

**星轨与会话状态。** `application/queries/pet-session-display` 从同一 `surface-read-composition` 的 canonical
pomodoro/resumeAction 和现有待处理决定投影 `{mode, sessionId, plannedMs, elapsedMs, running, kind, phase, reason}`。
phase 依次区分恢复不一致 attention、到点 confirm、关联任务已完成 task-completed、其他不可继续 attention、paused、
运行 break/focus；没有活动会话但有 quickStartDecision/focusLandingPrompt 时为 complete，否则 null。
已有会话优先于落点提示（例如休息期间保留此前落点），不会消费待答事实；本人仍在原面板处理。
pet context 的闭合白名单与初始化 mapper 共同携带 sessionDisplay；两种 completion dirty 各自触发 pet 发布。
字段使用既有 canonical revision／到达所有权，不引入第二版本号、IPC、持久化状态或 session writer。

`surfaces/pet/session-orbit` 在现有 renderer 帧循环中读取单调 performance 锚点，静态写 SVG 弧与星位置；不自建
RAF／timer，不用 CSS animation 推算时长。页面隐藏、锁屏、吸附、菜单、拖动与开发面板不绘制状态；恢复只显示当下
锚点，不补播装饰。sensory policy 在首次及 live sync 前生效；calm 模式对运行进度取30秒档，暂停／确认直接采用
canonical 秒数，不用“小于2秒”去重吞掉58→59。重复运行锚点差值小于2秒且 identity/kind/mode/phase 相同才保留插值。
到0只画满，不能自行结算、清除、发奖励或推断新的 complete。null 清理 phase、SVG状态、可访问名称与Tab停靠，dispose解除点击监听。

现有脚下120×26轨道仍位于 `.pet-layer`、220舞台和两种形态的canvas／命中几何不变。底部一行使用状态SVG图标与颜色，
倒计时只在可访问名称／tooltip内；idle无状态文本区。原生状态button仅调用既有pet_openPanel，不提供继续／确认／结算命令，
也不以aria-live每秒宣读。原活动切换保留真实动作名称于tooltip／可访问名称；context的音乐／AI／编程SVG与名称由同一类别集决定。
不增加浏览／听歌推断、轮播采集或telemetry。

`focusRing` 投影及旧调用者仍保留；旧CSS环适配器已从冻结controller抽至 `legacy-focus-ring`。只有从未接收
sessionDisplay的旧调用者使用它；canonical包括null一旦到达便隐藏并停用旧CSS环，后来的兼容ring不能复活空闲状态。
这不是两套业务计时器：兼容字段无writer，也不能影响canonical会话或新星轨。

**内容注册表。** 新内容写进 `src/content/` 对应注册表（台词、场景、行为、会话动作、表达、交互），
台词是手写的短句，不是拼出来的：`dialogues.js` 只放主句，每句 ≤ 20 字、一个分句、不带 emoji、不催人，每个常规池 ≥ 8 条
（`test/pet-content.test.js` 检查这些）；要加台词就往池里加一句，不要再做“开头 × 主句 × 结尾”的乘法凑数。
`registry.js` 负责合并、去重、最低水位与近期防重复；renderer 不维护第二份 ID 清单。自动场景池不放雷雨等
高刺激场景，用户主动换景后才用完整池。专注/休息期间用各自的安静房间替代普通场景；会话动作的两个时钟分开
注入：单调 `clock` 推进段落与进度，墙钟 `entryClock` 只选进入哪个活动。

**Surprise Director** 是自主 cue 的唯一调度者：内容先适配为版本化 manifest 并校验大小、ID、路径、动画白名单
与时长；选择顺序“硬门禁 → 每日预算 → 全局/家族/单 cue 冷却 → 近期防重复 → 权重”；`petActivityMode` 只改
预算。cue 信封 `issued → received → started → completed | cancelled | rejected`，ACK 单调幂等，首次 ACK 前最多
重试两次，重启时取消未完成 cue 不重播。

**发现事实（REV-PET-001）。** Director 只在实际 `completed` 时加入 discovery；`cancelled`、`rejected` 和重启清理不获得发现。
`companion/application/persist-surprise-state` 沿用唯一 UoW，写集严格为 `['companion']`：以当前 canonical companion
为底，仅替换已验证的 surprise，并按 discovery ID 合并传入与当前收藏；重复 ID 保留当前时间戳（包括 0），
不采纳旧快照的 relationship、appearance、activePackIds 或 completedArcIds。整份合并后的 companion 必须严格校验；
两个各自合法的收藏合并超过 512 项时拒绝整笔提交，不截断、不只保存 surprise。重复回执不重复增加收藏，提交失败不确认完成。
没有新增 schema、存储写入者、成长或食物规则。

**呈现管线**单向：Presentation Director → Expression Registry → Pixel Motion Engine → Canvas 合成
（缓存身体 → 实时脸/四肢/道具 → overlay）。`core/pet-presentation` 按优先级裁决（输入安全态 100、必要反馈 90、
用户互动 80、会话转换 70、自主 cue 60、长期 base 50），同一 eventId 幂等。`content/expressions.mjs` 恰好 32 个
语义 ID，未知字段、越界值失败关闭。`core/pet-motion` 用单调时间、有步长上限的时钟、临界阻尼弹簧和速率
累加器；页面隐藏或锁屏停表。注视由主进程已有的 200 ms 光标采样推送有界的 `x/y/near/sameDisplay`，
renderer 不接触 `screen` API、不记录光标；菜单、拖动、睡眠、隐藏、Reduce Motion 与低刺激立即回中。

**美术舞台**由 `core/pet-stage.mjs` 独占：身体坐标仍为 66×66，四周 40 美术单位余量形成 146×146 舞台，CSS 为 219×219。
团子兽生成 PNG 和乌沙奇 SVG Rig/生成衣柜经 form registry 按实际 CSS×DPR 建光栅，不强制 33×33 格采样。
身体缓存只依赖物理层、版本、皮肤、朝向和必要加载/隐藏状态，表情、脚、手和工具在同一空间逐帧绘制；
纹理来自保存素材或确定性路径，不按帧随机重画。旧整数像素网格仍服务历史资产校验。DPR 变化时重建光栅并清空缓存；
`#petCanvas` 只出图，交互与无障碍在 `#petHit`，吸附、peek 与按压位移统一作用在 `.pet-layer`。

伙伴页肖像按实际选择的衣物求适配并集，包含生成层的 `rect`、经典路径款的边界与实际光环升降量。
身体、脸、衣物共用 `fitBounds`，且它进入肖像缓存键；不因此放大桌宠命中框，也不让未穿戴的形态为不存在的帽子留空。

**吸附**用可见宠物矩形（由 form descriptor 派生）相对最近显示器的 `workArea` 判断：进入 14 px、离开 72 px，
角点优先左右边；拖动开始即解除。吸附后只移动宠物，隐藏场景、状态条、喂食入口、饱食条和 overlay；指针
120 px 内探头，离开 2.5 秒后收回。

**菜单窗口。** Windows 由 `windows/pet-viewport.js` 持有固定 520×360 透明原生窗口；外部 getBounds、拖动及持久化仍使用 220×220 逻辑锚点。菜单开关不调整 HWND 尺寸或位置，只改变画布内布局与命中区域；空白区用 `setIgnoreMouseEvents` 穿透，隐藏和销毁时停止光标检查。其他平台常态窗口 220×220，展开到 520×360。
`platform/electron/pet-menu-expansion.js` 把扩容后的窗口收进工作区，返回 `stageOffset` 让舞台反向移动，
宠物在屏幕上不跳；面板开在屏幕上空间更大的一侧；关闭时恢复打开前的精确 bounds。

**执行中编辑。** `update-work-item` 在事务内检查 focus/quick-start 及其暂停态；当前会话的任务仅接受 current scope 的 add/rename 步骤操作，work domain 再拒绝已完成或不存在的步骤，拒绝整单修改及重复系列模板更新。renderer 的 session-step 与 impulse/step-editor 各自拥有按 task/step ID 绑定的草稿，失败保留，不打开完整编辑器。

**食物等级与形态喜好。** `content/food-progression.mjs` 独占等级目录与角色口味；food-shop 投影提供锁定、价格、库存与已尝次数，购买事务在扣食票之前校验等级。喂食保持既有库存消费规则，已拥有的食物可继续使用；favorite 收据只在提交后触发笑眼与延长庆祝，不改 XP 或奖励规则。桌宠食物菜单共享完整目录，不再维护六种食物的子集。

**伙伴纪念册。** companion/domain/journey 从已持久化的完成计数和食物偏好投影八个章节及口味阶梯。结算在同一次 companion 写入中把已达成章节加入既有 relationship.milestones，内容与阈值为版本化代码目录，不增加存储形状或计时器。已获纪念不因离开而回退。

pet 的 `sync` 以 canonical publication revision 和逐字段到达所有权处理 hydration。getState 发出前记录 ticket，响应到达即
通过同一 context 通路应用，getContent 完成后只初始化内容与当前 base，不重放旧 snapshot。旧／相同 snapshot 不能覆盖后到 live
字段；真正更新的 canonical snapshot 可以修补较早 canonical 字段。相同 revision 的后到 live 可接管 hydration 字段，但不能重写
已接收的同 revision live 内容。无版本 live／feed、锁屏、开发与活动消息按独立到达所有权保护；新版 canonical live
接管后释放旧独立 claim。丢弃旧 canonical 字段时仍投递其合法 message／expression／cue／food／transient。
感官策略在 sessionDisplay／兼容ring与session呈现前生效；单调插值、null清除、session identity重锚、food／appearance
和 transient 回到最新 base 的原合同不变。相同 base／paused 的重复 context 不重置本地 hungry／sleeping 等呈现，真正会话变化仍立即生效。

## 活动镜像

伙伴按有效本地信号呈现当前活动（音乐 / 写代码 / 和 AI 对话）；专注保留原会话动作，只叠加安静配件。设置键 `settings.activityMirrorEnabled`（schema 15，默认 false）
由 preferences 拥有；整个功能不写任何其他持久化路径，也不进时间轴、记忆或模型请求。

- **纯规则** `capabilities/companion/domain/activity-mirror.js`：`categoryOf` 按 `content/activity-apps.js` 的分平台名单
  （macOS bundle ID、Windows 进程名，大小写不敏感，`*` 前缀匹配）归类；`rawActivity` 的优先级是 agent 事件 > AI 应用在前 >
  编辑器 / IDE / 终端在前 > 名单内播放器发声，闲置 ≥ 2 分钟只保留音乐；`advanceMirror` 以 15 秒跟随、30 秒回落做迟滞，
  agent 的 prompt 事件立即切换；prompt 最多算 10 分钟，stop 之后再算 90 秒。时间、样本和名单全部由调用方传入。
- **探针** `platform/activity/`：每种系统一个常驻 helper，每 2 秒输出一行 `{"v":1,"front":…,"audio":[…]}`，
  `probe-line.js` 闭合解析（标识 ≤ 200 字、audio ≤ 32 项）。macOS 是 `native/macos/ActivityProbe.swift`
  （`NSWorkspace.frontmostApplication` + Core Audio `kAudioHardwarePropertyProcessObjectList` / `kAudioProcessPropertyIsRunningOutput`，
  macOS 14.2+，无需授权），由 `npm run native:build`（`xcrun swiftc`）编译到 `build/native/darwin/` 并作为 extraResources 打包；
  未编译时退回每 2 秒调一次 `lsappinfo` 只取前台 bundle。Windows 是 `native/windows/activity-probe.ps1`（PowerShell 5.1 内联 C#：
  `GetForegroundWindow` 取进程名，WASAPI `IAudioSessionManager2` + `IAudioMeterInformation` 取峰值高于静音的会话，暂停即停止计入）。
  `activity-probe-host.js` 管理子进程：按行切分、崩溃按 2 / 8 / 30 秒退避重启，连续 5 次失败后放弃；关闭 stdin 即让 helper 退出。
  闲置时间来自 Electron `powerMonitor`。私有 MediaRemote、窗口标题与录屏授权都不使用。
- **AI 工具通知** `agent-signal-server.js` 只在功能开启时监听 `127.0.0.1:47614`（开发 profile 47615，插件侧用 `IMADHDER_AGENT_PORT` 覆盖），
  只接受 `POST /v1/agent/<source>/<event>`、必须带 `X-ImADHDer-Agent: 1`、不得带 Origin 和请求体，返回 204，每分钟最多 60 次；
  自定义头迫使浏览器先做预检而预检永不放行，网页因此无法触发。`source` 是 1–32 位小写字母、数字与连字符组成的工具名，
  不再是固定枚举；`event` 只能是 `prompt` / `stop`。端口被占用时面板说明收不到通知。
- **随附插件** `integrations/` 本身是一个插件市场：`.claude-plugin/marketplace.json`（Claude Code、CodeBuddy）与
  `.agents/plugins/marketplace.json`（Codex），内含唯一插件 `plugins/imadhder-companion/`。插件带五份只有元数据的清单：
  根目录 `plugin.json`（Agent Plugins 标准，Codex 读取）、`.claude-plugin/`、`.qoder-plugin/`、`.codebuddy-plugin/`
  （WorkBuddy 共用）与 `.cursor-plugin/`。`hooks/hooks.json` 是 Claude 格式（`UserPromptSubmit` / `Stop`），被 Claude Code、
  Codex、Qoder、CodeBuddy / WorkBuddy 共用；Cursor 的事件名与结构不同，清单另指 `hooks/cursor-hooks.json`
  （`beforeSubmitPrompt` / `stop`）。每条 hook 是一段 POSIX sh：先读完并丢弃标准输入（其中可能含提问原文），按
  `QODER_PLUGIN_ROOT` → `CODEBUDDY_PLUGIN_ROOT` → `CLAUDE_PLUGIN_ROOT` → `PLUGIN_ROOT`（Codex）判断来源，未命中记为 `agent`，
  再发一次无正文的 curl；不向标准输出写任何东西（`UserPromptSubmit` 的输出会进入模型上下文），应用未运行也以 0 退出。
  Cursor 版本始终输出它要求的 JSON。不使用工具自带的 http 类型 hook，因为它会把整个事件（含提问）作为请求体发出。
  hook 命令依赖 sh：Windows 上只有强制 Git Bash 的 Claude Code、CodeBuddy 确认可用。
  应用只负责打包（electron-builder `extraResources` 复制 `integrations/` 到 `resources/integrations`，含点目录）和展示安装步骤，
  **不改写任何工具的配置文件**；各工具的步骤、命令模板与平台在 `content/agent-plugin.js`，命令由主进程填入真实路径，
  面板按工具 id 请求 `activity:copy-plugin-command`（companion 合约，仅 popover）写入剪贴板。是否已接入只按“最近一次收到该来源信号”的时间显示，
  不读工具配置。DeepSeek Harness 等其他工具没有插件格式，提示用户把 `hooks/hooks.json` 中的两条加入其用户级 hooks 配置（来源记为 `agent`）。
- **组装** `bootstrap/activity-mirror.js` 跟随设置启动 / 停止探针与接收端，把兼容主类别经 `pet:sync { activityMirror }` 交给桌宠，并附加闭合版本投影 `activityMirrorConcurrent: { v: 1, music, coding, ai }`（每 30 秒补发一次，
  桌宠重载后会追上），并投影 `state.activityMirror`（类别、接收端状态、各工具安装步骤与最近一次收到信号的时间，dirty 键 `activity`）。
  `main.js` 只负责创建、注册和在设置变化时调用 `sync()`。每次启动以独立运行身份拥有回调；关闭先失效身份再释放探针、计时器和接收端，旧完成不能污染重开后的状态。接收端也持有待监听实例，关闭时结清待启动结果并关闭实例。
- **桌宠** `surfaces/pet/activity-mirror.mjs` 把类别映射到会话活动模式 `mirror-music / mirror-coding / mirror-ai`
  （`content/session-activities.mjs` 的 `MIRROR_ACTIVITIES`，分别保留 `dance + music-notes`、`type + keyboard`、`browse + ai-chat` 语义记录；
  两种现代形态的音乐/AI 画笔按 ID 绘制专属耳机与电脑/机器人，不把记录中的旧道具别名当成实际素材清单）；
  focused 保留实际会话动作和原工具，resting 清退活动配件，未知类别忽略。镜像的表情只替换普通 idle base，不提升到会话或互动优先级；暂停、睡眠、饥饿、深夜状态和既有输入反馈保持原规则。`core/session-activity.mjs` 的活动模式由轮换表的键决定，保留不同活动时长与延迟帧余量。
  三类镜像保留原 ID 和 24/36/30 秒周期。音乐与 AI 的形态专属呈现分别由 `dango-raster-mirror.mjs` 和
  `usagi-event-actions.mjs` 消费既有类别及循环进度：音乐使用小耳机与轻柔身体/脚部动作，AI 使用面向宠物的电脑和短暂键盘接触。
  团子保留反向电脑盖板、短鳍手和键盘→手→外盖层序；乌萨奇保留原 Rig 身体、双波嘴、电脑与独立踝挂点，缩短 AI 接触手的轮廓。
  耳机后带、耳朵、帽子和衣料按实际层序遮挡。旧的音符和省略点不再用于这两个专属动作；写代码镜像保持原样。
- **呈现生命周期** `surfaces/pet/mirror-playback.mjs` 每个 renderer 持有一份临时连续性记录，只使用调用方单调时钟；
  `action-playback.mjs` 在原动作选择和 artist 采样之间附加 `mirrorPresentation`，其 enter / loop / exit 只表示可见动作阶段。
  初次进入 800 ms，回到无活动时收势 600 ms；同类补发和 24/30 秒循环不重放入场。专注、休息、写代码、手动输入与更高优先级反馈立即覆盖，
  不排队补播旧退出；隐藏、锁屏、切换形态、减少动效和低刺激清理或静置过渡。没有第二个定时器、事件总线、奖励、IPC 或持久化写入。
  renderer 不根据补发间隔另设 TTL：闲置、prompt/stop 过期和 15/30 秒迟滞仍只由主进程原规则决定。
  桌宠始终只知道有效类别布尔投影，不知道应用/source标识、采样时间、BPM、歌曲内容、提问/回答内容或 AI 当前生成阶段；动作不得据此宣称同步节拍或真实生成进度。
- **标识、短句与叠加** `surfaces/pet/context-emphasis.mjs` 拥有临时类别观察和一次短句机会，向 renderer 提供 `activityUi` 窄端口。
  `speech.mjs` 抽取原单一 bubble 和可替换 timeout，所有讲话共用，不创建新定时器类别；旧 timeout 以 generation 身份拒绝关闭新讲话。
  音乐/AI 的短句最多在有效信号新增后的第一次可见帧尝试一次，被其他讲话或状态挡住就消费机会，不延迟重播。
  主动作仍按 AI > coding > music 选择；上游另提供独立类别投影，只有存在信号才组合，不增 IPC 通道、持久化字段或外部 agent 通信。
  同一个纯 eligibility 规则控制音乐/AI 特殊道具和文字：睡眠/困倦/饥饿、休息/暂停、输入反馈/拖动、其他讲话、菜单/吸附/探头、
  隐藏/锁屏优先。写代码沿用原路径。context 自己的短句可以和道具同在，但暂时隐藏 badge；其他讲话同时压住特殊道具和 badge。
  `status-footer.css` 在不改变220px角色舞台、画布和原生命中几何的前提下，用同一 grid 分配动作、喂食和补充状态。
  无补充状态时动作行保持 y181；两行模式动作 y169–196、补充状态 y198–218，喂食独占右侧26px单元。
  context 短句复用单一 bubble/timeout 并替换补充状态；普通讲话把同一 bubble 归还原舞台位置。
  动作字号11px、补充文字12px，长文本省略但保留完整可访问名称；狭窄窗口优先保留动作与喂食控件。
  菜单/拖动/吸附/讲话的优先级与短句只尝试一次的规则不变，冻结美术不参与布局修复。
  “音乐疗愈中 / AI协作中”只表达陪伴语境，不能解释为医疗效果或真实 AI 执行/生成状态。

- **并发信号与兼容** `domain/concurrent-activity.js` 独立平滑发声音乐与前台应用，按 source 保存最多64份有效 agent 通知；
  stop 只更新本来源为原90秒陪伴窗口，不删除其他来源的 prompt。prompt 最长10分钟；过期来源会从临时集合移除。
  probe 样本带主进程接收时刻，超过原30秒 release 窗口就不再作为新证据；旧呈现按原30秒回落，总计60秒回落，并在既有5秒评估tick内可见（最迟65秒），
  延迟 tick 按已过去的时间结算，不重新开始等待。闲置实时重读，只保留音乐；关闭/销毁清除全部临时信号，旧回调不能复活。
  这些时间只存在于主进程内存，不保存记录、时间线、内容或跨进程来源标识；面板诊断只保留既有已知工具最近收到通知的字段。
  `contract/activity-concurrent.mjs` 严格接受且仅接受v1与三个boolean字段。新renderer以此为权威；仅缺少新字段时才从旧单类别降级，
  畸形新字段失败关闭，不伪造同时活动。旧renderer仍可只消费 `activityMirror`。
- **组合计划** `surfaces/pet/activity-combination.mjs` 纯投影生成 `activityCombination`：一个原主动作ID、最多耳机/机器人两项，
  不改会话调度器、原story阶段、手部工具、表情/脚部轨迹。renderer在形态采样前附加计划；两个artist只追加同一套获认可道具并去重。
  音乐+AI以AI电脑为主；专注保持当前选中的六种动作之一，音乐配件不触发跳舞，AI只用侧边机器人，不加电脑。
  手部工具的阶段淡入淡出不影响安静附加道具或badge；音乐/AI主动作仍共享入场/退出包络。暂停、休息、睡眠、菜单和互动清退配件，
  结束时按最新投影恢复，无第二份TTL、排队恢复或补说短句；低刺激固定完整组合，不能当成睡眠。

会议白名单的前台检测同样改用 `lsappinfo info -only name`，不再请求 System Events 的自动化授权。

## 界面层

**图标库。** 元素上写 `data-icon="play"`，图标画在它的 `::before`：一个 SVG 做成的 `mask`，底色是 `currentColor`，
所以颜色跟着文字走（深浅色、强调色、危险色都不用单独画）。数据只有一份 `src/surfaces/shared/icon-paths.json`，
`npm run icons:build` 生成三处输出：`shared/icons.css`（全部，popover 用 `<link>` 引入）和 `impulse.html` / `pet.html` 里
`icons:begin … icons:end` 之间**只含该页面用到的**图标。两页保留内联子集，CSP 为 `style-src 'self' 'unsafe-inline'`：
允许随包提供的局部 CSS（快捷记录、宠物菜单与纸笔联动），不允许远程样式。`npm run icons:check`（已并入 `npm run check`）和 `test/icons.test.js` 保证输出没有过期、
用到的图标都有定义、定义的图标都被用到、只有图形的按钮有名字。脚本里动态换图标用 `el.dataset.icon = 'play'`
（快捷面板的“暂停 / 继续”），并且要在页面 HTML 里出现一次该图标名（注释也行），好让内联子集包含它。

**深色 / 浅色。** 跟随系统 `prefers-color-scheme`，不新增持久化设置。`ui/panel-palette.mjs` 为工具提供固定的浅/深色语义配色，独立于伙伴皮肤；`app-chrome.applyTheme` 在挂载时标记外观并监听系统切换，只以外观作为缓存键。`theme-appearance.mjs` 只剩变量映射与 WCAG 对比度计算；按皮肤推导浅色主题的旧函数已删除。配色另有五个低饱和分类墨色，只供时间轴区分完成、日常、情绪等行，在两种外观下对 bg1/bg2 均 ≥ 4.5。
正文和说明使用 `--fg-*`，强调文字使用 `--primary-ink`，填充按钮文字使用 `--ink`；`test/action-workspace.test.js` 覆盖两种外观的对比度。
快捷面板没有皮肤主题，在 `impulse.html` 里自带一套固定的浅色变量。

popover 的页面职责固定：**现在 = 执行面**（选一件、开始、计时、落点），**任务 = 仓库面**（捕捉、澄清、组织、
找回），日常保持独立的生活记录与提醒能力（不参与任务奖励），伙伴与回顾消费各自投影。一个控件的 `aria-controls` 目标必须和它在同一个面内或是弹层，否则切页后它
就在 hidden 祖先里渲染。弹层共用 `.modal-mask` + `trapFocusWithin` + `restoreModalFocus`；焦点环包含
`select` 与 `textarea`，排除收起的 `<details>` 内部控件。

样式在 `src/surfaces/popover/styles/`，层序 `@layer tokens, base, components, features, theme, utilities`。
`theme.css` 是统一视觉规则的唯一覆盖层（角色由专属原生画笔绘制，工具使用系统界面）。`body[data-session]`（idle / focus / paused / break）由计时模块写入，样式层据此在专注时收起能量、回顾、
日常与候选。feature 选择器以 feature root 或组件类为前缀；运行时不得往 `<head>` 插 `<style>`。文案规则见
PRODUCT「界面语言」。

## 感官策略

`core/sensory-policy` 把 `motionMode`、`stimulationMode`、DND 与系统 Reduce Motion 归一为一个策略：
`reduceMotion = motionMode === 'reduced' || (motionMode !== 'full' && systemReducedMotion)`；
`lowStimulation = stimulationMode === 'low'`；场景运动与环境粒子只在两者都为 false 时允许；自主 cue 需要 DND
关闭且非低刺激，attention cue 还要求非 reduce motion；必要的静态反馈始终允许。策略切换时要清掉已存在的粒子、
运动和 cue，而不只是阻止下一次。DND 管“是否主动打扰”，动效档位管“如何运动”，两者不互相暗改。

## 输入与无障碍

桌宠左键由 `core/pet-input` 的 Pointer Events 状态机协调：`pointerup` 提交短按、550 ms 进入长按、严格大于
14 px 的曼哈顿距离开始拖动，三者互斥，取消、失焦、页面隐藏或丢失 pointer capture 时复位。右键与 macOS
Control-click 走去重的 `contextmenu` 命令入口；双击不绑定命令。菜单与 tablist 有键盘语义、焦点返回和有限
自动关闭；隐藏 panel 内的控件不进入 Tab 顺序。

**焦点与键盘的几条硬规矩**（`test/modal-focus.test.js`、`test/heatmap-keyboard.test.js`、`test/ui-legibility.test.js` 守着）：
- 弹层的焦点陷阱只算 **Tab 真正会停的地方**——`tabindex="-1"` 的元素（漫游 tabindex 的缩略图）不算。算进去，陷阱会
  以为“下一个还在弹层里”而放行，浏览器却直接跳出弹层。
- 打开弹层 / 抽屉时焦点必须真的进去。对折叠的 `<details>` 里的元素调用 `focus()` 会静默失败，所以只聚焦当下看得见的控件，
  否则退到关闭按钮。
- 一大片同类控件（热力图 84 个格子）是**一个** Tab 停靠点，方向键在里面移动（漫游 tabindex）；重建这片控件之前记下焦点
  在哪，重建后还给同一项。“选中”和“键盘焦点”是两件事，用两种标记。
- 正文不小于 11px；强调色当**文字**用时走 `-ink` 令牌；一段不含空格的长串文字要能换行（`overflow-wrap: anywhere`）。

## 安全边界

- 每类窗口独立 preload，只暴露所需方法；`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- CSP `default-src 'none'`、`connect-src 'none'`，禁止对象与表单提交；拒绝新窗口、导航和 webview。
- IPC 先按真实 `file:` 页面做 sender allowlist，再严格校验 payload 与领域前置条件。
- 自主内容 manifest 限制总大小、资源大小、相对路径、cue 数与动画白名单。
- 不得为复用代码恢复通用 preload、放宽 CSP、信任 renderer 传入的计算结果，或把业务写入移到 renderer。

**透明窗口的圆角。** 弹窗是透明窗口。CSS 的规矩：`html` 没有自己的背景时，`body` 的背景会被“提升”去铺满整个画布，
`body` 的 `border-radius` 不起作用——窗口四个角是不透明的方角，页面里的圆角只剩里面一条弧线。所以 `html` / `body` 都不画，
圆角卡片由 `.app-shell`（快捷面板是 `.quick-shell`）自己画；铺满视口的遮罩和抽屉在外壳之外，各自带同样的圆角。
`harness/audit/corners.py` 用透明背景截图逐状态检查四角像素，`test/window-corners.test.js` 守结构。
开关窗口的闪屏：主进程先推最新状态再显示（隐藏期间渲染器不绘制，先显示会先画一帧旧内容）、显示后让系统重算阴影、
窗口外壳保持静态，不在 `visibilitychange` 时再次做整体淡入或位移，避免与内容过渡叠加。

界面动效由 `surfaces/shared/motion.mjs` 提供 GSAP 生命周期：按元素替换动画、异步加载过期保护、隐藏/低刺激/减少动效时清理以及卸载回收。
`ui/companion-ambience.mjs` 只拥有伙伴舞台的装饰浮动与粒子，IntersectionObserver 限定为舞台可见时运行；不改变像素坐标、形态绘制或经验状态。经验值继续读取 progress 投影。
`ui/help-tooltips.mjs` 以事件委托覆盖静态与动态问号，使用 Popover 顶层、视口钳制、悬停保留和 Escape，说明不进入表单布局；只通过 textContent 展示既有说明。`ui/panel-dialogs.mjs` 使用原生 modal dialog 承载食物图鉴、旅程与待回顾列表，浏览器负责焦点圈与背景 inert，已有 modal registry 将这些弹窗计入阻挡状态。回顾卡仍走原有 open/resolveReview 契约。
主面板的 `ui/chrome-motion.mjs` 只协调头部、伙伴入口图标与可见内容；每个图标绑定的监听器在 dispose 时移除。快捷面板和宠物菜单分别在自身内容就绪、窗口定位完成后进入。
动效不参与窗口尺寸、业务命令或状态写入，加载失败时内容保持可用。外壳禁止成为滚动容器，页面只滚动内部内容，避免聚焦或 `scrollIntoView` 带动头部。
主面板默认尺寸由 `core/window-placement` 的 560 × 680 DIP 钳制函数提供，窗口创建及跨工作区重新定位共用同一策略。表单遮罩、弹层与设置抽屉使用 `overflow: clip` 防止程序化滚动外壳，只有内容区使用 `overflow-y: auto`，因此展开帮助或定位字段不会卷走标题和关闭按钮。
所有 Electron 窗口由 hardened window host 强制 skipTaskbar；恢复 focusable 后重新应用 skipTaskbar，避免 Windows 重新显示任务栏入口。macOS 在 app ready 后使用 accessory activation policy 并 hide Dock，打包的 Info.plist 通过 LSUIElement 声明菜单栏应用。托盘入口、退出菜单与单实例行为保留。
通知分流属于 Electron 投递适配层。NotificationHost 默认走系统通知；只有显式标记 `delivery: 'companion'` 的日常反馈（升级、皮肤解锁、温和归档、下一次已排好、回顾卡、2 分钟启动、已记下）交给可见桌宠，桌宠隐藏时丢弃且不强行唤出，桌宠气泡去掉 emoji。到期、预约、计时到点与启动恢复等不依赖桌宠是否可见。DND外且前台已确认非白名单时，attention 的 `prefersCompanionReminder` 保留低优先级日常和 focus-check 的既有桌宠回执；不可用时回退原通知。会议白名单、未知前台先行，高优先级延后和会话到点保持原路径，配置的后续升级仍生效。`nudge-delivery` 返回真实host结果并包含投递异常，避免桌宠消息重复镜像；这些效果不写持久化状态。

`NotificationHost.show(options, receipt)`先绑定show/failed，再调用show；只有实际show事件证明原生L1送达。构造、调用show、unsupported、suppressed、throw、failed都不能造成功。提醒每代以3秒有界回执等待，supersede/reset/dispose结清取消，迟到事件无效；同一实例替换回执须先转移owner再取消旧回执与timeout，旧回执不能关闭新表面。L2以上须ready、init发送成功且isVisible才确认。通用应用NotificationHost不享有routine的DND例外。此回执是适配器所观察事件，不是操作系统真机验收。

**窗口行为（macOS）**——这几条在沙盒里的 Chromium 里复现不了，所以每条都有一个测试守着配置：
- 所有窗口默认 `acceptFirstMouse: true`（`window-host`）。浮在别的应用上的窗口不是当前窗口，第一次点击默认只用来激活它，
  桌宠、提醒气泡就得点两次。
- 弹窗失焦就隐藏，所以点托盘图标想关它时会先失焦隐藏、随后托盘的 click 才到。托盘点击用 `justHiddenByBlur()`
  （350 ms 内）把这一下当作“关闭”，不再重新打开；托盘菜单项和全局快捷键不走这个守卫。
- 弹窗和快捷面板是**不透明的圆角卡片**，所以不用 `vibrancy`：毛玻璃铺满整个矩形窗口、不理会页面的圆角，
  会在圆角外面露出方形的毛玻璃和方形阴影。

收工巡检由 `bootstrap/work-boundary-reminder` 的单一实例拥有命名分钟定时器和按工作日去重的在途集合；
设置刷新只重启该命名定时器，不重建集合。预约激活与回顾生成仍先于提醒开关检查；确实送达后经原 attention 命令记账。
定时器释放不等于取消已开始的投递；投递取消仍归 nudge host，已取得送达回执的续段保留原命令与错误处理边界。

## 扩展规则

1. 先写出归属能力与它写的状态路径；在对应注册表加唯一 ID 与完整元数据。
2. 新持久化字段必须提升 schema，并带逐字节备份、幂等、损坏拒绝测试；生产 schema 18 禁止通过同版本修补绕过准入；历史兼容测试不授权生产迁移。
3. 新 IPC 放进所属能力的 codec 与最小 preload，同时加 sender、payload、非法输入与安全回归测试。
4. 新的可视运动覆盖 DND、低刺激、Reduce Motion、专注、吸附与运行中切换策略，并落在舞台安全区内。
5. 测试放在最低有效层；源码字符串断言只用于“禁止某 API/路径”这类架构检查。
6. 交付前运行 `npm run check`，再按 VALIDATION 做对应改动类型的检查。

伙伴呈现修订归属 form artist 与专用接触/投影模块。短手的轮廓所有权必须跟随实际混合后的腕部位置，
不能只按离散动作名提前切回静止手；工具接触点、既有过渡计时、输入仲裁与状态写入保持原有唯一所有者。
同一道具的键盘、接触手与外盖可按物理遮挡拆层，但不得以全图盖住接触点来掩盖穿插。

确认修改与普通手工写入现在共享同一个配置SQLite权威事务。生产不写JSON镜像；Windows式目录EPERM的历史兼容测试不代表原生系统已验收。SQL结果不可核验时保留原确认身份，不声称未应用、不发布outbox、不执行新业务；恢复只核对同一回执。原生Windows与物理断电仍未验收。

删除来源时，关联回执的正文/依据/撤销副本按evidence refs和操作实体一起清理，保留无正文去重身份。config内同组提交；涉及SQLite对话或收件归档的后续删除，先核验配置SQL红删已提交，失败明确partial/pending并允许按原身份重试。回执仍可脱离对话与AI开关在本机核对。相同canonical提案重新打开只返回既有回执，不能通过丢响应/关闭重开再次创建任务。facts权威仓另有独立初始化标记与application_id绑定，缺失、错配或任一表/约束不完整均保留原件并失败关闭。

**记忆与节奏个性化。** 事实SQLite追加v4：按ID/version管理candidate、active、paused、removed，正文/来源/范围/时效/版本撤销/记忆回执/outbox在同库事务内提交。旧SQL记忆以legacy-import保留原source语义，confirmedAt未知仍null；确认cutover后旧upsert/forget/clear与自动汇总注入停止。JSONL旧档需要明确导入流程，不能在旁边新建空SQL冒充迁移成功。独立forgetting SQLite保存无正文ID/来源失效账本，永久移除先记失效再清正文、撤销版本和来源副本；部分清理失败给出receiptId和cleanupPending，并由读取回执安全续做。两库同时回滚无法仅凭本机旧快照证明最新删除，未知导入/恢复默认拒绝注入。

记忆UI统一有效、待确认、暂停、已移除四类；删除与永久移除分开，恢复先暂停，撤销10分钟。每份预览闭合hash/版本；操作本身永远不接受模型或renderer宣称的来源与确认时间。会话memory-candidate只是不可执行的历史提案，用户在本机看过内容/来源后才用同一确认界面写入。相同canonical候选再次预览指向已有记录，不重复添加。长期记忆总开关不因创建记录自动开启。每轮另选最多8条、正文合计1200字符；6次总读取、50条来源和64KiB总上下文限制仍在。语义版本不含使用计数，发送尝试的使用记录不会制造目标版本冲突。

遗忘账本检查在恢复、组装上下文、发送前及返回后执行；直接user消息依赖和assistant/摘要的传递依赖也检查，不能只过滤memory.search。来源引用按真实发送消息和数据产生，失效来源不再从旧摘要复活。记忆不可用时不假称没有记忆；旧来源无法证明安全的历史不进Provider，当前本次输入仍可使用。默认不读情绪、用药、窗口标题、音频或其他聊天。

config schema17增加独立planningPreferences、energySelfReports、energyCurveTrials。安排偏好只含时间段/需求/有效期，不修改energyProfile或observations。自评历史默认关闭，只在明确当前自评/手工调整入口收集，保存当时已有预测或显式null，不补造历史。曲线试用要求至少10条真实记录、7个本地日期且时间跨度7天；这只是工程门槛。只改单一现有非药物参数chronotypeShift或morningRampMinutes、幅度不超过可编辑范围2%，对确认之前的采样不追溯生效，今天或7天到期恢复，用户自评仍优先，随时可按版本撤销。仅本机参数比较使用完整本地模型版本，Provider只得到用户另行选择的已确认安排偏好；不会收到曲线参数、药效缩放、完整自评历史或其内部版本。

同一会话的提案卡用只读 `ai:conversation-proposal-status` 查询最多50个真实owned proposal ID，分别读取config、记忆和安排偏好的canonical回执。模型生成和真实提交分开，某个仓不可用只把该组标为unavailable；详情正文不进入状态投影。安排偏好保存最多512条无正文origin回执，撤销更新原回执状态；记忆candidateOrigin及其索引字段必须完全一致，腐坏不能伪装成未消费提案。普通读取或重开不能重新应用旧提案。

记忆确认重新检查canonical contextAllowed及全部消息来源，不能用当前时间或消息时间戳证明旧历史安全。实际confirmedAt/updatedAt及回收起止时间使用提交时钟，预览跨过回收期限时拒绝恢复。单条到期自动清理不能扩大到同来源其他条目；扩大范围须重新明确确认。

模型记忆建议是闭合union：memoryCandidate新增，memoryChange仅update或forget。现有目标必须在本轮授权选择中且真实由memory.search返回；来源语义版本在生成、预览、确认再次核验。forget对应独立永久移除预览，主进程按真实私有预览检查permanentAcknowledged；已经提交的同身份回执可以直接恢复，不要求重复删除授权。候选origin同时进入无正文遗忘账本，因此ledger-first部分清理和旧事实备份恢复也保留消费身份。记忆事件在提交时保存timezone/offset/localDayKey，补记时不按当前时区重算。

记忆权威与遗忘账本也使用受限verification_count证明：每次重新打开，以及COMMIT抛错后，必须有成功的只改计数器的WAL/FULL事务和新连接读回。可读到旧页不代表同步成功。未知结果锁住读取、注入、outbox及新写入，只允许原previewId/hash/version或其回执核对；计数器不改变业务版本、receipt/outbox、来源或遗忘sequence。已知ledger-first成功但正文清理未证实仍明确partial；未证实则不声称已应用或零写入。界面保留原确认身份，永久遗忘结果不明时先遮蔽旧缓存正文，不把遮蔽当成删除成功。

## 桌面更新

应用维护能力拥有临时更新状态；bootstrap只负责定时检查、IPC和安装门禁，Electron adapter负责electron-updater6.8.10。
检查、下载、取消、安装分别显式执行，禁止自动下载/退出时自动安装、prerelease和降级。按架构使用latest-arm64/latest-x64通道。
安装前重读当前会话、待收口和SQLite FULL写入证明；提示用户先保存未提交输入，不声称可替用户自动保存全部编辑草稿。
settings.autoCheckUpdates只保存检查偏好；安装器缓存不属于业务数据，不放进SQLite。开发构建/未配置feed/不支持平台明确不可用。
设置抽屉拥有更新UI和轮询生命周期；窗口不可见或分组关闭后不继续轮询。各操作只通过闭合的updates:get/check/download/cancel/install通道。
销毁与微任务启动之间再次检查closed，防止关闭后才开始传输。更新运行态不写业务状态，不新增持久化writer。

### 情绪删除与来源清理

删除跨配置与归档时，先提交 canonical 清理及回执脱敏并证明持久性，再清理归档；不能声称跨库原子。部分失败保留目标身份并明确 pending/unknown，按同一身份重试。
`alreadyAbsent` 只表示已核验的当前后置条件：情绪、canonical 来源和归档均不存在且配置证明成功；不能冒充本次删除的因果回执。未知或冲突字段优先于单一 ok 标志。
UI 保留无正文操作槽，换日期或隐藏不丢在途对象；dispose 禁止迟到绘制。重启后发现仍有来源必须重新获得明确删除确认，不推断过去授权。不承诺跨备份安全擦除或后台自动恢复。


## 当前测试版名称与档案身份

当前产品使用 `im-adhder` 默认档案、`im-adhder-dev` 开发档案、`com.imadhder.app` 应用标识和独立的系统凭据身份。此次更名明确采用新的空默认档案，不自动导入、迁移或删除旧目录与旧凭据；显式 `--user-data-dir` 路径保持原样。四个 preload 与 renderer 使用一致的 `imAdhder` 窄桥，环境入口统一为 `IM_ADHDER_*`，不提供旧名称别名。新事实库名为 `im-adhder.sqlite`，配置权威及其身份核验合同不变。
