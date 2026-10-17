# Bubu theme state ledger v2

有限资格窗口版本。保留用户规则，去掉v1主题专用ordinal/永久封存；v1另目录冻结。

## 功能

- routine默认600秒、preset可600–900秒；feed30秒
- 多来源独立期限并集，单源撤销；历史不触发，修改/重放不续时
- 真正完成代际、最高revision、完整当前状态与严格精确映射准入
- routine保留至original时间+900秒，feed至+30秒；撤销、缩短、未知映射不会提前删除
- 到安全期限后清理；旧事件先判过期、不再占record，长期历史不会累计停收
- 当前窗口容量满仍原子拒绝，不逐出撤销记录
- 显式needsReconciliation诊断；恢复需独立权威cursor/time floor，不能靠checksum检测旧快照回滚
- project给出来源身份/代际/修订和资格快照，供后续场景协调层消费；不声称已经显示

没有生产adapter或真实preset映射；生产registry为空。此模块不扣库存、不播放、不切专注背景，不把能力声明当真实3D验收。

## 运行与接口

Node最低20，本轮实际24.19.0；无npm install或第三方包。
- npm test
- npm run demo：全新进程恢复原剩余10秒，重放不续时

createLedger(config)
applyBatch(events, trustedUtcNowMs)
project(trustedUtcNowMs)
snapshot(sourceCursor)
restoreLedger(snapshot, now, {sourceCursor, minLastNow})

精确schemaVersion=2字段见CONTRACT.md及fixtures/fixtures.mjs。旧v1的completionOrdinal、seal字段/API在此无效。sourceCursor要包含stream/epoch边界，由宿主绑定当前已处理事件；恢复expected必须来自独立权威，不能抄快照自身。能力/映射使用显式注册，fixture ID绝非真实产品预设。

## 验收范围

覆盖严格输入、双时限、旧版本重放、窗口内容量原子性、连续窗口清理、同一发生槽位的新完成代际、跨隐藏过期、恢复旧snapshot与新authority cursor不符拒绝、文件损坏/增长/截断、有界读取。

初次只见edit/revoke仍缺初次准入证据，不宣称所有排列等价；完整同batch有complete证据与先见edit的串行流有不同结果。CONTRACT明确解释。

参考checkpoint只提供单写者本地闭包，不认证生产outbox、身份源或断电恢复。主程序正确集成需先完成真实事件/可信时钟/恢复authority边界。性能调优不是本轮目标。
