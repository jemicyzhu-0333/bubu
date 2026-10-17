# V1→V2 场景能力与首批配置范围关卡

状态：**planned / draft，非可执行 schema，非动作迁移完成声明**。2026-10-17。
仅新增文档与规划 JSON；不修改 runtime、已批准静态脸或动作源码。V1事实由独立来源清单交叉核实到ff711d9代码；未核实生产调用或运行效果的项不作为既有闭环行为。

## 结论

先统一分类与生命周期，再实现场景，避免把一个场景名直接塞进 faceId、wearable 或动作枚举。当前真实资产支持七槽八层单语义脸路径与有限时单次表情；它还不是持续状态、身体行为、道具与环境的完整编排器。18张静态批准不能等价为18张运行能力。底座闭环后也不能只靠加配置得到喝咖啡、饥饿外显、AI协作、浏览网页、拖拽或抚摸的完整场景。

owner08最终已获独立247/247通过：七槽固定单次CPU/API单writer、epoch、显式freeze逻辑时钟与生命周期接入已测。owner最终hash为b201a02edcb101d886d963988b0eb68750933b339eb3b61ec2991010e6f06d14。observer01与preparse07修复已合流；真实浏览器/GPU仍未验证。

## 1. 共性：事实与表现分层，正交不等于随意叠加

| 类别 | 含义与拥有者 | 生命周期 | 不应承载 |
|---|---|---|---|
| 持续外显状态 | 有来源的事实，例如饥饿、困倦；AI协作/网页活动应另作activity维度而非情绪 | 来源开始/变更/结束、过期或撤销；暂时被遮挡不代表事实结束 | 无限单次hold、自动推断用户情绪、一个状态塞完所有视觉通道 |
| 短动作事件 | 一次喝、拿、挥手、反馈等明确行为意图 | 进入→动作阶段→完成/中断→清理；何时算实际消费需单独定义 | 常驻身份、服装选择、动作被打断即删除持续事实 |
| 情绪/表情表达 | 经审批的表现意图，映射到单一脸路径；不等于事实本身 | 真实到达→可读停留→安全退出→gap | 身体姿势、道具、背景、随机权重；不从饥饿/网页活动必然推导某情绪 |
| wearable | 用户选择的穿戴外观，例如衣帽眼镜 | 装备到卸下/替换；可以临时隐藏，但保存选择 | 杯、电脑等操作道具；背景；“咖啡状态” |
| 临时道具 | 某动作/活动拥有并使用的物体 | 获取/绑定→使用→放回/释放；取消也清理 | 永久穿戴、只要场景结束便删除共享资源 |
| 环境背景 | 舞台/场景环境，不属于角色骨骼装配 | 显式选择或批准情境政策切换；单独过渡/释放 | 随机每帧重选、绑定某脸、默认为全部场景换背景 |
| 输入与接触 | 拖拽/抚摸等真实交互的资格、抓点与接触 | pointer资格→捕获/识别→持续→up/cancel/失焦清理 | 仅表情cue就宣称交互完成 |

事实状态至少有独立的needs、activity维度；是否允许饥饿与困倦并存、AI协作与浏览网页并存，是产品状态模型的问题，不由视觉优先级抹掉。展示仲裁可暂时只表现一个主动作/脸，未被表现的事实仍有效。真实事件抢占后，重新读取仍有效事实生成新展示意图；不要恢复旧lifetime或播放积压表情。

兼容约束必须明确：每只角色同刻一个脸语义writer；身体按明确通道/骨骼所有权；每手/socket的占用、手持物与接触需求、头部wearable与脸轮廓遮挡、服装与蒙皮/体积、背景与场景尺度/支撑面均需约束。冲突策略为拒绝、等待、暂时隐藏或经批准替代之一，不能静默混搭。临时隐藏wearable后恢复的是仍有效用户选择，而非历史被替换装备。资源加载失败须不半提交场景；已接纳道具/actor按各自lease清理。

## 2. 当前能力矩阵

“已实测”限定证据层级；“仅接口/局部”包括可执行机械fixture，不是产品能力。

