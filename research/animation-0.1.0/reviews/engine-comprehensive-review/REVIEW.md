# 独立架构、代码、性能与成熟方案横评

日期：2026-10-17。审查者为本轮新建独立审查任务。范围：facepath06、expression-director-p0 及其生产接入边界。未修改受审源码；可执行探针及新增报告位于本目录。复跑旧独立脚本会重写其确定性 JSON，已用原 SHA256SUMS 全量确认文件字节不变。

## 最终状态（08:09 UTC）

本轮发现并独立复核闭合了观察者半提交、前置内存低估、生产单writer/生命周期缺口，以及集成时暴露的策略快照race、恢复不唤醒、外层无界/访问器遍历、非枚举字段复制丢失。最终 **owner08的7槽CPU/API基础集成通过**（247测试+本轮独立探针）。这不表示全V1/V2场景底座完整，也不表示真实GPU/交互验收；用户新要求的逐场景清单/配置/缺失能力映射仍为下一个独立关卡。以下初始发现保留历史过程，具体修复复核见文末。

## 结论与交互门槛

**条件通过基础算法；不通过“已经可以直接进入拖拽/长按”的整体声明。** 当前无需推倒重写或引入另一整套游戏引擎；保留 Three.js 资源/场景基础、定制单语义脸路径时钟和小型 director 是合理选择。但生产单writer接入、统一逻辑时钟及错误/销毁边界尚未闭合，真实浏览器/GPU/输入也没有证据。完整18槽、随机P1、gaze、身体/接触及配饰能力不可由本次通过推导。

受审 director SHA256 见 reviewed-hashes.txt，冻结原版 e692c55738e8837e12e25734d63ea8e97478d0e04d0423a38609b32a4d62a454。root告知归档提交 3bbf161db081bf61cc54f02b88c44145e3f15c8c；此处直接证据是工作区文件哈希，不声称从该提交独立检出了整个目录。

### P0：交互前必须闭合

1. **一个实际生产 writer 和一个生命周期所有者。** `createFaceSuite` 私有创建 FaceTimeline，并公开 enqueue/advance；P0 director 私有创建第二个 FaceTimeline，只接可信 apply 回调。没有生产 API 交接或替换旧 timeline。不能把 director.apply 接 actor.enqueue 后两边分别推进，这会再次插值、重复拥有时序。应在新版本中由 admitted actor factory 创建绑定并选唯一 driver；公共交互层只提交完整意图批，不直接写 morph。释放 actor 后 director、timer、RAF、回调均停止且拒绝新输入。本文探针直接重新绑定 actor.root，同时完全不推进 actor 自带 timeline，仅证明组合算法可行，不是可发布接口。
2. **明确逻辑时钟/外部输入批次契约。** 现 ContextLifecycle 仅停 draw/RAF，wall time 继续；P0说明未实现暂停映射。不能一边用“停留暂停”策略，一边仍用 performance.now 对输入计时。需选 catch-up 或冻结逻辑时间，统一应用到 director/actor/输入；测 hidden/context loss 前后 hold、release、reset，及时提交同刻完整输入批，禁止先 advance(t) 再 submit(t)。后者是旧 face-demo.cue 的模式，照搬到 director 会因 sealed timestamp 拒绝。未定产品隐藏策略前，不应臆造暂停语义。
3. **可控故障边界。** 新独立探针证明 onRecord 在 request 抛错时，外部批已移除且 active/phase 已改，deadline 尚未设置；之后正常 advance 会永久处于 enter、脸已到目标、deadline=Infinity。原契约明确排除可信回调抛错，所以不是原隔离P0承诺违约，但在生产接入前必须隔离观察者或显式fault-stop，不能静默继续半提交状态。已交原实现者，root协调新副本修复；修复状态另附复核记录。核心 apply 异常也应由生产 owner 停止并释放，不能承诺自动恢复。
4. **可操作的实时验收门。** 当前无可用、授权的真实WebGL运行证据；不得用CPU、离屏帧、EventTarget模拟或“源码看起来对”替代。待允许路线可用后需验证8层显示、快速切换、context restore、首帧加载、实际draw calls、GPU时间/内存及输入延迟。没有绕过浏览器sandbox或使用用户电脑。可继续修底座、做机械适配；不能称交互已经验收。

