/**
 * QQbot-Core 本地工具（自包含，不依赖主仓 dist 运行时解析）。
 * normalizeError 与主仓 src/utils/normalize-error.ts 同实现：
 * 非 Error 抛错（字符串/对象/undefined）统一归一为 Error，避免日志失真。
 */

export function normalizeError(err) {
  // Node ≥26：用 Error.isError；禁止基础设施式 instanceof 判错
  if (Error.isError(err)) return err
  return new Error(String(err))
}