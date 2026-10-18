# 统一验收候选交付

状态：代码/合同层完成；视觉、真实GPU、原生窗口、生产集成未通过/未实现。

实现：
- 固定99 CSS身体宽、219/220明确偏移、DPR可配cap、0尺寸延后、floor/正交换算/安全矩形与原子resize端口。
- 两张真实V1 PNG及哈希：focused base、coffee-shop整图decor。美术不重画，不冒充交互桌面。
- 独立具备三角面与top接触平面的桌板proxy，世界尺寸必须另行校准。
- 环境共享lease宿主：复用现有coordinator，跨日锁定、两类generation与selectionToken重核、事实TTL、取消/晚到/双actor/hidden恢复/100轮资源稳态。
- 不重置actor，不触sourceSkin/骨骼/几何/灯光；无额外阴影、IPC、数据库shape、服务或生产入口变更。

证据：
- candidate49/49，隔离复制49/49，独立复核49/49。独立复核三项P2全部修复且新增回归。
- repo-check基线integration71/71；全仓check8359通过/3历史缺依赖失败/29跳过。未包含候选，所以不是新背景集成证明。
- GPU/真实13mesh投影校准及装配遮挡未运行；已知Chromium/云CDP阻塞未绕过。

入口：README.md、src/、tests/、evidence/verification.json、final-candidate-allowlist.json。没有ZIP或远端发布。