| 能力 | 等级 | 证据/限制 | 完成条件 |
|---|---|---|---|
| 七槽 04/N3/A7/07/S5/R0/N2、八层单脸、同脸安全反转/跨脸Basis | 已实测：真实资产CPU绑定/回放 | facepath06 + 综合review；几何路径C0，标量C1；Basis≠R0 | 真实浏览器显示与批准节奏另验 |
| 18张静态脸 | 已批准静态；运行缺失11槽 | approved-face-source只注册七槽 | 新运行资产闭包、hash/预算、路径/视觉/中断验收，不能改现白名单绕过 |
| 固定单次 request→arrival→hold→exit→gap | 已实测：P0纯逻辑；组合CPU探针 | 固定时长、interaction/idle两级、无循环/随机 | 已批准艺术映射与真实宿主接入 |
| 单writer owner、输入完整batch、逻辑时钟、epoch、释放/销毁 | 已实测：CPU/API，独立247/247 | owner08；不能沿用06旧API描述新owner能力 | 真实浏览器宿主边界仍需实测 |
| observer故障隔离 | 已实测 | observer01 43/43+独立45组；不覆盖GPU | owner合流版本继续回归 |
| 前置内存预算 | 已实测支持子集 | preparse07 179/179+独立核查；非总heap/VRAM上限 | owner合流+真实资源测量 |
| 持续事实、状态优先、自动条件、恢复策略 | 缺失/需重设计模型 | P0只有有限时单次生命周期，hold≤3600不是持续事实协议 | 状态版本/来源/撤销+展示重新求值+跨交互回归 |
| 稀疏随机、权重、冷却、防重复、确定性候选 | 仅提案 | expression-policy PROPOSAL，无实现 | 固定PRNG版本/seed/候选顺序/日志，30/60/120Hz与大跳一致 |
| 真实身体动作、杯/电脑道具、真实wearable | 缺失真实资产闭环 | mechanical authored quaternion/rigid socket仅CPU原语；face actor无playClip | 真实rig绑定、接触/遮挡、动作中断、装配及资源限额 |
| 拖拽、抚摸/长按、抓点、支撑、IK | 缺失当前引擎能力 | 历史实验不等于现runtime接入 | DOM输入、capture丢失/cancel/失焦、身体接触与视觉独立验收 |
| 背景固定/情境/确定性候选集 | 缺失场景政策 | V1已核实：本地日历种子确定性选择+session背景覆盖；V2不得设艺术默认 | 批准来源/切换时机/资源边界；背景不随每帧重抽 |
| gaze、减少动态、艺术逐段time-map | 缺失或仅提案 | 七槽表情不等于独立眼球/眉控制 | 新能力契约、兼容资产、偏好切换及视觉验收 |
| 真实GPU、context恢复、输入延迟 | 未验证 | CPU/EventTarget/离屏帧不替代 | 授权浏览器实测、目标设备预算/首帧/恢复/绘制指标 |

## 3. 与现有字段、触发、退出、中断、优先级的对应

| 场景概念（规划字段，非现API） | 现V2可落点 | 缺口与约束 |
|---|---|---|
| sourceFact / validUntil / clearReason | 无 | 需事实状态存储，不能塞进candidate或morph |
| expressionCandidate | P0 key/faceId/amount/enterSec/exitSec/holdSec/gapSec | 只固定单次；faceId映射与时长须批准，拒绝不支持字段 |
| startTrigger | 转换为request的type/owner/requestId/lifetime/priority/candidate/holdMode | 真实事件适配器未建；lifetime全局严格递增；owner08另带epoch |
| endTrigger | 精确release(owner,requestId,lifetime) | 只释放匹配当前脸请求；不会结束整套身体/道具或持续事实 |
| abort / replace | 普通可见释放/新request走安全路径；reset仅显式全局复位 | 不可cancel+face同刻；全局reset不能充当日常状态切换 |
| resumeRule | 无自动恢复；重新读事实再发新request | 旧请求不会自动恢复；旧epoch/lifetime不得复活 |
| priority | 现固定interaction>idle，同级完整batch最后请求胜 | 没有“饥饿>困倦>AI”或wearable优先；需独立批准跨通道场景仲裁 |
| hold | 到达后有限hold；keep/restart可控 | 持续按住/状态直到结束不是holdSec大数；需正式持续协议或明确有限单次展示 |
| bodyPlan / propPlan / outfitSelection / environmentPlan | 当前真实face actor无对应接口 | 保持规划描述，不能伪装为runtime manifest字段 |
| sceneTransaction / cleanup | owner只负责脸actor一域 | 跨身体、临时道具、环境的原子提交与清理待建 |

