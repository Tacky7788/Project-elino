import { platform } from '../platform';
// Settings > Memory Dashboard tab
import type { Settings } from '../types';
import { t } from '../locales';
import { modalPrompt } from './shared';

let cachedMemoryV2: any = null;

async function loadMemoryDashboard() {
  try {
    cachedMemoryV2 = await platform.getMemoryV2();
    renderMemoryStats();
    renderMemoryFacts();
    renderMemorySummaries();
  } catch (err) {
    console.warn('記憶読み込み失敗:', err);
  }
}

function renderMemoryStats() {
  const el = document.getElementById('memory-stats');
  if (!el || !cachedMemoryV2) return;
  const m = cachedMemoryV2;
  const factCount = m.facts?.length || 0;
  const archivedCount = m.archivedFacts?.length || 0;
  const summaryCount = m.summaries?.length || 0;
  const promiseCount = m.promises?.filter((p: any) => p.status === 'pending')?.length || 0;
  const notebookCount = m.notebook?.length || 0;
  const rel = m.relationship || {};
  el.innerHTML = `
    ${t('settings.memory.stats.facts', { count: factCount, archived: archivedCount })}<br>
    ${t('settings.memory.stats.summaries', { count: summaryCount })}<br>
    ${t('settings.memory.stats.promises', { count: promiseCount })}<br>
    ${t('settings.memory.stats.notebooks', { count: notebookCount })}<br>
    ${t('settings.memory.stats.conversations', { count: rel.interactionCount || 0 })}
  `;
}

function renderMemoryFacts(filter = '') {
  const container = document.getElementById('memory-facts-list');
  if (!container || !cachedMemoryV2) return;
  container.innerHTML = '';

  const facts: any[] = cachedMemoryV2.facts || [];
  const filtered = filter
    ? facts.filter(f => f.content.toLowerCase().includes(filter.toLowerCase()) || f.key.toLowerCase().includes(filter.toLowerCase()))
    : facts;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); padding: 8px 0;">${t('settings.memory.facts.empty')}</div>`;
    return;
  }

  for (const fact of filtered) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border);';

    const info = document.createElement('div');
    info.style.cssText = 'flex: 1; min-width: 0;';

    const keySpan = document.createElement('span');
    keySpan.style.cssText = 'font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;';
    keySpan.textContent = `${fact.key} (${fact.importance || 'medium'}) x${fact.seenCount || 1}`;

    const contentSpan = document.createElement('span');
    contentSpan.style.cssText = 'font-size: 13px; color: var(--text); display: block; word-break: break-word; cursor: pointer;';
    contentSpan.textContent = fact.content;
    contentSpan.title = t('settings.memory.facts.clickToEdit');
    contentSpan.addEventListener('click', async () => {
      const newContent = await modalPrompt(t('settings.memory.facts.editPrompt'), fact.content);
      if (newContent !== null && newContent.trim()) {
        fact.content = newContent.trim();
        await platform.saveMemoryV2(cachedMemoryV2);
        contentSpan.textContent = fact.content;
      }
    });

    info.appendChild(keySpan);
    info.appendChild(contentSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-secondary';
    deleteBtn.style.cssText = 'font-size: 11px; padding: 2px 6px; color: #f87171; flex-shrink: 0;';
    deleteBtn.textContent = t('common.delete');
    deleteBtn.addEventListener('click', async () => {
      cachedMemoryV2.facts = cachedMemoryV2.facts.filter((f: any) => f.key !== fact.key);
      await platform.saveMemoryV2(cachedMemoryV2);
      renderMemoryFacts(filter);
      renderMemoryStats();
    });

    row.appendChild(info);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  }
}

function renderMemorySummaries() {
  const container = document.getElementById('memory-summaries-list');
  if (!container || !cachedMemoryV2) return;
  container.innerHTML = '';

  const summaries: any[] = cachedMemoryV2.summaries || [];
  if (summaries.length === 0) {
    container.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); padding: 8px 0;">${t('settings.memory.summaries.empty')}</div>`;
    return;
  }

  for (const s of summaries) {
    const item = document.createElement('div');
    item.style.cssText = 'padding: 8px 0; border-bottom: 1px solid var(--border);';
    const dateSpan = document.createElement('div');
    dateSpan.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-bottom: 2px;';
    dateSpan.textContent = s.date;
    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = 'font-size: 13px; color: var(--text); white-space: pre-wrap;';
    contentDiv.textContent = s.content;
    item.appendChild(dateSpan);
    item.appendChild(contentDiv);
    container.appendChild(item);
  }
}

export async function initTab(_settings: Settings): Promise<void> {
  await loadMemoryDashboard();

  document.getElementById('memory-open-folder')?.addEventListener('click', () => {
    platform.openMemoryFolder();
  });
  document.getElementById('memory-refresh')?.addEventListener('click', () => {
    loadMemoryDashboard();
  });
  document.getElementById('memory-search-input')?.addEventListener('input', (e) => {
    renderMemoryFacts((e.target as HTMLInputElement).value);
  });
}

export function collectSettings(_settings: Settings): void {
  // Memory dashboard is read-only in settings, no collect needed
}
