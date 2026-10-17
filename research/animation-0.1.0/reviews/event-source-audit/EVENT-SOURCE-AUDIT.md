# 日常完成与喂食事件源审计

## 版本边界，先看这一节

2026-10-17只读核实远端：
- 当前main：`1a66a0d3b7a51b19ac843b80f6629d0eb20eeb18`，PR17合入。
- 日常时间修复：`fix/daily-record-time`=`08571d530c4efa651a92bed1479ee68dc47ca011`。
- 早期日常体验修复：`fix/routine-capture-experience`=`e3e1e2a647be618eb2e11cf6dbdb9f607a73a917`。
- 动画历史基线：`ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a`。

本次逐文件取当前main12份相关代码，其中10份事件/schema文件与ff基线忽略末尾空白一致。改变的是routine UI及新增历史展示。daily-record-time的schema和log command也与旧基线一致。所有当前结论均通过当前commit文件核对，不把旧动画版本缺失直接当当前缺失。详见CURRENT-VERSION-COMPARISON.json、BRANCH-BOUNDARIES.json。

## 预设类型：已知与未定位

已确认当前main内置种类8个：medication吃药、stimulant咖啡因、meal正餐、snack加餐、movement活动、rest休息、meeting会议、custom自定义。权威表为content/energy-effects.mjs:67–116，标签见routine-symbols.mjs:5–14。

当前持久schema routine-schema.js:170–203仍为id/title/kind/schedule/effect/maxLevel/active/createdAt/updatedAt，没有typeId/presetId。routine.id由idFactory创建，是用户日常实例身份，标题可编辑；这两者都不等于细粒度预设类型。当前routines.mjs:18–19明确快捷记录来自用户自己的日常列表。

因此，仅在这次已提交源码范围内，尚未定位用户所说“已设计预设日常”的细粒度稳定ID清单。这个结论不否定它存在于设计文档、其他任务或尚未提交的工作树。接入前需要定位那份现成设计及其版本，不能重新发明一套ID，也不能把stimulant一律判咖啡、rest一律判睡觉。

## 日常：真实完成与改时间/撤销/补录

调用链：用户done/skipped/quick → surfaceClient.logRoutine → main routines:log → logRoutineOccurrenceCommand.log → unitOfWork.run → logOccurrence/correctOccurrenceTime → 仅transaction.committed后routine-logged → routineTimelineEffects。

当前postcommit fact：type、routineId、occurrenceId、status、kind、scheduled、at、dayKey、revision。done才是已完成；skipped与独立routine-reminded均不能启动完成主题。ok:true可能是无变化重试，不等于新完成。

- occurrenceId是原始发生槽位身份：排程 `<routineId>:<dayKey>:HH:mm`，自由记录 `<routineId>:<dayKey>:free:<序号>`。同ID替换同记录，不追加。
- at是用户确认的实际发生时间，默认命令读取一次now。明确补录限制今天或昨天，拒绝未来。
- 时间修正使用expectedAt+expectedStatus CAS，保留occurrenceId及原始归属日；修改at后依然发送同一个routine-logged。fact没有operation、previousAt、committedAt、origin，直接听所有routine-logged会把改时间误当新完成。
- 普通done重复上报若at变化，也可形成替换提交；不能仅因revision增加就重复启动主题。
- undo提交后独立routine-log-undone，携带occurrenceId/routineId/revision；缺原kind/at、撤销时间。撤销删除记录，自由ID未来可复用，因此不能永久用occurrenceId去重“所有事件”。
- 收件箱确认action=log走organize-inbox，occurredAt默认原始capture.createdAt或用户明确时间；成功提交嵌套routine-logged。action=routine只是创建日常，不表示做完。补录到现在才送达不能当“现在完成”。
- 当前main新增历史UI：昨天沿用可编辑记录，更早时间轴仅只读展示；读取/展开历史不产生完成命令。

关键源码：当前main log-routine-occurrence.js:37–121；domain/routine-logging.js:112–199、240–252；occurrence-time.js:10–46；organize-inbox.js:26–45、89–104。精确链接在JSON。

## 喂食：新成功边界与重放陷阱

准确链：pet:feed → feed-companion.execute → prepareFoodCommand → prepareFeed + 饱食/库存/照料及bond事务 → rememberFoodCommand → repository commit → transaction.committed时companion-fed。

当前fact包含foodId、bond、gainedXp、satiation、totalFeeds、fedAt、revision。fedAt是workflow时钟采样，不是动画开始或renderer收到消息时刻。

已存在可复用幂等身份：createFoodRequest用issuedAt+nonce生成commandId；pet.foodCommands保存commandId/kind/foodId/issuedAt/成功result。相同ID重放返回replayed:true，不再次提交、不再次发布companion-fed。运输结果不明会保留同一请求身份，不能偷偷新建重喂。

缺口：companion-fed和response均未透传commandId/issuedAt；保存的result没有原fedAt/revision。bootstrap只将成功fact转dirty投影，没有把该事实事件直接送pet。renderer收到ok后启动吃动作，replayed成功回包也可能启动表现，所以不能把“吃动作开始”或“收到ok”当新的30秒主题成功事件。

totalFeeds也不能替代事件ID：基础餐、自动餐不增加该计数。饱食/库存变化可能有其他来源。应在新提交fact处增加事件适配，并携带commandId及原成功时间，而不是从动画反推。

## V2接入最小契约建议，未实施

按用户指示，已设计预设日常完成命中主题持续10–15分钟；喂食成功命中约30秒。这是V2新策略，不是旧动作3500/9000ms时长。

建议适配事件：eventId、operation(completed/time-corrected/undone/skipped)、sourceEntityId、sourceVersion、presetTypeId、occurredAt、committedAt、commandId、origin(live-confirmed/backfill/replay/migration)、replaces/revokes引用。已有字段复用，缺字段明确增加；不要把拟议字段写成当前已存在。

- 日常只对已确认、新提交、命中既有预设、live done启动；更正/补录/撤销分别处理，不能重启计时。
- 喂食只对新提交匹配foodId启动约30秒；replayed不续命。时间源不能替换成receivedAt。
- 去重需要实体ID+版本/operation或真正eventId；撤销再做不能被永久旧ID挡住。
- 表现资源不支持仅不播放，业务完成/喂食成功不回滚。
- 日常不因此增加XP、连胜或自动喂食；现有写集严格区分健康/日常记录与游戏化。

UnitOfWork源码确认的是repository.commit返回且revision恰好+1后的canonical提交；本轮未认证整条磁盘持久化链或重启重放保证，不能称已有durable outbox。

所有修改仅新审计文件；未改main、旧V1、用户电脑、未启动生产连接。
