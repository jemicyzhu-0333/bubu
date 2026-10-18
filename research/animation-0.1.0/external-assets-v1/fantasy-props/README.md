# 小步：幻想与手作道具静态候选

9件独立生图参考 → 可编辑Three.js实体几何 → GLB → 原角色13mesh静态装配。

## 验收入口

- `renders/batch-1-{mounted,isolated}.png`：蝴蝶、地洞、泡泡棒
- `renders/batch-2-{mounted,isolated}.png`：魔术帽、星星、毛线与小织片
- `renders/batch-3-{mounted,isolated}.png`：双织针、南瓜灯、小幽灵
- `manifest.json`：文件、哈希、材质、socket、safeBounds、静态审查结果与限制
- `reports/model-tests.log`：49项通过
- `reports/mount-audit.json`：实际世界三角面BVH和手表面距离

原身体、双手、双脚、8个脸部mesh的顶点与索引完全保留；没有移动、缩放、重画手或新增手。因手完全未变，整个原肩根封口也原样保留，不用单根点近似证明新的手姿势。

本批不包含新动作、不包含衣柜组合验收、不包含生产集成或原生系统验证。所有截图为实际几何CPU离线渲染，生成图仅为设计参考。

## 环境地洞

地洞不是可拿取物品。GLB为便于观察的土层截面样块，具有真实椭圆开口和下降洞壁；不可把土层截面当可接触道具。`src/ground-hole-contract.mjs`给出有限局部开口与地下角色裁切判定，已单测，但正式renderer还需原子化接入地面开口、角色裁切和退出复原。装配图用了较高视点展示洞口，没有掉落动作。

## 资源与复现

`src/prop-models.mjs`提供9个工厂；`src/prop-pool.mjs`共享不可变geometry/material、每个实例独立transform，并在最后一个实例释放时回收。双针原始GLB用于单体检查，装配fixture把两个独立节点分别定位到左右原手。

在本目录运行：

    node src/export-models.mjs
    node src/export-mounts.mjs
    node --test src/test-models.mjs
    blender -b -t 2 -P src/audit-mounts.py
    python src/finalize-report.py

渲染单体使用 `ONLY_IDS=逗号分隔id blender -b -t 2 -P src/render-models.py`。装配使用 `src/render-mounted.py`；输入为 `reports/<id>-mounted.json`，0/45/90/180度。依赖复用同工作区已安装的three与Blender，无付费生图API。


## Portable current validation

Use the package-level fresh pipeline (requires Node with Three.js 0.186.1, Python, and Blender):

```sh
python shared/check-prop-groups.py --repo-root /path/to/repository --reference-root /path/to/prepared-fixture --cache-root /path/to/cache --group fantasy-props
```

Prepare the D2/hybrid fixture and current accessory halo reference first using the package-level cache workflow. The reference fixture manifest is checked before exporting. Model exports write into cache/model-rebuild, never into the preserved models or manifests. This pipeline checks GLB byte parity against the existing factories, regenerates actual mounted meshes, runs fresh Blender triangle/contact audits, writes a hash-bound current-evidence.json, and runs model/lifecycle tests. All mounted JSON and new audit/proof outputs live under cache/fantasy-props/reports.

Existing reports, renders, manifest statuses and prototype provenance remain historical evidence. Old absolute/sibling paths inside those records identify the original creation environment; they are not runtime dependencies or proof of current acceptance. Current static success does not upgrade pending action, wardrobe, renderer, native runtime or scene integration requirements. Do not run historical finalize utilities to update acceptance status.
