# V1 场景闭环证据审计

## 范围与结论

基准固定为 `ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a`，不是“当前分支HEAD”，不是新3D底座。已有表情审计34份源码复用，本次从同commit只读补取19份指定源码，总53份，文件路径/行数/哈希在 SOURCE-MANIFEST.json。不下载整仓；未读禁止参考图；不改用户电脑、V1代码或生产配置。未运行Electron，不把源码可达性称为已发生的用户播放。

全量目录已列44动作、12会话活动、3活动镜像、45穿戴项（小步dango18，usagi27）、25背景、交互里程碑、食品仪式、临时prop并集。这里的“全量”限定于这些固定版本目录，不是全历史分支。FULL-INDEX.json保留完整配置，SCENARIOS.json逐项记录首批7场景的触发、外显、动作脸、穿戴/道具、背景及退出/优先级。每字段有固定commit代码证据。

## 最重要的差异

1. 咖啡时间尚不是单一闭环：coffee喂食成功→sip-tea已接通；coffee-shop背景按时间池选择，与喝咖啡无绑定；coffee特殊状态特效有画笔入口，现取证renderer只有hungry调用。应先决定场景语义，不能把三项拼成“已有完整套装”。
2. AI协作由启用的活动镜像+prompt/stop事实驱动，可与music/coding并存；前台AI窗口本身不证明对话中。web browsing是focused中的focus-browse轮播，未发现“用户打开浏览器→自动浏览动作”的链。
3. 饥饿是satiation<=20的need状态，吃东西仪式中react.hungry又是短暂表情；两个含义不可合并。状态维护在focus/rest/drag/egg/菜单/DND下会跳过。
4. 想睡觉必须拆成22–01点idle困倦表情、01点后空闲>60秒深夜睡眠状态、rest-nap小盹活动，以及独立yawn短动作。它们并不共享同一触发和退出。
5. 长按550ms，拖拽阈值14；长按held表情与finite动作的所有权不同，松手会撤销held脸，但原动作可以继续至到期。拖拽input-safe100优先，松手低速satisfied、高速spin。
6. 旧表情清单需一处范围修正：form-art.mjs:80–84明确只有usagi采用interaction-presentation长按/烟花/召唤重演。Dango长按使用tail-wiggle7500ms及dango-face强制content+smile。内容中longPress7000ms由usagi分支采用，不能跨形态抄用。

## 背景：固定、变化与随机

renderer.mjs:473–496用“本地日历日期转UTC整数日种子+sceneOffset”对时间段候选池取模；并非随机抽景。日期、时段、手动sceneOffset影响选择；手动模式且本地日期号%3==0时启用skin偏好。focused/resting覆盖为对应session room；docked不画背景。背景粒子发射可随机，不能因此把背景身份标为random。Dango raster scene painter确认25背景及focused/resting房间接口；本次没验素材齐全或像素。

## 分类与共性缺口

- state/needs、外部activity事实、presentation source/priority、emotion/face、有限action/stage、wearable、临时prop、background、particle应正交。`prop`还混有headband/sleep-cap/hat/gloves等临时穿戴、ellipsis/music-notes等反馈符号和none，不能整列迁移为实体道具。
- appearance是按form/skin/level/view与exclusiveGroup选择的持久衣柜；动作道具及activityCombination的robot/headphones是另一条链。没有证据表明首批每场景都自动换完整衣服套装。
- 全局脸优先级为input-safe100>essential90>interaction80>session70>cue60>base50；但背景、状态overlay、动作有各自门禁，必须做跨通道冲突验收，不能只测脸。
- 已用固定V1原文隔离复现饥饿/睡眠交替：低饱食且state已hungry时饥饿进入条件不执行，睡眠条件可设sleeping，下一tick又hungry。详见下方复现补充；此结论是控制器逻辑复现，不是用户设备实测。
- life.return/system.searching/system.restricted旧审计未发现生产触发；chew/sleep动作配方未找到motion绑定。它们保留“未发现调用”，不是断言不存在。
- 外显coffee特效未发现调用是新增缺口。无资源实际加载、截图、OS播放或历史遥测证明。

