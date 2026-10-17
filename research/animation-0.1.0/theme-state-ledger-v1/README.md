# Bubu theme state ledger v1

第一阶段纯状态实现，CPU/Node参考闭包。没有生产事件接入、没有自动播放、没有修改冻结runtime或main。

## 已实现

- 精确注册表与批准/能力准入；测试ID全部 `fixture:`，生产表为空。
- routine默认600秒、显式600–900秒；feed30秒。只保留成功事务携带的原始期限；不是动画hold。
- 独立source期限求并集；撤销单源、严格截止边界、补录不激活、修改不续时。
- 稳定业务namespace、完成代际、revision完整快照；未知旧发生ID不能被当永久业务身份。
- 输入深层严格校验，拒未知字段/getter/proxy/原型/数组洞；批次原子接纳。
- 有界幂等状态：满容量拒绝，不静默遗忘。显式权威封存水位释放记录，旧水位永久拒绝。
- 严格导出/恢复；恢复原剩余期限。参考本地checkpoint将snapshot和upstream cursor同文件原子替换，另有全新Node进程恢复演示。

## 运行

声明最低Node >=20；本次实际验证Node v24.19.0。无需npm install，无第三方包。

- `npm test`：实现自测，含最大合法容量/配置恢复、严格输入、撤销乱序和真实文件回放
- `npm run demo`：独立新进程读checkpoint，恢复10秒剩余资格，重复投递不续时，原期限到达即失效

API: `createLedger(config)`、`restoreLedger(snapshot, now)`；对象方法 `applyBatch(events, now)`、`project(now)`、`snapshot()`、`seal(namespace, throughOrdinal, checkpointId, now)`。事件/注册表精确字段见 `CONTRACT.md` 和 `fixtures/fixtures.mjs`；运行错误包含稳定 `ContractError.code`。

`project`仅报告事实资格。所有输出明确selected/visible/performing=false；不把资格冒充显示成功。

## 上游必须先完成的协议

真实生产adapter尚未实现。现有V1 postcommit事实缺原生operation/origin、完整完成代际、稳定事务映射等字段，不能直接喂入此模块。新契约需要业务层权威提供original完整事实、非递增deadlineOccurredAt、completionOrdinal与封存保证；不是renderer自造字段。首次只见edit/correct/revoke而没有已接纳初次成功，明确输出needsReconciliation=true（admissionReason=needs_reconciliation），不静默假造资格；可通过restoreLedger载入权威保存的原接纳账本解除，不能仅凭新编辑通知自愈。

上游可投递真正的新提交事件及其原样durable replay；replayed成功回包不是新事件。输入postCommit=true只是一项声明，不是认证，部署时必须隔离不可信调用者。

封存要求权威证明某ordinal范围永久关闭且不存在未送达有效完成；不得按“好像过了很久”、最大已见revision或本地时钟猜封存。没有这条协议，4096记录满后显式阻塞。旧业务identity在封存后被错误分配新ordinal不属于模块可独立检测的情形。

## 时间与持久边界

调用方的now必须来自可信UTC与单调时钟映射，单调不回退。hidden动画freeze不能冻结事实时钟；恢复展示前先按新now求资格。模块没有访问系统时钟，也不能认证调用者是否给了真实时间。

checkpoint参考适配器限定单写者、可信目录、本地文件系统。写入临时文件fsync后rename并同步目录；若rename后目录同步失败，错误携带checkpointMayBePublished=true，调用者须先读取核对。不能当作生产outbox或跨进程事务认证。ack/对外曝光新资格前应完成snapshot+业务cursor持久提交；文件丢失/回滚必须向权威源重建，不能新建空账本继续假称幂等安全。SHA256只检测意外损坏，不是签名/权限校验。读取先stat拒绝超过128MiB的文件，再按至多64KiB分块读取，累计硬上限带额外1字节探针，读后复核大小/mtime以发现增长、截断或修改。仍限定可信目录；没有注入rename后的目录同步失败或断电故障。

## 未实现，明确不算通过

专注背景session锁执行器、overlay容量/兼容仲裁、身体/手/socket/prop/face资源租约、稀疏动作预算、异步资产过期释放、检测开关/采样、生产preset目录/真实美术能力、跨设备outbox与浏览器/GPU观感。这里没有上述API，也没有库存/喂食写入路径。

原r3的39项设计真值表逐项范围映射见 `COVERAGE.json`。纯状态子条件可测试；表现或来源认证部分仍deferred，不把39项全称“已运行通过”。

## 来源与版本

基于已冻结r3设计与独立来源审计，用户确认routine600秒默认（指定preset可到900）、feed30秒、历史不触发、修改不续时，并要求大量边界测试。审核当前生产main为1a66a0d3b7a51b19ac843b80f6629d0eb20eeb18；本模块不修改它。发布由主任务在feature/pet-animation-v2另行提交；本目录不自称已经推送。
