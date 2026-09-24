/**
 * 中文报告格式化器
 *
 * 统一所有校验脚本的输出格式，保证报错信息带文件、行号、原因与建议。
 */

/**
 * 格式化单个问题
 * @param {{level?: string, ruleId: string, file: string, line?: number, message: string, detail?: string, suggestion?: string}} issue
 * @returns {string}
 */
export function formatIssue(issue) {
  const { level = 'error', ruleId, file, line, message, detail, suggestion } = issue;
  const icon = level === 'error' ? '❌' : '⚠️';
  const location = line ? `${file}:${line}` : file;
  const parts = [`${icon} 【${ruleId}】${location}`, `  问题：${message}`];

  if (detail) parts.push(`  详情：${detail}`);
  if (suggestion) parts.push(`  建议：${suggestion}`);
  parts.push('');

  return parts.join('\n');
}

/**
 * 格式化问题列表
 * @param {Array} issues
 * @param {string} title
 * @returns {string}
 */
export function formatReport(issues, title = '校验报告') {
  if (issues.length === 0) return `✅ ${title}：未发现问题`;

  const errors = issues.filter((item) => (item.level ?? 'error') === 'error');
  const warnings = issues.filter((item) => item.level === 'warn');
  const icon = errors.length > 0 ? '❌' : '⚠️';
  const parts = [
    `${icon} ${title}：发现 ${errors.length} 个错误、${warnings.length} 个警告`,
    '='.repeat(60),
    ''
  ];

  for (const issue of errors) parts.push(formatIssue(issue));
  for (const issue of warnings) parts.push(formatIssue(issue));

  return parts.join('\n');
}

/**
 * 格式化统计信息
 * @param {{totalFiles?: number, duration?: number, issues?: number, warnings?: number}} stats
 * @returns {string}
 */
export function formatStatistics(stats) {
  const { totalFiles = 0, duration = 0, issues = 0, warnings = 0 } = stats;
  return [
    '📊 校验统计',
    '='.repeat(60),
    `检查文件数：${totalFiles}`,
    `检查耗时：${duration}ms`,
    `错误数量：${issues}`,
    `警告数量：${warnings}`,
    ''
  ].join('\n');
}

/**
 * 汇总结论
 * @param {number} errors
 * @returns {string}
 */
export function formatSummary(errors) {
  return errors > 0
    ? `校验未通过：存在 ${errors} 个错误，请修复后重新执行。`
    : '校验通过：未发现错误。';
}