## 配置草案建议（尚未实现）

每个场景配置至少包括：id、factSource、entryGuards、visibleStatus、presentationSource、faceCue、actionTimeline、wearablePolicy、temporaryProps、backgroundPolicy（inherit/fixed/conditional/deterministic-pool）、interruptPolicy、exitPolicy、resumePolicy、reducedMotionFallback、formOverrides、assetReadiness、evidence与migrationStatus。

先以这7场景确认事实→展示→中断→恢复链，再迁移全量动作。基础验收：需求状态与action可分离；打断后读最新base；穿戴互斥不丢持久配置；手持物不重叠；背景继承/覆盖显式；降低动效下事实保留而粒子静止；形态专属分支不串用；每个none/missing处写清是有意空值还是未接入。

## 产物

- FULL-INDEX.json：目录全量定义及行号。
- SCENARIOS.json：7首批完整字段链、证据URL、待核与缺口。
- SOURCE-MANIFEST.json：53份源码版本边界、哈希、行数。
- source/：只读取证副本，供逐行复核。
- 另一个V2评估交付的V1-V2-COVERAGE.json和SCENE-DRAFT.json负责配置映射，不等于已迁移。


## 补充：低饱食+深夜交替已在原文隔离执行中复现

脚本 `reproduce-hunger-sleep.mjs` 从取证文件提取原封不动的setState（853–863）、isLateNightIdle/desiredBasePresentation（535–559）及维护setInterval（1405–1421），用Node VM执行。只模拟时钟和端口，不导入app，不启Electron，不发IPC、不启动计时器、不连接任何生产服务。结果为HUNGER-SLEEP-RESULT.json，包含完整提取文本、17组输入与状态序列，可复跑。

复现前提：satiation<=20；当地时刻处于[01:00,min(06:00,workStart))；idleFor>60000；dockedEdge为空；无drag/currentEgg/foodMenu/DND；初始不是walking/focused/resting/celebrating/dragged；stopped=false。隔离例用2点、workStart=9、空闲120秒、satiation=20、低刺激以去掉随机话语副作用。

每次维护间隔为1000ms，得到：
- tick0: idle → life.idle
- tick1: hungry → react.hungry
- tick2: sleeping → life.sleep
- tick3: hungry → react.hungry
- tick4: sleeping → life.sleep
- tick5–8: 继续每秒交替

原因是饥饿条件包含“state !== hungry”；已hungry时跳过饥饿分支，却没有阻止后面的深夜睡眠分支。setState不刷新idleSince，也没有饥饿/睡眠仲裁，因此次tick再被饥饿条件抢回。原文setState还会每次请求pet_setState，fixture记录到8次交替请求。被更高优先级transient覆盖时最终脸可能暂时不变；本例无transient，确认base选择也交替。未声称已测实际GPU或生产上游回推后的行为。

边界对照：satiation21稳定sleeping；22点/工作开始截止/06点边界稳定hungry；吸附时稳定hungry；DND、focused、active egg、food menu、dragging保持输入状态。也覆盖satiation0、初始hungry/sleeping、01点边界、idle60秒与超过60秒，共17组fixture。

### V2必须保留的回归案例

1. 同时成立的needs.hunger与context.deepNightIdle是两个事实，不许互相清除；选择器对相同事实持续输入必须幂等，不能因上一次displayedState不同而翻转。
2. 饥饿/睡眠谁做主展示由产品明确优先策略；本审计不替用户决定。无论采用饥饿优先、睡眠优先或兼容overlay，连续tick输出必须稳定。
3. 饱食从20→21只改变饥饿事实，深夜睡眠事实保持；一次重新选择后稳定。时刻跨出睡眠窗只改变时间条件。
4. 拖动或手动交互遮盖时事实继续保留；退出后读取最新事实，不能恢复“之前缓存的hungry/sleeping快照”。
5. 检验状态发布/背景选择/道具挂载均不因重复tick重新触发；同一事实版本不重复发进场或资源装卸事件。
6. 低刺激仅改变动效，不能用隐藏动画掩盖事实选择交替。
