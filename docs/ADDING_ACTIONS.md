# 新增动作 / 姿势的标准流程

目标：新增动作、姿势或配饰时，只改数据与素材，按同一套插槽接口接入，并由检测器自动兜底。下面每一步都有对应的文件和命令。

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
- **Dango**：在 `assets/companion/dango/raster/limbs/limbs.json`（`dango-limbs/1`，规格见出图说明）加帧：`segments`、`paws.<pose>.views.<view>[]`（每帧写 `angle`、`root`、`grip`）。代码会按 IK 解出的角度选最近一帧，不旋转。新姿势只需加一个 `paws` key，代码不用改。

## 3. 配饰

- 新槽位：在 `motion-core/accessory-resolver.mjs` 的 `ACCESSORY_MANIFEST` 写清楚挂点、区域、各视角层级（或 `hide`）、面积预算、跟随参数和 `stacksUnder`。
- 动作只声明 `wear`。解析器按 换层（tuck）→ 挖空（cut）→ 收起（stow）的顺序处理，不允许穿模。
- 背面视角的领饰会自动绕开双爪挖空（`FORM_TRAITS.usagi.backPawCut`）。

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
