# 观察者修复独立复核（2026-10-17 07:53 UTC）

新副本 `bubu-expression-director-p0-observer01-20261017`，director SHA256 `529185114f8e2c26100654a80db33fa14d7c3445a5776eb62b7712aab14546b5`。源码差分确认只更改诊断投递：核心边界提交后投递、有界4条队列、首次异常永久停用、无原错误对象保留、同步重入仍拒绝。原版保持冻结。

独立新 `observer-recheck.mjs` 在15个记录位置逐一注入不可信错误值，按budget1/2/64推进共45组；7类事件均覆盖，每组144次scalar输出与无错误基线完全相同，最终Basis/idle，observer只调用到首次故障，错误元数据冻结。另完整43/43测试独立复跑通过。判定上述onRecord故障项已修复；该结论不覆盖apply故障、生产绑定与GPU。异步observer不支持，原生Promise返回禁用并处理拒绝，不能当作异步控制入口。


Original probe SHA256: d591c2338307edebbe0f4478f2a7d9c3eded5faa153b4cb65ba472424dcd88cb
Local runnable copy adjusts only its import path.
