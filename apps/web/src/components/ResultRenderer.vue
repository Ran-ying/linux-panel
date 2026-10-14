<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Object, required: true },
  presentation: { type: Object, default: null }
});

const fields = computed(() => props.presentation?.fields ?? []);
const details = computed(() => props.presentation?.details ?? []);
const rows = computed(() => {
  const value = props.data?.[props.presentation?.rowsKey];
  return Array.isArray(value) ? value : [];
});
const progress = computed(() => {
  const value = props.data?.[props.presentation?.valueKey];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
});

function format(value, kind) {
  if (value === null || value === undefined) return '—';
  if (kind === 'bytes' && typeof value === 'number') {
    if (value === 0) return '0 B';
    const index = Math.min(5, Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))));
    return `${(value / 1024 ** index).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${['B','KiB','MiB','GiB','TiB','PiB'][index]}`;
  }
  if (kind === 'duration' && typeof value === 'number') {
    const secs = Math.floor(value);
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    return `${days ? days + ' 天 ' : ''}${hours} 小时 ${minutes} 分钟`;
  }
  if (kind === 'milliseconds') return `${value} ms`;
  if (kind === 'integer' && typeof value === 'number') return value.toLocaleString('zh-CN');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatted(key, formatKind) {
  return format(props.data?.[key], formatKind);
}
</script>

<template>
  <div class="rendered">
    <p v-if="data.source === 'mock-macos'" class="notice" role="status">
      模拟数据：macOS 不使用 systemd，这不是 VPS 的真实服务列表。
    </p>
    <p v-else-if="data.source === 'node-os-estimate'" class="notice" role="status">
      当前系统使用 Node.js 空闲内存估算，可能与系统监控工具的口径不同。
    </p>

    <div v-if="presentation?.type === 'metrics'" class="metric-grid">
      <div v-for="field in fields" :key="field.key" class="metric-card">
        <div class="metric-label">{{ field.label }}</div>
        <div class="metric-value">{{ formatted(field.key, field.format) }}</div>
      </div>
    </div>

    <div v-else-if="presentation?.type === 'progress'" class="progress-panel">
      <div class="progress-head">
        <div>
          <div class="metric-label">{{ presentation.title }}</div>
          <div class="big-number">{{ progress === null ? '—' : progress.toFixed(1) + '%' }}</div>
        </div>
        <div class="progress-summary" v-if="presentation.totalKey">
          <span>已用：{{ formatted(presentation.usedKey, 'bytes') }}</span>
          <span>总量：{{ formatted(presentation.totalKey, 'bytes') }}</span>
          <span>可用：{{ formatted(presentation.availableKey, 'bytes') }}</span>
        </div>
      </div>
      <div class="progress-track" role="progressbar" :aria-label="presentation.title"
        :aria-valuenow="progress ?? undefined" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" :class="{ critical: progress !== null && progress >= 90 }"
          :style="{ width: (progress ?? 0) + '%' }"></div>
      </div>
      <dl v-if="details.length" class="details">
        <div v-for="field in details" :key="field.key">
          <dt>{{ field.label }}</dt><dd>{{ formatted(field.key, field.format) }}</dd>
        </div>
      </dl>
    </div>

    <div v-else-if="presentation?.type === 'table'" class="table-wrap">
      <table>
        <thead><tr><th v-for="col in presentation.columns" :key="col.key" scope="col">{{ col.label }}</th></tr></thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="row.name ?? index">
            <td v-for="col in presentation.columns" :key="col.key">{{ format(row[col.key], col.format) }}</td>
          </tr>
          <tr v-if="!rows.length"><td :colspan="presentation.columns.length">没有可显示的记录</td></tr>
        </tbody>
      </table>
      <p class="muted small">{{ rows.length }} 条记录<span v-if="data.unparsedLines?.length"> · {{ data.unparsedLines.length }} 行未能解析（请查看 JSON）</span></p>
    </div>

    <pre v-else class="raw-output">{{ JSON.stringify(data, null, 2) }}</pre>
  </div>
</template>
