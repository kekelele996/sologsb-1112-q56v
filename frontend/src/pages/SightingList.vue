<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import StatBadge from '../components/common/StatBadge.vue';
import { useSightingStore } from '../stores/sightingStore';
import { useSiteStore } from '../stores/siteStore';
import {
  CLAIM_STATUS_COLOR,
  CLAIM_STATUS_LABEL,
  PENDING_REASON_LABEL,
  SIGHTING_COLOR_PRESETS,
  type ClaimStatus,
  type PatrolSighting,
} from '../types/patrol-sighting';
import type { BirdSummary } from '../utils/birds';
import { formatDate } from '../utils/format';

const route = useRoute();
const sightingStore = useSightingStore();
const siteStore = useSiteStore();

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();
const detailVisible = ref(false);
const detailRingNo = ref('');

interface SightingForm {
  colorRing: string;
  sightingDate: string;
  siteId: string;
  observer: string;
  remark: string;
}

const form = ref<SightingForm>({
  colorRing: '红-黄',
  sightingDate: new Date().toISOString().slice(0, 10),
  siteId: '',
  observer: '',
  remark: '',
});

const rules: FormRules = {
  colorRing: [{ required: true, message: '请输入彩环组合', trigger: 'change' }],
  sightingDate: [{ required: true, message: '请选择目击日期', trigger: 'change' }],
  siteId: [{ required: true, message: '请选择鸟点', trigger: 'change' }],
  observer: [{ required: true, message: '请输入目击 / 巡护人', trigger: 'blur' }],
};

const kwParam = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const claimParam = computed(() => (typeof route.query.claim === 'string' ? route.query.claim : ''));
const reasonParam = computed(() => (typeof route.query.reason === 'string' ? route.query.reason : ''));

/** FilterBar 用中文 label 作为选项值，这里映射回状态键 */
const claimKeyOf = (label: string): ClaimStatus | '' => {
  const entry = Object.entries(CLAIM_STATUS_LABEL).find(([, v]) => v === label);
  return entry ? (entry[0] as ClaimStatus) : '';
};
const reasonKeyOf = (label: string): PatrolSighting['pendingReason'] | '' => {
  const entry = Object.entries(PENDING_REASON_LABEL).find(([, v]) => v === label);
  return entry ? (entry[0] as PatrolSighting['pendingReason']) : '';
};

