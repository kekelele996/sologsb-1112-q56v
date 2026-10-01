/** 目击认领状态 */
export type SightingStatus = '待认领' | '已认领';

/** 待认领原因 / 最近一次对账结果 */
export type UnclaimedReason = '未核对' | '一对多' | '档案缺失' | '已撤回';

/** 巡护目击记录（志愿者隔水只看得到彩环，先记在巡护这侧） */
export interface Sighting {
  id: string;
  /** 彩环组合（对账依据） */
  colorRing: string;
  /** 目击时间 ISO */
  sightedAt: string;
  /** 目击鸟点 id */
  siteId: string;
  /** 巡护志愿者 */
  observer: string;
  /** 随手写的彩环顺序与符号，如「左→右：○红 ▭黄」 */
  rawText?: string;
  /** 天气 / 水文等目击备注 */
  note?: string;
  /** 认领状态：待认领 / 已认领 */
  status: SightingStatus;
  /** 待认领原因（已认领时为空） */
  reason?: UnclaimedReason;
  /** 最近一次对账时间 ISO */
  reconciledAt?: string;
  /** 认领到的环志档案记录 id（通常为该鸟初捕记录） */
  ringId?: string;
  /** 认领时快照的金属环号（档案后续变动也不影响巡护侧留存） */
  ringNo?: string;
  /** 认领时快照的鸟种中文名 */
  speciesCn?: string;
  /** 认领时间 ISO */
  matchedAt?: string;
}

export const SIGHTING_REASONS: UnclaimedReason[] = ['未核对', '一对多', '档案缺失', '已撤回'];

/** 待认领原因的标签配色 */
export const REASON_TAG_TYPE: Record<UnclaimedReason, 'info' | 'warning' | 'danger'> = {
  未核对: 'info',
  一对多: 'warning',
  档案缺失: 'danger',
  已撤回: 'info',
};

export const REASON_TEXT: Record<UnclaimedReason, string> = {
  未核对: '尚未对账',
  一对多: '彩环组合命中多只鸟',
  档案缺失: '环志档案中无此组合',
  已撤回: '认领已撤回，等待重新对账',
};
