# 当前接口支持与缺口

基线：`../bubu-runtime-0.1.0-facepath06-20261017`，2026-10-17源码阅读。没有修改或运行新实现。

| 需求 | 当前证据 | 判断与建议 |
|---|---|---|
| 每脸不同入/退时长 | `src/face-timeline.mjs` FACE_KEYS, enqueue, #accept；`spec/FACE-TIMELINE.md` | 已支持逐cue `fadeInSec/fadeOutSec`，合法0.04..2秒；fadeOut指此次替换请求的退场时长，不是某脸固有退出属性。高层须明确采用出场候选的exit参数，且已开始撤退可能继承原时长 |
| 可读停留 | #hold，actualArrival/holdSince；规范Arrival and hold diagnostics | 已有准确到达及静止hold，尚无holdSec/自动结束；重复同ID+amount不重置 |
| 不同间隔 | 绝对time cue、单调advance | 可由外层显式排程；无自动gap/随机时长策略 |
| 权重选择 | cue仅接受face/cancel固定字段 | 不支持；不能将weight加进cue，会正确拒绝。上层新模块负责 |
| 非均匀路径过点 | #smooth固定smoothstep；face-binding amount*8；face-contract固定(i+1)/8 | 过点已非等时，但无作者逐段时间配置。knots是几何坐标，不能改为概率或时间 |
| 同路径多阶段 | 不同amount cue与同脸安全反转 | 能做分段停速机械原型；不能当成完整连续time-map实现 |
| 中断 | #beginBrake, #beginWithdraw, #accept | 已有有界刹车、同脸回转、跨脸Basis、scalar C1；表面几何只C0 |
| 优先级 | advance同刻cancel优先，face插入序；cancel清队列/代际递增 | 没有真实事件优先级，也没有选择性撤回queue API。上层仲裁；不排长串未来自主cue |
| generation | snapshot暴露generation，随cancel递增 | 不是策略所有权token。上层要独立generation/request token，忽略迟到timer，不只依赖timeline generation |
| deterministic seed | 无随机逻辑 | 新策略负责，算法/顺序/事件时钟明确版本化；不动低层确定性采样 |
| idle与调度 | `src/demand-loop.mjs`；FaceTimeline isAnimating/nextDeadline | 静止hold无需RAF，适合包装；nextDeadline不包含hold/gap等上层期限，须统一聚合 |
| manifest/profile扩展 | `src/face-contract.mjs` exact字段；fixtures/face-slice7/manifest.json | 当前只容许固定GLB+profile，profile路径严格固定；新策略应独立sidecar并绑定摘要，不能悄悄加字段 |
| 长按/reduced-motion/条件 | `spec/FACEPATH05-API.md` 明确无pointer/pet API | 全属待建宿主层，当前没有这些能力证明 |

## 最小新增边界（未来实现，不是现API）

1. `validateExpressionPolicy(policy, admittedPack)`：严格schema+跨引用/能力检查，返回不可变编译对象。
2. `ExpressionDirector`：独占actor写入口，持有真实输入、generation、冷却/历史、随机流及规范时钟；事件进来先仲裁，再发原有face/cancel cue。
3. 包装runtime：`advance(now)`按规范事件边界推进director与actor；`isAnimating()`反映真实过渡；`nextDeadline()`合并必要上层期限。新事件调用现DemandLoop.invalidate。
4. `record/replay`：以policy摘要、事件序列及seed为输入，输出可核对的选择和实际时序；运行诊断不能混进每帧无分配路径。

暂不建议修改FaceTimeline cue字段。先利用getter和wrapper建立可测试的arrival/hold边界；只有确有需求才增加带版本的生命周期通知或下一内部边界getter。当前不能从apply回调重入enqueue；所有提交必须在advance之外由wrapper安排。

## 给当前渲染工作的边界