5. **前置decoded内存预算缺口，已交专门修复。** 独立资源探针中，527,924-byte合法mechanical GLB、15个重叠bufferView，prepare预留534,760 bytes，而解析完成后的reachable geometry backing为7,340,032 bytes，超过预留13.73倍，直到后置LIMIT才拒绝。`decodedArrayReservation`目前以assetBytes+dense accessor大小估计，未完整覆盖GLTFLoader逐view整块复制。应在parse前按实际复制模型作保守准入，不能用解析后检查替代峰值约束。只对新审查目录中的受限本地fixture核查，无外部目标。资源子审查后续被安全过滤结束，尚未提供最终报告；这里仅记录其已完成结果与现有复现文件，不声称更多验证。root已指派独立修复副本，复验另附。

### P1：重要但不要求另造引擎

- 默认预算真实容量只有2只当前角色。actors=8只是独立上限，不是8只实际角色承诺；第三只的变形计数1,008,396已超1,000,000。4只测试上调vertices=250,000、deformedVertices=1,500,000；不能把该测试宣传成默认配置能力。不要直接提高默认上限来“解决”GPU未知。
- 加载成本比标量调度更值得优化。每次prepare都读/复制/hash/preflight；source缓存只在活跃租约期间有效，最后一只释放后会驱逐。考虑明确的prepared pack复用生命周期和预热策略，设置保留上限/过期机制后才加缓存；不无界保留全部18槽。
- replay目前是从头重放同一输入/策略，state只是诊断，不是完整可恢复快照：队列、private clock段、sealed/maxLifetime等未导出。若需要跨重启恢复，必须版本化持久协议或保存完整输入日志；当前不需为了“完备”加任意seek。对未来随机P1必须同时固定seed/PRNG算法、候选排序、策略/资源hash、时间映射事件，不能只记最后表情。
- 身体authored clip、刚性socket历史fixture与当前静态身体脸适配是不同能力。当前无真实角色身体重定向、skinned衣物、碰撞/抓点/支撑约束证明；拖拽的物理/接触层不能由本审查放行。
- 维护上需要减少多版目录与vendored时钟的漂移。短期hash锁和明确冻结可接受；生产合流时应单一实现来源，资产manifest/profile与策略编译产物保持可追溯。不要复制第3份稍改的FaceTimeline。
- 输入错误限流/可观测性、失焦、pointercancel、丢失capture以及dispose中的晚到输入需在真实adapter测试；当前单元测试未覆盖实际DOM输入，因为尚无该能力。

### 可推迟

无需立即改队列为堆、做ECS、多线程时钟、通用动画图DSL、热重载解释器或构造全功能状态机引擎。128批×32事件已有硬边界；先测真实场景热点。也不应为追求标量“更平滑”修改已批准静态形状：标量C1不等于分段线性几何路径C1，更不等于美术节奏通过。

## 独立验证与性能证据

- 原包完整回归：director 29/29；runtime 167/167；旧独立对抗20/20再次运行。日志保存在本目录。全通过不等于新增覆盖；明确区分既有测试复跑与新probe。
- 新probe.mjs：真实 admitted GLB / 8层 morph binding，1、2、4个克隆，每个128次请求，37ms间隔快速中断，120Hz共600 tick；每tick独立assertCurrent核对所有权重；最终Basis、idle、资源计数归零。未调用actor原时钟，故无测试内双writer。测量剔除assert耗时；无WebGL。
- 此单次组合探针每组tick p50/p95/max（微秒）：1只 3.295/28.183/740.918；2只 9.384/44.878/2075.562；4只 8.904/63.246/1088.603。样本存在JIT/云负载/GC噪声，2只p50高于4只正说明不能据此拟合规模规律。
- 原完整CPU基准由本轮重新运行，输出runtime-cpu.json，1次warmup+5次测量/数量；before/after源码hash完全一致，稳态skin getVertexPosition调用0。prepare中位数83.6–112.1ms，coldCreate中位数155.5–186.6ms，4只额外3克隆中位1.47ms，dispose组中位0.10–0.15ms。并发回归曾在同机执行，此为共享云环境观察，不是隔离基准或硬预算承诺。
- 原基准活跃段individual group call p50/p95/max（微秒）：1只1.983/3.816/183.316，2只3.596/4.747/72.299，4只7.892/14.222/376.949。该采样窗口/请求节奏与新组合probe不同，不能直接宣称director额外耗时为二者相减。
- 单源8,509,100 bytes；decoded预留18,756,540 bytes；实测geometry backing 10,246,992 bytes。每只51,036顶点、20节点、336,132 morph展开计数；资源共享后4只仍一个source、3命中。计数归零仅代表所有权账本，不是浏览器heap/VRAM实际释放证明；prepared pack仍由调用方持有。
- 当前steady binding每次变动清零8×56影响值，再写至多2槽/层；将来18槽按相同8-knot做法会增加resident morph/清零成本，但未构建/测量，不能线性推断GPU容量。应比较全驻留、按组加载、受限预热，以真实资产和首次切换延迟决定。

