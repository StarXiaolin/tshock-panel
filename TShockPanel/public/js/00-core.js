'use strict';

/* 通用工具层 —— 只依赖 DOM 与 fetch，不读写任何业务状态。
 *
 * 这里放所有页面都会用到的东西：DOM 选择、格式化、请求封装、toast、模态框。
 * 依赖方向：页面模块 -> 本文件；本文件不反向依赖任何页面或状态模块。
 */

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtClock(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtUptime(ms) {
  if (!ms || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} 天 ${h} 小时 ${m} 分`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(list) {
  const arr = Array.isArray(list) ? list : [255, 255, 255];
  const [r, g, b] = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Number(arr[i]) || 0)));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function toast(message, type = 'ok', timeout = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (opts.body !== undefined && !(opts.body instanceof Blob)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || `请求失败（${res.status}）`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function modal({ title, desc = '', fields = [], okText = '确定', danger = false }) {
  hideDropdown();
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const rows = fields
      .map((f) => {
        const id = `m-${f.id}`;
        if (f.type === 'select') {
          const opts = (f.options || [])
            .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`)
            .join('');
          return `<div class="field"><label for="${id}">${esc(f.label)}</label><select class="input" id="${id}">${opts}</select>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea class="textarea" id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></div>`;
        }
        return `<div class="field"><label for="${id}">${esc(f.label)}</label><input class="input" id="${id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" />${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
      })
      .join('');

    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head"><h3>${esc(title)}</h3>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
          <div class="modal-body">${rows}</div>
          <div class="modal-foot">
            <button class="btn" data-modal="cancel">取消</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-modal="ok">${esc(okText)}</button>
          </div>
        </div>
      </div>`;

    const close = (value) => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        submit();
      }
    };
    const submit = () => {
      const values = {};
      for (const f of fields) {
        const el = $(`#m-${f.id}`);
        if (el) values[f.id] = f.type === 'number' ? Number(el.value) : el.value;
      }
      close(values);
    };

    $$('[data-modal]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.modal === 'ok') submit();
        else close(null);
      });
    });
    document.addEventListener('keydown', onKey);
    const first = $('.modal-body input, .modal-body select, .modal-body textarea', root);
    if (first) setTimeout(() => first.focus(), 30);
  });
}

function confirmDialog(title, desc, okText = '确定', danger = true) {
  return modal({ title, desc, fields: [], okText, danger }).then((v) => v !== null);
}
