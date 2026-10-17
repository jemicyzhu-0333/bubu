# 短时主题账本架构复杂度独立复审

## 结论

**建议在真实adapter接入前另起revision，采用有限资格窗口账本，移除主题模块专用completionOrdinal、永久seal水位与权威封存协议。** 保留语义完成代际、版本/全量事实、不可延期原始时间边界、有效窗口内撤销/不合格记录、可信事实时钟及可靠恢复。当前v1保持冻结作对照，不因测试已通过就把永久历史协议带入生产。

理由不是“TTL天然安全”，而是：主题可见资格最长900秒，所有旧事件在不可变安全期限之后都必然无法激活。只要每次输入都先执行该期限门禁，已过安全期限的业务身份不需要永久存储。永久审计、库存事务幂等、业务历史编辑应继续由原业务存储负责，不由表现资格账本重新实现。

本评审未改实现，没有宣称新设计实现或通过运行测试。

## 已读实现及独立证据

受审bubu-theme-state-ledger-v1-20261017/src/ledger.mjs，读取时SHA256 380dcfc178b73808dc4de5fa2a27604d2f7dbd26ee86bcf706d33042d4e73f9a。读取CONTRACT、README、capacity测试、checkpoint契约。源码insert为每个新身份保留first/latest并分配ordinal索引；project扫描全部历史；只有seal能删除记录。

独立probe.mjs/json在未修改v1上确认：
1. maxRecords=2时，两条已超过900秒且无活跃主题的历史仍占满容量，新真实完成抛CAPACITY_REQUIRES_SEAL。实际4096只是同机制更晚触发，不是15分钟窗口容量。
2. 保存complete后快照，再revoke；恢复旧complete快照时now仍在原期限内，可以重新输出活跃主题。说明ordinal+seal自身并不能识别存储回滚，仍需外部恢复协议。
3. 空账本接收已超过原最大期限的旧complete也不会激活。这是有限窗口去重可简化的基础；当前仍把它存入记录。

## 两方案真正差别

v1提供“封存水位以下永不再接纳”，但依赖上游永久稳定identity→ordinal、单调分配、范围内无遗漏有效事件、修改/补发永久关闭、持久ack。客户端无法证明这些承诺。若上游将旧身份换新ordinal，该保证仍失效。它不是无条件更安全，而是多了一套需要实现/维护/迁移的权威协议。

有限窗口方案提供“永不因重复/乱序/重启获得超过首次原期限的主题；当前有效期内不忘撤销、缩短及拒绝结果”。过期后允许忘记诊断身份，但拒绝其所有重放。对当前短时表现需求足够。若未来要求永久查询handledOutcome或永久审计每条通知，应由业务历史系统承担，不能把该额外目标隐含进主题层。

复杂度改善：删除ordinal分配/唯一索引/identity绑定、seal调用/水位/快照验证及范围闭合证明。内存从累计历史数量转为最近安全窗口内事件数量；project不必扫描无限增长历史。仍需窗口内容量上限及显式过载策略，不能承诺永不满。4096可以暂保留作为资源上限，但没有已测生产流量依据，不应把提高上限当解决方案。900秒内若确有4096个不同有效身份，仍须拒绝/暂停表现并报告，绝不能逐出未过安全期限的撤销记录。

## 必须分开的两个期限

- currentDeadline：允许表现的当前截止，可被时间修正缩短，不能增加。
- safeForgetAfter：所有合法版本可能拥有的截止上界，不能用当前缩短值替代。

最简单可靠的上界是不可变original.occurredAt + 固定kind硬上限：routine900000ms、feed30000ms。它不依赖当前注册表能否找到mapping或后续duration配置；最多少保留几分钟，但避免为压缩存储新增复杂证明。

若采用更紧的originalDeadline，则必须由权威源连同首次映射版本/首次固定时长一起不可变地提供或验证，所有版本和重放都受到同一上界约束。仅靠当前registry重算不够；未知mapping尤其不能凭未来新时长改变清理边界。

反例：原截止t+900，revision2将当前截止缩短至t+300。在t+301删掉记录，再收到revision1，若只按其原t+900判断，可错误复活。撤销后立即删除、未知mapping记录立即删除也有同类风险。必须保留到t+900，期间记住最高版本、最早deadline水位和原始准入结果。到now>=safeForgetAfter时删除，然后任何版本的输入先判同一上界expired，不再创建记录、播动作或续时。

证明前提：对身份i所有合法事件e，event.safeForgetAfter恒为H(i)，event.currentDeadline<=H(i)，可信now不倒退；若now>=H(i)，则now<event.currentDeadline必为假。删除记录不改变此结论。若任一前提不成立，TTL去重不成立。

## 边界逐项审查

### 撤销、修正、代际

窗口内按(namespace,kind,entityId,completionGeneration)识别身份，保留最高revision和全量当前状态。revoke不删除身份；旧complete不能覆盖。currentDeadline只缩短，后续完整快照携带非递增deadline watermark，跨过漏收revision仍不丢缩短。原始origin、时间、kind、definition/mapping版本不能被编辑换掉。

