<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_COLOR, type RingStatus } from '../../types/ring-record';
import { REASON_TEXT } from '../../types/sighting';
import { buildBirdProfile } from '../../utils/reconcile';
import { formatDate, formatDateTime } from '../../utils/format';
import { useRingStore } from '../../stores/ringStore';
import { useSightingStore } from '../../stores/sightingStore';
import { useSiteStore } from '../../stores/siteStore';

const props = defineProps<{
  modelValue: boolean;
  /** 要查看的金属环号 */
  ringNo: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const ringStore = useRingStore();
const sightingStore = useSightingStore();
const siteStore = useSiteStore();

const profile = computed(() =>
  props.ringNo
    ? buildBirdProfile(props.ringNo, ringStore.rings, sightingStore.sightings, siteStore.sites)
    : undefined,
);

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const siteName = (siteId: string) => siteStore.siteName(siteId);
</script>

<template>
  <el-drawer v-model="visible" :title="profile ? `鸟档案 · ${profile.ringNo}` : '鸟档案'" size="560px">
    <div v-if="profile" class="profile">
      <el-descriptions :column="2" border size="small" class="block">
        <el-descriptions-item label="金属环号">{{ profile.ringNo }}</el-descriptions-item>
        <el-descriptions-item label="彩环组合">{{ profile.colorRing }}</el-descriptions-item>
        <el-descriptions-item label="鸟种">{{ profile.speciesCn }}</el-descriptions-item>
        <el-descriptions-item label="学名">{{ profile.speciesSci || '—' }}</el-descriptions-item>
        <el-descriptions-item label="首次环志">{{ formatDate(profile.firstRingAt) }}</el-descriptions-item>
        <el-descriptions-item label="最近到访">{{ formatDate(profile.lastSeenAt) }}</el-descriptions-item>
      </el-descriptions>

      <el-row :gutter="8" class="stat-row">
        <el-col :span="8">
          <el-card shadow="never" class="mini-card">
            <div class="mini-label">捕获经历</div>
            <div class="mini-value">{{ profile.captureCount }} <span>次</span></div>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never" class="mini-card">
            <div class="mini-label">巡护目击</div>
            <div class="mini-value">{{ profile.sightingCount }} <span>次</span></div>
          </el-card>
        </el-col>
        <el-col :span="8">
          <el-card shadow="never" class="mini-card">
            <div class="mini-label">到访鸟点</div>
            <div class="mini-value">{{ profile.siteVisits.length }} <span>处</span></div>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never" class="block">
        <template #header>
          <span class="card-title">捕获经历（环志档案 {{ profile.captures.length }} 条）</span>
        </template>
        <el-timeline>
          <el-timeline-item
            v-for="cap in profile.captures"
            :key="cap.id"
            :timestamp="formatDateTime(cap.ringDate)"
            placement="top"
            :type="cap.status === '初捕' ? 'success' : cap.status === '重捕' ? 'warning' : 'danger'"
          >
            <div class="cap-line">
              <el-tag :type="STATUS_COLOR[cap.status as RingStatus]" size="small">{{ cap.status }}</el-tag>
              <span class="cap-site">{{ siteName(cap.siteId) }}</span>
              <span class="cap-net">{{ cap.netNo }} · 第 {{ cap.netRound }} 网次</span>
            </div>
            <div class="cap-meta">环志人：{{ cap.ringer }}<span v-if="cap.remark"> · {{ cap.remark }}</span></div>
          </el-timeline-item>
        </el-timeline>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <span class="card-title">巡护目击（已认领 {{ profile.sightings.length }} 条）</span>
        </template>
        <el-empty v-if="profile.sightings.length === 0" description="暂无认领到这只鸟的巡护目击" :image-size="60" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="sighting in profile.sightings"
            :key="sighting.id"
            :timestamp="formatDateTime(sighting.sightedAt)"
            placement="top"
            type="primary"
          >
            <div class="cap-line">
              <el-tag size="small" type="primary" effect="plain">{{ sighting.colorRing }}</el-tag>
              <span class="cap-site">{{ siteName(sighting.siteId) }}</span>
              <span class="cap-net">{{ sighting.observer }}</span>
            </div>
            <div v-if="sighting.rawText || sighting.note" class="cap-meta">
              <span v-if="sighting.rawText">手记：{{ sighting.rawText }}</span>
              <span v-if="sighting.note"> · {{ sighting.note }}</span>
            </div>
          </el-timeline-item>
        </el-timeline>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <span class="card-title">鸟点分布（{{ profile.siteVisits.length }} 处）</span>
        </template>
        <el-table :data="profile.siteVisits" size="small" border>
          <el-table-column label="鸟点" min-width="140">
            <template #default="scope">{{ scope.row.siteName }}</template>
          </el-table-column>
          <el-table-column prop="captureCount" label="捕获次数" width="90" align="right" />
          <el-table-column prop="sightingCount" label="目击次数" width="90" align="right" />
          <el-table-column label="最近到访" width="120">
            <template #default="scope">{{ formatDate(scope.row.lastAt) }}</template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
    <el-empty v-else :description="REASON_TEXT.档案缺失" />
  </el-drawer>
</template>

<style scoped>
.block {
  margin-bottom: 14px;
  border-radius: 8px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f4a44;
}
.stat-row {
  margin-bottom: 14px;
}
.mini-card {
  border-radius: 8px;
  text-align: center;
}
.mini-label {
  font-size: 12px;
  color: #8a7a68;
}
.mini-value {
  font-size: 22px;
  font-weight: 600;
  color: #1f5b52;
}
.mini-value span {
  font-size: 12px;
  font-weight: 400;
  color: #8a7a68;
}
.cap-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #2f4a44;
}
.cap-site {
  font-weight: 600;
}
.cap-net {
  color: #8a99a5;
  font-size: 12px;
}
.cap-meta {
  margin-top: 2px;
  font-size: 12px;
  color: #8a99a5;
}
</style>
