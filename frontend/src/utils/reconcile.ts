import type { RingRecord } from '../types/ring-record';
import type { Sighting, UnclaimedReason } from '../types/sighting';
import type { BirdSite } from '../types/bird-site';

/** 彩环组合归一化：去空格、统一分隔符与大小写，保证「随手写」也能对上档案 */
export function normalizeColorRing(value: string): string {
  return (value || '')
    .trim()
    .replace(/[—–－_·\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** 无彩环（「无」/空）无法作为跨水识别的对账依据 */
export function isMatchableColorRing(colorRing: string): boolean {
  const norm = normalizeColorRing(colorRing);
  return norm.length > 0 && norm !== '无';
}

export interface RingCandidates {
  /** 命中的环志档案记录 */
  rings: RingRecord[];
  /** 按金属环号（即一只鸟）去重后的候选鸟 */
  birdRingNos: string[];
}

/**
 * 按彩环组合在环志档案中找候选鸟。
 * 一只鸟可能有初捕 + 多条重捕记录，因此先按环号去重。
 */
export function findCandidates(colorRing: string, rings: RingRecord[]): RingCandidates {
  if (!isMatchableColorRing(colorRing)) return { rings: [], birdRingNos: [] };
  const target = normalizeColorRing(colorRing);
  const matched = rings.filter((ring) => normalizeColorRing(ring.colorRing) === target);
  const birdRingNos = Array.from(new Set(matched.map((ring) => ring.ringNo)));
  return { rings: matched, birdRingNos };
}

/** 单条待认领目击的对账结论 */
export type ReconcileOutcome =
  | { kind: 'claimed'; ring: RingRecord }
  | { kind: 'unclaimed'; reason: Extract<UnclaimedReason, '一对多' | '档案缺失'> };

/** 对一条待认领目击按彩环组合对账：唯一鸟命中才认领，一对多 / 缺失留待认领 */
export function reconcileSighting(sighting: Sighting, rings: RingRecord[]): ReconcileOutcome {
  // 巡护记录靠彩环跨水识别，没有彩环就没有对账依据
  if (!isMatchableColorRing(sighting.colorRing)) return { kind: 'unclaimed', reason: '档案缺失' };
  const { rings: matched, birdRingNos } = findCandidates(sighting.colorRing, rings);
  if (birdRingNos.length === 0) return { kind: 'unclaimed', reason: '档案缺失' };
  if (birdRingNos.length > 1) return { kind: 'unclaimed', reason: '一对多' };
  // 认领到该鸟最早的一条档案记录（通常是初捕）
  const ringNo = birdRingNos[0];
  const ring =
    matched
      .filter((item) => item.ringNo === ringNo)
      .sort((a, b) => a.ringDate.localeCompare(b.ringDate))[0] ?? matched[0];
  return { kind: 'claimed', ring };
}

/** 应用对账结论到目击记录（返回新对象，不改动原记录） */
export function applyOutcome(sighting: Sighting, outcome: ReconcileOutcome, at: string): Sighting {
  if (outcome.kind === 'claimed') {
    return {
      ...sighting,
      status: '已认领',
      reason: undefined,
      reconciledAt: at,
      ringId: outcome.ring.id,
      ringNo: outcome.ring.ringNo,
      speciesCn: outcome.ring.speciesCn,
      matchedAt: at,
    };
  }
  return {
    ...sighting,
    status: '待认领',
    reason: outcome.reason,
    reconciledAt: at,
    ringId: undefined,
    ringNo: undefined,
    speciesCn: undefined,
    matchedAt: undefined,
  };
}

/** 撤回认领：目击回到待认领（巡护记录与环志档案两边都不删除） */
export function withdrawClaim(sighting: Sighting, at: string): Sighting {
  return {
    ...sighting,
    status: '待认领',
    reason: '已撤回',
    reconciledAt: at,
    ringId: undefined,
    ringNo: undefined,
    speciesCn: undefined,
    matchedAt: undefined,
  };
}

/** 某只鸟在一个鸟点的到访情况（捕获经历 + 巡护目击合并） */
export interface SiteVisit {
  siteId: string;
  siteName: string;
  /** 捕获（初捕/重捕/回收）次数 */
  captureCount: number;
  /** 巡护目击次数（已认领） */
  sightingCount: number;
  /** 最近一次到访时间 ISO */
  lastAt: string;
}

/** 一只鸟的完整档案：捕获经历 + 鸟点分布（含已认领巡护目击） */
export interface BirdProfile {
  /** 取该鸟初捕记录作为主记录 */
  primary: RingRecord;
  ringNo: string;
  speciesCn: string;
  speciesSci: string;
  colorRing: string;
  /** 全部捕获经历，按时间升序 */
  captures: RingRecord[];
  /** 认领到该鸟的巡护目击，按时间升序 */
  sightings: Sighting[];
  /** 鸟点分布 */
  siteVisits: SiteVisit[];
  captureCount: number;
  sightingCount: number;
  /** 首次环志时间 */
  firstRingAt: string;
  /** 最近一次到访（捕获或目击） */
  lastSeenAt: string;
}

function siteNameOf(sites: BirdSite[], siteId: string): string {
  return sites.find((site) => site.id === siteId)?.name ?? '未知鸟点';
}

/**
 * 汇总某金属环号对应鸟的捕获经历与鸟点分布。
 * 捕获来自环志档案，巡护目击来自已认领到该环号（任一档案记录 id 或环号快照）的 sighting。
 */
export function buildBirdProfile(
  ringNo: string,
  rings: RingRecord[],
  sightings: Sighting[],
  sites: BirdSite[],
): BirdProfile | undefined {
  const captures = rings
    .filter((ring) => ring.ringNo.toLowerCase() === ringNo.trim().toLowerCase())
    .sort((a, b) => a.ringDate.localeCompare(b.ringDate));
  if (captures.length === 0) return undefined;

  const ringIds = new Set(captures.map((ring) => ring.id));
  const claimed = sightings
    .filter(
      (sighting) =>
        sighting.status === '已认领' &&
        (ringIds.has(sighting.ringId ?? '') || sighting.ringNo?.toLowerCase() === ringNo.trim().toLowerCase()),
    )
    .sort((a, b) => a.sightedAt.localeCompare(b.sightedAt));

  const visitMap = new Map<string, SiteVisit>();
  const bump = (siteId: string, at: string, kind: 'capture' | 'sighting') => {
    const visit =
      visitMap.get(siteId) ??
      ({ siteId, siteName: siteNameOf(sites, siteId), captureCount: 0, sightingCount: 0, lastAt: at } as SiteVisit);
    if (kind === 'capture') visit.captureCount += 1;
    else visit.sightingCount += 1;
    if (at && (!visit.lastAt || at > visit.lastAt)) visit.lastAt = at;
    visitMap.set(siteId, visit);
  };

  captures.forEach((ring) => bump(ring.siteId, ring.ringDate, 'capture'));
  claimed.forEach((sighting) => bump(sighting.siteId, sighting.sightedAt, 'sighting'));

  const primary = captures.find((ring) => ring.status === '初捕') ?? captures[0];
  const allTimes = [...captures.map((r) => r.ringDate), ...claimed.map((s) => s.sightedAt)].filter(Boolean).sort();

  return {
    primary,
    ringNo: primary.ringNo,
    speciesCn: primary.speciesCn,
    speciesSci: primary.speciesSci,
    colorRing: primary.colorRing,
    captures,
    sightings: claimed,
    siteVisits: Array.from(visitMap.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    captureCount: captures.length,
    sightingCount: claimed.length,
    firstRingAt: captures[0]?.ringDate ?? '',
    lastSeenAt: allTimes[allTimes.length - 1] ?? captures[0]?.ringDate ?? '',
  };
}