复用raw occurrenceId允许真正新完成代际；“新代际”必须由业务权威定义，不能每次重试、改时间、undo/recomplete就自动新建。重复同语义完成继续原期限；确实新完成可有新期限。TTL方案没有取消这个业务歧义，也不能靠eventId或时间近似解决。

### 隐藏

事实时间始终继续，动画freeze不影响safeForgetAfter/currentDeadline。hidden期间不必每毫秒调度；恢复/投递/查询前统一推进可信now，先过期/清理再求投影，不补播错过动作。

### 时钟回退与跳变

进程内用可信UTC锚点+单调elapsed，不直接用可能回退的Date.now。now倒退拒绝。若允许把now先推进到错误未来并清理，再校正回过去，旧事件会复活；因此已清理的时域不能回退。应将时间异常显式阻断/重校验，不能悄悄修正。

跨重启保存lastNow并要求可信当前时间不早于它；也要保证该lastNow未被回滚。仅snapshot内max(lastNow,wallNow)不能证明物理时间可信。若时钟有误差范围，安全清理应在可信时间下界达到H以后，或在不确定时暂停恢复/清理。精确误差策略由宿主时钟能力确定，不在主题核内凭空发明。

### 重启、存储丢失和rollback

只需要持久保存未过safeForgetAfter的记录及原准入结果/最高revision/期限，连同配置版本和lastNow/source cursor原子提交。已过安全期限的记录可不恢复，不需永久封存表。

但在H之前丢失revoke/unsupported/shortening状态，重放旧complete依然危险。必须保留有效窗口内可靠快照，或在暴露资格前从权威源拿到当前完整状态和原准入证据。单文件snapshot+cursor原子替换不等于能检测旧文件回滚；须与权威cursor/存储epoch核对或重新同步。SHA哈希不能检测合法旧文件重放。未能确认恢复时fail closed，不得新建空账本接旧事件并声称幂等安全。可考虑产品明确批准的“恢复先不显示，只接确认的新完成”降级，但本评审不自行授权该行为。

v1也有完全相同的回滚条件；ordinal不能替代它。

### 原始事件缺失、乱序、未知映射

原complete未被接纳、先收到edit/revoke时，不能仅靠一份声称original.origin=live的普通通知推断曾有资格。保留needs_reconciliation并从权威取得原完成及当前状态/首次准入结果；不要靠renderer伪造first。安全期限已经到则直接expired，不再为历史补账阻塞主题。

完整权威快照可以减少事件逐条回放，但必须证明原始事实与此前准入结果；不能把“完整字段”当来源认证。未知mapping/unready结果在本身份有效窗口内保持不合格，后续注册变更不激活旧事务。H之后所有重放过期，故可以清理该拒绝记录。

## 最小正确生产接入契约

1. 可信postcommit入口，禁止把replayed成功回包当新完成事件；主题层不执行业务事务。
2. 稳定业务namespace+语义completion identity/generation；revision以及完整当前状态；重复revision冲突原子拒绝。
3. 不可变original时间/origin/kind/definition与mapping版本；可信immutable safe horizon可由固定kind上限计算。任何currentDeadline不超过它，且修正水位非递增。
4. 同一身份窗口内固定首次准入结果与映射/能力快照；完整batch先验证并更新事实，再求一次投影；new generation只能来自权威真正新完成。
5. 每次输入在资格更新前执行now>=H过期门禁；过期重放返回expired且不占记录。窗口内不逐出身份，过载显式失败。清理边界与批次提交均需保持原子。
6. 可信非回退事实时钟，不跟动画freeze走。恢复必须先推进真实时间。
7. 有效窗口内snapshot+source cursor/epoch的持久一致性和恢复核验。原始事实缺失需权威reconciliation。不存在通用的本地模块办法代替来源/磁盘可信性。
8. 注册表为空或能力未就绪仍禁止生产激活；短动作幂等与表现调度保持另层，不因事实恢复反复消费。

不需要新增主题专用全局completionOrdinal或永久seal；自然业务revision/已存在的可靠投递cursor可以用于排序和恢复，但不要把投递cursor误当语义完成代际，也无需承诺某历史范围永不编辑。

## 建议下一revision验收

保留当前全部适用测试，删除/替换仅为seal设计服务的测试。追加：H-1/H/H+1；缩短/撤销后在currentDeadline与H之间旧版本重放；未知mapping在窗口内后补不得激活；过H后批量历史重放不增加记录；大量连续窗口事件可清理且不阻塞新窗口；窗口内容量拒绝不丢tombstone；所有原始字段改变被拒；时钟先前进清理后回退拒绝；恢复旧快照在有效窗口内必须被宿主核验阻断；缺初次成功reconciliation；隐藏跨H后恢复无资格。真实adapter前应把这些条件写成完整契约并独立复验。