完整同刻输入必须先收齐batch再推进；不可advance(t)之后submit(t)，不可加epsilon规避。隐藏/不可绘制时owner08当前显式freeze：互动失效、epoch更新，不重播旧输入；纯装饰保持剩余逻辑时长。此为已获CPU/API独立验收的实现契约，不是V1产品行为或最终艺术默认。

## 4. 首批场景草案

详见同目录SCENE-DRAFT.json。所有场景为planned，未批准faceId、时长、服装/道具/背景默认值留空。此JSON是人工评审清单，现runtime必须拒绝直接加载。初批以共性代表场景验证分类：安静展示、咖啡相关、饥饿、困倦、AI协作、网页活动、拖拽、抚摸；不是穷尽V1迁移承诺。V1来源核对结果见§6及129项覆盖矩阵；咖啡是动作、状态或换装不能仅凭名字认定。

## 5. 修正清单与可验证关卡

1. 保留V1证据：每场景提供来源、原字段、触发/退出/随机/资产关系；“找不到”显式标未知。核实背景来自固定场景选择、随机候选还是两者分层。
2. 分类修正：将同一枚举内混杂的状态、动作、情绪、穿戴、临时道具、背景拆开；保留V1语义ID到新分类的映射，禁止仅按文件名迁移。
3. 明确状态生命周期和恢复：至少覆盖“饥饿+困倦并存→拖拽→释放→重新求展示”“AI结束时互动仍在→不复活AI道具”“旧release晚到→不结束新事件”。结果应有可读事件日志。
4. 底座门：owner08最终独立247/247及observer/preparse合流已闭合CPU/API门，继续保留单writer/统一时钟/late callback/销毁/故障回收回归。通过只准进入能力实现，不等于场景完成。
5. 配置门：正式schema版本独立制定；资产能力和兼容约束预检，unknown字段拒绝，无隐式fallback。上述规划JSON不得直接当可执行模板。
6. 真实资产门：从代表性短动作+道具开始，证明身体通道、手部接触、穿戴兼容与中断清理，再扩展持续状态；不要一次全量迁移。
7. 背景政策门：fixed/contextual/deterministicCandidates仅可选设计模式，候选与切换时点需批准。随机回放记录seed/顺序/策略hash，环境不可随表情自动绑定。
8. 交互门：分别实现拖拽与抚摸输入资格/身体接触/安全退出；真实设备验证pointercancel、lost capture、失焦、隐藏恢复，不能只测表情。
9. 表现与性能门：用已批准18静态的相应运行子集，实测目标浏览器/GPU、首次加载/切换、并发预算、恢复和延迟；艺术评审检查可读停留、动作节奏、接触与长时不机械。

完成定义：每个首批场景均能从证据支持的触发到退出走通，所有取消与抢占路径清理到位，能记录决定依据和资产版本，满足兼容矩阵，实际浏览器可见结果与批准设计一致。任一缺失能力仍标planned，不能因单元测试全绿写“全场景支持”。

## 证据索引

- bubu-engine-comprehensive-review-20261017/REVIEW.md：独立实测、性能边界、observer01/preparse07复验。
- bubu-runtime-0.1.0-facepath06-20261017/src/approved-face-source.mjs 与 spec/API.md：七槽注册与机械/真实资产能力区分。
- bubu-expression-director-p0-observer01-20261017/spec/CONTRACT.md：可执行P0精确字段/优先级/生命周期。
- bubu-runtime-0.1.0-owner08-20261017/spec/OWNER08.md 与 src/expression-owner.mjs：已获独立CPU/API验收的宿主接线。
- bubu-expression-policy-proposal-20261017/PROPOSAL.md：随机/条件/time-map仅提案；旧INTERFACE-AUDIT为06基线，不能用其“尚无director”覆盖后续P0事实。
- bubu-3d-motion-readonly-audit-20261016/AUDIT.md：历史动作实验机械节拍问题，仅用于重设计风险提示，非V2能力证据。

