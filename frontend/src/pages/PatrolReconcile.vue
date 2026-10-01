<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import BirdProfileDrawer from '../components/common/BirdProfileDrawer.vue';
import { useSightingStore } from '../stores/sightingStore';
import { useRingStore } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { COLOR_RING_PRESETS } from '../types/ring-record';
import { REASON_TAG_TYPE, REASON_TEXT, type Sighting } from '../types/sighting';
import { findCandidates, isMatchableColorRing } from '../utils/reconcile';
import { formatDate, formatDateTime, todayStr } from '../utils/format';

const sightingStore = useSightingStore();
const ringStore = useRingStore();
const siteStore = useSiteStore();

const activeTab = ref<'unclaimed' | 'claimed'>('unclaimed');
const reconciling = ref(false);
const dialogVisible = ref(false);
const formRef = ref<FormInstance>();
const profileVisible = ref(false);
const profileRingNo = ref('');

interface SightingForm {
  colorRing: string;
  sightedDate: string;
  siteId: string;
  observer: string;
  rawText: string;
  note: string;
}

const form = ref<SightingForm>(emptyForm());

function emptyForm(): SightingForm {
  return {
    colorRing: '',
    sightedDate: todayStr(),
    siteId: siteStore.sites[0]?.id ?? '',
    observer: '',
    rawText: '',
    note: '',
  };
}

const rules: FormRules = {
  colorRing: [{ required: true, message: '请填写隔水看到的彩环组合', trigger: 'change' }],
  observer: [{ required: true, message: '请填写巡护志愿者', trigger: 'blur' }],
  siteId: [{ required: true, message: '请选择目击鸟点', trigger: 'change' }],
};

const unclaimed = computed(() => sightingStore.unclaimed);
const claimed = computed(() => sightingStore.claimed);
const claimedBirdCount = computed(() => new Set(claimed.value.map((item) => item.ringNo).filter(Boolean)).size);

const reasonBreakdown = computed(() => {
  const result = { 未核对: 0, 一对多: 0, 档案缺失: 0, 已撤回: 0 };
  unclaimed.value.forEach((item) => {
    result[item.reason ?? '未核对'] += 1;
  });
  return result;
});

/** 登记表单里即时预览彩环组合在档案中的候选鸟 */
const formCandidates = computed(() => findCandidates(form.value.colorRing, ringStore.rings).birdRingNos);
const formPreview = computed<{ type: 'success' | 'warning' | 'info' | 'danger'; text: string }>(() => {
  if (!isMatchableColorRing(form.value.colorRing)) {
    return { type: 'info', text: '填写彩环组合后可预览档案候选鸟；「无彩环」无法用于跨水对账' };
  }
  const count = formCandidates.value.length;
  if (count === 0) return { type: 'danger', text: `档案中暂无「${form.value.colorRing}」组合，登记后将留待认领` };
  if (count === 1) return { type: 'success', text: `档案唯一命中 ${count} 只鸟：${formCandidates.value[0]}，对账后自动挂上` };
  return { type: 'warning', text: `该组合命中 ${count} 只鸟（${formCandidates.value.join('、')}），需核金属环，先留待认领` };
});

/** 待认领列表里每行实时显示候选鸟（档案修正后重试前可先看到变化） */
function candidateRingNos(sighting: Sighting): string[] {
  return findCandidates(sighting.colorRing, ringStore.rings).birdRingNos;
}

function openCreate() {
  form.value = emptyForm();
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  await sightingStore.addSighting({
    colorRing: form.value.colorRing,
    sightedAt: new Date(`${form.value.sightedDate}T08:00:00`).toISOString(),
    siteId: form.value.siteId,
    observer: form.value.observer,
    rawText: form.value.rawText,
    note: form.value.note,
  });
  ElMessage.success('巡护目击已先记在巡护侧（待认领），可点「按彩环对账」挂到鸟名下');
  dialogVisible.value = false;
  activeTab.value = 'unclaimed';
}

