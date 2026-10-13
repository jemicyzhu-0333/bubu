# 新增动作 / 姿势的标准流程

目标：新增动作、姿势或配饰时，尽量只改数据与素材，按同一套插槽接口接入，再由检测器做部分兜底。检测器覆盖范围有限：`limbs:check` 的像素扫描只查 10 个最常出问题的动作（`--all` 才查全部）；配饰矩阵每个动作只抽 6 个帧位；原生窗口、GPU 合成和高刷新率显示器上的表现，不在自动检查范围内。下面每一步都有对应的文件和命令。

## 1. 声明动作（content）

1. `src/content/behaviors.mjs`：动作 id、`motion`、`prop`、时长。
2. `motion-core/action-capabilities.mjs`：能力声明，**不要在画笔里写动作 id 判断**。常用字段：
   - `body` / `story` / `gesture`：身体姿态、道具故事、自由手势；
   - `ownsGround`、`groundShiftScale`：自己控制脚底；
   - `wear`：配饰适配 `{ stow:[{region|slot, window, why}], holds, layers:{slot:pass}, follow }`；
   - `limbs`：可选，逐侧覆盖肢体意图 `{ l: {kind, bend} | null, r: … }`；
   - `yieldPropToHeadwear`：用户头饰优先于动作自带头部道具。
3. 姿势关键帧放在 motion-core 数据表（`track.mjs` / `body-poses.mjs` / `accents.mjs`），曲线用统一的缓动和弹簧。

## 2. 肢体：插槽 + 意图（不写画笔代码）

- **Usagi**：在 `src/content/companion/usagi-limbs.mjs` 的 `USAGI_LIMB_INTENTS` 增加一条规则，按 `motion`/`motions`、`props`/`anyProps`、`side`、`contact`、`gesture` 匹配，给出
  - `kind`：`grip`（爪子握或按住道具）、`gesture`（自由手）、`support`（保留原短掌，手臂从下方长出）；
  - `bend`：`table`、`fold`、`lateral`、`out`、`compact`、`gesture`、`support`（`USAGI_LIMB_RIG.bends` 中定义朝向与最大弯曲）；
  - 可选 `whileExtended`：只在腕部仍伸出时保持。
- 腕部目标用 `usagi-contact.mjs` 的 `placePaw(bones, data, side, target, armAngle, toolAngle, maxReach?, reachFrom?)` 写进手骨。自由伸手请传 `USAGI_LIMB_RIG.supportReach`，避免手臂被拉长；握道具的目标保持原值。
- 新视角或新形态：在 `USAGI_LIMB_RIG.sockets` 增加插槽坐标（根骨空间），骨长保持不变。
- **腿**（仅 usagi）：动作只摆脚（腿骨），不用管髋。腿顶被拉到髋下方时，`solveUsagiLegs` 会自动接回，地面线不变；`limbs:check` 会检查腿是否离开髋。注意：现有 44 个动作的腿都处于收起状态，这层 IK 目前没有在任何动作里触发过。
- **减弱动效**（`calmVisual`）：肢体直接使用静态姿势，不做意图淡入淡出，也不做肘部速度滤波。
- **Dango**（limbs v2，素材已交付、**生产默认关闭**）：清单 `assets/companion/dango/raster/limbs/limbs.json`（`dango-limbs/1` v2，契约见同目录 `COMPOSITION.md`），由 `dango-limb-assets.mjs` 校验加载（含 `joints/elbow.json`、`interfaces/interfaces.json`），`dango-limb-compose.mjs` 按契约合成：固定肩点、6+6 骨长、只用 bend≤150° 的肘对、腕 = 接触点 −(grip−root)、肩部覆盖模板、肘部 mask/patch 修补、225 挥手接口；运行时 three-quarter 由 three-quarter-left 关于 x=66 镜像。逐动作/视角/侧做门控：该侧全部采样接触点误差 ≤ `maxContactError`（1.25）才启用，否则整段保持旧画法，不移动道具；四分之三视角的远侧手（在身后）一律保持旧画法。素材标注 `runtimeReady=false`，因此生产只在 `DANGO_LIMB_RIG.hostAcceptsContract` 设为 2 时启用（当前为 null）。爪子姿势由 `poseByProp`/`poseByMotion` 选择。腿和脚尚未接入（素材无步态数据）。可用 `node tools/dango-limbs-qa.mjs` 查看各动作可达率。

## 3. 配饰

- 新槽位：在 `motion-core/accessory-resolver.mjs` 的 `ACCESSORY_MANIFEST` 写清楚挂点、区域、各视角层级（或 `hide`）、面积预算、跟随参数和 `stacksUnder`。
- 动作只声明 `wear`。解析器按 换层（tuck）→ 挖空（cut）→ 收起（stow）的顺序处理，不允许穿模。
- 背面视角：双爪在服装 front pass 内有自己的层（`FORM_TRAITS.usagi.backPaws`）：盖在领饰、围巾、前挂式（`frontHung`）围裙上面，压在披风（`coveredBy`）下面。新的背面服装如果真的会盖住手臂，就加进 `coveredBy` 槽位；前挂式的加进 `frontHung`。
- 动作细节（标记、光点）锚在头顶等区域时，如果和某个配饰重叠，在 `REGION_CLEARANCE` 里写偏移和视角，不要隐藏配饰。
- 矩阵检测器：半透明道具按相对对比度判断；面向观众的动作按实际绘制的视角判断；≤8px 的下摆接触不算遮挡。

## 4. 检查

```bash
export PET_MOTION_CANVAS_PACKAGE=$PWD/node_modules/@napi-rs/canvas DANGO_CANVAS_PACKAGE=$PET_MOTION_CANVAS_PACKAGE USAGI_CANVAS_PACKAGE=$PET_MOTION_CANVAS_PACKAGE
npm run limbs:check                      # 几何追踪 + 最常出问题动作的轮廓断口扫描
node tools/limb-check/check.mjs --all    # 全部动作的像素扫描
node tools/limb-check/trace.mjs --ids=<id> --out=trace.json
node --expose-gc tools/accessory-matrix/scan.mjs --item=<item> --views=auto,back --out=dist/matrix
node --expose-gc tools/pet-motion-craft/bench-frame.mjs --actions=<id>
npm run check                            # 全部门禁（已包含 limbs:check）
```

人工核对：
- 正常速度播放一遍，确认手臂不会突然出现或消失，也不会忽长忽短；
- 肩部和身体轮廓接成一条线，没有断口、双线或奶油色补丁；
- 爪子和手里的道具始终贴合，伸手时只是把手臂伸直，不会被拉长；
- 脸部（眼睛、嘴）不被手臂或道具挡住，脚底位置不变；
- 配饰矩阵里不出现新的 covers-prop、z-order-flip 或 visibility-pop。如果是有意遮挡，要在 `wear` 或 `yieldPropToHeadwear` 里声明。
