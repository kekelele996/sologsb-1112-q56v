/** 认领状态：待认领 / 已挂接 */
export type ClaimStatus = 'pending' | 'linked';

/** 未决原因：档案中无此彩环组合 / 组合对上多只鸟 */
export type PendingReason = 'none' | 'multiple';

/** 巡护目击记录（志愿者在巡护侧随手记的彩环目击，与站里环志档案各留一份） */
export interface PatrolSighting {
  id: string;
  /** 彩环组合（志愿者随手记，顺序与符号不规范） */
  colorRing: string;
  /** 归一化彩环密钥（用于对账匹配） */
  colorKey: string;
  /** 目击日期 ISO */
  sightingDate: string;
  /** 鸟点 id */
  siteId: string;
  /** 目击 / 巡护人 */
  observer: string;
  /** 备注 */
  remark?: string;
  /** 认领状态：待认领 / 已挂接 */
  claimStatus: ClaimStatus;
  /** 挂接的鸟（金属环号），claimStatus=linked 时有值 */
  linkedRingNo?: string;
  /** 挂接时该鸟最新一条环志记录 id */
  linkedRingId?: string;
  /** 最近一次对账未决原因 */
  pendingReason?: PendingReason;
  /** 最近对账时间 ISO */
  reconciledAt?: string;
  /** 记录创建时间 ISO */
  createdAt: string;
}

/** 可识别的彩环颜色（单字） */
export const COLOR_CHARS = ['红', '橙', '黄', '绿', '蓝', '白', '黑', '粉', '灰', '紫'] as const;
export type ColorChar = (typeof COLOR_CHARS)[number];

/** 彩环标准顺序（归一化排序用） */
export const COLOR_ORDER: Record<string, number> = COLOR_CHARS.reduce(
  (acc, ch, idx) => {
    acc[ch] = idx;
    return acc;
  },
  {} as Record<string, number>,
);

/** 巡护目击彩环常用组合（不含「无」：没有彩环无法按组合对账） */
export const SIGHTING_COLOR_PRESETS: string[] = ['红-黄', '蓝-白', '绿-橙', '黑-红', '黄-蓝-白'];

/**
 * 归一化彩环组合：忽略书写顺序与分隔符号，按标准顺序排序，得到可对账的密钥。
 * 志愿者随手写的「红-黄」「红黄」「黄红」都归一为同一密钥；「无」「没有」等返回空串。
 */
export function normalizeColorRing(raw: string): string {
  if (!raw) return '';
  const text = raw.trim();
  if (!text || text === '无' || text === '没有' || text.toLowerCase() === 'none' || text === '-') return '';
  const found: string[] = [];
  for (const ch of text) {
    if (COLOR_ORDER[ch] !== undefined) found.push(ch);
  }
  if (found.length === 0) return '';
  return found.sort((a, b) => (COLOR_ORDER[a] ?? 99) - (COLOR_ORDER[b] ?? 99)).join('');
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  pending: '待认领',
  linked: '已挂接',
};

export const CLAIM_STATUS_COLOR: Record<ClaimStatus, 'warning' | 'success'> = {
  pending: 'warning',
  linked: 'success',
};

export const PENDING_REASON_LABEL: Record<PendingReason, string> = {
  none: '档案中无此彩环组合',
  multiple: '组合对上多只鸟',
};