## 成熟开源方案横评：复用层次比工具数量重要

本节是源码/官方能力适配比较，不是性能赛跑；未实现语义等价的三种后端，因此不声称谁更快。资料于2026-10-17读取。Three源码固定r186；Phaser固定v3.90.0；XState文档当时已显示v6 alpha，main源码仅用于机制参考，若采用需另选并固定稳定版本，不把alpha当默认依赖。

### Three.js AnimationMixer / AnimationAction：复用通用轨道，不替换脸语义规则

Mixer已提供root/clip复用、属性绑定、活动资源管理；Action提供LoopOnce、权重、crossfade、timeScale等。未来正式glTF身体轨道应优先使用这些成熟能力，并在销毁时stop/uncache。参考：[Mixer文档](https://threejs.org/docs/pages/AnimationMixer.html)、[r186实现](https://raw.githubusercontent.com/mrdoob/three.js/r186/src/animation/AnimationMixer.js)。

但普通crossfade是同时混合两个动作，不能自动保证本项目“唯一语义脸、先退出Basis再入新脸、回当前脸时制动回转、8层同步”约束；业务owner/priority/arrival hold/gap也不属于clip播放器。因此保留小型FaceTimeline/director有必要。不要把每张脸的每个morph都转成同时混合action来替代现有路径。若需clip bridge，也应只写一个语义scalar或独占的身体通道。Action的finished/clamp不应被当作被中断后的业务完成承诺。参考：[Action文档](https://threejs.org/docs/pages/AnimationAction.html)、[r186实现](https://raw.githubusercontent.com/mrdoob/three.js/r186/src/animation/AnimationAction.js)。

### XState：未来复杂交互编排有价值，现P0无需强行迁移

actor顺序处理事件、私有状态及父子生命周期对pointer/drag/press/失焦/reset并发管理有借鉴价值；若交互演变为平行状态、多种中断、工具可视化需求，可以在输入编排层采用，输出给唯一director。当前五阶段固定生命周期直接实现较小，整体迁移会引入适配和两套时间调度成本，尚无证据抵消。参考：[Actors](https://stately.ai/docs/actors)。

持久化快照和普通观察快照有区别，适合借鉴版本化恢复契约。参考：[Persistence](https://stately.ai/docs/persistence)。SimulatedClock提供可注入时间，但源码先将now设置为目标再flush到期callback；直接用递归after定义hold/gap并一次跳大时间，不自动等同当前逐个canonical deadline推进。必须在项目语义下做差分测试，不能以“有模拟时钟”推导cadence independence。参考：[SimulatedClock源码](https://github.com/statelyai/xstate/blob/main/packages/core/src/SimulatedClock.ts)。

### Phaser TweenManager：借鉴生命周期和链式组织，不引入整套引擎

其scene管理、TweenChain、完成后销毁/显式persist可降低通用补间的生命周期负担；适合独立UI效果。但源码默认lag smoothing（maxLag=500ms、lagSkip=33ms）及wall-clock管理不等于本项目规范时间回放；属性tween也不自动实现owner仲裁/单脸约束。引入Phaser只为这个小标量，会增加第二场景/时钟体系，现阶段不值得。借鉴显式所有者销毁与可注入调度即可。参考：[固定v3.90.0 TweenManager源码](https://raw.githubusercontent.com/phaserjs/phaser/v3.90.0/src/tweens/TweenManager.js)、[官方Tween说明](https://docs.phaser.io/phaser/concepts/tweens)。

### 建议的最小架构

输入/产品状态（可日后XState） → 固定完整timestamp batch → 唯一ExpressionDirector → 唯一FaceTimeline → 已验证FaceBinding → Three scene。身体clip可由Three Mixer控制专属、不重叠通道；由同一个host逻辑时钟驱动。ActorPool拥有加载预算/共享lease，host拥有director、scene actor、loop及故障清理。不增加通用动画DSL；只在新需求证明当前显式状态难维护时扩展。

## 后续复核清单

修复副本须新增观察者故障对request/arrival/exit/gap/done/reset、重复错误、有界诊断、apply fault的测试，独立比较有/无抛错的scalar轨迹和生命周期记录。生产接线版本需证明只有一个writer，销毁无晚到写入，hidden/resume时钟一致，延迟批处理不会丢release。随后再给拖拽/长按分别定义输入契约和验收，不把本报告当成未实现功能的认证。

## 观察者修复独立复核（2026-10-17 07:53 UTC）

新副本 `bubu-expression-director-p0-observer01-20261017`，director SHA256 `529185114f8e2c26100654a80db33fa14d7c3445a5776eb62b7712aab14546b5`。源码差分确认只更改诊断投递：核心边界提交后投递、有界4条队列、首次异常永久停用、无原错误对象保留、同步重入仍拒绝。原版保持冻结。

独立新 `observer-recheck.mjs` 在15个记录位置逐一注入不可信错误值，按budget1/2/64推进共45组；7类事件均覆盖，每组144次scalar输出与无错误基线完全相同，最终Basis/idle，observer只调用到首次故障，错误元数据冻结。另完整43/43测试独立复跑通过。判定上述onRecord故障项已修复；该结论不覆盖apply故障、生产绑定与GPU。异步observer不支持，原生Promise返回禁用并处理拒绝，不能当作异步控制入口。

## 补充资源/配饰证据边界

资源子审查在终止前留下 `resources/equipment-results.json`：mechanical fixture每只8个刚性配饰、2角色，实例统计51节点/316顶点各自匹配，两个source共18租约，先销毁一只不影响另一只，全部销毁账本归零，第9配饰被LIMIT拒绝。这里只支持CPU层共享资源/实例计数，不支持真实服装贴合、碰撞或GPU。

另 `resources/probe-results.json` 记录：保留3个已disposed的mechanical actor句柄时，其公开model/face/lanes仍可达各自约6.615MB几何backing，尽管pool计数为零；源码 `suite.mjs` 返回这些强引用，dispose清空root children/内部数组并不清除返回对象字段。这不证明调用方丢掉句柄后仍泄漏，也不证明GPU dispose失败。生产host应释放actor引用；最好统一disposed句柄为轻量tombstone并避免公开可长期滞留的低层句柄。属于P1所有权契约/误解风险，不能将账本零描述成进程heap已归零。

## 前置内存修复独立复核（2026-10-17 07:59 UTC）

新副本 `bubu-runtime-0.1.0-preparse07-20261017`。`geometry-accounting.mjs` SHA256 `59b2ad82f16db8771fa683788387f2eeb17f16fb0e6a0a5abff9dfe66c9f268f`，pack-loader `8bd9f5b00f21fb26df65badc97f55cce76d152cc7a566b14577e5bcaba6ef4d3`。源码差分检查了依赖图（场景node→mesh/skin→accessor→view）、按view索引独立复制、共享typed array、sparse/zero-base额外dense backing及预解析interleaved兼容限制。没有放宽资产/应用上限。

独立复跑179/179通过。新增本目录 `preparse-recheck.mjs` 为纯结构/算术核查：原fixture仅读取JSON、不调用parser，确认body预算8,392,244（15×524,288+527,924）；微型描述验证共享view、重复mesh、未使用accessor和sparse依赖去重。已有回归中的不足预算测试确认parseCalls=0，解析回归仅使用16KiB BIN受限数据。当前缺口判定已闭合于该支持子集；不是任意GLTF加载器或总heap限额认证。

修正后的face7预留18,927,900，比原18,756,540增加171,360，仍小于原manifest ceiling20,971,520；正常资产容量上限未因此变化。旧性能报告/旧内存数字仍只属于06。该修复与observer01需在生产owner副本合流后再跑集成回归。

## owner08最终独立复核（2026-10-17 08:06 UTC）

受审 `expression-owner.mjs` SHA256 `d8a053f266657224dcf6690e14162dbcd4d6013a122c7e223b9aaf4b0eca28ea`；`director.mjs` SHA256 `9d9af01c19d16fe4bc49ca6efafba39dc279609cb94925ad4aa3afddf045ede2`。完整关键文件锁见owner08-reviewed-hashes.txt。4个preparse07实现文件逐字节保持已复核版本；actor-pool保留其预算语义并增加directed准入。face clock使用冻结06相对路径reexport，交付必须包含该依赖，不能把owner08当成独立单目录包。

### 本轮新增发现与修复

1. 策略验证结果最初被丢弃，原policy跨await/retire闭包继续可变；独立before探针holdSec从.2被外改10，deadline从预期.3变10.1。准入快照修后同探针deadline=.30000000000000004（正常binary浮点），不受外部修改。
2. bindLifecycle恢复最初仅resume、不wake，独立probe恢复后paused=false但RAF/timer均0。修后恢复有1个RAF；独立无新输入drain完成14次调度，最终Basis/idle、0RAF/0timer，重新绘制并终止。
3. owner水位预扫描最初先for...of后验证事件边界，普通index getter及batch getter均执行一次；修后两者0读取，先检查严格有界own-data batch/array，再遍历。
4. 既有director允许non-enumerable own data但spread丢字段。独立request.type探针最初submit成功、lifetime=1但token=0，意图被忽略；集成validator现拒绝非枚举字段且lifetime仍0，失败批保持原子。旧冻结版本没有被改写；采用owner08时才具有此修复。

### 验证结果与接受范围

- 独立运行203/203 runtime/preparse/owner测试，另43/43 director/observer测试，合计246/246；完整日志保留。
- 新本轮策略/data/resume/nonenumerable探针均有before/after输出，恢复调度另外跑到最终idle而非仅观察一帧。
- 源码检查唯一driver直写8层binding；无director→actor.enqueue双插值。统一owner持有异步加载、actor、调度和监听器，pool关闭会关owner，fault-stop释放且不继续半提交状态。
- 显式freeze策略通过epoch退休解决隐藏同刻release与sealed冲突；interaction在enter/hold/exit/gap或future queue均失效，纯装饰冻结。wall/logical映射、全局lifetime、旧epoch/晚到callback防护有测试。恢复只安排下一帧，保留host先提交完整同刻批；DOM gesture batch合并本身尚未实现。
- apply故障、Basis reset故障、绘制故障、异步加载取消、pool关闭和取消调度失败走统一清理；观察者隔离在退休后维持禁用。

**判定：允许把owner08作为下一阶段场景配置与机械集成的已测基础候选。不得笼统称“完整底座”或直接放行拖拽/抚摸产品效果。** 全18运行/随机P1/gaze/身体接触/配饰贴合/背景与AI协作状态语义仍由V1→V2逐场景映射明确；真实浏览器/GPU/输入时延与视觉效果仍待授权路线。旧06CPU基准不属于owner08性能认证，owner08完整性能需另测实际场景，不跨版本移植数字。

### 最后调度收尾与最终锁（08:09 UTC）

实现者自查到同generation替换timer时旧callback ticket仍有效，可能覆盖新timer句柄。独立审查要求一并闭合：wake清timer前递增ticket，新增替换旧timer→生成新timer→调用晚到旧callback的回归，确认新句柄不变、没有额外draw/RAF，dispose清空全部。

最终全套独立同次运行 **247/247通过**，日志 `owner08-final247.txt`。最终owner SHA256 `b201a02edcb101d886d963988b0eb68750933b339eb3b61ec2991010e6f06d14`；director仍为 `9d9af01c19d16fe4bc49ca6efafba39dc279609cb94925ad4aa3afddf045ede2`，完整锁 `owner08-final-hashes.txt`。本节替代上文08:06的246测试/旧owner hash；其它能力范围和未验证事项不变。发布overlay的独立恢复由实现者/root另行核查，本报告不宣称已独立验证尚未取得的发布布局。
