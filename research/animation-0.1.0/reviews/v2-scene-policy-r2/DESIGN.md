# V2 场景政策 r2：锁定专注背景、统一 coffee、事实与通道仲裁

状态：设计草案 planned / non-executable。2026-10-17。保留上一版 `bubu-v2-scene-capability-map-20261017` 不变。本版本替代首批场景中背景与coffee的相关规划，不改变已批准美术或runtime源码，不实现129项迁移。

## 1. 用户决定、工作解释、未决定事项

来源：用户消息 Sentinel_fe4149c556f08191af2218bda54542aa。

用户方向：V2 coffee一致；专注只给一个基础背景，保留日期等选择依据但不切换；根据已激活的检测切换表现；仅背景新增coffee可叠加，覆盖动作则判断优先级；需要状态管理。

已向用户说明的工作解释：focus session开始按日期/时段选一个基础背景并锁定，本轮不再切换，下次session重新选；检测只改变状态/动作，不轮播背景；coffee装饰层可叠加，拿杯动作参与冲突仲裁；事实不因抢占消失，结束后按最新有效事实重求展示。此解释不能被扩大为所有细节已批准。

仍未决定：coffee事实来自用户开关、喂食事件、定时还是其他来源；coffee overlay具体美术与是否常驻；饮用请求是否与overlay自动联动；活动之间的产品优先级、抢占/等待/丢弃规则；首次无检测时基础动作/脸；focus暂停/恢复的session身份；跨重启是否恢复旧session背景；用户中途主动换背景是否例外。以上不设隐含常量，不把未答问题变成实现默认。

## 2. 统一coffee概念，不把全部视觉绑定在一起

`coffee`作为统一主题/语义标识，输出至少两种可独立启用的表现配方：

- `coffee.environmentOverlay`：纯环境装饰，不替换focus基础背景、不写脸/骨骼、不占手。它仍占环境叠加层与视觉预算；若设计存在遮挡，应声明屏幕安全区/遮挡约束，不能因“不占手”就无条件兼容。
- `coffee.drinkAction`：拿杯/饮用/放回的短动作，声明身体、手socket、临时杯道具以及可选脸通道的占用。它与打字/浏览/其他手持物会竞争。实际使用哪只手、哪些骨骼、是否独占脸，待动作设计批准，不凭名称猜。

两配方共享coffee语义但不共享事实生命周期。overlay移除不自动取消已接纳的饮用动作；饮用结束不自动撤销coffee事实；是否联动由显式配方依赖决定。若要求杯从环境桌面拿起再放回，需要对象身份/道具租约转移协议，不能复制两只杯或把overlay直接挂到手上。首批可先审纯overlay，饮用仍因真实身体/接触能力缺失保持planned。

V1区分作为来源保留：喂coffee/milk→sip-tea；coffee-shop独立背景；coffee状态特效未核到生产闭环。V2新设计可以统一语义，但不能声称V1本来就是统一闭环。

## 3. 正式上层状态模型（概念设计，不是现API）

四层，不建立一个万能state字符串：

1. 事实账本：needs（hunger、deepNightIdle等）、activity（AI/coding/music，未来browse）、用户选项、focus session；每条具有来源、有效状态、版本/顺序、开始/最后观察、撤销或过期条件。事实结束只能由其来源/有效性规则决定，展示被遮挡不删除事实。
2. 资格求值：检测总开关、各源是否已启用、focus上下文、交互/隐藏/失效、安全及资产能力。输出可展示候选，不在每帧改全局state。关闭检测立即撤销检测派生事实与意图，保留手动coffee、needs与focus基础背景等无关来源。
3. 多通道仲裁：候选声明资源与所需配方。仅有冲突才比较产品策略；不冲突可并存。事实层的AI/music布尔值不能被单一primary投影覆盖。未配置的冲突组合必须使配置审查/准入失败，不能偷偷以输入顺序或V1数值优先级当产品决策。
4. 表现提交：生成当前通道所有者及新意图，进入唯一face owner与未来body/prop/environment执行器。提交通道前验证依赖、资产就绪与全部租约；出现失败不得半套动作已动而杯仍未加载。结束/撤销释放自己的资源；永不撤销其他来源。

状态记录至少区分 `factActive`、`eligible`、`selected`、`visible/performing`、`suppressed`、`revoked/expired`。事实有效不等于正在播放；加载中也不能报告可见。诊断记录抑制原因和占用者，避免用户看到“AI状态丢了”而其实只在等手部资源。

### 资源声明与仲裁

