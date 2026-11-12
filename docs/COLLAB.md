# Grok 与 dot 协作记录

本文件是 Bubu V2 分支上 Grok（独立审查）与 dot（实现与后续实机验证）的共享信息源。仓库公开，不写本机路径或私人信息。主人在双方之间转发交接摘要；收到后先核对仓库实际状态，再继续工作。

## 协作规则

1. 开始写代码前，先在本文件登记任务范围（文件或功能）和基线提交。
2. 同一时间避免双方修改同一文件或同一功能；发现对方正在修改时先协调，不覆盖、不强推。
3. 测试结果必须区分：**本地测试**、**CI**、**真实实机验收**。不得把其中一种写成另一种。
4. 遇到权限、费用、数据外发、不可逆操作，先说明事项并等主人决定。
5. 电脑端训练、前台测试、实机采集暂停；主人明确恢复后才进行。
6. 本分支没有自动 CI。本地或云端手工检查不得称为 CI 通过。

## 任务表

2026-11-12 M1/L1 复审修正：dot 基于 `bbfd4e51e9fca55d383521637437463e700fb361`，修改 journal 错误文本脱敏、采集 evidence/supervisor 的对应窄边界、回归与本记录。不修改状态路径、IPC 或原生协议。不把普通路径截断在空格以免泄露含空格路径；独立数字比例保留；HTTP(S) URL 整体遮罩（含 host、凭据、查询和片段），保留其后错误上下文。已脱敏标记只有遇空白/终点或分隔符加空白才作稳定标记，紧邻标记的任意秘密仍被遮罩。journal → collector → 封包反例覆盖上下文与分号保留。M2（UNC/相对路径及 guidance/采集规则统一）另立后续项，不跨模块扩修；本轮不声称日志可接受任意敏感输入。最终云端 `npm run check` exit0：7,158 total / 7,152 pass / 6 skip / 0 fail，语法/边界/架构/资源门禁通过；定向75/75、集成71/71。6项跳过与 R1 相同；不是 CI、GPU 或真实 OS 输入验收。

2026-11-12 R1 复审修正：dot 在独立审查分支基于 `1d9affd42b7b3ccff610d6f55ed2c05d1bb5656f` 修复 AggregateError 根因在 V2 日志丢失的问题。范围扩展到 `realtime/error-journal.mjs`、日志/采集诊断/初始化故障回归及本记录，不改原生协议或动画。保留一个失败发生记录，按顺序提取有界子错误文本（总长2048、单层最多8项、总访问16节点、深度3），每段最多256字符，不读取 stack/cause/payload，不保留原始对象；逐片段脱敏后再拼接，防止截断引号跨子项造成敏感值遗漏，采集封包仍走既有二次脱敏。初始化只注册部分监听后失败也逐项清理并保留原始错误文本。最终云端 `npm run check` exit0：7,155 total / 7,149 pass / 6 skip / 0 fail（启用 Dango、Usagi 与 PET_MOTION Canvas）；语法/边界/架构/资源门禁通过。定向80/80、集成71/71通过。6项跳过仍为3项 Windows 原生、旧眼睛基线、D2资产和可选SQLite驱动；无CI或原生/GPU验收。

R2 独立遗留项：2D `controller.stop()` 在 `petSync.dispose()` 或 `lifetime.dispose()` 抛错时仍可能跳过后续 owner，重复 stop 不能补做。这不是本候选新引入，留待单独改造与注入回归，本轮不扩修；宿主释放失败后回调已失效，但未证明宿主已移除引用，不能承诺内存已回收。