现渲染不必等本提案，也不应因此换脸、重排cue或修改批准参数。当前结果继续验证facepath06已有连续性；后续时序配置应另建对照演示。当前截图或视频不证明概率策略、交互、长按和减少动态已实现。

## 用户确认后的适配分级与行为链路

用户确认需要同时检查基础能力适配。本次补充7个独立最小探针，全部通过，命令：`node bubu-expression-policy-proposal-20261017/probe.mjs`。结果见同目录`probe-results.json`。这不是完整测试复跑，也不是性能基准。

| 能力 | 分级 | 配置到实际行为链路 | 中断/恢复与确定性 | 复杂度/性能证据 |
|---|---|---|---|---|
| 独立进入/退出时长 | 已有 | 原cue字段→enqueue严格验证→#accept/#smooth→单路径binding | 继承已开始withdraw及有界brake，需以arrivalTime观察；探针1/5/6 | 每帧scalar常数计算；binding会清8层target数组，不是零成本 |
| 到达后停留与间隔 | 部分 | 现只有actualArrival/holdSince；缺policy时长→到期→下一cue的wrapper链路 | 同意图幂等，探针2；高层需逻辑hold token | 当前hold无RAF，探针2；新增deadline成本可限定常数 |
| 权重/条件/冷却/防重复 | 缺失 | 需新sidecar→校验编译→合格候选→加权选择→原cue | 必须独立seed/事件日志及generation；现API拒绝这些字段，探针3 | 目标为每决策O(n)，不是每帧O(n)；未实现未测性能 |
| 真实事件优先与恢复 | 部分 | 已有同刻cancel和face顺序，缺真实事件→优先级→所有权仲裁 | cancel清未来并压过同刻face，探针4；恢复必须重新看当前事实，不重播过期待机 | timeline队列插入及shift涉及有界O(q)搬移，q≤128；不宣称所有事件操作O(1) |
| 确定性回放 | 部分 | 现确定性cue时间线可回放；新选择策略/输入记录缺失 | 30/60/120Hz及一次大跳最终状态一致，探针6；这不证明尚未写出的调度器 | scalar按边界推进，成本随跨越的cue/segment数增长 |
| 艺术knots非均匀时序 | 部分 | 固定smoothstep→amount→固定8knots映射；缺time-map配置链路 | 同路径分段cue可停速原型；新连续曲线中断需另验 | 现映射直接求相邻knots；未来time-map编译后应有有界段索引 |
| 长按、减少动态 | 缺失 | 当前无输入宿主层；不能声称仅加配置就有长按/reduced-motion | 新规范事件→generation失效→安全cue；不硬切morph | 长时稳定hold可休眠；实际输入与渲染功耗未测 |
| 统一到期调度 | 部分 | DemandLoop已有；nextDeadline只读queue；缺策略期限聚合 | 过渡中nextDeadline可能Infinity，探针7；wrapper必须处理arrival边界 | 稳态无timer；有到期取最小值可常数级，候选冷却资格恢复时扫描 |

### 探针发现的实现注意点

首次探针对预计到达直接断言十进制1.7失败：规范计算`1 + .3 + .4`实际为`1.7000000000000002`。改为同一规范算式并在引擎返回的arrivalTime推进后通过。这是浮点时间边界行为，不是引擎缺陷。上层不得四舍五入arrival、使用epsilon提前认定到达或从UI显示时刻反算hold起点。

### 优先补齐建议

P0：独立policy schema与纯逻辑director，先实现显式时长、真实事件仲裁、generation、实际arrival起算及统一deadline。这些是自然节奏的可靠底座。

P1：接条件/冷却/防重复/确定性加权选择，补完整replay和长时无机械重复验证。不要先做随机脸轮播再补抢占。

P2：待机/长按宿主适配及减少动态配置的视觉验证；其输入语义须先获确认。

P3：独立艺术time-map能力；当前方案不要改艺术knots、静态脸和安全路径。若没有明确的逐段时间需求，可暂不实现。
