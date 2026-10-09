# 分层骨骼 Rig

## 并发配件的姿势隔离

乌萨奇 `combinationAccessories` 只挂在已求解的artwork上，耳机/机器人画笔读取它；不改 `pose.sample`、world、props或face。
团子 `appendCombinationAccessories` 只向现有contact追加去重工具层；原hands、feet、face与手持道具保持。
次级音乐不调用音乐body sampler，次级AI不调用电脑或AI手部接触采样。头带在原后层，耳罩在完整衣物之前。

乌沙奇 2.0（`usagi`）的 canonical 身体、脸和活动骨骼只使用 `assets/companion/usagi/rig/usagi.rig.mjs`，
由分层 SVG 编译而来。衣柜另叠加生成 PNG，不能借试穿图重画身体或五官。
旧九帧适配器与旧矢量角色已移除，缺少有效 Rig 时不会替换成历史形象。

整帧九宫图只能整张换图，表情、眨眼、眼神、手臂和道具都烤死在图里。Rig 把它们拆开：身体静态缓存，
脸按表情逐帧合成，四肢、耳朵和道具跟着骨骼动，配饰挂在骨骼上一起摆。

当前内置 `usagi-v2@5`（乌沙奇 2.0），依据用户提供的参考图与新生成的四视图设计稿重建为可编辑矢量图层，
不是对原 PNG 的无损切片。四个独立朝向包含耳朵、躯干、手脚、尾巴、16 种眼形、9 种嘴形和
每视图 54 个道具图层（52 个运行时道具名，加两个备用图形）；当前 25 件形态专属配饰（17 件生成款、
8 件经典路径款）复用七个槽位及双踝挂点。素材使用范围继续见 `assets/companion/usagi/USAGE.txt`。

`tools/rig-build/usagi-source.mjs` 保存重建路径，运行 `node tools/rig-build/usagi-source.mjs` 可重新生成
`usagi.rig.svg`，随后运行 `npm run rig:build` 编译。直接编辑 SVG 后只运行后者，避免覆盖手工编辑。
耳根与腿根藏在躯干填色后面，所有部件挂在稳定的 root 下；整体呼吸交给呈现层，避免活动部件随
body 骨骼缩放、静态身体缓存却不缩放的关节滑动。

## 快速开始

```bash
npm run rig:demo       # 编译原创示范角色“芽芽”，打印覆盖率
npm run rig:preview -- --in tools/rig-build/examples/sprout.rig.svg   # 打开本地预览台
```

内置角色已可直接使用。要改原稿，编辑 `assets/companion/usagi/rig/usagi.rig.svg`，然后：

```bash
npm run rig:check      # 只看覆盖率，不写文件
npm run rig:build      # 写出 usagi.rig.mjs；重启应用生效
npm run rig:preview    # 预览台：所有朝向 × 动作、所有眼睛和嘴的状态；保存 SVG 后刷新即可
```

`--in <svg>`、`--out <mjs>`、`--version <n>` 可以覆盖默认路径和版本号。版本号进入身体缓存键，
改了图但缓存没刷新时把它加一。

## 坐标

SVG 的坐标就是形态的美术坐标：66 单位的身体框，脚落在 y≈64，耳朵最高到 y≈-28。
把 `viewBox` 设成 `-15 -31 96 113`（即 `artBounds`），身体缓存与肖像以此取景。
66 美术单位在默认比例下对应 99 CSS px 身体设计宽度，长耳和衣物的完整非透明前景另行量测；
99/198 身体宽度截图不能当作完整角色高度证据，尺寸标注规则见 PET_VISUAL「舞台与坐标契约」。
实时动作、道具和状态点缀仍必须落在完整舞台 `[-40,106]` 安全区；不能用扩大 SVG 画布掩盖越界。
如果你习惯在大画布上画，在根 `<svg>` 上写 `data-art-scale="0.1" data-art-origin="0,0"`，
编译时按 `(坐标 − origin) × scale` 换算。

