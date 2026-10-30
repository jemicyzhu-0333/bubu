# V2 有限状态与材料接触检查点

生产物理验收仍失败。已验证的有限状态改动仅用于隔离共用网格实验，不启用生产布料；冻结模型、控制器、原阈值与基线文件不变。

## 已验证与采用

- 原 60 Hz 正常路径在 7.55 秒产生 NaN。完整原生状态快照可单步复现，不必重跑前 452 步。
- 同一时间段使用 2、4、8 个子步均有限，位置差异随步长缩小而下降；它们仍有翻转单元，不能称为完整稳定解。
- 原约束表示在 120 Hz 下，正常与 0.2 秒取消路径各完成 9 秒、1,080 步，全部位置与速度有限。因此隔离共用网格入口默认采用 1/120 秒步长；显式 60 Hz 反例保留。
- 增加原生位置/速度、动能、重力势能变化与有向体积诊断；能量数据不含弹性、接触和驱动做功，不是总能量守恒证明。
- 最终研究回归 37 阶段通过：872 项 Node、2 项 Python；2,112 个代码/数据源哈希在验证期间及结束后均匹配。
- 应用检查 6,742 通过、29 个既有跳过；应用集成检查通过。首次沙盒回环/子进程 EPERM 日志保留，获准权限下检查通过，未修改测试门槛。
- 整套穿搭 481 帧零交叉成果保留；它仍不是整套连续接触证明。

## 仍失败与未运行

| 120 Hz 完整路径 | 正常 | 0.2 秒取消 |
| --- | ---: | ---: |
| 有限步数 / 请求步数 | 1080 / 1080 | 1080 / 1080 |
| 有交叉的采样步数 | 950 | 319 |
| 最小–最大边长比例 | 0.20678–3.06827 | 0.78159–1.48646 |
| 最大接缝误差 | 0.00268596 | 0.000511372 |
| 最大翻转单元数 | 66 | 25 |

原应变门槛仍为 0.8–1.2，接缝仍为 1e-5。两条路径最终均有前包边/身体交叉。
在同频率 240 Hz、0.216667 秒的真实显示网格中，布面/身体相交计数为 0，但两条前包边分别仍有 28、22 个三角形对与身体交叉。该时刻应变 0.78319–1.34677、接缝 3.68660e-5，不能关闭整件衣物的原反例。

软件浏览器帧间隔 P95 为 216.9 ms，仍失败；它不能推断实体 GPU。完整物理长跑与其他检查有并行负载，不作为同条件性能收益。旧缓存优化 100.16→93.01 ms 结论保持未达标。
实体 GPU/VRAM、原生 Windows/macOS 输入与窗口未运行；其他完整物理取消时点、动态整套穿搭连续接触、包含、自接触仍未建立。当前材料/接触缺陷是实现缺口，不能归因于硬件，也没有证据要求用户解冻模型。

## 已否决的候选与审计

- 粒子附着替代单点代理关节：13 点局部反例和原失败快照保持有限，双截面传力也通过；完整正常路径却在 7.516667 秒失稳，失稳前动能大幅增长。该开关继续禁用，局部通过不外推。
- 8 次四单元内部重连：粒子位置、单元数量、外边界与区域体积不变；首次翻转从 0.016667 推迟至 0.075 秒。但前包边交叉、应变及接缝仍失败，外部候选未采用。
- 真实原生状态中的恢复速度检查：0.5 改为 50 后，两子步的位置和速度逐字节一致。未证明有收益或单位修复，未采用。
- 边长合法不能证明单元方向合法；反射四面体回归会在全部边长不变时揭示负体积。
- 首个接触/固定点/应变失败几何与更早的接缝失败分开记录；不能把前者称为所有门禁的最早失败几何。

下一项实质工作仍是让耦合材料与接触解同时满足真实布面、包边、有向体积、应变和接缝。当前 0.216667 秒的两组前包边交叉是可重放的具体目标；不能通过关闭碰撞、放宽容差、冻结摆动或启用失败候选消除报告。

## 复现

```sh
cd /workspace/bubu/research/animation-0.1.0/animation-foundation-v1/secondary-motion/cloth-probe
python3 author-shared-surface-cage.py --output /tmp/NEW-cage.json
node endpoint-probe.mjs --trajectory --convex-hands \
  --shared-surface-cage /tmp/NEW-cage.json \
  --local-body-proxy fixtures/wire-local-body-proxy-v2.json \
  --constraint-pgs 12 --collect-failures --physics-diagnostics \
  --output /tmp/NEW-normal
# 默认 120 Hz。另选新输出目录，加 --cancel-at .2 验证完整取消。
# 显式 --sample-hz 60 --snapshot-frame 452 重放原非有限反例。
```

- [完整审计及剩余最小工作](/workspace/artifacts/bubu-v2-cloth-stability-20261025/audit.json)
- [因果反例与单步快照](/workspace/artifacts/bubu-v2-cloth-stability-20261025/causal-audit.json)
- [完整正常路径](/workspace/artifacts/bubu-v2-cloth-stability-20261025/normal-120-summary.json)
- [完整取消路径](/workspace/artifacts/bubu-v2-cloth-stability-20261025/cancel02-120-summary.json)
- [实际三角形交叉证据](/workspace/artifacts/bubu-v2-cloth-stability-20261025/prefix-contact-witnesses.json)
- [正常路径放大静帧](/workspace/artifacts/bubu-v2-cloth-stability-20261025/contact-frames/normal-5.png)
- [实际画面核对](/workspace/artifacts/bubu-v2-cloth-stability-20261025/visual-review.json)
- [离散重连比较](/workspace/artifacts/bubu-v2-cloth-stability-20261025/connectivity-comparison.json)
- [最终统一回归](/tmp/bubu-cloth-stability-final-20261025/summary.json)

代码保存在原 V2 工作树，未提交、未推送；未重录或重新打包演示。最终备份及 SHA-256 见外部 checkpoint。
