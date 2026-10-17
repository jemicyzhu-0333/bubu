# 真实完成事件adapter与schema21小批正确性审查

## 结论与锁

事件转换、真实命令/UoW接线及合成SQLite迁移范围通过；不是Electron整应用启动、主题跨重启恢复或可见场景验收。

受审目录bubu-theme-commit-adapter-20261017。冻结REVIEW-SHA256SUMS自身摘要813c1a81655392068d6229b28de478b35e06f376481a85014b3c96a212f178ea，856项独立哈希核验通过。独立复跑24实现测试和5新增迁移探针共29/29通过。

## 必需修正已闭合

初版把连续done当代际，撤销/skip后重做同一slot会新UUID续600秒。已报告root并按其定义修复：显式同occurrence恢复保留原completion；done→skipped保留元数据；undo留canonical纠错receipt。明确新增free记录才新完成代际。旧记录没有身份不会被补认成新主题。

当前receipt保留72小时、最多256，溢出不阻止业务undo，显式slot主题恢复保守阻断并诊断；它保护业务完成身份，不是把主题TTL改成72小时。排程跨日候选仅今天/昨天，普通显式free槽要求所属day，历史补录本身不激活。不能以清理receipt为由将旧历史编辑改为新live完成。

额外commit-probe.cjs复用候选真实仓储fixture搭建，不复用其测试断言：核同slot undo恢复、skip恢复、901秒后不复活、新增free独立代际、精确撤销routine不清两条feed来源，全部通过且adapter errors=0。

## 事件/接线核查

operation/origin、commitEventId、completionGeneration由实际domain/command/UoW postcommit路径传递。已接main的routine、inbox及companion-feeding publish钩子；inbox补录标historical_backfill。feed command receipt重放不再次提交/发布，旧receipt缺新字段不伪造fedAt；独立适配拒replayed回包。映射使用exact定义ID和version，默认生产registry为空，无title/kind猜测。

实际bootstrap feed hook经过register pet:feed→真实workflow→postcommit测试，routine/feed→ledger→coordinator为headless真实模块链路，输出plan visible/performing=false。没有以fixture证明真实美术或body已运行。

中途依赖闭包发现旧donor catalog与缺front-stories，本轮未忽略MODULE_NOT_FOUND；实现者替换固定main依赖后重新冻结，最终29测试全部在该闭包执行。当前main package证据Node>=22.12、Electron^44，CJS require(mjs)不是此patch新引入的运行时要求；未实际启动Electron。

## 数据安全迁移独立探针

migration.test.cjs使用真实node:sqlite与合成schema20 profile，不触碰用户数据：
- backup-copied与backup-verified各在无WAL/有live WAL下故障，共4例；原目录文件字节与metadata逐项不变。
- COMMIT完成后抛错，按已提交状态核对成功而非重做业务；随后连续3次关闭重开固定点，除schemaVersion外业务状态保持原值。

候选原测试另含确认token、备份容器字节校验、提交前故障、重复升级拒绝、旧历史无身份伪造。通过是测试边界证据，不是物理断电/全部磁盘故障认证。

## 仍须保留的接入边界

当前theme-state-runtime新建内存ledger，尚无持久snapshot/cursor与跨重启权威reconciliation；main仍注入Date.now，不是已证明可信UTC+单调映射。默认空registry使生产主题不激活，但今后填真实registry前必须闭合这些边界或明确受限会话语义，不能宣称现有schema迁移重开固定点等于主题资格恢复完成。

适配器catch错误不会回滚已经成功的业务事务。此处project不是资源执行器；真实显示、焦点背景asset执行、身体/prop、检测系统与GPU均未由本审查验收。保持功能优先，未追加微性能或泛化架构优化。