## 标记

标记可以写成 `data-*` 属性，也可以写进 Inkscape 图层名或元素 id，用空格分隔，例如
`bone:arm_r pivot:54,41 layer:front`。两种写法等价。

| 标记 | 作用 |
| --- | --- |
| `view:front` / `three-quarter` / `profile` / `back` | 一个朝向的根组。没画的朝向借最近的：三分之二 → 侧面 → 正面，背面 → 正面。整张图没有任何 view 组时视为正面。view 组以外的内容（参考图、辅助线）被忽略 |
| `bone:<名字>` | 骨骼组。嵌套关系就是父子关系；组里的图形跟这根骨头动 |
| `pivot:x,y` 或组内一个名为 `pivot` 的小圆 | 骨骼的转轴（肩、耳根）。小圆本身不画 |
| `layer:back` / `body` / `front` | `body` 进静态身体缓存，不随骨骼动；`back` 画在身体后面、`front` 画在脸之后，二者都跟骨骼动。默认 `body` |
| `face:eyes:<状态>`、`face:mouth:<状态>` | 表情状态。可以是隐藏图层，编译器照样收 |
| `pupil` | 眼睛状态里的瞳孔组，随眼神跟随平移（最多 ±2 单位）。没有它眼睛就不跟随 |
| `prop:<名字>` | 道具，平时不画，动作需要时出现。挂在所在的骨骼上，默认在前层 |
| `anchor:<配饰槽位>` | 一个小圆的圆心作为配饰挂点，挂在所在的骨骼上，例如 `anchor:usagi.earwear` 放在右耳组里，蝴蝶结就跟着耳朵摆 |
| `palette:<1-9>` | 这块填色改用皮肤调色板的第 n 色 |
| `ignore` | 整组跳过 |

## 骨骼名

动作按名字驱动骨骼（`rig/motions.mjs`），缺的骨骼就不动：

`root`、`body`、`ear_l`、`ear_r`、`arm_l`、`arm_r`、`hand_l`、`hand_r`、`leg_l`、`leg_r`、`tail`。

`_l` / `_r` 指画面上的左右。旋转以顺时针为正：右臂 `-r` 向外上抬（挥手），`+r` 向身体收（喝水）。
`hand_r` 在喝水时反向转，让杯子基本保持竖直。

## 状态、动作与道具

| 类别 | 可以画的名字 | 缺了会怎样 |
| --- | --- | --- |
| 眼睛 | `neutral`（必需）、`closed`（眨眼用）、`sleepy`、`half`、`droopy`、`smile`、`content`、`sparkle`、`wide`、`surprised`、`curious`、`focused`、`determined`、`pleading`、`shy`、`waiting` | 沿回退链找最近的，例如 `sparkle → wide → neutral`，`closed → sleepy → half → smile`（见 `rig/face.mjs`） |
| 嘴 | `neutral`（必需）、`closed`、`smile`、`grin`、`open`、`talk`、`surprised`、`chew`、`wavy` | 同上，例如 `grin → smile → open` |
| 动作 | 46 个行为/会话语义动作，加 `idle`、`curious`、`sleep`、`chew`，共 50 个独立定义 | `usagi-form.mjs` 保留各动作身份，不再把 46 种动作合并为十种；未知动作退回 `curious` |
| 道具 | `rig/props.mjs` 的 `PROP_SETS` 将语义道具解析为 52 个原生道具名 | `resolveRigProps` 单独上报缺项；内置乌萨奇不再用旧角色道具替补，显式 `none` 不借用动作默认道具 |

背面刻意不画五官；其他朝向缺少脸层会报告缺口，内置乌萨奇不会改画退役角色。
动作可以按朝向覆盖单条轨道，写作 `sip@profile` 这类键（见 `MOTIONS.sip.views.profile`）。
低刺激模式下骨骼和道具只取动作声明的静止位姿，不做循环摆动。

### 动作、道具与表情的协作

