// 关卡内容与版本的统一入口。
// 目的：UI / 解锁 / 结算都从这里取关卡，不把 60 这个数字散落各处，
// 以后追加关卡时只改 levels.js + 这份文件即可。

import { LEVELS } from './levels-live.js';

/** 程序版本（代码） */
export const PROGRAM_VERSION = '1.1.0';
/** 关卡内容版本（数据） */
export const CONTENT_VERSION = '2026-10-25.60';
/** 存档 schema 版本 */
export const SCHEMA_VERSION = 3;

export function levelCount() {
  return LEVELS.length;
}

/** 按序号取关（存档里的 unlocked 也是序号） */
export function levelAt(index) {
  return LEVELS[index] || null;
}

/** 按稳定 ID 取关；找不到返回 null */
export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

/** ID → 序号；用于把"按 ID 存的成绩"映射回归档里的序号 */
export function indexOfLevelId(id) {
  return LEVELS.findIndex((l) => l.id === id);
}

/**
 * 内容自检：ID 必须唯一且从 1 开始连续。
 * 追加关卡时只要保持"在末尾追加、ID 递增"，旧存档的序号就不会错位。
 */
export function checkContent() {
  const problems = [];
  const seen = new Set();
  LEVELS.forEach((l, i) => {
    if (!Number.isInteger(l.id)) problems.push(`第 ${i + 1} 项 id 不是整数`);
    if (seen.has(l.id)) problems.push(`id 重复: ${l.id}`);
    seen.add(l.id);
    if (l.id !== i + 1) problems.push(`id 与序号不一致: 位置 ${i + 1} 的 id=${l.id}`);
  });
  return problems;
}

/** 给 QA / 日志看的一行摘要 */
export function contentStamp() {
  return `v${PROGRAM_VERSION} content=${CONTENT_VERSION} levels=${levelCount()}`;
}
