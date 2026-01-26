<template>
  <div class="bookmark-import">
    <h2 class="page-title">书签导入</h2>
    <p class="page-desc">上传 Chrome/Firefox 导出的书签 HTML 文件，将书签导入为导航卡片。</p>

    <div class="import-form">
      <!-- 文件上传 -->
      <div class="form-group">
        <label class="form-label">选择书签文件</label>
        <div class="file-upload" :class="{ 'has-file': selectedFile }">
          <input
            type="file"
            ref="fileInput"
            accept=".html,.htm"
            @change="onFileChange"
            class="file-input"
          />
          <div class="file-upload-content">
            <svg v-if="!selectedFile" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2566d8" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span v-if="!selectedFile">点击或拖拽上传 HTML 文件</span>
            <span v-else class="file-name">{{ selectedFile.name }} ({{ formatFileSize(selectedFile.size) }})</span>
          </div>
        </div>
      </div>

      <!-- 导入模式 -->
      <div class="form-group">
        <label class="form-label">导入模式</label>
        <div class="radio-group">
          <label class="radio-item">
            <input type="radio" v-model="importMode" value="merge" />
            <span class="radio-label">合并导入</span>
            <span class="radio-desc">同 URL 书签将跳过，不重复导入</span>
          </label>
          <label class="radio-item">
            <input type="radio" v-model="importMode" value="replace" />
            <span class="radio-label">替换导入</span>
            <span class="radio-desc">先删除目标范围内的数据，再重新导入</span>
          </label>
        </div>
      </div>

      <!-- 目标栏目 -->
      <div class="form-group">
        <label class="form-label">目标栏目</label>
        <div class="radio-group">
          <label class="radio-item">
            <input type="radio" v-model="targetType" value="auto" />
            <span class="radio-label">自动创建</span>
            <span class="radio-desc">顶层文件夹自动创建为栏目，子文件夹路径创建为分组</span>
          </label>
          <label class="radio-item">
            <input type="radio" v-model="targetType" value="menu" />
            <span class="radio-label">指定栏目</span>
            <span class="radio-desc">所有书签导入到选定栏目，分组按完整路径创建</span>
          </label>
        </div>
        <select v-if="targetType === 'menu'" v-model="targetMenuId" class="menu-select">
          <option value="">请选择栏目</option>
          <option v-for="menu in menuList" :key="menu.id" :value="menu.id">
            {{ menu.name }}
          </option>
        </select>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <button
          class="btn btn-preview"
          @click="previewImport"
          :disabled="!canPreview || loading"
        >
          {{ loading && !isApplying ? '预览中...' : '预览导入' }}
        </button>
        <button
          class="btn btn-import"
          @click="executeImport"
          :disabled="!previewResult?.plan || loading"
        >
          {{ loading && isApplying ? '导入中...' : '确认导入' }}
        </button>
      </div>
    </div>

    <!-- 预览结果 -->
    <div v-if="previewResult" class="result-panel preview-panel">
      <h3>预览结果</h3>
      
      <!-- 统计摘要 -->
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">将创建栏目</span>
          <span class="stat-value">{{ previewResult.stats?.menusToCreate || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">复用已有栏目</span>
          <span class="stat-value muted">{{ previewResult.stats?.menusToReuse || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">将创建分组</span>
          <span class="stat-value">{{ previewResult.stats?.groupsToCreate || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">复用已有分组</span>
          <span class="stat-value muted">{{ previewResult.stats?.groupsToReuse || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">将创建卡片</span>
          <span class="stat-value success">{{ previewResult.stats?.cardsToCreate || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">将跳过重复</span>
          <span class="stat-value muted">{{ previewResult.stats?.cardsToSkip || 0 }}</span>
        </div>
      </div>

      <!-- 栏目详情 -->
      <div v-if="previewResult.menuDetails?.length" class="menu-details">
        <h4>栏目详情</h4>
        <div class="menu-list">
          <div v-for="(menu, idx) in previewResult.menuDetails" :key="idx" class="menu-item">
            <div class="menu-header">
              <span class="menu-name">{{ menu.name }}</span>
              <span class="menu-action" :class="menu.action">{{ menu.action === 'create' ? '新建' : '复用' }}</span>
            </div>
            <div class="menu-stats">
              <span v-if="menu.directCardCount > 0">直属卡片: {{ menu.directCardCount }}</span>
              <span v-if="menu.directSkipCount > 0" class="skip-count">(跳过 {{ menu.directSkipCount }})</span>
              <span v-if="menu.groupCount > 0">分组: {{ menu.groupCount }}</span>
            </div>
            <div v-if="menu.groups?.length" class="group-list">
              <div v-for="(group, gIdx) in menu.groups.slice(0, showAllGroups[idx] ? undefined : 5)" :key="gIdx" class="group-item">
                <span class="group-name">{{ group.name }}</span>
                <span class="group-stats">
                  卡片: {{ group.cardCount }}
                  <span v-if="group.skipCount > 0" class="skip-count">(跳过 {{ group.skipCount }})</span>
                </span>
              </div>
              <button v-if="menu.groups.length > 5" class="btn-more" @click="toggleGroups(idx)">
                {{ showAllGroups[idx] ? '收起' : `展开剩余 ${menu.groups.length - 5} 个分组` }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 样本书签 -->
      <div v-if="previewResult.sample?.length" class="sample-list">
        <h4>样本书签</h4>
        <ul>
          <li v-for="(item, idx) in previewResult.sample" :key="idx">
            <span class="sample-title">{{ item.title }}</span>
            <a :href="item.url" target="_blank" class="sample-url">{{ truncateUrl(item.url) }}</a>
          </li>
        </ul>
      </div>

      <!-- 解析提示 -->
      <div v-if="previewResult.errors?.length" class="error-list">
        <h4>解析提示</h4>
        <ul>
          <li v-for="(err, idx) in previewResult.errors.slice(0, 5)" :key="idx">{{ err }}</li>
          <li v-if="previewResult.errors.length > 5">... 共 {{ previewResult.errors.length }} 条提示</li>
        </ul>
      </div>
    </div>

    <!-- 导入结果 -->
    <div v-if="importResult" class="result-panel import-panel" :class="{ success: importResult.ok }">
      <h3>{{ importResult.ok ? '导入成功' : '导入失败' }}</h3>
      <div v-if="importResult.ok" class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">已创建栏目</span>
          <span class="stat-value success">{{ importResult.created?.menus || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">已创建分组</span>
          <span class="stat-value success">{{ importResult.created?.subMenus || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">已创建卡片</span>
          <span class="stat-value success">{{ importResult.created?.cards || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">已跳过重复</span>
          <span class="stat-value muted">{{ importResult.skipped?.cards || 0 }}</span>
        </div>
      </div>
      <p v-if="importResult.error" class="error-msg">{{ importResult.error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getMenus, previewBookmarks, applyBookmarks } from '../../api';

const fileInput = ref(null);
const selectedFile = ref(null);
const importMode = ref('merge');
const targetType = ref('auto');
const targetMenuId = ref('');
const menuList = ref([]);
const loading = ref(false);
const isApplying = ref(false);
const previewResult = ref(null);
const importResult = ref(null);
const showAllGroups = ref({});

const canPreview = computed(() => {
  if (!selectedFile.value) return false;
  if (targetType.value === 'menu' && !targetMenuId.value) return false;
  return true;
});

onMounted(async () => {
  try {
    const res = await getMenus();
    menuList.value = res.data || [];
  } catch (e) {
    console.error('Failed to load menus:', e);
  }
});

function onFileChange(e) {
  const file = e.target.files?.[0];
  if (file) {
    selectedFile.value = file;
    previewResult.value = null;
    importResult.value = null;
    showAllGroups.value = {};
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function truncateUrl(url) {
  return url.length > 50 ? url.slice(0, 47) + '...' : url;
}

function toggleGroups(idx) {
  showAllGroups.value[idx] = !showAllGroups.value[idx];
}

async function previewImport() {
  if (!canPreview.value) return;

  loading.value = true;
  isApplying.value = false;
  importResult.value = null;

  try {
    const target = targetType.value === 'auto' ? 'auto' : `menu:${targetMenuId.value}`;
    const result = await previewBookmarks(selectedFile.value, importMode.value, target);
    previewResult.value = result.data;
    showAllGroups.value = {};
  } catch (e) {
    previewResult.value = { ok: false, error: e.response?.data?.error || e.message };
  } finally {
    loading.value = false;
  }
}

async function executeImport() {
  if (!previewResult.value?.plan) return;

  loading.value = true;
  isApplying.value = true;

  try {
    const result = await applyBookmarks(
      previewResult.value.plan,
      importMode.value,
      previewResult.value.targetType,
      previewResult.value.targetMenuId
    );
    importResult.value = result.data;

    if (result.data.ok) {
      selectedFile.value = null;
      previewResult.value = null;
      if (fileInput.value) {
        fileInput.value.value = '';
      }
      const res = await getMenus();
      menuList.value = res.data || [];
    }
  } catch (e) {
    importResult.value = { ok: false, error: e.response?.data?.error || e.message };
  } finally {
    loading.value = false;
    isApplying.value = false;
  }
}
</script>

<style scoped>
.bookmark-import {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #222;
  margin-bottom: 8px;
}

.page-desc {
  color: #666;
  margin-bottom: 24px;
}

.import-form {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.form-group {
  margin-bottom: 24px;
}

.form-label {
  display: block;
  font-weight: 500;
  margin-bottom: 8px;
  color: #333;
}

.file-upload {
  position: relative;
  border: 2px dashed #d0d7e2;
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.file-upload:hover {
  border-color: #2566d8;
  background: #f8faff;
}

.file-upload.has-file {
  border-color: #2566d8;
  background: #f0f7ff;
}

.file-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.file-upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #666;
}

.file-name {
  color: #2566d8;
  font-weight: 500;
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.radio-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  padding: 12px;
  border: 1px solid #e3e6ef;
  border-radius: 8px;
  transition: all 0.2s;
}

.radio-item:hover {
  border-color: #2566d8;
}

.radio-item input[type="radio"] {
  margin-top: 2px;
}

.radio-label {
  font-weight: 500;
  color: #333;
}

.radio-desc {
  display: block;
  font-size: 12px;
  color: #888;
  margin-left: auto;
}

.menu-select {
  width: 100%;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #d0d7e2;
  border-radius: 8px;
  font-size: 14px;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-preview {
  background: #f0f7ff;
  color: #2566d8;
  border: 1px solid #2566d8;
}

.btn-preview:hover:not(:disabled) {
  background: #e0efff;
}

.btn-import {
  background: #2566d8;
  color: #fff;
}

.btn-import:hover:not(:disabled) {
  background: #174ea6;
}

.result-panel {
  margin-top: 24px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.result-panel h3 {
  font-size: 1.1rem;
  margin-bottom: 16px;
  color: #333;
}

.result-panel.success h3 {
  color: #1abc9c;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.stat-item {
  background: #f8f9fa;
  padding: 14px;
  border-radius: 8px;
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 1.4rem;
  font-weight: 600;
  color: #2566d8;
}

.stat-value.success {
  color: #1abc9c;
}

.stat-value.muted {
  color: #999;
}

/* 栏目详情 */
.menu-details {
  margin-top: 20px;
}

.menu-details h4 {
  font-size: 14px;
  color: #666;
  margin-bottom: 12px;
}

.menu-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.menu-item {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 12px;
}

.menu-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.menu-name {
  font-weight: 600;
  color: #333;
}

.menu-action {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}

.menu-action.create {
  background: #e3f9e5;
  color: #1a7f37;
}

.menu-action.reuse {
  background: #e8f4fd;
  color: #0969da;
}

.menu-stats {
  font-size: 13px;
  color: #666;
  display: flex;
  gap: 12px;
}

.skip-count {
  color: #999;
}

.group-list {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid #e0e0e0;
}

.group-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.group-name {
  color: #555;
}

.group-stats {
  color: #888;
}

.btn-more {
  background: none;
  border: none;
  color: #2566d8;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
  margin-top: 4px;
}

.btn-more:hover {
  text-decoration: underline;
}

.sample-list, .error-list {
  margin-top: 20px;
}

.sample-list h4, .error-list h4 {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.sample-list ul, .error-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sample-list li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
  font-size: 13px;
}

.sample-title {
  color: #333;
  font-weight: 500;
}

.sample-url {
  color: #2566d8;
  text-decoration: none;
}

.sample-url:hover {
  text-decoration: underline;
}

.error-list li {
  padding: 6px 0;
  font-size: 13px;
  color: #e67e22;
}

.error-msg {
  color: #e74c3c;
  font-weight: 500;
}

@media (max-width: 600px) {
  .bookmark-import {
    padding: 12px;
  }

  .import-form {
    padding: 16px;
  }

  .form-actions {
    flex-direction: column;
  }

  .radio-desc {
    display: block;
    margin-left: 0;
    margin-top: 4px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
