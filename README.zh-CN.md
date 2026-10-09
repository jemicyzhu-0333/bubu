# 小步 · bubu

[项目网站](https://jemicyzhu-0333.github.io/bubu/) · [English](README.md) · 简体中文

小步（英文名 bubu）是一个本地优先的 ADHD 日常效率与桌面陪伴应用：随手记下想法，把任务拆成下一步，用专注计时器开始，再和桌面伙伴一起回来继续。

这是开发中的执行功能辅助工具，不提供 ADHD 诊断、治疗或医疗疗效承诺。

## 真实界面

以下为 Linux 原生 Electron 测试中的应用窗口原图，使用可删除的测试档案；任务名称为虚构测试数据。截图采集于本次更名前，没有重绘，也不代表 Windows/macOS 原生验收通过。当前应用界面为中文。截图中的角色仍受下方[许可与美术限制](#许可)约束。

| 现在：从一件小事开始 | 专注：下一步与剩余时间 |
| --- | --- |
| ![现在面板，包含自由专注、能量估计、日常与收件箱](docs/images/now-panel.jpg) | ![专注中的真实界面，使用虚构测试任务](docs/images/focus-session.jpg) |

| 伙伴面板 | 桌面陪伴 |
| --- | --- |
| ![团子兽形态与默契进度](docs/images/companion-panel.jpg) | ![原生桌面上的乌沙奇睡眠状态](docs/images/desktop-companion.jpg) |

## 功能

- **随手记与收件箱**：先保存想法，再整理为任务、日常、状态、情绪或留存记录。
- **任务与下一步**：标题即可新建；按需添加步骤、日期、重复规则、标签和估时。本地推荐支持“综合优先”和“最容易开始”。
- **专注与续接**：专注计时、暂停、休息和落点记录；中断后可继续，离线到点需本人确认结算。
- **日常与回顾**：独立的生活提醒与记录、能量自评和日常估计、活动时间线与累计进展。没有连续打卡惩罚。
- **桌面伙伴**：团子兽与乌沙奇形态、互动、喂食、食票购买食物、可用装扮和陪伴动作；免打扰、低刺激和减少动效分别可控。
- **可选 AI**：任务拆解、补全、卡住建议与持续协作。可选择参考范围，查看修改差异，确认后才应用建议；未配置时核心功能仍可用。

主面板分为“现在 / 安排 / 回顾”；“安排”包含任务、日常、收件箱和已归档。应用驻留托盘或菜单栏。

## 下载与开发版本

- [项目网站](https://jemicyzhu-0333.github.io/bubu/)提供功能介绍与当前下载提示。
- **当前小步测试包**：[v0.0.1-dev-r4](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.1-dev-r4) 提供提交 `df3242a` 构建的 Windows x64 与 macOS ARM64 包，安装包已使用小步 / bubu 名称。应用版本仍为 `0.0.1-dev`，`r4` 用于区分本次测试发布。下载 Mac 包前请先阅读下方限制。
- **历史版本**：[r3](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.1-dev-r3)、[r2](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.1-dev-r2) 与 [v0.0.1-dev](https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.1-dev) 保留作历史记录；请勿安装初版 v0.0.1-dev 中已报告“已损坏”的旧 Mac 包。
- 新测试包来自手动 [Build Windows and macOS (test)](https://github.com/jemicyzhu-0333/bubu/actions/workflows/build-desktop.yml) 工作流，面向 **Windows x64** 和 **macOS ARM64**。成功运行后可在保留期内下载 artifact，GitHub 可能要求登录；请核对运行的分支与提交。工作流不会创建 Release。

Windows 测试包未签名；Mac 测试包采用 **ad-hoc 本地签名**，没有 Apple Developer ID 签名或公证。已发布的 r4 Mac 包通过了严格代码签名校验、DMG 安装副本在隔离档案下直接启动及 SQLite 持久化 CI，但 Gatekeeper 分发评估拒绝了该包。这些检查不能保证浏览器下载后正常双击打开。请勿关闭 Gatekeeper 或移除隔离标记来安装。

从更名后源码构建的 Mac 应用名为 `小步.app`；旧的 `I’m ADHDer.app` 可能继续与它并存，直至你自行移除旧副本。新构建使用全新的 bubu 应用与凭据身份，默认从空测试档案开始。旧测试应用、数据目录和凭据保持原样，不会自动导入、迁移或删除。请在新档案中重新配置 AI 凭据；新应用身份或变化后的 ad-hoc 签名二进制可能触发 macOS 钥匙串提示。

这是开发测试版，不是稳定版。**当前没有可用的应用内更新**，尚未发布更新元数据，请手动下载测试包。请使用全新测试档案。

## 进入开发环境

需要 Node.js **22.12.0+**、npm 和可运行 Electron 的桌面环境。Windows/macOS 是主要桌面目标；Linux 已有有限原生验证，仍有已知呈现问题，详见 [验证说明](docs/VALIDATION.md)。

```bash
git clone https://github.com/jemicyzhu-0333/bubu.git
cd bubu
npm ci
npm run dev          # 独立开发档案
npm run check        # 单测、语法、架构边界及生成资源检查
npm run test:integration
```

`npm start` 使用日常档案 `bubu`；开发时优先用 `npm run dev`，使用独立开发档案 `bubu-dev`。两者的数据、凭据和 Chromium 存储隔离。此次完整更名采用全新的 bubu 内部标识和空默认档案，不提供旧名称兼容别名。旧测试目录和凭据保持原样，不自动导入、迁移或删除。显式 `--user-data-dir` 仍受尊重，但不代表允许导入或改写旧档案。

当前为 `0.0.1-dev`，业务数据须同时满足完整规范的 **schema 18** 和 **bubu 品牌配置身份**。无品牌标记、其他品牌、损坏或只剩孤立持久化文件的档案均拒绝打开，不自动导入、转换、修复或重置。拒绝后请选择新的空测试目录；显式路径不能绕过此边界。可删除的测试场景用：

```bash
npm run dev:bench -- --scenario=level-up
npm run test:electron   # 需要可用的原生桌面
```

开发和运行都需要安装 devDependencies。首次运行请使用全新测试档案；详细数据与测试合同见 [ARCHITECTURE](docs/ARCHITECTURE.md) 和 [VALIDATION](docs/VALIDATION.md)。

### AI 设置与联网

AI 默认关闭。在设置中启用 AI，填写 OpenAI 兼容的公网 HTTPS Base URL、模型名和 API 密钥，再点击“保存配置”。密钥使用 Electron 的 `safeStorage` 保存，保护能力取决于操作系统及其凭据后端；Electron 报告加密不可用时会拒绝保存。开发档案需要单独配置。

Local-first 表示核心数据与执行闭环在本机，不表示应用绝不联网：使用 AI 时，消息和为该请求组织的参考上下文会发送给配置的 Provider；发送敏感信息前，请检查参考范围与服务商的数据政策。目前尚未发布可用的应用内更新通道。活动镜像默认关闭，仅处理本地活动类别，不读取桌面内容、音乐内容或 AI 对话正文。

## 构建

```bash
npm run build                   # 当前系统、当前 Node 架构的安装包
npm run pack                    # 当前系统的未封装目录
npm run build:win -- --x64
npm run build:mac -- --arm64     # 需在 macOS 上运行
npm run build:linux
```

也提供 `pack:win`、`pack:mac`、`pack:linux`。支持 x64/arm64；macOS 还需要 Xcode Command Line Tools。构建脚本不会自动发布，不能在 Windows 上直接构建 macOS 包。

构建命令支持 x64/arm64，不表示所有系统与架构组合都经过原生验收。测试包的签名与安装限制见上方“下载与开发版本”。

## 快捷键

- `Alt/Option + Space`：主面板
- `Alt/Option + Shift + Space`：快捷行动面板
- `Alt/Option + Shift + N`：提醒可见时移入焦点
- `/`：主面板随手记；`Esc`：关闭当前浮层

快捷键冲突时使用下一组可用组合，设置中显示实际绑定。

## 文档与素材开发

- [产品原则](docs/PRODUCT.md)：功能语义与交互边界
- [工程架构](docs/ARCHITECTURE.md)：分层、状态所有权、IPC、SQLite 与 AI 安全
- [验证说明](docs/VALIDATION.md)：开发检查、原生验收与已知限制
- [桌宠视觉](docs/PET_VISUAL.md) / [分层 Rig](docs/PET_RIG.md)：生产坐标、图层与素材构建
- [AGENTS.md](AGENTS.md)：代码代理的工作约束

修改素材可使用 `npm run rig:check`、`npm run rig:build`、`npm run rig:preview`、`npm run raster:check` 和 `npm run usagi:wardrobe-check`。实际渲染可通过 `npm run frames` 检查；离屏帧不能代替原生桌面验收。

公开版本包含已生成的运行素材、source-specs 与运行资源检查。完整 Dango／Usagi 设计母版重建、历史动作审批证据和 run-sample 原始样题重建保留在原作者的私有归档中，不在本仓库的可复现范围内；正常应用开发与安装包构建不依赖这些母版流程。

## 许可

有权授权的项目代码采用 [PolyForm Noncommercial 1.0.0](LICENSE)，属于带非商业限制的 source-available 软件，不是 OSI 认可的开源许可。完整范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)。

第三方依赖与角色、美术等素材保留各自许可和权利限制。Usagi 素材不由项目许可重新授权；保留素材不代表已取得权利人许可，非商业发布本身也不构成免责。Dango 美术权利同样不能由项目代码许可推定，复用或再分发前须核查相应来源和授权。

须保留 [Usagi 使用声明](assets/companion/usagi/USAGE.txt)。截图中展示的美术也受上述权利限制。内部商业使用并不因“不售卖副本”就自动获准，具体以完整许可为准。