- `rig/motions.mjs` 分别定义挥手、击掌、接星、打字、浏览、整理、编织、做饭、浇水、打鼓等轨道，
  周期结束回到起始位姿；左右手、耳朵、脚和尾巴可以各自变化。`root` 不负责旋转整只角色，
  否则实时四肢会离开缓存中的静态躯干。
- `usagi-body-motion.mjs` 对整张角色执行位移、转动及明确的伸缩，因此缓存身体、脸和活动部件一起移动。
- `rig/props.mjs` 拆分组合道具：文档是纸和笔，毛线是织物与双针，杂耍是三只独立球，宝藏是铲子和箱子。
  `samplePropPoses` 给飞行、旋转、显现等局部动画；手持道具用腕骨枢轴，场景道具用显式美术枢轴。
- `face-choreography.mjs` 为注视、动作接触、收势选择独立眼嘴，并缓慢改变视线、眼睑张开与眼间距。
  SVG 眼层以各眼中心作为局部坐标，`rigEyeMatrix` 只缩放对应眼部，不拉伸整张脸或眉毛；
  必要反馈、输入安全态等较高优先级表达仍胜过动作表情。低刺激时不追加动态表情。
- `usagi-accents.mjs` 画睡眠/困倦的矢量 Z、饥饿时的胡萝卜想象气泡和咖啡杯热气，接收外部单调时间。
  低刺激时保留静止符号；未知状态返回未绘制，让调用方正确决定是否使用通用回退。

### 会话中的多段动作

`content/companion/activity-stories.mjs` 为既有 12 个专注/休息活动声明阶段、道具、表情与阶段内循环数。
例如阅读按“翻书 → 阅读 → 记下发现 → 回看 → 收尾”推进，写文档包含构思、落笔、回读与整理。
`presentation/activity-playback.mjs` 是纯采样器，输入原活动进度，输出当前阶段及局部进度；
`surfaces/pet/action-playback.mjs` 只从原预览、彩蛋或会话源取得活动，不创建第二个活动调度器。
原会话时长、暂停/恢复和表达导演的优先级不变，不新增计时器、奖励或持久化字段；
低刺激时固定在声明的代表阶段及局部 0.5 位姿。

### 活动镜像的专属动作

音乐与 AI 仍使用原 `mirror-music`、`mirror-ai` 类别和 24/30 秒周期，不新增原生 Rig 身体或脸层。
`usagi-event-actions.mjs` 在支持层采样器内为这两个 ID 提供短手、耳朵、独立脚部与注视轨道；其他 browse/type/dance
动作不会借用这组覆盖。音乐耳机拆为后带/远侧耳罩和前侧耳罩，杯状耳罩在脸外侧，整件衣帽仍按原穿戴层序盖在前面。
AI 保留面向宠物的小电脑，不画表示生成进度的省略点；键盘底座、短手、外盖按深度分开，三分之四使用局部透视适配。
`usagi-event-robot.mjs` 在身体旁的有界区域 x75–97/y37–65 绘制奶油色机身、薄荷色脸屏、淡紫侧件与空白便笺的小机器人。
它按原类别循环做轻微看向伙伴/点头/手部动作，只是假装协作；与电脑共用入场/退出包络和静态策略，不延续到被打断或已退出的动作。
强化后的耳机以清晰外壳、内垫和侧支架提高原生尺寸辨识度，后带和远侧部件仍服从原衣帽/耳朵层序。
两个镜像允许正面与双眼三分之四，默认正面；不能用缩扁身体来冒充新角度。双波嘴、两只原脚和鞋子的独立踝矩阵保持不变。
`mirrorPresentation` 仅描述可见动作的入场、循环和收势，细则见 ARCHITECTURE「活动镜像」；没有音乐节拍或 AI 内容输入。
生成参考保存在 `assets/companion/usagi/real-events/sources/`，只确定道具与动作关系，不作为替换身体贴图。
强化关系图及来源记录在其 `context-emphasis-v2/` 子目录；生产仍是原生矢量道具和未修改的 canonical 身体/脸。

