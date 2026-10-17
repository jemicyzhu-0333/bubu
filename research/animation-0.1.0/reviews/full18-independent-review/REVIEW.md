# Full18独立准入评审

## 当前结论

CPU/API准入技术范围可行。受审候选为 bubu-runtime-full18-candidate-20261017/research/animation-0.1.0/runtime-facepath05；最终源码已锁定并复跑，见末节。独立复跑277/277通过，包含原247及新增full18真实绑定和owner生命周期回归。无由此推出真实GPU、FPS、全部18槽过渡视觉或交互验收。

## 预算与边界

独立读取批准gold GLB，hash1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677。精确16,867,596源字节；2351accessors/2109views；8脸层，每层144targets；51,036渲染顶点，784,140展开顶点。GLB18节点，runtime含2包装节点计20。

前置decoded reservation：16,867,596保守BIN +16,389,416 view复制 +4,954,392 dense/sparse分配 =38,211,404。实际geometry backing20,999,184单独统计，并非整进程内存。源输入、准备包持有、JS/parser scratch、骨骼、renderer staging及GPU不能由此推出上限。保留7槽18,927,900预算及336,132展开量不变。

默认pool1,000,000展开预算只支持1个full18 actor；第二个在准入阶段原子拒绝。2个完整actor需显式至少1,568,280展开额度，同时满足其他预算。不得将pool actors上限当可实际容纳角色数。共享geometry与source cache不意味着共享actor morph权重/骨骼，也不意味着GPU成本已知。

## 源码审查

审查相对owner08实体发布版8处新增/修改模块。prepareFullFacePack为显式opt-in，full18独立purpose、格式限额、source/profile固定hash；默认prepareFacePack与neutral准入仍封闭。新JSON复杂度参数只由full preflight使用，原默认限额不变。director按完整source/profile登记选择18个精确ID，pack-policy双向不匹配在actor准入前拒绝。policy快照/retire继续使用已验证同一profile。未新增场景自动触发、随机优先级、交互或GPU能力。

01/04/07/08保留前导0，T05与T5独立；bare05/历史Face05不被当别名；R0与零权重Basis分开。D4的静态哈欠目标不提供长期hold场景语义授权。

## 独立探针

resource-plan.mjs/json直接读取金版和slice资产，重算所有资源计划。

binding-probe.mjs/json使用独立已批准库mapping-fixtures.json，非仅调用实现自身assert作oracle。4,626样本，在8个真实层共5,329,152标量权重逐项与正式mapper fixture比对全过；回Basis、默认第二actor拒绝前后stats相等、dispose后所有ownership统计及cache.live归零。零计数只证明资源所有权释放，不能证明GC或VRAM已回收。

单次独立prepare约157.04ms、冷create约251.81ms，属于共享云CPU观测，不能当稳定性能基准/FPS。候选自有benchmark另列，不与独立单次合并宣称分位数。

candidate-tests.txt为独立npm test全277/277输出。新增测试含所有18脸259强度采样、immutable geometry/clone隔离、前置预算差1拒绝parse/cache、cross-profile、完整18槽owner中断/隐藏/恢复/故障/生命周期。原7槽及observer/资源179+25+43历史范围保持通过。

## 未闭合范围

真实浏览器/WebGL加载、GPU morph texture上限/驱动能力、VRAM与帧时；全部18槽视觉过渡及中间形态的产品核准；多角色实际GPU预算；场景配置、活动来源、背景、道具/身体/拖拽抚摸均不在此次准入完成范围。

## 最终冻结复验（08:44 UTC）

FULL18-SHA256SUMS摘要77b15db986086ec683dcfb8ca3b79aa6460290938f6d373dc465528c6b82fd2f，独立校验35/35文件全部OK。最终仅移除2个闲置import、更新Seven过期注释；冻结后再次npm test为277/277通过，final-tests.txt。完整锁复制为REVIEWED-SHA256SUMS。

Director 8e2398af1a63017892ef85aef35afee350891f0e44043b917709a94ffa3fa4ec；actor-pool 04203b252b663c0fc8c80c9c74dfd11a5b74d7800a32d5718ba0a9f1f3df64da；face-suite 03f939410a7393d0bc6428772c80ab39850470bb9a223d2b8b9d8c9c70154bc1。

本次独立结论：通过完整18槽显式CPU/API准入候选关卡；无新增P0技术阻断。7槽默认不退化，其他未闭合范围不变。打包必须排除开发node_modules链接并按既有流程做实体依赖恢复检查；本报告未声称已对将来Git发布归档做独立恢复。