const visible = computed(() => {
  const claimKey = claimKeyOf(claimParam.value);
  const reasonKey = reasonKeyOf(reasonParam.value);
  return sightingStore.sightings.filter((s) => {
    if (claimKey && s.claimStatus !== claimKey) return false;
    if (reasonKey && s.pendingReason !== reasonKey) return false;
    if (kwParam.value) {
      const kw = kwParam.value.trim().toLowerCase();
      const siteName = siteStore.siteName(s.siteId);
      const haystack = `${s.colorRing} ${s.colorKey} ${s.observer} ${siteName} ${s.linkedRingNo ?? ''}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
});

const claimOptions = computed(() => Object.values(CLAIM_STATUS_LABEL));
const reasonOptions = computed(() => Object.values(PENDING_REASON_LABEL));

const detailSummary = computed<BirdSummary | undefined>(() =>
  detailRingNo.value ? sightingStore.birdSummary(detailRingNo.value) : undefined,
);

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = {
    colorRing: '红-黄',
    sightingDate: new Date().toISOString().slice(0, 10),
    siteId: siteStore.sites[0]?.id ?? '',
    observer: '',
    remark: '',
  };
  dialogVisible.value = true;
}

function openEdit(record: PatrolSighting) {
  editingId.value = record.id;
  form.value = {
    colorRing: record.colorRing,
    sightingDate: record.sightingDate.slice(0, 10),
    siteId: record.siteId,
    observer: record.observer,
    remark: record.remark ?? '',
  };
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const payload = {
    colorRing: form.value.colorRing,
    sightingDate: new Date(`${form.value.sightingDate}T08:00:00`).toISOString(),
    siteId: form.value.siteId,
    observer: form.value.observer,
    remark: form.value.remark,
  };
  if (editingId.value) {
    await sightingStore.updateSighting(editingId.value, payload);
    ElMessage.success('已更新目击记录');
  } else {
    await sightingStore.addSighting(payload);
    ElMessage.success('已登记目击记录，可点击「一键对账」按彩环组合认领');
  }
  dialogVisible.value = false;
}

async function remove(record: PatrolSighting) {
  const confirmed = await ElMessageBox.confirm(`确认删除这条彩环目击记录（${record.colorRing}）？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await sightingStore.removeSighting(record.id);
  ElMessage.success('已删除');
}

/** 一键对账：只补没挂上的（待认领），已挂接的不动 */
async function runReconcile() {
  const result = await sightingStore.reconcile();
  if (result.linked > 0) {
    ElMessage.success(`已挂接 ${result.linked} 条：${result.linkedNames.join('、')}；${result.pending} 条仍待认领`);
  } else if (result.pending > 0) {
    ElMessage.warning(`没有可挂接的目击，${result.pending} 条仍待认领（档案无此组合或对上多只鸟）`);
  } else {
    ElMessage.info('没有待认领的目击');
  }
}

/** 单条对账（只补这一条没挂上的） */
async function reconcileOne(record: PatrolSighting) {
  const result = await sightingStore.reconcile(record.id);
  if (result.linked > 0) {
    ElMessage.success(`已挂接到 ${result.linkedNames[0]}`);
  } else {
    ElMessage.warning(result.pending ? '仍待认领：档案无此组合或对上多只鸟' : '没有可挂接的目击');
  }
}

/** 撤回挂接：目击回到待认领，环志档案不动 */
async function revoke(record: PatrolSighting) {
  const confirmed = await ElMessageBox.confirm(
    `确认撤回目击 ${record.colorRing} 对 ${record.linkedRingNo} 的挂接？撤回后该目击回到待认领，环志档案不受影响。`,
    '撤回确认',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await sightingStore.revoke(record.id);
  ElMessage.success('已撤回，目击回到待认领');
}

function showBird(record: PatrolSighting) {
  if (!record.linkedRingNo) return;
  detailRingNo.value = record.linkedRingNo;
  detailVisible.value = true;
}

function claimLabel(status: ClaimStatus): string {
  return CLAIM_STATUS_LABEL[status];
}

function reasonLabel(record: PatrolSighting): string {
  return record.pendingReason ? PENDING_REASON_LABEL[record.pendingReason] : '—';
}
</script>

<template>
  <div>
    <h2 class="page-title">巡护目击对账</h2>
    <p class="page-desc">
      秋迁巡护时隔着水面只看得到彩环，志愿者把目击随手记在这侧；回站后按彩环组合与环志档案对账：恰好对上一只鸟就挂到该鸟名下，对上多只或档案里没有的留在待认领。核对失败两边都保住，重试只补没挂上的，挂错可撤回。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="目击总数" :value="sightingStore.sightings.length" unit="条" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="待认领" :value="sightingStore.pendingCount" unit="条" status="warning" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="已挂接" :value="sightingStore.linkedCount" unit="条" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="档案鸟种数" :value="sightingStore.birdGroups.length" unit="种" />
      </el-col>
    </el-row>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记目击</el-button>
      <el-button type="success" :disabled="sightingStore.pendingCount === 0" @click="runReconcile">一键对账（补没挂上的）</el-button>
      <el-tag v-if="sightingStore.pendingCount > 0" type="warning" effect="plain">
        {{ sightingStore.pendingCount }} 条待认领
      </el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'claim', label: '认领状态', options: claimOptions, width: 120 },
        { key: 'reason', label: '未决原因', options: reasonOptions, width: 160 },
      ]"
      keyword-placeholder="搜索彩环 / 目击人 / 鸟点 / 环号"
      :result-count="visible.length"
      :total-count="sightingStore.sightings.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的巡护目击" action-text="登记目击" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border>
        <el-table-column label="彩环组合（随手记）" width="150">
          <template #default="scope">
            <span class="ring-raw">{{ scope.row.colorRing }}</span>
            <el-tag size="small" effect="plain" class="ring-key">密钥 {{ scope.row.colorKey || '—' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目击日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.sightingDate) }}</template>
        </el-table-column>
        <el-table-column label="鸟点" width="140">
          <template #default="scope">{{ siteStore.siteName(scope.row.siteId) }}</template>
        </el-table-column>
        <el-table-column prop="observer" label="目击人" width="90" />
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="CLAIM_STATUS_COLOR[scope.row.claimStatus as ClaimStatus]" size="small">
              {{ claimLabel(scope.row.claimStatus as ClaimStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="挂接鸟 / 未决原因" min-width="200">
          <template #default="scope">
            <el-button v-if="scope.row.claimStatus === 'linked'" link type="primary" @click="showBird(scope.row)">
              {{ scope.row.linkedRingNo }}
            </el-button>
            <span v-else class="reason-text">{{ reasonLabel(scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="scope">
            <el-button v-if="scope.row.claimStatus === 'pending'" link type="success" @click="reconcileOne(scope.row)">对账</el-button>
            <el-button v-if="scope.row.claimStatus === 'linked'" link type="warning" @click="revoke(scope.row)">撤回</el-button>
            <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
            <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑巡护目击' : '登记巡护目击'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" class="sighting-form">
        <el-form-item label="彩环组合" prop="colorRing">
          <el-select
            v-model="form.colorRing"
            filterable
            allow-create
            default-first-option
            placeholder="随手记下看到的彩环，如 红-黄 / 红黄"
            style="width: 260px"
          >
            <el-option v-for="item in SIGHTING_COLOR_PRESETS" :key="item" :label="item" :value="item" />
          </el-select>
          <div class="form-hint">顺序与符号随手写即可，对账时按颜色归一（红-黄 / 红黄 / 黄红 视为同一组合）</div>
        </el-form-item>
        <el-form-item label="目击日期" prop="sightingDate">
          <el-date-picker v-model="form.sightingDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="鸟点" prop="siteId">
          <el-select v-model="form.siteId" style="width: 240px">
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="目击 / 巡护人" prop="observer">
          <el-input v-model="form.observer" style="width: 180px" maxlength="16" placeholder="如：马晓" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="80" placeholder="目击情境、彩环顺序等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" :title="`鸟只档案 · ${detailSummary?.group.ringNo ?? ''}`" width="760px">
      <div v-if="detailSummary" class="bird-detail">
        <div class="bird-head">
          <el-tag type="success" effect="plain">已挂接</el-tag>
          <span class="bird-ring">{{ detailSummary.group.ringNo }}</span>
          <span class="bird-species">{{ detailSummary.group.speciesCn }}</span>
          <span class="bird-sci">{{ detailSummary.group.speciesSci }}</span>
        </div>

        <el-divider content-position="left">捕获经历（{{ detailSummary.group.records.length }} 条环志记录）</el-divider>
        <el-table :data="detailSummary.group.records" size="small" border>
          <el-table-column label="环志日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
          </el-table-column>
          <el-table-column prop="ringNo" label="环号" width="110" />
          <el-table-column prop="colorRing" label="彩环" width="100" />
          <el-table-column prop="status" label="状态" width="80" />
          <el-table-column label="鸟点" width="150">
            <template #default="scope">{{ siteStore.siteName(scope.row.siteId) }}</template>
          </el-table-column>
          <el-table-column prop="ringer" label="环志人" width="90" />
        </el-table>

        <el-divider content-position="left">巡护目击（{{ detailSummary.sightings.length }} 条）</el-divider>
        <el-table :data="detailSummary.sightings" size="small" border>
          <el-table-column label="目击日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.sightingDate) }}</template>
          </el-table-column>
          <el-table-column prop="colorRing" label="彩环（随手记）" width="140" />
          <el-table-column label="鸟点" width="150">
            <template #default="scope">{{ siteStore.siteName(scope.row.siteId) }}</template>
          </el-table-column>
          <el-table-column prop="observer" label="目击人" width="90" />
        </el-table>

        <el-divider content-position="left">鸟点分布（捕获 + 目击）</el-divider>
        <el-table :data="detailSummary.siteDistribution" size="small" border>
          <el-table-column label="鸟点" min-width="160">
            <template #default="scope">{{ siteStore.siteName(scope.row.siteId) }}</template>
          </el-table-column>
          <el-table-column prop="captureCount" label="捕获" width="90" align="right" />
          <el-table-column prop="sightingCount" label="目击" width="90" align="right" />
          <el-table-column prop="total" label="合计" width="90" align="right">
            <template #default="scope">
              <span class="dist-total">{{ scope.row.total }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
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
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.ring-raw {
  font-weight: 600;
  color: #1f4a44;
}
.ring-key {
  margin-left: 6px;
}
.reason-text {
  color: #b06a00;
  font-size: 13px;
}
.form-hint {
  font-size: 12px;
  color: #8a99a5;
  line-height: 1.6;
  margin-top: 4px;
}
.bird-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bird-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.bird-ring {
  font-size: 16px;
  font-weight: 700;
  color: #1f4a44;
}
.bird-species {
  font-size: 15px;
  color: #2f7d6f;
  font-weight: 600;
}
.bird-sci {
  font-size: 13px;
  color: #8a99a5;
  font-style: italic;
}
.dist-total {
  font-weight: 700;
  color: #2f7d6f;
}
</style>