/** 按彩环组合对账：幂等，只补待认领；失败时两边数据不丢（store 内事务保证） */
async function runReconcile() {
  if (unclaimed.value.length === 0) {
    ElMessage.info('没有待认领的目击，全部已挂上鸟名');
    return;
  }
  reconciling.value = true;
  try {
    const summary = await sightingStore.reconcileAll();
    if (summary.tried === 0) {
      ElMessage.info('没有需要补对账的目击');
    } else {
      ElMessage.success(
        `对账完成：核对 ${summary.tried} 条，新挂上 ${summary.claimed} 条` +
          (summary.ambiguous + summary.missing > 0 ? `，${summary.ambiguous + summary.missing} 条留待认领` : ''),
      );
    }
  } catch (error) {
    ElMessage.error(`对账失败，巡护记录与环志档案均未改动：${(error as Error).message}`);
  } finally {
    reconciling.value = false;
  }
}

/** 撤回错误认领：目击回到待认领，可在档案修正后重新对账 */
async function withdraw(sighting: Sighting) {
  const confirmed = await ElMessageBox.confirm(
    `撤回对 ${sighting.ringNo}（${sighting.speciesCn ?? ''}）的认领？撤回后该目击回到待认领，巡护记录保留，可重新对账。`,
    '撤回认领',
    { type: 'warning', confirmButtonText: '撤回认领', cancelButtonText: '取消' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await sightingStore.withdraw(sighting.id);
  ElMessage.success('已撤回，目击回到待认领');
  activeTab.value = 'unclaimed';
}

async function remove(sighting: Sighting) {
  const confirmed = await ElMessageBox.confirm('确认删除这条巡护目击？删除后无法恢复（环志档案不受影响）。', '删除确认', {
    type: 'warning',
  })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await sightingStore.removeSighting(sighting.id);
  ElMessage.success('已删除');
}

function openProfile(ringNo: string) {
  profileRingNo.value = ringNo;
  profileVisible.value = true;
}

const siteName = (siteId: string) => siteStore.siteName(siteId);
</script>

<template>
  <div>
    <h2 class="page-title">秋迁巡护 · 彩环对账</h2>
    <p class="page-desc">
      志愿者隔水只看得到彩环，目击先记在巡护这侧；回站后按彩环组合与环志档案对账：唯一命中才挂到鸟名下并汇总捕获经历与鸟点分布，组合对上多只鸟或档案没有的先留待认领。可反复重试，只补没挂上的；挂错可撤回，撤回后目击回到待认领。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="巡护目击" :value="sightingStore.sightings.length" unit="条" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="待认领" :value="unclaimed.length" unit="条" status="warning" hint="一对多 / 档案缺失 / 未核对" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="已认领目击" :value="claimed.length" unit="条" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="覆盖鸟只" :value="claimedBirdCount" unit="只" status="default" hint="已挂上鸟名的不同环号数" />
      </el-col>
    </el-row>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记巡护目击</el-button>
      <el-button type="warning" :icon="Refresh" :loading="reconciling" @click="runReconcile">按彩环对账</el-button>
      <el-tag v-if="reasonBreakdown.一对多" type="warning" effect="plain">一对多 {{ reasonBreakdown.一对多 }}</el-tag>
      <el-tag v-if="reasonBreakdown.档案缺失" type="danger" effect="plain">档案缺失 {{ reasonBreakdown.档案缺失 }}</el-tag>
      <el-tag v-if="reasonBreakdown.已撤回" type="info" effect="plain">已撤回 {{ reasonBreakdown.已撤回 }}</el-tag>
      <el-tag v-if="reasonBreakdown.未核对" type="info" effect="plain">未核对 {{ reasonBreakdown.未核对 }}</el-tag>
      <span class="toolbar-hint">对账幂等：已认领的不动，只补待认领</span>
    </div>

    <el-tabs v-model="activeTab" class="tabs">
      <el-tab-pane name="unclaimed">
        <template #label>待认领 <el-badge :value="unclaimed.length" :hidden="unclaimed.length === 0" :max="99" type="warning" /></template>

        <EmptyPanel
          v-if="unclaimed.length === 0"
          description="没有待认领的目击，巡护目击都已挂上鸟名"
          action-text="登记巡护目击"
          @action="openCreate"
        />

        <el-card v-else shadow="never" class="block">
          <el-table :data="unclaimed" size="small" border>
            <el-table-column prop="colorRing" label="彩环组合" width="120">
              <template #default="scope">
                <el-tag size="small" effect="dark">{{ scope.row.colorRing }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="目击时间" width="150">
              <template #default="scope">{{ formatDateTime(scope.row.sightedAt) }}</template>
            </el-table-column>
            <el-table-column label="鸟点" width="130">
              <template #default="scope">{{ siteName(scope.row.siteId) }}</template>
            </el-table-column>
            <el-table-column prop="observer" label="志愿者" width="90" />
            <el-table-column prop="rawText" label="手记彩环顺序/符号" min-width="150" show-overflow-tooltip />
            <el-table-column label="档案候选" min-width="170">
              <template #default="scope">
                <template v-if="candidateRingNos(scope.row).length === 0">
                  <el-tag size="small" type="danger" effect="plain">无候选</el-tag>
                </template>
                <template v-else-if="candidateRingNos(scope.row).length === 1">
                  <el-tag size="small" type="success" effect="plain">唯一：{{ candidateRingNos(scope.row)[0] }}</el-tag>
                </template>
                <template v-else>
                  <el-tooltip placement="top">
                    <template #content>
                      <div>{{ candidateRingNos(scope.row).join('、') }}</div>
                    </template>
                    <el-tag size="small" type="warning" effect="plain">
                      {{ candidateRingNos(scope.row).length }} 只候选（{{ candidateRingNos(scope.row).slice(0, 2).join('、') }}…）
                    </el-tag>
                  </el-tooltip>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="待认领原因" width="150">
              <template #default="scope">
                <el-tag size="small" :type="REASON_TAG_TYPE[sightingStore.reasonOf(scope.row)]" effect="plain">
                  {{ REASON_TEXT[sightingStore.reasonOf(scope.row)] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="scope">
                <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane name="claimed">
        <template #label>已认领 <el-badge :value="claimed.length" :hidden="claimed.length === 0" :max="99" type="success" /></template>

        <EmptyPanel v-if="claimed.length === 0" description="还没有认领到鸟名下的目击，先按彩环对账" />

        <el-card v-else shadow="never" class="block">
          <el-table :data="claimed" size="small" border>
            <el-table-column prop="colorRing" label="彩环组合" width="110">
              <template #default="scope">
                <el-tag size="small" effect="dark">{{ scope.row.colorRing }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="目击时间" width="150">
              <template #default="scope">{{ formatDateTime(scope.row.sightedAt) }}</template>
            </el-table-column>
            <el-table-column label="目击鸟点" width="120">
              <template #default="scope">{{ siteName(scope.row.siteId) }}</template>
            </el-table-column>
            <el-table-column prop="observer" label="志愿者" width="90" />
            <el-table-column label="认领到" min-width="200">
              <template #default="scope">
                <el-button link type="primary" :icon="Search" @click="openProfile(scope.row.ringNo)">
                  {{ scope.row.ringNo }} · {{ scope.row.speciesCn }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="认领时间" width="110">
              <template #default="scope">{{ formatDate(scope.row.matchedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click="openProfile(scope.row.ringNo)">鸟档案</el-button>
                <el-button link type="warning" @click="withdraw(scope.row)">撤回认领</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogVisible" title="登记巡护目击" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="130px">
        <el-form-item label="彩环组合" prop="colorRing">
          <el-select
            v-model="form.colorRing"
            filterable
            allow-create
            default-first-option
            placeholder="隔水看到的颜色顺序，如 红-黄"
            style="width: 260px"
          >
            <el-option v-for="item in COLOR_RING_PRESETS.filter((c) => c !== '无')" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="候选预览">
          <el-tag :type="formPreview.type" effect="plain">{{ formPreview.text }}</el-tag>
        </el-form-item>
        <el-form-item label="目击日期" prop="sightedDate">
          <el-date-picker v-model="form.sightedDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="目击鸟点" prop="siteId">
          <el-select v-model="form.siteId" style="width: 280px" placeholder="选择鸟点">
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="巡护志愿者" prop="observer">
          <el-input v-model="form.observer" style="width: 200px" maxlength="16" placeholder="如：林舟" />
        </el-form-item>
        <el-form-item label="手记彩环顺序/符号">
          <el-input v-model="form.rawText" maxlength="60" placeholder="如：左→右：○红 ▭黄" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="80" placeholder="天气 / 水文 / 距离 / 混群等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存到巡护侧</el-button>
      </template>
    </el-dialog>

    <BirdProfileDrawer v-model="profileVisible" :ring-no="profileRingNo" />
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #1f4a44;
}
.page-desc {
  margin: 0 0 12px;
  color: #6f8480;
  font-size: 13px;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.toolbar-hint {
  font-size: 12px;
  color: #8a99a5;
}
.tabs {
  margin-top: 4px;
}
.block {
  border-radius: 8px;
}
</style>
