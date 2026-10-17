# V2 有限资格窗口：独立功能边界验收

2026-10-17。本轮另建v2测试目录，v1实现及106项独立验收保持冻结。依据复杂度复审，重点验证去除ordinal/seal后，短时主题不会错误续时、撤销不会复活、恢复不会偷偷重新计满。没有新增性能基准。

## 结果与复跑

**本轮33个独立组合场景全部通过，0失败/跳过。** 包含20种子×120步（2400步）独立集合oracle及v1对照、1000个连续安全窗口的历史清理。测试数未与v1相加，没有把多断言包装成“视觉效果通过”。

    node --test --test-reporter=tap bubu-theme-state-v2-independent-review-20261017/*.test.mjs

Node实际版本v24.19.0。证据：independent.test.mjs、checkpoint.test.mjs、test-output.tap、REVIEWED-SHA256SUMS。独立测试未修改主实现。

## 精简方案保住了什么

1. safeForgetAfter只依赖不可变original.occurredAt及kind硬上限：routine900秒、feed30秒。已经显示到期、被缩短、撤销或不合格，不代表可以提前忘记该身份。
2. 显示资格currentDeadline仍为原起点加固定时长，并可单向缩短。日常默认600秒、允许600..900秒；feed30秒。主题为独立来源并集，截止取最大值，不做累加。
3. 到now>=safeForgetAfter才能清理；每个旧输入先受同一安全上界门禁，过期输入不创建记录。边界H−1/H/H+1独立验证。
4. 有效窗口内仍保留最高revision、撤销、最早deadline水位、首次准入结果及原始字段。重放/不同delivery ID不获得新TTL；真正新completionGeneration保留独立资格。
5. 窗口内容量满时原子拒绝，不能逐出撤销或不合格记录。验证失败的批次不提前清理记录、不推进lastNow。长期过期历史不再累计堵满容量。

## 核心反例与已执行检查

- 缩短反例：原始日常T，修正currentDeadline到T+300秒；T+301秒重放原revision1，仍不活跃，记录保留至T+900秒；T+900之后原始重放不再入账。
- 撤销反例：撤销后在T+30、600、899.999秒重放旧完成，均不复活；不能因原显示600秒结束就忘记routine身份。
- 不合格反例：unknown mapping、unready capability、unapproved mapping在窗口内保持不合格；外部修改传入的配置对象、递送新revision均不重新准入；改变原definition/mappingVersion拒绝。此API没有动态注册表更新入口；受信任快照内改配置不属于受支持迁移，也未冒充已测试的真实registry热更新。
- 1000连续窗口与1000条批量过期历史后，新完成仍能入账；窗口内真实超载显式失败且原撤销状态不丢失。
- 长/短同主题双到达顺序、独立撤销、精确到期；同主题真实新完成不按次数累计时长。
- 时间编辑不延长、缩短水位不回升；历史补录/历史编辑/新恢复同步不激活；失败/pending/cancelled及feed replay receipt拒绝。
- 原始成功缺失、edit/correct/revoke先到保持needsReconciliation=true；晚到旧完成或较新完成不能静默解除。批处理原始完成+新修订与逐次edit-first证据不同，不声称所有排列等价。
- 可信时钟前进清理后，回退输入拒绝。恢复只保留原剩余TTL，跨hard horizon恢复为空；未来/非法时间、溢出、非整数/非有限数值拒绝。
- namespace隔离，复用原始occurrence但真正新generation不被旧撤销误伤；原始时间/definition/mappingVersion不能重写。
- snapshot与projection防御性复制；无效恢复不更改原账本。getter、nested getter、prototype、null prototype、symbol、nonenumerable、toJSON、数组洞/extra字段及Proxy严格边界不运行用户代码。恢复凭证getter另有文件级测试。
- focus/detection/inventory字段没有写入口；所有visible/selected/performing始终false。这是状态模块隔离，不是UI集成验收。

## V1对照的适用范围

随机对照为2400次状态迁移：两个实现使用相同固定映射、真实稳定业务身份/不可变original、非倒退可信now、相同完成/撤销/修正/重放输入。V1额外ordinal只供V1接口。逐步比较active sourceId与expiresAt，同时用独立模型计算活跃集合和主题最大截止。周期性执行v2恢复并核对投影。

该范围内未发现活跃资格或截止差异。V2保留记录数同时与独立hard-horizon集合一致。

不比较永久历史条数、seal返回值、永久handled诊断或被封存水位：这些是删除的机制，非短时主题需求。不声称面对不同初始准入证据、未经支持的配置迁移、虚构generation、修改旧身份original或不可信时间仍等价。忘记身份以后，original不可变与语义generation真实性必须由上游业务权威保证；这个纯模块无法重新认证历史真相。

## 恢复安全：已验与依赖

snapshot显式绑定sourceCursor；restore必须提供宿主独立获得的{sourceCursor,minLastNow}。旧complete快照cursor1对上较新revoke权威cursor2或新epoch时拒绝；snapshot.lastNow低于权威floor拒绝；缺凭证拒绝。新的撤销快照配对正确权威后恢复仍不活跃。

测试还故意传入与旧快照一致的旧凭证，确认模块会恢复旧资格。这不是声称认证成功，而是清楚标出信任边界：宿主绝不能从待验证快照自己抄出“expected”。checksum只检测内容损坏，不能认证来源、检测有效旧文件rollback或为cursor提供权威。

文件回归检查：snapshot内外cursor绑定、旧文件对新权威拒绝、损坏checksum拒绝、非法替换不覆盖原文件、fresh child Node process恢复原剩余TTL、getter不执行，以及保留的有界读取对预stat超界/读取增长/截断的拒绝。详细全套有界reader竞态测试已在冻结v1报告中执行；v2本轮复验关键路径，未新增性能或文件大小基准。

## 尚未交付的真实功能，不以本报告代替

没有生产事件adapter、业务来源认证、真实preset映射或美术能力审核；没有渲染/GPU/overlay/动作/稀疏调度、focus/detection真实集成；没有生产时钟adapter、磁盘断电/多写者/ack原子性或权威cursor服务认证。有效窗口内可靠持久状态与权威reconciliation仍是接入门槛。

本轮无已复现的纯状态功能阻断。可以在保持上述边界的前提下继续功能接入，不需为此次精简追加细微性能调优。
