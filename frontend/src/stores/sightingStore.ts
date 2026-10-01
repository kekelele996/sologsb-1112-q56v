import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { applyOutcome, reconcileSighting, withdrawClaim } from '../utils/reconcile';
import type { Sighting, UnclaimedReason } from '../types/sighting';

export interface SightingInput {
  colorRing: string;
  sightedAt: string;
  siteId: string;
  observer: string;
  rawText?: string;
  note?: string;
}

/** 一轮对账的结果汇总 */
export interface ReconcileSummary {
  /** 本轮参与对账的待认领条数 */
  tried: number;
  /** 新挂上鸟名的条数 */
  claimed: number;
  /** 一对多，留待认领 */
  ambiguous: number;
  /** 档案缺失，留待认领 */
  missing: number;
}

interface SightingState {
  sightings: Sighting[];
  hydrated: boolean;
}

/** 巡护目击记录与彩环对账 */
export const useSightingStore = defineStore('sighting', {
  state: (): SightingState => ({ sightings: [], hydrated: false }),

  getters: {
    unclaimed(state): Sighting[] {
      return state.sightings.filter((sighting) => sighting.status === '待认领');
    },
    claimed(state): Sighting[] {
      return state.sightings.filter((sighting) => sighting.status === '已认领');
    },
  },

  actions: {
    async hydrate() {
      this.sightings = await db.sightings.orderBy('sightedAt').reverse().toArray();
      this.hydrated = true;
    },

    /** 登记巡护目击：先原样留在巡护侧，状态为待认领（尚未对账） */
    async addSighting(input: SightingInput): Promise<Sighting> {
      const sighting: Sighting = {
        id: uid('sight'),
        colorRing: input.colorRing.trim(),
        sightedAt: input.sightedAt,
        siteId: input.siteId,
        observer: input.observer.trim(),
        rawText: input.rawText?.trim() || undefined,
        note: input.note?.trim() || undefined,
        status: '待认领',
        reason: '未核对',
      };
      await db.sightings.put(toPlain(sighting));
      this.sightings = [sighting, ...this.sightings];
      return sighting;
    },

    async removeSighting(id: string) {
      await db.sightings.delete(id);
      this.sightings = this.sightings.filter((sighting) => sighting.id !== id);
    },

    /**
     * 按彩环组合对账（幂等，可反复重试）：
     * 已认领的目击保持不动，只补待认领的；唯一命中挂到鸟名下，
     * 一对多 / 档案缺失继续留在待认领。全程在事务内，失败时巡护记录与环志档案两边都不丢。
     */
    async reconcileAll(): Promise<ReconcileSummary> {
      const summary: ReconcileSummary = { tried: 0, claimed: 0, ambiguous: 0, missing: 0 };
      const updated: Sighting[] = [];

      // 单事务内「读档案 → 判定 → 写巡护」原子完成：中途失败整体回滚，巡护记录与环志档案两边都不丢。
      await db.transaction('rw', db.sightings, db.rings, async () => {
        const rings = await db.rings.toArray();
        const pending = await db.sightings.where('status').equals('待认领').toArray();
        const at = new Date().toISOString();
        pending.forEach((sighting) => {
          summary.tried += 1;
          const outcome = reconcileSighting(sighting, rings);
          const next = applyOutcome(sighting, outcome, at);
          if (outcome.kind === 'claimed') summary.claimed += 1;
          else if (outcome.reason === '一对多') summary.ambiguous += 1;
          else summary.missing += 1;
          updated.push(next);
        });
        if (updated.length > 0) await db.sightings.bulkPut(toPlain(updated));
      });

      if (updated.length > 0) {
        const nextMap = new Map(updated.map((sighting) => [sighting.id, sighting]));
        this.sightings = this.sightings.map((sighting) => nextMap.get(sighting.id) ?? sighting);
      }
      return summary;
    },

    /**
     * 撤回某条已认领目击（站里发现挂错鸟）：
     * 只解除挂接关系并回到待认领，巡护记录本身保留，可在修正档案后重新对账。
     */
    async withdraw(id: string): Promise<void> {
      const current = this.sightings.find((sighting) => sighting.id === id);
      if (!current || current.status !== '已认领') return;
      const updated = withdrawClaim(current, new Date().toISOString());
      await db.sightings.put(toPlain(updated));
      this.sightings = this.sightings.map((sighting) => (sighting.id === id ? updated : sighting));
    },

    /** 待认领原因的兜底取值 */
    reasonOf(sighting: Sighting): UnclaimedReason {
      return sighting.reason ?? '未核对';
    },
  },
});
