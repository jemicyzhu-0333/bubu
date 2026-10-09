# I'm ADHDer

[English](README.md) · 简体中文

一个本地优先的 ADHD 日常效率与桌面陪伴应用：随手记下想法，把任务拆成下一步，用专注计时器开始，再和桌面伙伴一起回来继续。

这是开发中的执行功能辅助工具，不提供 ADHD 诊断、治疗或医疗疗效承诺。

## 真实界面

以下为 Linux 原生 Electron 测试中的应用窗口原图，使用可删除的测试档案；任务名称为虚构测试数据。图片没有重绘，也不代表 Windows/macOS 原生验收通过。当前应用界面为中文。截图中的角色仍受下方[许可与美术限制](#许可)约束。

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
- **桌面伙伴**：团子兽与乌沙奇形态、互动、喂食、食票换装和陪伴动作；免打扰、低刺激和减少动效分别可控。
- **可选 AI**：任务拆解、补全、卡住建议与持续协作。可选择参考范围，查看修改差异，确认后才应用建议；未配置时核心功能仍可用。

主面板分为“现在 / 安排 / 回顾”；“安排”包含任务、日常、收件箱和已归档。应用驻留托盘或菜单栏。

## 下载与开发版本

- 已发布安装包请看 [GitHub Releases](https://github.com/jemicyzhu-0333/im-adhder/releases)。只有实际附在 Release 上的文件才是可下载的发布包；构建入口或工作流不代表已经发布安装包。
- 开发包请看 [Build Windows and macOS (unsigned)](https://github.com/jemicyzhu-0333/im-adhder/actions/workflows/build-desktop.yml)：手动工作流面向 Windows x64 与 macOS arm64。成功运行后可在保留期内下载对应 artifact，GitHub 可能要求登录。这些是未签名开发包，工作流不创建 Release。
- 也可按下方命令从源码运行或本机构建。当前不是正式发布版本，请勿用已有或旧版用户档案试运行。

## 进入开发环境

需要 Node.js **22.12.0+**、npm 和可运行 Electron 的桌面环境。Windows/macOS 是主要桌面目标；Linux 已有有限原生验证，仍有已知呈现问题，详见 [验证说明](docs/VALIDATION.md)。

```bash
git clone https://github.com/jemicyzhu-0333/im-adhder.git
cd im-adhder
npm ci
npm run dev          # 独立开发档案
npm run check        # 单测、语法、架构边界及生成资源检查
npm run test:integration
```

`npm start` 使用日常档案；开发时优先用 `npm run dev`。开发档案 `focuspix-dev` 与日常档案 `focuspix` 的数据、凭据和 Chromium 存储隔离。内部旧名称用于兼容，不影响产品品牌。

当前为 `0.0.1-dev`，业务数据只接受完整规范的 **schema 18**。不要拿已有或旧版用户档案试运行；不自动导入、转换或修复旧资料。可删除的测试场景用：

```bash
npm run dev:bench -- --scenario=level-up
npm run test:electron   # 需要可用的原生桌面
```

开发和运行都需要安装 devDependencies。首次运行请使用全新测试档案；详细数据与测试合同见 [ARCHITECTURE](docs/ARCHITECTURE.md) 和 [VALIDATION](docs/VALIDATION.md)。

### AI 设置与联网

AI 默认关闭。在设置中启用 AI，填写 OpenAI 兼容的公网 HTTPS Base URL、模型名和 API 密钥，再点击“保存配置”。密钥通过系统安全存储保存；开发档案需要单独配置。

Local-first 表示核心数据与执行闭环在本机，不表示应用绝不联网：启用 AI 后，所选上下文会发送给配置的 Provider；更新功能在可用且执行检查或下载时也会联网。活动镜像默认关闭，仅处理本地活动类别，不读取桌面内容、音乐内容或 AI 对话正文。

## 构建

```bash
npm run build                   # 当前系统、当前 Node 架构的安装包
npm run pack                    # 当前系统的未封装目录
npm run build:win -- --x64
npm run build:mac -- --arm64     # 需在 macOS 上运行
npm run build:linux
```

也提供 `pack:win`、`pack:mac`、`pack:linux`。支持 x64/arm64；macOS 还需要 Xcode Command Line Tools。构建脚本不会自动发布，不能在 Windows 上直接构建 macOS 包。

仓库的手动 GitHub Actions 工作流 **Build Windows and macOS (unsigned)** 分别生成 Windows x64 和 macOS arm64 开发包，不创建 Release。工作流存在不代表两端已经构建成功。签名、公证、实际安装与系统集成仍需目标平台验证；当前不是正式发布版本。

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