### 长会话的连续性边界

`activity-playback.mjs` 只采样已有活动内的分镜，不创建计时器、奖励或持久化状态。`viewMotion` 保留原活动的朝向，
换工具或换动作不会在正面与侧面之间瞬间跳轮廓；没有专门转身轨道时保持这一约束。相邻分镜使用同一道具时持续握住，
确实换道具时用 220 ms 放下／拿起透明度配合已有骨骼姿势混合。低刺激模式固定一个分镜和完整道具。

乌沙奇的照镜子动作由绑定右手的原生小镜子及其中的兔脸倒影表达，不能套用团子兽的全身镜像叠层，
否则会把第二只完整兔子盖在主角色上。`form-art.drawActionOverlay` 把这类形态专有表现交还画笔；普通共享文字特效仍共用。
桌宠默认使用 `pet` 动画通道；多实例预览注入独立 `renderChannel`，避免不同画面的过渡姿势互相污染。

### 七个服饰槽位与八个挂点

`usagi.headwear`、`usagi.aura`、`usagi.neckwear`、`usagi.backwear`、`usagi.sidebag` 绑定 `root`；
`usagi.earwear` 绑定 `ear_r`。`usagi.footwear` 绑定 `leg_l`，辅助挂点 `usagi.footwear-r` 绑定 `leg_r`，
它不是第二个可选槽位。右靴取消合成器已经应用的左踝矩阵再应用右踝矩阵，两脚各自抬落。
25 件服饰的等级、自动默认与选择保留规则见 PET_VISUAL「乌萨奇的独立衣柜」。
生成配饰直接取 `sprite.bone` 对应的 Rig 世界矩阵：耳饰随耳骨，两只鞋各随自己的腿骨，不能再次套用旧左踝补偿。
上面的取消左踝矩阵逻辑只属于经典路径鞋。生成鞋全部加载完成后才隐藏原 `leg_l/leg_r`，避免双脚叠加或冷启动缺脚。

## 渲染顺序

每帧：动作后层（`back` 部件与后层道具）→ 配饰后层 → 身体缓存 → 脸 → 配饰前层 → 动作前层
（`front` 部件与前层道具）。有 Rig 时即使没有正在播放的动作也会画动作层，否则手和耳朵会消失。
伙伴页肖像没有实时动作层，所以 `fit` 模式下身体画笔把三层按静止位姿一起画进去；
前层衣物完成后 `portraitForeground` 以相同静止位姿盖回手部，避免完整布料遮住手。
身体、脸和服饰共用实际穿搭的 fit bounds，不能为每层独立缩放。

身体缓存键在原来的基础上加 `|rig:<id>@<version>`、衣柜版本及 `hide:<bones>`；
隐藏原脚的集合只在所选生成层全部 ready 后改变。fit 肖像还包含实际 bounds，键不随位姿变化。

**只有 `back` / `front` 层会动。** 身体位图只缓存 `body` 层，所以画在 `body` 层的部件即使绑在会动的骨骼上（耳朵、手臂、手、腿）
也一动不动，还会和同一根骨骼上别的部件脱节。`npm run rig:check` 会把这种情况列成一条缺口并告诉你挪到 `back` 或 `front`。
躯干自己（`body` 骨骼，只做呼吸缩放）画在 `body` 层是正常的。

**动作之间的过渡。** 睡觉、读书、写字、喝水、啃咬、挖掘这几个动作的第一帧就是“保持的姿势”（啃咬的手臂离待机 0.9 rad），
不混合的话切进去、切出来会在一帧内瞬移（实测最多 33 个美术像素）。`rig-art` 只在“动作或朝向变了”的那一刻做一次
smoothstep 混合，时长 200–420 ms，随两个姿势的角度及平移差距增长（差 4.7 rad 的极端一对也是被摆过去，不是甩过去）。稳定播放时姿势就是原始采样、
幅度不变；混合中途被打断就从当前显示的姿势接着走；启用减少动效时立即固定完整姿势，不残留过渡摆动；帧停了超过 500 ms（窗口隐藏、节流）或时钟倒退就直接对齐。
过渡需要单调时钟：调用方不传 `elapsedMs`（静止的肖像）拿到原始姿势，也不会碰过渡状态；`channel` 让多个持续动画的画面各自独立。
`test/rig-continuity.test.js` 对所有动作两两切换逐帧检查骨骼点位移。