2026-11-12：dot 在独立 `review/dot-lifecycle-cleanup-isolation` 分支核验并修复共享 `src/surfaces/pet/lifecycle.mjs` 的宿主清理失败隔离，基线 `3751977ceac5c9bdcefd76a47aa5fa482f207a7a`。范围为该模块、资源行为测试、V2 surface 故障注入回归及本记录；不改动画算法、UI、原生输入协议、共享分支或用户本机。验证属于云端 CPU/模拟宿主，不是实机验收。 本轮 `npm run check` exit0：7,149 total / 7,138 pass / 11 skip / 0 fail，后续语法、边界、架构及资源门禁均通过；调用方定向 76/76、集成 71/71 通过。全量中5项动效 Canvas 跳过后，单独启用 `PET_MOTION_CANVAS_PACKAGE` 补跑相关10项全部通过，不与全量重复加总。其余跳过为3项 Windows 原生、1项旧眼睛基线、1项未恢复 D2 资产和1项可选 SQLite 驱动。异常清理汇总为 AggregateError，该初版 V2 日志只保留一条 cleanup-lifecycle 汇总，根因文本的不足由下述 R1 修正。2D controller 原有外层 stop 遇异常中断问题没有扩修；不声称所有宿主释放成功、原生进程清理或 GPU 验收完成。

| 任务 | 负责人 | 范围（文件/功能） | 基线提交 | 状态 | 测试及真实结果 | 未验证事项 | 阻塞 | 下一步 | 需主人决定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 手势清理竞态修复 | dot | 完成于 `5cdb6bb`。主要改动：`src/surfaces/pet/realtime/fixture-transport.mjs`、`src/surfaces/pet/realtime/surface.mjs`、`tools/pet-realtime-capture/held-transport-probe.cjs`、`tools/pet-realtime-capture/window-port.cjs`；以及 `test/pet-realtime-fixture-transport.test.js`、`test/pet-realtime-held-transport.test.js`、`test/pet-realtime-surface.test.js`、`research/animation-0.1.0/animation-foundation-v1/body-runtime/fixture-grip.test.mjs`、`docs/ARCHITECTURE.md`、`docs/VALIDATION.md`。修复旧手势清理可能误取消新手势、截断松手收尾。 | `5cdb6bb` | 已完成（代码已合入 V2 头） | **云端完整检查** 7,141 项通过、5 项跳过；**本地针对性测试** 91 项通过。以上来自 dot 记录，Grok 未复跑。本分支**无自动 CI**。 | Windows 实机采集已生成但未解析；该次采集 CLI 返回 2；清理未验证；人工式拖拽未完成。 | 电脑端实机工作暂停，待主人恢复。 | 恢复后先只读解析已有采集，并检查残留进程，不重复采集。采集文件在 dot 本机，路径不公开。 | 何时恢复电脑端实机工作。 |
| 独立审查 V2 动画与交互算法 | Grok | 只读审查动画与交互算法，不改实现代码。审查意见写成文档或单独分支提出。 | `5cdb6bb` | 待开始 | 尚无。 | 审查尚未开始。 | 无。 | 在基线 `5cdb6bb` 上开始只读审查。 | 无。 |
| G1 实机门禁 | dot | 真实窗口帧链；帧间隔 P95 接近 16.7 ms。目标见 `docs/VALIDATION.md`，不承诺必达。 | `5cdb6bb` | 未验证 | 尚无真实实机验收。已有的 Node / 离屏检查不能代替 G1。 | 实际应用帧、原生输入/显示、帧间隔 P95/P99。 | 需主人恢复电脑端后，在目标机器上开窗采集。 | 主人恢复后，先处理已有采集与残留进程，再按验收清单做 G1。 | 是否及何时恢复电脑端采集。 |

## 交接记录

### 2026-11-10（北京时间）第一轮同步

主人确认分工：Grok 做独立审查，dot 负责实现与后续实机验证；同意在本分支新增本文件。双方当时均无正在修改的文件，也无正在运行的本机训练或采集。电脑端暂缓。

远端核对：`origin/feature/pet-animation-v2` 头为 `5cdb6bb`，之后无新提交；PR #18 已合入。dot 上次完成手势清理竞态修复，无已知待提交改动。Windows 实机采集已生成但未解析（CLI 返回 2；清理与人工式拖拽未完成）；恢复后只读解析、先查残留，不重复采集。路径不写入本仓库。

Grok 审查尚未开始。本文件为 docs-only 提交，不改功能代码。
