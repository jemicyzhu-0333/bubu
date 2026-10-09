'use strict';

// architecture/manifest.json 里那份契约的可执行形式：文件归哪一层、一条边是否朝外、
// 一条例外是否盖住这条边。判据放在这里而不是抄成正则，是因为抄一份就多一处会和 manifest
// 说法不一的地方——先前那几条硬编码正则正好把 src/core、src/content 和 src 根目录漏在了
// 所有层之外：它们既没有被声明成层，也没有任何规则约束其方向。

// 层序就是 layers 的数组顺序：内层在前。返回全部命中而不是第一个：一个文件命中两层说明
// manifest 自己有歧义，这必须报出来，而不是被“取首个”静默吞掉。
function layersOf(layers, file) {
  return layers.flatMap((layer, rank) => (
    layer.paths.some(prefix => file === prefix || file.startsWith(`${prefix}/`))
      ? [{ name: layer.name, rank }]
      : []
  ));
}

function soleLayerOf(layers, file) {
  const matches = layersOf(layers, file);
  return matches.length === 1 ? matches[0] : null;
}

// 向外的边是唯一的方向违规。返回两端层名而不是布尔值：报错要能直接读出违反了哪一段层
// 序，否则光说“depends on outer layer”还得读的人自己回去查表。归层不明的一端不参与方向
// 判断，由归层完整性检查单独报告。
function outwardEdge(layers, file, dependency) {
  const from = soleLayerOf(layers, file);
  const to = soleLayerOf(layers, dependency);
  if (!from || !to || to.rank <= from.rank) return null;
  return { from: from.name, to: to.name };
}

// 一条例外只豁免它自己列出的那几条依赖。给整个文件开空白通行证会让这个文件之后新增的
// 外向依赖继续静默通过——AGENTS.md 要求例外必须“窄”，逐条记账才是可核对的窄。
// 没有 dependencies 字段的例外按整文件生效，供 electron-import 这类不针对某条边的规则使用；
// 反过来，用整文件口径去问一条逐边记账的例外一律不豁免，宁可报错也不静默放过。
function isExempt(exceptions, rule, file, dependency) {
  return exceptions.some(exception => {
    if (exception.rule !== rule || exception.path !== file) return false;
    return Array.isArray(exception.dependencies)
      ? exception.dependencies.includes(dependency)
      : dependency === undefined;
  });
}

module.exports = { layersOf, outwardEdge, isExempt };