| 通道/资源 | 基本约束 | 本轮设计边界 |
|---|---|---|
| environment.base | focus session内一个稳定所有者 | 日期/时段变化、检测切换、coffee均不得改写 |
| environment.overlays | 有界有序叠加集合 | 需遮挡/容量兼容，coffee可加入但不是换底图 |
| body.pose/action | 单个或明确不重叠骨骼通道writer | 当前真实角色能力缺失，默认不能证明局部并行 |
| hand/socket/tool | 每物理抓持资源独占或明确共享协议 | cup与keyboard/laptop动作是否冲突需真实动作声明 |
| face.semantic | 每角色一个语义路径writer | 当前7槽；多个活动不得同时混脸 |
| wearable.selection | 保留用户穿戴选择 | 临时头饰/耳机与常驻帽子须兼容，隐藏不等于卸载选择 |
| visual.feedback | 单独预算/遮挡与减少动态政策 | 机器人图标、音符不能一概当3D手持道具 |

优先级不必形成“AI>coffee>music”全局总序。相同资源可使用经批准的冲突矩阵；不抢同一资源则允许并行。显式取消/生命周期失效先撤销资格；真实互动相对idle脸的优先级当前底座已有，但不能据此自动推导整个身体/道具的优先级。动作取得资源应全有或全无，避免两个动作各拿一只手相互等待。若策略选择wait，队列必须有界、可撤销、具有事实版本与截止条件；短动作不得无限积压。恢复持续展示从当前事实重新生成新意图，不重播旧lifetime；短动作是否可重试/续段必须逐动作批准，不能默认重复喝一次。

## 4. 专注基础背景的session锁定

拟议状态迁移：`no-session → focus-start/select-once → locked → focus-end/release`。

- 开始：捕获sessionId、选择时刻、明确时区的本地日历日期/时段、候选集与政策版本；确定性选择一次；资源成功接纳后锁定environment.base。艺术候选为空或加载失败不静默换未批准图，进入可报告的blocked状态。
- 活动切换：仅更新活动事实/候选/展示；环境base ID和selection token保持不变。overlay可以按自己的事实增减。
- 跨日期/时段：锁定期间不重选。需要下一轮重新读取日期/时段，不能重用上一轮当前日期缓存。
- 检测开启/关闭、AI停止、音乐暂停、stale TTL：不结束focus session、不重选base。
- 结束：撤销本session展示资格并释放环境所有权；下一轮有新sessionId/new selection token，即使恰巧同一底图也仍是新选择。
- 暂停：建议同一session继续持锁，结束/重启才重选；这是待确认细节。跨进程恢复同理不得自行宣称已支持。

延续V1的是日期/时段等选择依据的意图，不是直接复用全部候选池/skin偏好。V1用本地日期转UTC整数日seed，focused/resting有另行session背景；V2新锁定政策是产品修改。选择日志只需粗粒度日期/时段、版本、候选及结果，不需应用名/网页内容。

## 5. 检测能力真实性与迁移缺口

以下是ff711d9源码核实，未在本次真实OS运行；V2 runtime尚无对应适配器。

| 信号 | V1已存在 | 不可冒充/迁移设计 |
|---|---|---|
| coding | 本地前台应用类别，目录识别编辑器/终端；有dwell/release与idle门禁 | 不是读取代码内容；V2需接有授权的粗类别来源 |
| music | 音频样本中专用音乐播放器分类；独立并存 | 浏览器/会议应用明确未列入，视频/会议不能假定为音乐 |
| AI active | prompt/stop hook，多source保留；stop只结束自身source；TTL/idle结束 | AI窗口在前台不代表活动；不能仅凭窗口标题判正在协作 |
| concurrent | music/coding/ai三个并存布尔；兼容primary按旧规则投影 | V2应保留并存事实，旧ai>coding>music投影不是已批准V2动作优先级 |
| browse | 无真实浏览检测；focus-browse是focused脚本轮播 | 未来新检测需另建数据来源/授权/最小数据契约；首批禁用，不从网页轮播伪造事实 |
| coffee | 本次无检测来源/事实协议 | 保持触发未定，不能自动从AI、时间或focus推出coffee |

V1原工程数值用于复现，不直接成为V2默认：idleMs120000、dwellMs15000、releaseMs30000、agentThinkingMs600000；主进程5秒评价、30秒重呈现。V2应把事实新鲜度时钟与动画逻辑时钟分开：隐藏可冻结表情，但外部事实TTL不能随动画暂停永久冻结。恢复可见前先重算当前事实并撤销过期意图，再提交当前epoch。wall/monotonic映射与重启语义应版本化；本设计不直接选系统时钟替代。

撤销协议至少覆盖：开关off使本次检测generation失效并关闭来源；旧sample/prompt回调不得复活；再次on要新generation与新鲜样本；某AI source stop只移除此source，其他source保留；全部AI结束才撤销aggregate AI；stale sample、TTL、idle按源规则求值；音乐是否在idle继续遵从其独立信号，不能跟AI一起clear-all。V1既有精确prompt/stop协议不含跨source可排序request identity，V2若需处理同source乱序stop/新prompt，应另加source session/version协议，不凭到达顺序猜旧stop含义。

## 6. 首批配置与真值表

