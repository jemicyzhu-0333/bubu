# V2 共用变形与完整路径检查点

当前生产验收仍失败；共用变形代码仅为显式选择的研究候选，未进入默认运行时。

## 已验证

- 实际布面和四条包边直接读取原生碰撞网格，源几何、控制器及原阈值不变。
- 同一 0.129167 秒快照的布面／材料点最大偏差从 1.01826e-4 降至 1.33280e-7。
- 可复现生成器：1,983 粒子、3,760 单元、51 原支撑，保持既定预算。
- 回归 37 阶段通过：868 项 Node、2 项 Python；2,107 个代码/数据源哈希在验证期间及验证后均匹配。
- 应用检查 6,742 通过、29 既有跳过；集成 71 通过。整套穿搭 481 帧零交叉成果保留。

## 仍失败／未运行

- 同频率 240 Hz 候选在 0.129167 秒先发生应变/接缝失败，尚不能关闭 0.216667 秒原反例。
- 正常路径原定 9 秒，在 7.55 秒发生非有限物理状态；保留 452 个有限样本及上一有限画面。
- 0.2 秒取消路径完成 9 秒/540 帧，但 391 帧交叉，最终前包边/身体仍交叉；应变 .782998–1.967926，最大接缝 .00136844。
- 失败快照已有体积单元翻转。重力隔离也失败，不能归因于喝茶动作或缺少 GPU。
- FEM 重力对照约 10 秒/步，未采用；更小体积、均匀质量和弹性约束对照也未采用。没有无判据的参数搜索或默认替换。
- 软件浏览器帧间隔 P95 144.6 ms，仍未达标。完整取消路径测时有其他检查并行负载，不作为同条件优化收益。
- 动态穿搭连续接触、包含、自接触、完整有限固定面，以及实体 GPU/Windows/macOS 验收仍未建立或未运行。

回归套件通过只表示测试合同正确执行，不代表上述物理验收通过。原模型／控制器冻结不是当前内部实现修复必须停下索取授权的理由。

## 复现与证据

```sh
cd /workspace/bubu/research/animation-0.1.0/animation-foundation-v1/secondary-motion/cloth-probe
python3 author-shared-surface-cage.py --output /tmp/NEW-cage.json
node endpoint-probe.mjs --trajectory --convex-hands \
  --shared-surface-cage /tmp/NEW-cage.json \
  --local-body-proxy fixtures/wire-local-body-proxy-v2.json \
  --constraint-pgs 12 --sample-hz 60 --collect-failures --profile \
  --output /tmp/NEW-normal
# 另选新输出目录并加 --cancel-at .2；去掉 --collect-failures 可恢复首错停止。
```

- [完整审计与剩余最小工作](/workspace/artifacts/bubu-v2-shared-surface-20261025/audit.json)
- [正常路径失败与原始状态](/workspace/artifacts/bubu-v2-shared-surface-20261025/shared-full-normal-60/endpoint-cloth.json)
- [完整取消路径](/workspace/artifacts/bubu-v2-shared-surface-20261025/shared-full-cancel02-60/endpoint-cloth.json)
- [同帧材料点绑定对比](/workspace/artifacts/bubu-v2-shared-surface-20261025/material-point-dynamic-comparison.json)
- [单元翻转审计](/workspace/artifacts/bubu-v2-shared-surface-20261025/cell-inversion-audit.json)
- [实际模型静帧检查](/workspace/artifacts/bubu-v2-shared-surface-20261025/visual-review.json)
- [统一回归报告](/tmp/bubu-shared-surface-verification-20261025/summary.json)
- [冻结文件哈希](/workspace/artifacts/bubu-v2-shared-surface-20261025/frozen-hashes.json)

代码保存在 feature/pet-animation-v2 的未提交工作树。没有提交、推送、发布、重录或重打包演示。历史失败执行的准确模块版本保存在外部证据目录 candidate-source-versions/，不覆盖旧反例；最终安全备份清单位于同目录 source-backup-shared-verified.json。
