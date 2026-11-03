# research/ 存储与瘦身方案

## 已完成（fix/v2-known-issues）
- `runtime-facepath05/evidence/` 中与 `runtime/evidence/` 逐字节相同的 4 个证据文件（约 7.2 MB）已删除，
  清单与 sha256 见 `runtime-facepath05/evidence/DEDUPED.json`，规范副本位于 `../runtime/` 同相对路径。

## 未做 Git LFS 的原因
- 本分支不改写历史；把已提交的大文件改为 LFS 指针不会缩小已有历史，只对新增文件生效。
- CI（build-desktop.yml）checkout 未启用 `lfs: true`，研究 preflight 按 SHA 读取 GLB；改指针会让 hash 校验失败。
- 当前环境没有 git-lfs。

## 后续计划（合入 main 前必须完成，择一）
1. 推荐：research/ 不进 main。main 只接收 `src/surfaces/pet/realtime` 与 `src/runtime/pet-actions` 公开接口，
   已批准 GLB 通过可复现构建或 Release 附件（带 sha256 清单）获取。
2. 若必须同仓：启用 git-lfs，`.gitattributes` 追踪 `research/**/*.glb`、`*.glb.gz`、
   `research/**/diagnostics/**/*.json`、`research/**/evidence/*matrix*.json`；CI checkout 加 `lfs: true`；
   preflight 在缺少 LFS 内容时给出明确错误码。
- 当前 >2 MB 文件 36 个，合计约 213 MB（GLB、帧尖峰 run1–run4、CPU 矩阵）。