## 支持与限制

- 支持 `path`、`rect`、`circle`、`ellipse`、`line`、`polyline`、`polygon`，`transform` 全部种类，
  填充、描边、线宽、端点、拐角、`opacity`、`fill-opacity`、`stroke-opacity`、`fill-rule`，
  写在属性或内联 `style` 里都行。
- 渐变压成中间一个色标的纯色并给出警告；`<style>` 样式表、`<text>`、`<image>`、滤镜、蒙版不支持，
  编译时逐条警告。Illustrator 导出时选“演示文稿属性”，Figma 导出 SVG 默认可用。
- 编译结果只含路径字符串和数字，校验器（`rig/schema.mjs`）拒绝非路径字符、非颜色值和骨骼环，
  最多 6000 个图形、64 根骨骼。
- 画布没有 `Path2D` 的环境明确报告 unsupported；Node 几何测试使用记录型 Path2D，真实绘制由 Electron 或离屏 Skia Canvas 验证；后者不能替代原生窗口、透明合成与 GPU 验收。

## 代码位置

| 文件 | 职责 |
| --- | --- |
| `src/capabilities/companion/presentation/rig/schema.mjs` | 文档格式、校验、朝向回退 |
| `rig/pose.mjs` | 前向运动学：骨骼世界矩阵 |
| `rig/motions.mjs` | 动作关键帧、朝向覆盖、低刺激静止位姿 |
| `rig/face.mjs` | 眼嘴回退链、眼神范围、眼睑与内收矩阵 |
| `rig/props.mjs` | 语义组合道具、道具动画、枢轴与缺失上报 |
| `rig/paint.mjs` | Path2D 缓存与绘制 |
| `rig/source.mjs` | 加载与一次性校验 |
| `rig/rig-art.mjs` | 实现 `ARTIST_METHODS` 画笔协议 |
| `presentation/usagi-art.mjs` | canonical Rig、生成衣柜与场景点缀的装配入口，汇总 ready/订阅 |
| `presentation/usagi-support.mjs` | 专属辅助画笔的窄装配入口，不含身体或脸 |
| `presentation/usagi-appearance.mjs`、`usagi-seasonal-wardrobe.mjs` | 经典路径服饰与加载中回退、独立踝骨附件 |
| `presentation/usagi-raster-wardrobe.mjs` | 17 件生成服饰的四视图、骨骼附着、ready 和肖像边界 |
| `presentation/raster/source.mjs`、`raster/paint.mjs` | 版本化 PNG 加载、受预算约束的缓存与透明合成 |
| `assets/companion/usagi/wardrobe/` | 当前编译衣柜、运行 PNG 与可用编译输入 |
| `tools/usagi-wardrobe/assemble.mjs`、`generation/` | 编译运行时适配；母图重建另需完整原始输入 |
| `presentation/usagi-accents.mjs` | 睡眠、困倦、饥饿和咖啡状态点缀 |
| `presentation/usagi-body-motion.mjs` | 整体位移、旋转与伸缩 |
| `presentation/face-choreography.mjs` | 动作眼嘴、注视与表达优先级保护 |
| `presentation/activity-playback.mjs` | 会话阶段的无状态采样 |
| `content/companion/activity-stories.mjs` | 12 个会话活动的多段呈现表 |
| `tools/rig-build/` | SVG 读取、编译、覆盖率、预览台、示范角色 |

