import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain, toPlainList } from '../utils/plain';
import { useRingStore } from './ringStore';
import {
  normalizeColorRing,
  type ClaimStatus,
  type PatrolSighting,
  type PendingReason,
} from '../types/patrol-sighting';
import { buildBirdGroups, summarizeBird, type BirdGroup, type BirdSummary } from '../utils/birds';

export interface SightingInput {
  colorRing: string;
  sightingDate?: string;
  siteId: string;
  observer: string;
  remark?: string;
}

interface SightingState {
  sightings: PatrolSighting[];
  hydrated: boolean;
}

/** 巡护目击与环志档案按彩环组合对账 */
export const useSightingStore = defineStore('sighting', {
  state: (): SightingState => ({ sightings: [], hydrated: false }),

  getters: {
    pendingCount(state): number {
      return state.sightings.filter((s) => s.claimStatus === 'pending').length;
    },
    linkedCount(state): number {
      return state.sightings.filter((s) => s.claimStatus === 'linked').length;
    },
    /** 站里环志档案按金属环号归并出的鸟组 */
    birdGroups(): BirdGroup[] {
      const ringStore = useRingStore();
      return buildBirdGroups(ringStore.rings);
    },
    /** 某只鸟的捕获经历 + 目击记录 + 鸟点分布 */
    birdSummary(state): (ringNo: string) => BirdSummary | undefined {
      return (ringNo: string) => {
        const ringStore = useRingStore();
        return summarizeBird(ringNo, ringStore.rings, state.sightings);
      };
    },
  },

  actions: {
    async hydrate() {
      this.sightings = await db.sightings.orderBy('sightingDate').reverse().toArray();
      this.hydrated = true;
    },

    async addSighting(input: SightingInput): Promise<PatrolSighting> {
      const colorKey = normalizeColorRing(input.colorRing);
      const sighting: PatrolSighting = {
        id: uid('sighting'),
        colorRing: input.colorRing.trim(),
        colorKey,
        sightingDate: input.sightingDate ?? new Date().toISOString(),
        siteId: input.siteId,
        observer: input.observer.trim(),
        remark: input.remark?.trim() || undefined,
        claimStatus: 'pending',
        createdAt: new Date().toISOString(),
      };
      await db.sightings.put(toPlain(sighting));
      this.sightings = [sighting, ...this.sightings];
      return sighting;
    },

    async updateSighting(id: string, patch: Partial<SightingInput>) {
      const current = this.sightings.find((s) => s.id === id);
      if (!current) return;
      const next: PatrolSighting = {
        ...current,
        ...patch,
        colorRing: patch.colorRing !== undefined ? patch.colorRing.trim() : current.colorRing,
        colorKey: patch.colorRing !== undefined ? normalizeColorRing(patch.colorRing) : current.colorKey,
        observer: patch.observer !== undefined ? patch.observer.trim() : current.observer,
        remark: patch.remark !== undefined ? patch.remark.trim() || undefined : current.remark,
      };
      await db.sightings.put(toPlain(next));
      this.sightings = this.sightings.map((s) => (s.id === id ? next : s));
    },

    async removeSighting(id: string) {
      await db.sightings.delete(id);
      this.sightings = this.sightings.filter((s) => s.id !== id);
    },

    /**
     * 对账：只处理待认领（pending）的目击，已挂接的不重跑。
     * 彩环组合恰好对上一只鸟 → 挂到该鸟名下；对上多只鸟或档案里没有 → 留在待认领并记原因。
     * 核对失败不删改任何一方数据，巡护记录与环志档案两边都保住。
     * @param targetId 只对账某一条目击（不传则对账全部待认领）
     */
    async reconcile(targetId?: string): Promise<{ linked: number; pending: number; linkedNames: string[] }> {
      const ringStore = useRingStore();
      const groups = buildBirdGroups(ringStore.rings);
      const now = new Date().toISOString();
      let linked = 0;
      let pending = 0;
      const linkedNames: string[] = [];

      const nextList = this.sightings.map((s) => {
        if (s.claimStatus !== 'pending') return s; // 已挂接的不重跑
        if (targetId && s.id !== targetId) return s;
        const key = s.colorKey || normalizeColorRing(s.colorRing);
        const matches = key ? groups.filter((g) => g.colorKeys.has(key)) : [];

        if (matches.length === 1) {
          const bird = matches[0];
          linked += 1;
          linkedNames.push(`${bird.ringNo}（${bird.speciesCn}）`);
          return {
            ...s,
            colorKey: key,
            claimStatus: 'linked' as ClaimStatus,
            linkedRingNo: bird.ringNo,
            linkedRingId: bird.latestRingId,
            pendingReason: undefined,
            reconciledAt: now,
          };
        }

        pending += 1;
        return {
          ...s,
          colorKey: key,
          claimStatus: 'pending' as ClaimStatus,
          linkedRingNo: undefined,
          linkedRingId: undefined,
          pendingReason: (matches.length === 0 ? 'none' : 'multiple') as PendingReason,
          reconciledAt: now,
        };
      });

      const changed = nextList.filter((s, idx) => s !== this.sightings[idx]);
      if (changed.length) await db.sightings.bulkPut(toPlainList(changed));
      this.sightings = nextList;
      return { linked, pending, linkedNames };
    },

    /** 撤回挂接：目击回到待认领，环志档案不动 */
    async revoke(id: string) {
      const current = this.sightings.find((s) => s.id === id);
      if (!current || current.claimStatus !== 'linked') return;
      const next: PatrolSighting = {
        ...current,
        claimStatus: 'pending',
        linkedRingNo: undefined,
        linkedRingId: undefined,
        pendingReason: undefined,
        reconciledAt: undefined,
      };
      await db.sightings.put(toPlain(next));
      this.sightings = this.sightings.map((s) => (s.id === id ? next : s));
    },
  },
});