## 6. V1来源已核对后的字段迁移修正

来源版本由独立V1清单任务确认：`ff711d9`。完整复核目录 `/workspace/shared/bubu-v1-scenario-audit-20261017`（REPORT.md、FULL-INDEX.json、SCENARIOS.json、SOURCE-MANIFEST.json；53份固定源码、111条范围校验引用）；以下是本次协作核对摘要，原始逐项清单为权威证据，不将缺乏调用点的素材函数视为产品闭环。

| V1证据/原字段 | 核实的触发、退出和分类 | V2对应修正 | 当前缺失 |
|---|---|---|---|
| controller.mjs:1405–1422，satiation/state | 维护定时器有drag/egg/foodMenu/session/dnd等门禁；≤20进入hungry，>20退出idle。不是所有时刻无条件饥饿抢占 | 保留饱食事实与显示门禁分离；不直接把hungry改名某faceId | 事实层、情境资格、跨交互重新求展示 |
| controller.mjs夜间维护与idle脸分支 | 深夜1点至min(6,workStart)、idle>60秒且未docked进入sleep；困倦表现另有22–1点分支 | sleepy表现与sleeping状态分开，A7只证明睡脸可运行；时区/时钟显式输入 | 时段策略、睡眠身体、状态恢复 |
| food-rituals.mjs:18–23，coffee/milk→sip-tea | 喂咖啡/牛奶进入饮用动作；450/850/2200ms三阶段surprised→hungry→satisfied。原V1节奏不自动成为V2批准节奏 | coffee作为食物输入，sip-tea作为短动作；杯为临时道具；三个V1表情标签需另映射 | 喂食事务、真实身体/杯接触、完整阶段中断 |
| dango-raster-art.mjs:301–310；renderer.mjs:424–425 | 素材函数可画hungry/coffee状态特效，但生产renderer只核到hungry调用；coffee状态闭环未证实 | 不创建声称已迁移的“coffee持续状态”；保留未证实来源项 | 先确定是否确需独立咖啡状态，再定义触发/退出 |
| scenes.mjs coffee-shop；renderer.mjs:473–496 | coffee-shop为独立背景项，与喂coffee无绑定 | 咖啡动作与咖啡店背景独立配置，可按批准方案组合 | 环境政策与真实场景资源 |
| session activity mirror-ai | action=browse、prop=ai-chat、expression=life.attentive、durationMs=30000；由外部AI category活动持续 | activity事实、展示动作、临时道具、脸映射、片段时长分别保存；不能把AI当衣服 | 外部活动适配+持续编排+真实身体/道具 |
| session activity focus-browse | action=browse、prop=laptop、expression=work.switch、durationMs=38000；属于focused轮播 | 与AI可共享动作意图但道具/脸/退出不同；V1 action相同不代表完整场景相同 | focused活动状态与有界轮播、真实道具 |
| core/session-activity.mjs | 初始活动用分钟种子取模；current按各duration轮转并保留跨延迟余量 | 保留事实与活动脚本区分；需批准是否沿用确定性轮换，不能擅改成加权随机 | 当前P0不支持自主脚本轮换，未来高层实现 |
| appearance.mjs:6–54；core/pet-appearance.mjs:79–113 | slot/layer/z/parts/formId/minLevel/skin/exclusiveGroup/exclusivePriority/renderKey/effect/views/anchor/bleed；按form/解锁/skin/view筛选互斥，不是场景套装自动切换 | 保留资格和互斥语义；2D layer/z/anchor/bleed需转为3D socket/遮挡/边界验证，不能数字直搬 | 真实3D穿戴资产/兼容矩阵；部分字段需重设计 |
| pointer：长按550ms、拖动阈值14 | V1输入判定参数，完整门禁/取消见独立清单 | 参数可作为来源，不等于V2已批准阈值；输入坐标单位与缩放需定义 | DOM adapter及真实设备试验 |

### 背景结论：确定性选择，不是“固定一个”或“每帧随机”二选一