测试入口：`test/pet-rig.test.js`（运行时）、`test/rig-build.test.js`（编译器）、
`test/rig-continuity.test.js`（过渡）、`test/usagi-wardrobe.test.js`（经典服饰与状态几何）、
`test/usagi-raster-wardrobe.test.js`（生成服饰、ready、骨骼附着与缓存）。
这些行为与采样检查不能代替真实 Canvas/Path2D 截图、动态回放和桌面可读性检查；最终验收记录见 VALIDATION。

### 握伞、脚部闪光与双波浪嘴形

`usagi.umbrella-grip` 与右手骨骼枢轴重合；伞杆、握手使用同一世界矩阵，不能另叠一段伞的旋转。
伸出去的握手由肩到手的同色前臂连接，连接线画在身体后层。四个视角均逐相位验证伞杆穿过握点。
`shoe-glint-l/r` 分别绑定左右腿，只画小高光，不额外画固定鞋底；穿靴子、裸足与侧视图都仍只有真实两只脚。
全部九个嘴形都保留乌沙奇上唇的两个波浪。张嘴、咀嚼与惊讶通过下部轮廓变化，不删除这条识别特征。

### 当前生成衣柜、冷启动与可逆适配

`content/companion/usagi-wardrobe.mjs` 的三套只读搭配为晴日园丁（六件）、雨后散步（五件）、月色邮差（六件），
合计 17 件生成款。另保留旅行短披风、嫩芽耳夹、麦色小草帽、胡萝卜小挎包、柔光小环、星点软靴、
樱花耳夹、奶油小王冠八件经典路径款，当前共 25 件。
搭配卡仅预览既有单件，不是解锁礼包，不新增一键多槽装备命令或第二份装备状态。

`usagi-raster-wardrobe.mjs` 的 `ready` 表示当前选择在实际绘制视图中的所有生成层已加载；
`usagi-art.mjs` 将它透传到 artwork 顶层。`companion-portrait.mjs` 据此登记待重绘缩略图，素材完成后重绘 hero 与预览，
并在 dispose 时释放订阅；仅有内层 `wardrobe.ready` 不能让冷启动静态肖像更新。
`ready()` 的 Promise 完成不等于所有资源成功，仍须检查 `failed`、`missingAssets` 和实际画面。
衣柜源缓存限制为 256 项/48 MiB；当前 105 个活动 PNG 的解码预算为 3,347,748 字节，不代表整个进程内存。

公开树中的运行时描述、PNG、编译 manifest 与必要校验输入必须保持一致；不包含完整历史母图、参考与评审证据。`generation/` 的母图重建需要额外的完整来源，不是公开开发入口的自足保证。应用包排除 sources，保留所有活动资源，过滤回归见 ARCHITECTURE「换装与伙伴形态」。

- 历史云彩小围巾的 `three-quarter` 平移 `[0,2]` 保留在旧来源；当前围巾使用新的前后衣料层
- 三星小光弧先保留原件，再从原图提取三个金色星形，统一缩放各星并重排为更低、更宽的稀疏淡紫弧线；
  四张结果存入 `runtime-fits/constellation/`，原高弧、拒绝的整体缩小和路径替代证据仍可追溯
- 编译器先应用星弧的 per-view override，再以 `[0,1]` 平移增加分数 DPR 下打嗝峰值的下移余量；
  不可用覆盖原 PNG 或整体缩小把这些不同修正合成不可逆的一步

静态 fit 图、离屏 Skia 的生产 painter 和运行时数据测试各证明自己的范围，不能证明已完成真实 Electron/浏览器桌面验收。
最终检查和未关闭门禁见 VALIDATION。

### 衣物前后关系

雨后散步、晴日园丁、月色邮差各三件身体服饰/包共九个 ID 使用 `items-depth-v2/`。
三份 `source-specs/*-depth-v2.json` 用 `replaces` 固定被替换原始描述的 SHA256；未匹配的重复项、缺少前项或无效声明均报错。
编译器只统计最终活动层；完整潜在衣料、遮挡契约、来源 hash 与运行时字节关系不可随意改写。公开树的编译核对不代表母图提取流程的全部输入均已提供。

