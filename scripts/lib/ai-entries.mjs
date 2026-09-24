/**
 * AI 工具入口清单（唯一事实来源）
 *
 * 三个入口都由 AGENTS.md 生成，只是落地路径不同：
 *   claude  → CLAUDE.md
 *   cursor  → .cursor/rules/00-workflow.mdc
 *   copilot → .github/copilot-instructions.md
 *
 * 团队不用的工具，可以在 workflow.config.json 的 aiEntries 里去掉，脚本就不再生成对应文件，
 * 项目里也就不会留下用不到的目录（例如不用 Copilot 就没有 .github/）。
 * 默认三个都生成：多一个入口不影响使用，缺一个却会让用该工具的人拿到过时规范。
 */
export const AI_ENTRY_KEYS = ['claude', 'cursor', 'copilot'];