V1 resolveScene先处理开发预览；否则取manual/auto时段候选。manual且本地日号%3=0时，优先使用当前skin的时段可用偏好。用本地getFullYear/getMonth/getDate取得日期，再Date.UTC构成整数日种子；索引为abs(daySeed+sceneOffset)%available.length。缓存key含日期、时段、skin、manual/auto与offset，只有key变更才重新选择并清场景粒子。不要误写为“按UTC午夜切换”。focused/resting另走session背景；docked隐藏。

V2建议保留三种可显式选择的政策能力：fixed、contextual、deterministic candidate set。它们是设计选项，不是已实现字段，也不擅自决定默认背景或保留全部V1时间池。环境和wearable可存在批准兼容关系，但不得默认skin强制换背景。

### V1→V2特别不能直接搬的字段

- V1的2D layer/z/anchor/bleed是屏幕合成语义，不是3D骨骼或socket变换；保留意图后重新校准真实几何。
- V1的expression字符串是情境标签，不等于V2七槽ID；需要逐项映射审批。
- durationMs是V1活动片段长度，不能直接当V2脸holdSec；动作时间、脸到达后停留、事实有效期各自独立。
- V1状态枚举优先级并不自动等于director仅有的interaction/idle；跨状态仲裁应在上层明确。
- skin解锁和exclusivePriority不是表情优先级；衣服互斥不能驱动脸owner抢占。

## 7. 完整目录覆盖检查（不是全动作迁移）

`V1-V2-COVERAGE.json`逐ID链接V1来源，覆盖44动作、15活动（12session+3mirror）、45穿戴（其中dango18，其余形态不自动纳入）与25背景，共129项。每项明确not_migrated/runtimeReady=false，给出真实资产/分类/能力检查项。它用于防遗漏，不宣称129项都需进入首批。

重要分类修正：V1的prop字段不全是可手持3D物体。其值包含headband/sleep-cap/hat/gloves等临时穿戴，也有ellipsis/music-notes等图形反馈和none。先按使用语义拆成实体道具、临时穿戴、视觉效果或无物体；不能把整个prop列表直接生成3D道具资产需求。临时穿戴仍须与用户常驻wearable按槽位及遮挡兼容仲裁，并在结束后恢复有效选择。背景emitters的随机粒子和背景选景的确定性规则也须分开，不能由“场景里有随机粒子”推导“背景随机”。

## 8. 最终一致性修订与明确回归门

- 网页浏览：V1 focus-browse来自focused活动轮播，非操作系统网页浏览检测。来源src/content/session-activities.mjs:19、activity-stories.mjs:33–39。V2不能把该场景迁成任意网页事件自动触发。
- AI活动：mirror-ai来源src/content/session-activities.mjs:77–86；上游bootstrap/activity-mirror.js:127–134启用，domain/concurrent-activity.js:11–24、53–72处理多源prompt/stop、TTL和idle。V2须明确来源有效性与撤销，不能用30秒脸hold替代。
- 长按按形态区分：Dango（小步）是tail-wiggle 7500ms动作加held脸content/smile；三阶段neutral/content重演属于usagi（小奇）分支，form-art:80–84。内容表中的7000ms不能直接覆盖小步实际动作时长。V2首批抚摸仅planned，保留分支来源，待批准真实3D身体与脸映射，不照搬二维阶段或时长。
- V1饥饿/睡眠交替已经控制器原文隔离复现：饱食≤20、本地2点、workStart=9、idle>60秒、未docked且无维护门禁时，每秒idle→hungry→sleeping→hungry交替，并重复pet_setState及基础表情选择。17个边界fixture通过。来源V1审计目录reproduce-hunger-sleep.mjs、HUNGER-SLEEP-RESULT.json；这是原文隔离控制器实验，不是生产app运行实测。

V2必须新增回归：同一组有效事实持续输入时展示幂等；hunger与deepNightIdle事实能够并存且不互相清除；展示决策不能让维护轮次反复覆盖全局state；真实交互打断后按最新有效事实重新求展示。具体哪种状态先显示仍由产品批准，不在此设优先级常量。持续状态需正式上层事实与展示协议，本轮不修改V1、不实现该协议，也不迁移129项。首批8场景全部保持planned，129项仅防遗漏的覆盖清单。
