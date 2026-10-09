'use strict';

// How each AI tool installs the bundled `bubu-companion` plugin
// (ARCHITECTURE「活动镜像」). The plugin itself lives in `integrations/`; the app never
// edits a tool's configuration. `{marketplace}` is the bundled integrations directory and
// `{plugin}` the plugin directory inside it. `platforms` lists where the steps are known
// to apply. Labels are also used for signals that arrive from these sources.
const AGENT_PLUGIN_NAME = 'bubu-companion';
const AGENT_PLUGIN_TOOLS = Object.freeze([
  Object.freeze({
    id: 'claude-code', label: 'Claude Code', platforms: Object.freeze(['darwin', 'win32']),
    commands: Object.freeze(['claude plugin marketplace add "{marketplace}"', `claude plugin install ${AGENT_PLUGIN_NAME}@bubu`]),
    steps: Object.freeze(['在终端运行这两条命令，下次打开 Claude Code 生效。'])
  }),
  Object.freeze({
    id: 'codex', label: 'Codex', platforms: Object.freeze(['darwin']),
    commands: Object.freeze(['codex plugin marketplace add "{marketplace}"']),
    steps: Object.freeze(['在终端运行这条命令，再在 Codex 里打开 /plugins 安装 bubu-companion。', 'Codex 会请你审查并信任插件里的两条 hook，信任后才会生效。'])
  }),
  Object.freeze({
    id: 'cursor', label: 'Cursor', platforms: Object.freeze(['darwin']),
    commands: Object.freeze([`mkdir -p ~/.cursor/plugins/local/${AGENT_PLUGIN_NAME}`, `cp -R "{plugin}/." ~/.cursor/plugins/local/${AGENT_PLUGIN_NAME}/`]),
    steps: Object.freeze(['在终端运行这两条命令，再在 Cursor 里执行 Developer: Reload Window。', '团队版需要管理员允许本地插件。'])
  }),
  Object.freeze({
    id: 'qoder', label: 'Qoder', platforms: Object.freeze(['darwin', 'win32']),
    commands: Object.freeze(['qoder plugins install "{plugin}"']),
    steps: Object.freeze(['在终端运行这条命令；也可以在 Qoder 设置 → Plugins → Create Plugin 里从本地文件夹导入同一个目录。'])
  }),
  Object.freeze({
    id: 'codebuddy', label: 'WorkBuddy / CodeBuddy', platforms: Object.freeze(['darwin', 'win32']),
    commands: Object.freeze(['{marketplace}']),
    steps: Object.freeze(['复制的是插件市场目录。WorkBuddy：插件 → 添加第三方插件市场，选择这个目录后安装 bubu-companion。', 'CodeBuddy Code：在会话里运行 /plugin marketplace add 加上这个目录。'])
  }),
  Object.freeze({
    id: 'agent', label: '其他 AI 工具', platforms: Object.freeze(['darwin', 'win32']),
    commands: Object.freeze(['{plugin}/hooks/hooks.json']),
    steps: Object.freeze(['支持 Claude 格式 hook 的工具（如 DeepSeek Harness 的 hooks-claude-code 桥），可把这个文件里的两条 hook 加入它的用户级 hooks 配置。'])
  })
]);

module.exports = { AGENT_PLUGIN_NAME, AGENT_PLUGIN_TOOLS };