`usagi-garment-depth.mjs` 把 opt-in 包身衣物的远手退后。`RigArtist.partLayer` 为窄可选接口，其他形态沿原 layer。
静态 fit 肖像在服饰 ready 后延后前景手，`appearanceForeground` 在整套前层衣物之后只执行一次；
没有衣物、冷加载或加载失败不得改变裸身层级，也不按动作时钟增加身体缓存键。
动态动作必须检查抬手后的衣料完整、远手隐藏以及握伞/工具的近手接触。

### 姿态片段子模块边界

小幅运动沿现有 Rig；大剪影姿态片段只可在角色画笔内部实现。`form-art.mjs` 与
`ARTIST_METHODS` 不扩展，不增加并列渲染器。`clips/clip-manifest.mjs` / `clip-sampler.mjs`
提供内容校验和纯采样；片段实验仅允许画笔内部的默认关闭跑步样题。身体材质遮罩与脸部叠加独立；
局部挂点、bounds 与遮挡共用现有坐标，根变换只施加一次。完整组 ready 后才原子切换，
缓存/订阅释放归现有生命周期；已失败的原生门禁继续保留，不将样题开发当成内存修复或发布验收。
具体规范见 PET_VISUAL「动画表达方式与片段契约」，运行与未通过项目见 VALIDATION。

## 手根、鞋口与帽饰投影

Usagi 的打哈欠与击掌使用短而厚的开口根轮廓，远手在身体后，近手在原有前景衣料前先绘制，再由完整衣领/披风自然遮挡；不以肤色圆或矩形擦掉衣料。侧面喷嚏保留原双波浪嘴形，仅用两轴投影与紧凑下轮廓适配侧视。打哈欠时，若用户已选头饰，该头饰拥有头部阶段，不叠加临时睡帽；裸身、仅耳饰或光环仍可使用睡帽，不改装备选择。

三套生成鞋履仍使用原 PNG。鞋口露出少量原脚填色，后层鞋壳受身体遮挡，近鞋前壳以 U 形裁剪排除完整鞋口；每只鞋继续绑定各自腿骨，三分之四/侧面远鞋较小且略靠后。原脚、身体、鞋图和脸图不为匹配鞋口而重画。帽子按两组实际接触点拟合颅顶；近耳饰在其后绘制，允许读得清的自然遮挡，不要求侧面两个包围盒永久分离。

### 既有动作的短手与握持轮廓

扩展只在既有动作/故事语义上启用：wave 与无道具 stretch 使用身体长出的短手；yawn、high-five
继续使用 既有的完整系数与画笔。profile 的近侧伸展手向前、在张嘴下方通过，远手仍向上，
不移动嘴、不限制原有朝向。普通 wave 仍按生产策略只显示正面；故事保留自身 viewMotion。

读写、键盘、编织、打鼓、积木、锅具、杯子和侧向工具使用一条开放肩根到既有掌端的轮廓，
避免旧短掌加第二条连接臂；世界矩阵、腕部/工具挂点、道具时序不改。rest-plant 的 organize
持盆阶段采用同一条近手轮廓。rest-nap、接星与实际输入情境保持 既有行为。

只将 stuck-corner 的 profile wavy 嘴投影为已审阅的平衡双波浪；其余嘴形与眼睛不动。
普通 magic-trick 的星星从帽沿下方移到脸外再升起，保留旋转、透明度与时序；click-30 的
情境召星不进入这一分支。photo-pose 仍为对着场景相机摆姿势，不新增握相机动作。

手部轮廓在故事阶段切换后继续跟随实际混合腕位；仅在仍超出旧连接臂阈值时保留，缩回后恢复原短掌。

AI协作确认修改与分层时间线不修改伙伴像素、素材、rig动作、坐标、碰撞或输入命中规则；相关UI由popover功能模块承担。伙伴v1美术冻结继续有效。