见 `PLAN.json` 的8场景和 `DECISION-TABLE.json`。字段仅为人工评审，无schema承诺；每项status=planned、runtimeReady=false。r2这8项是本次政策配方，不是新的首批总清单：拖拽/抚摸继续属于原首批范围，本文仅作为抢占回归引用，未降级或取消。基础focus背景、coffee overlay、coffee饮用、AI、coding、music、未来browse、needs稳定恢复组成首批；拖拽/抚摸用作抢占/取消回归，仍遵守上一版形态分支，不在此扩成全动作实现。

真值表刻意区分“可确定结果”和“需要优先级配置”：overlay与不冲突动作可并存；两动作都申请同一手/身体时，结果不能在此填AI胜或coffee胜；只有提供批准冲突策略后才能成为可执行配置。多个需要不同语义脸的活动同理，只能选一张已批准脸或明确某配方不占脸。

## 7. 完成条件与底座缺口

1. 冻结事实/来源/撤销协议和focus锁定身份；确定coffee触发及各配方依赖，审批冲突矩阵与恢复语义。
2. 实现严格sidecar校验：未知字段/未知能力/冲突无规则/未定触发/空候选拒绝激活；规划JSON不可直接运行。
3. 建立纯状态决策测试：同样事实和时序输出幂等，hunger+deepNightIdle不交替；AI多源stop不clear-all；off/on旧callback不复活；TTL跨隐藏有效；浏览无源不生成。
4. 建立资源仲裁与事务：手部/body/face/overlay/wearable占用、失败回滚、短动作队列界限、释放后最新事实重求，不重复提交消费动作。
5. 接真实资产：咖啡杯、手部身体动作、活动道具、overlay；单纯mechanical socket不能认证贴合/接触。每配方审批通道声明和视觉兼容。
6. owner08已通过247 CPU/API测试，仅负责七槽固定单次脸生命周期；不扩充其字段假装已有状态/场景/身体/检测。持续展示需正式上层协议，不能不断续hold或只将hold设3600秒。
7. 真实浏览器验证focus跨日期不换底图、活动切换不换底图、overlay可叠加、冲突动作有可见且安全退出、输入中断与资源清理、GPU/延迟/减少动态。

## 来源

用户消息ID如§1；V1固定ff711d9完整证据位于 `/workspace/shared/bubu-v1-scenario-audit-20261017`。重点：source/src/bootstrap/activity-mirror.js，source/src/capabilities/companion/domain/{activity-mirror.js,concurrent-activity.js}，source/src/content/activity-apps.js，source/src/surfaces/pet/{activity-mirror.mjs,activity-combination.mjs}；上一版范围图与综合独立review保留不变。

## 8. 一致性补充

事实主键至少source/sourceInstance/category，observedAt（来源观察时刻）、receivedAt（收到时刻）、version（来源顺序）、validUntil（有效截止）不可混作一个time字段；同一来源新实例不能被上实例stop撤销。完整同刻多来源变更先原子更新事实再求值一次，避免中间态闪烁。动画batch与事实batch是分层契约，不能把任意wall-clock事件直接送给已封闭时间戳的face owner。

focus锁定使用focusSessionId+backgroundSelectionSnapshot；跨午夜/时段/skin变更同样不重选。是否有用户显式换背景例外仍待确认。coffee overlay拥有自身环境lease并独立释放；overlay不是可抓取杯道具。多通道动作准入失败必须回滚已取得资源，未知冲突不静默选择赢家。

### 决策稳定性与消费语义

只有事实有效性、资格、资源所有者或批准策略改变才产生展示差量；相同输入反复求值不重新选择背景、不重启body动作、不重新发face request、不重复消费coffee动作。诊断刷新与展示重启动作分开。dwell/release等防抖若沿用，应归属来源资格层，不能在每一层重复计时，也不能延长精确stop已撤销的AI来源。隐式等待公平性与短动作截止也需要显式产品政策；没有策略就不激活相关冲突配置。

对于饮用等短动作，至少区分requested/admitted/started/completed/interrupted/consumed或等价提交边界。图形表现完成不应直接修改真实食物库存；本版本仅设计表现，不授权或实现库存消费。若未来连接喂食事务，必须复核现有消费提交点与重复事件去重，使交互抢占/恢复不会重复扣库存或重复喝。持续事实重新求展示与一次性动作重试属于不同恢复规则。

### 独立review修正

- 事实清除可由匹配来源事件或授权的有效性/总开关管理器执行，必须记录source-stop/TTL/idle/disabled等原因；禁止无关来源clear-all。不将“仅自身来源”误解为TTL管理器无法撤销。
- 每次背景/道具/配方异步加载带sessionId、source epoch与plan generation。session结束、新session开始或计划撤销后到达的旧结果不得attach，必须释放自身已取得lease，不能覆盖新锁定背景。
- 冲突矩阵须拒绝未定义冲突、循环优先或无法生成稳定兼容计划的配置；同级稳定tie规则待批准，不以通道遍历顺序或配置文件顺序偷定赢家。
- 真值表最终扩为24项：补旧异步结果晚到与冲突政策非法。仍全部为待执行验收定义，不是测试通过结果。
