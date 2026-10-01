import type { RingRecord } from '../types/ring-record';
import { normalizeColorRing, type PatrolSighting } from '../types/patrol-sighting';

/** 按金属环号归并出的「鸟」（一只鸟 = 一个金属环号，含全部捕获经历） */
export interface BirdGroup {
  /** 金属环号（取最新一条记录上的写法） */
  ringNo: string;
  speciesCn: string;
  speciesSci: string;
  /** 该鸟各条记录出现过的彩环密钥集合（重捕记录并入同一只鸟，不重复计数） */
  colorKeys: Set<string>;
  /** 最新一条环志记录 id */
  latestRingId: string;
  /** 最新环志日期 */
  latestDate: string;
  /** 最早环志日期 */
  firstDate: string;
  /** 按日期升序排列的全部环志记录 */
  records: RingRecord[];
  /** 捕获涉及的鸟点 id（去重，保序） */
  captureSiteIds: string[];
}

/** 把环志记录按金属环号归并为鸟组：重捕 / 回收记录并入同一只鸟，对账时不重复计数 */
export function buildBirdGroups(rings: RingRecord[]): BirdGroup[] {
  const map = new Map<string, RingRecord[]>();
  rings.forEach((r) => {
    const key = r.ringNo.trim().toLowerCase();
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  });

  const groups: BirdGroup[] = [];
  map.forEach((list) => {
    const sorted = [...list].sort((a, b) => a.ringDate.localeCompare(b.ringDate));
    const colorKeys = new Set<string>();
    sorted.forEach((r) => {
      const k = normalizeColorRing(r.colorRing);
      if (k) colorKeys.add(k);
    });
    const captureSiteIds: string[] = [];
    sorted.forEach((r) => {
      if (r.siteId && !captureSiteIds.includes(r.siteId)) captureSiteIds.push(r.siteId);
    });
    const latest = sorted[sorted.length - 1];
    groups.push({
      ringNo: latest.ringNo.trim(),
      speciesCn: latest.speciesCn,
      speciesSci: latest.speciesSci,
      colorKeys,
      latestRingId: latest.id,
      latestDate: latest.ringDate,
      firstDate: sorted[0].ringDate,
      records: sorted,
      captureSiteIds,
    });
  });

  return groups.sort((a, b) => a.ringNo.localeCompare(b.ringNo));
}

/** 某只鸟的汇总：捕获经历 + 目击记录 + 鸟点分布 */
export interface BirdSummary {
  group: BirdGroup;
  /** 挂到该鸟名下的目击记录（按目击日期升序） */
  sightings: PatrolSighting[];
  /** 鸟点分布（捕获 + 目击），按合计次数降序 */
  siteDistribution: Array<{ siteId: string; captureCount: number; sightingCount: number; total: number }>;
}

/** 汇总某只鸟的捕获经历、目击记录与鸟点分布（捕获与目击都计入鸟点分布） */
export function summarizeBird(ringNo: string, rings: RingRecord[], sightings: PatrolSighting[]): BirdSummary | undefined {
  const target = ringNo.trim().toLowerCase();
  const group = buildBirdGroups(rings).find((g) => g.ringNo.toLowerCase() === target);
  if (!group) return undefined;

  const linked = sightings
    .filter((s) => s.claimStatus === 'linked' && s.linkedRingNo?.toLowerCase() === target)
    .sort((a, b) => a.sightingDate.localeCompare(b.sightingDate));

  const distMap = new Map<string, { captureCount: number; sightingCount: number }>();
  group.captureSiteIds.forEach((siteId) => {
    const captureCount = group.records.filter((r) => r.siteId === siteId).length;
    const item = distMap.get(siteId) ?? { captureCount: 0, sightingCount: 0 };
    item.captureCount += captureCount;
    distMap.set(siteId, item);
  });
  linked.forEach((s) => {
    if (!s.siteId) return;
    const item = distMap.get(s.siteId) ?? { captureCount: 0, sightingCount: 0 };
    item.sightingCount += 1;
    distMap.set(s.siteId, item);
  });

  const siteDistribution = Array.from(distMap.entries())
    .map(([siteId, v]) => ({ siteId, captureCount: v.captureCount, sightingCount: v.sightingCount, total: v.captureCount + v.sightingCount }))
    .sort((a, b) => b.total - a.total);

  return { group, sightings: linked, siteDistribution };
}
