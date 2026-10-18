# 背景环境宿主：独立 research 候选

本轮只准备背景／接触支撑面契约与环境资源宿主。没有改生产入口，没有接新动作，没有新增 IPC、数据库字段、检测器、服务或图像生成。统一最后验收前不接生产。没有创建额外 WebGL context。

## 已实现

- `src/stage-metrics.mjs`：纯计算，身体设计宽 99 CSS px（明确 `previewScale:2` 才是198）；独立219角色canvas、220背景canvas、105命中区；保留角色中心偏移(0,2)。V1背景frame=(18,27,184,148)，内部canvas偏移(-20,-30)，所以背景canvas相对窗口为(-2,-3)，没有假定两个canvas重合。
- 明确注入 `projectedBodyWorldWidth`、`actorAnchor`、`floorY`，不从PNG rect猜世界尺寸。camera保留既有方向基底，沿校准anchor平移；frustum、正交投影/逆变换、floor平面、viewport裁剪、安全区域、DPR cap一起给出。宽高改变不会自动缩小角色；窄容器可能裁切，必须由后续真实装配边界测量拒收。样例1.2世界宽不是已认可13mesh的测量结果。
- DPR独立于CSS resize输入更新，默认上限2可配；0宽/高延后。resize宿主先prepare，再以一个同步atomicSwap交换backing store、投影、hit换算快照；失败保留上一套。原子性需由渲染适配端满足端口契约，本候选使用可故障注入的CPU端口验收，未实现DOM/GPU原子交换。
- `src/background-descriptors.mjs`：实际V1 `focused.png` 基础图 + `coffee-shop.png` 装饰图，拷贝字节有SHA256。沿用色板、原rect、.56外层透明度、radial mask、coffee .58内部alpha；合成美术尚未视觉批准。两图均为screen-space不可接触整图，没有杜撰拆分的深度层。`screen-composition.mjs`只输出绘制描述，没有假称已经绘制。
- `src/contact-proxy.mjs`：独立world-space、有顶面/底面/侧面的24坐标/36索引桌板proxy，调用方必须提供世界尺寸。明确标注research proxy、未视觉批准；top-only接触平面独立于PNG。没有自动与图中桌子对齐，没有新增杯或桌到手转移动作。
- `src/environment-host.mjs`：只通过 `plan(trustedNow)` 消费现有SceneCoordinator；重新plan后同时核对policy/session/selectionToken/planGeneration/validityGeneration，拒绝晚到结果。宿主只拥有环境lease，不接收actor/骨架/材质/道具句柄。prepare、commit失败保持可诊断blocked，不选fallback。不创建另一份focus/theme状态所有者。
- `src/environment-pool.mjs`：环境资源引用计数、双actor共享、取消释放、旧load晚到回收、最后owner释放。load/dispose是窄端口。取消不强行中止共享底层load；若该load晚到且已无owner立即释放。生产loader必须自有超时/网络取消策略；这里没有额外计时器。
- 完成attach也报告 `visible:false, performing:false, frameVerified:false`，不能把decision或CPU接入当成可见/GPU/动作证据。相同计划重复刷新不再load/commit；没有循环RAF。

## 接口边界

生产对接时由现有组合根提供coordinator的plan、可信时钟、共享environment pool与environment-only surface。`surface.commit(resources, descriptors)` 和 `surface.clear()` 必须同步、原子、仅影响环境；commit失败不得留下部分场景。资源 `dispose`、lease release须不抛出，且load成功返回非null资源。隐藏/context loss调用suspend，恢复调用resume；需要在既有事实/显示变化及已知TTL截止事件触发reconcile。没有新的定时/主题来源。

resize `prepare(metrics)` 返回 `{release()}` bundle；`atomicSwap(bundle, metrics, generation)` 若失败必须保持旧bundle和旧绘制状态。端口实现必须避免重入；不是通用事件总线。丢失上下文后的真实GPU纹理恢复与renderer cache重建仍由既有renderer/lifecycle完成，本宿主只保证环境资源重新获取与TTL重核。

沿用现有已认可角色灯光，代码不改sourceSkin材质/骨骼/几何，也不创建新灯。当前shadowMode=none、cssShadow=false；环境无额外阴影。未来若接实际3D投影阴影，必须先处理原V1 petCanvas CSS drop-shadow，不能二者叠加。地面支撑不能挂在角色骨骼上。

## 验证

Node内置模块即可：`npm run check`。测试使用现有coordinator逐字节副本（只作为fixtures；来源/哈希在PROVENANCE），不是重写状态所有者，不导入生产私有状态。

矩阵覆盖220/440/窄/宽舞台 × DPR1/1.25/1.5/2/3；2×显式预览；0→可见；DPR独立更新；投影往返；resize失败/双dispose；双actor共享；取消/销毁/隐藏晚到；相同session ID的新selectionToken；相同display的新validityGeneration；load期间过期；隐藏恢复过期；并行部分加载失败；旧generation与新resource隔离；100次装卸稳态。直接调用已有coordinator验证固定focus跨日、检测与coffee变化、feed30秒、routine600/900秒事实TTL、重复事实不续时、独立来源撤销。

## 尚未通过的门

这是代码/合同层候选。没有渲染新预览，也没有声称GPU、Electron、Windows/macOS透明窗口或生产接入通过。既有WebGL阻塞：新Chromium AF_UNIX EPERM；可见云CDP与shellserver隔离；data:被安全策略拒绝。本轮不绕过、不用用户电脑、不新开服务。

后续统一验收仍需：用认可完整13mesh真实测量body投影宽/脚底校准；前视/批准三分之四、裸装/重衣柜/最大手伸展/杯桌深度与安全脸区；真实2D mask和透明排序；无双重阴影；原生DPR/跨屏；drawcalls、纹理解码bytes/峰值、CPU/GPU帧时、idle绘制。未把数学安全矩形当成实际帽顶/手/道具已无裁切的证明。

代码沿用根LICENSE与LICENSE-SCOPE，保留资产权利未决边界；没有发布/推送/打包ZIP。

## 本次证据结果

- 新候选独立目录：49/49；隔离复制到临时目录：49/49；独立复核：49/49。全部src语法通过，upstream coordinator逐字节一致。
- 原repo-check工作树（HEAD e7ac3952df0abf47e2dbee8689dd3a92e6345e30，未包含本候选）：旧integration71/71；全仓check8391项中8359通过、3失败、29跳过。三项均为历史theme adapter/schema21缺失stage依赖，详见evidence/verification.json。npm test失败导致后续lint/boundaries/architecture/assets阶段未执行，不能写成check通过。
- 以上仓库结果只是并行工作树基线，不代表新背景已参与生产集成。
