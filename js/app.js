/*!
 * app.js —— 界面交互、答题流程、成绩统计
 */
(function () {
  'use strict';

  const P = window.QBParser;
  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.prototype.slice.call((r || document).querySelectorAll(sel));

  /* =========================================================
   * 工具函数
   * =======================================================*/

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(n) {
    const v = Math.round(n * 10) / 10;
    return String(v);
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (x) => (x < 10 ? '0' + x : '' + x);
    return h > 0 ? h + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 800);
  }

  /** 转义正则元字符，用于把用户关键词安全地放进 RegExp */
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* =========================================================
   * 状态
   * =======================================================*/

  /** 答题卡每页固定行数；每行题数由容器宽度决定，避免大屏浪费空间 */
  const SHEET_ROWS = 5;

  const S = {
    bank: null,          // { title, questions:[], warnings:[] }
    questions: [],       // 本轮实际练习的题目
    responses: [],       // 每题作答内容
    results: [],         // { graded, correct, score }
    current: 0,
    mode: 'instant',     // instant | defer
    study: false,        // 背题模式：只看题目与答案，不判题
    reveal: 'auto',      // 背题模式下答案显示方式：auto 直接显示 | click 点击显示
    revealed: [],        // 背题模式下每题答案是否已显示
    searchTexts: [],     // 背题搜索：每题可搜索文本（题干+选项，小写），避免反复拼接
    order: 'seq',          // seq | random | byType
    shuffleOptions: false, // 选项顺序是否随机（独立开关，不影响出题顺序）
    startTs: 0,
    elapsed: 0,
    timerId: null,
    filter: 'all',
    sheetPage: 0           // 答题卡当前页码（从 0 开始）
  };

  /* =========================================================
   * 视图切换
   * =======================================================*/

  const STEP_OF = { upload: 1, practice: 2, result: 3 };

  function showView(name) {
    ['upload', 'practice', 'result'].forEach((v) => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('is-hidden', v !== name);
    });
    $$('#steps .step').forEach((el) => {
      const n = Number(el.getAttribute('data-step'));
      const cur = STEP_OF[name];
      el.classList.toggle('is-active', n === cur);
      el.classList.toggle('is-done', n < cur);
    });
    window.scrollTo(0, 0);
  }

  /* =========================================================
   * 站点内确认弹窗（替代浏览器原生 confirm）
   * =======================================================*/

  let modalResolve = null;
  let modalFocusBack = null;

  /**
   * 打开确认弹窗，返回 Promise<boolean>
   * @param {{title?:string, text?:string, okText?:string, cancelText?:string, danger?:boolean}} opts
   */
  function ask(opts) {
    const el = $('#modal');
    if (!el) {
      // 理论上不会发生：弹窗节点缺失时直接放弃操作，避免静默误触
      console.warn('[练习助手] 未找到确认弹窗节点，操作已取消');
      return Promise.resolve(false);
    }
    // 已有弹窗未关闭时，新的请求按「取消」处理，避免两个弹窗叠在一起
    if (modalResolve) return Promise.resolve(false);

    $('#modal-title').textContent = opts.title || '请确认';
    const textEl = $('#modal-text');
    textEl.textContent = opts.text || '';
    textEl.classList.toggle('is-hidden', !opts.text);
    $('#modal-ok').className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    $('#modal-ok').textContent = opts.okText || '确定';
    $('#modal-cancel').textContent = opts.cancelText || '取消';

    modalFocusBack = document.activeElement;
    el.classList.remove('is-hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => { const b = $('#modal-ok'); if (b) b.focus(); }, 0);

    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function closeModal(result) {
    if (!modalResolve) return;
    $('#modal').classList.add('is-hidden');
    document.body.classList.remove('modal-open');
    const done = modalResolve;
    modalResolve = null;
    const back = modalFocusBack;
    modalFocusBack = null;
    if (back && back.focus) back.focus();
    done(result);
  }

  function bindModal() {
    $('#modal-ok').addEventListener('click', () => closeModal(true));
    $('#modal-cancel').addEventListener('click', () => closeModal(false));
    $('#modal-mask').addEventListener('click', () => closeModal(false));

    document.addEventListener('keydown', (e) => {
      if (!modalResolve) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(false);
        return;
      }
      if (e.key === 'Tab') {
        // 焦点锁在弹窗内的两个按钮上
        const items = [$('#modal-cancel'), $('#modal-ok')];
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        const next = e.shiftKey
          ? (i <= 0 ? items.length - 1 : i - 1)
          : (i === items.length - 1 ? 0 : i + 1);
        items[next].focus();
      }
    });
  }

  /* =========================================================
   * 在线题库：直接读取仓库 banks/ 目录
   * =======================================================*/

  // 同站优先（GitHub Pages）；失败再退回 raw.githubusercontent，
  // 这样双击本地 index.html 打开时也能用
  const ONLINE_SOURCES = [
    'banks/',
    'https://raw.githubusercontent.com/SubmergeDQ/Practice-Assistant/main/banks/'
  ];
  const ONLINE_TIMEOUT = 8000;

  let onlineOpen = false;
  let onlineHome = ''; // 上一次成功的源，下次优先用

  /** 带时间戳重新拉取，绕开浏览器与 CDN 缓存 */
  function fetchFreshText(url) {
    const u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ONLINE_TIMEOUT) : null;
    return fetch(u, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  async function fetchFromRepo(path) {
    const order = onlineHome
      ? [onlineHome].concat(ONLINE_SOURCES.filter((b) => b !== onlineHome))
      : ONLINE_SOURCES.slice();
    const fails = [];
    for (const base of order) {
      try {
        const text = await fetchFreshText(base + path);
        onlineHome = base;
        return text;
      } catch (err) {
        fails.push((base.indexOf('http') === 0 ? 'raw' : '本站') + ' ' + (err && err.message ? err.message : err));
      }
    }
    throw new Error(fails.join('；'));
  }

  async function readOnlineManifest() {
    const text = await fetchFromRepo('index.json');
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('index.json 不是合法 JSON');
    }
    const list = Array.isArray(data) ? data : data && data.banks;
    if (!Array.isArray(list)) throw new Error('index.json 里缺少 banks 数组');
    return list.filter((it) => it && it.file);
  }

  // 题库列表里题型固定的展示顺序：选择题在前
  const TYPE_BREAKDOWN = [['single', '单选'], ['multiple', '多选'], ['judge', '判断'], ['blank', '填空']];

  /** 第一行总体量（共 N 题 · 满分），第二行题型分布 */
  function onlineMeta(entry) {
    const total = entry.count
      ? '共 ' + entry.count + ' 题' + (entry.score ? ' · 满分 ' + entry.score + ' 分' : '')
      : '';

    let types = '';
    if (entry.types && typeof entry.types === 'object') {
      types = TYPE_BREAKDOWN
        .filter(([key]) => Number(entry.types[key]) > 0)
        .map(([key, label]) => label + ' ' + entry.types[key])
        .join('，');
    } else if (entry.desc) {
      types = entry.desc; // 兼容只写了一句描述的旧清单
    }
    return { total: total, types: types };
  }

  function renderOnlineList(items) {
    const box = $('#online-list');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<p class="online-empty">仓库里还没有题库文件。<br>把 JSON 放进 banks/，再登记到 banks/index.json 即可。</p>';
      $('#online-count').textContent = '';
      return;
    }
    $('#online-count').textContent = '共 ' + items.length + ' 个';
    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'online-item';
      const meta = onlineMeta(it);
      btn.innerHTML =
        '<span class="oi-main">' +
        '<span class="oi-name">' + esc(it.name || it.file) + '</span>' +
        (meta.total ? '<span class="oi-total">' + esc(meta.total) + '</span>' : '') +
        (meta.types ? '<span class="oi-types">' + esc(meta.types) + '</span>' : '') +
        '</span><span class="oi-go">载入</span>';
      btn.addEventListener('click', () => loadOnlineBank(it, btn));
      box.appendChild(btn);
    });
  }

  async function refreshOnline() {
    const box = $('#online-list');
    const tip = $('#online-tip');
    box.innerHTML = '<p class="online-empty">正在读取仓库里的题库…</p>';
    $('#online-count').textContent = '';
    tip.classList.remove('is-error');
    tip.textContent = '题库文件放在 GitHub 仓库的 banks/ 目录，每次打开都会重新拉取最新列表。';
    try {
      renderOnlineList(await readOnlineManifest());
    } catch (err) {
      box.innerHTML =
        '<p class="online-empty">读取在线题库失败。<br>如果是双击本地 index.html 打开的，浏览器会拦截跨域请求，请改用线上地址访问。</p>';
      tip.classList.add('is-error');
      tip.textContent = '失败原因：' + (err && err.message ? err.message : err);
    }
  }

  async function loadOnlineBank(entry, btn) {
    const tip = $('#online-tip');
    const go = btn.querySelector('.oi-go');
    const goText = go ? go.textContent : '载入';
    btn.disabled = true;
    if (go) go.textContent = '载入中…';
    tip.classList.remove('is-error');
    tip.textContent = '正在从仓库读取「' + (entry.name || entry.file) + '」…';

    try {
      const text = await fetchFromRepo(encodeURIComponent(entry.file));
      const bank = /\.txt$/i.test(entry.file) ? P.parseText(text) : P.parseJSON(text);
      if (!bank.questions.length) throw new Error('没有解析出有效题目');
      bank.fileName = entry.name || entry.file;

      closeOnline();
      handleBank(bank);
      if (!bank.warnings || !bank.warnings.length) {
        notice('已从在线题库载入「' + esc(bank.title) + '」，共 ' + bank.questions.length + ' 题。', 'ok');
      }
    } catch (err) {
      tip.classList.add('is-error');
      tip.textContent = '载入失败：' + (err && err.message ? err.message : err);
    } finally {
      btn.disabled = false;
      if (go) go.textContent = goText;
    }
  }

  function openOnline() {
    if (onlineOpen) return;
    onlineOpen = true;
    $('#online-modal').classList.remove('is-hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => { const b = $('#online-close'); if (b) b.focus(); }, 0);
    refreshOnline();
  }

  function closeOnline() {
    if (!onlineOpen) return;
    onlineOpen = false;
    $('#online-modal').classList.add('is-hidden');
    document.body.classList.remove('modal-open');
    const back = $('#btn-online');
    if (back) back.focus();
  }

  function bindOnline() {
    $('#btn-online').addEventListener('click', openOnline);
    $('#online-close').addEventListener('click', closeOnline);
    $('#online-mask').addEventListener('click', closeOnline);
    $('#online-refresh').addEventListener('click', refreshOnline);

    document.addEventListener('keydown', (e) => {
      if (!onlineOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeOnline();
      }
    });
  }

  /* =========================================================
   * 上传与解析
   * =======================================================*/

  function notice(msg, kind) {
    const el = $('#upload-notice');
    if (!msg) { el.className = 'notice is-hidden'; el.innerHTML = ''; return; }
    el.className = 'notice' + (kind ? ' is-' + kind : '');
    el.innerHTML = msg;
  }

  function handleBank(bank) {
    S.bank = bank;
    const counts = { single: 0, multiple: 0, judge: 0, blank: 0 };
    let totalScore = 0;
    bank.questions.forEach((q) => { counts[q.type]++; totalScore += q.score; });

    const chips = ['single', 'multiple', 'judge', 'blank']
      .filter((k) => counts[k] > 0)
      .map((k) => '<span class="chip">' + P.TYPE_LABEL[k] + ' <b>' + counts[k] + '</b></span>')
      .join('');

    $('#bank-card').className = 'bank-card';
    $('#bank-card').innerHTML =
      '<div class="bank-head">' +
      '<h3>' + esc(bank.title) + '</h3>' +
      '<span class="bank-count">解析成功 · ' + bank.questions.length + ' 题 · 满分 ' + fmtNum(totalScore) + ' 分</span>' +
      '</div>' +
      '<div class="bank-chips">' + chips + '</div>' +
      (bank.description ? '<p class="bank-score">' + esc(bank.description) + '</p>' : '');

    if (bank.warnings && bank.warnings.length) {
      const items = bank.warnings.slice(0, 8).map((w) => '<li>' + esc(w) + '</li>').join('');
      const more = bank.warnings.length > 8 ? '<li>…… 另有 ' + (bank.warnings.length - 8) + ' 条提示</li>' : '';
      notice('题库已载入，但有 ' + bank.warnings.length + ' 处需要注意：<ul>' + items + more + '</ul>', 'warn');
    } else {
      notice('题库解析成功，共 ' + bank.questions.length + ' 题，可以开始练习了。', 'ok');
    }

    $('#btn-start').disabled = bank.questions.length === 0;

    // 窄屏（手机）上题库卡片在首屏之外，解析完成后滚动过去，避免用户以为没反应
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
      setTimeout(() => {
        const card = $('#bank-card');
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    }
  }

  function loadFile(file) {
    if (!file) return;
    if (!/\.(json|txt|text)$/i.test(file.name)) {
      notice('不支持的文件类型：' + esc(file.name) + '。请上传 .json 或 .txt 题库文件。', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notice('文件过大（超过 10 MB），请拆分题库后再上传。', 'error');
      return;
    }
    notice('正在解析「' + esc(file.name) + '」……');

    P.parseFile(file)
      .then((bank) => {
        if (!bank.questions.length) {
          notice('没有解析出有效题目，请检查文件格式是否符合说明。', 'error');
          return;
        }
        handleBank(bank);
      })
      .catch((err) => {
        notice('解析失败：' + esc(err && err.message ? err.message : err), 'error');
      });
  }

  function loadSample() {
    if (!window.QB_SAMPLES) {
      notice('示例题库未加载，请确认 js/sample-data.js 存在。', 'error');
      return;
    }
    notice('正在载入示例题库……');
    try {
      const bank = P.parseText(window.QB_SAMPLES.txt);
      bank.fileName = '示例题库（TXT）';
      handleBank(bank);
    } catch (err) {
      notice('示例题库载入失败：' + esc(err.message), 'error');
    }
  }

  /* =========================================================
   * 练习：渲染题目
   * =======================================================*/

  function isGraded(i) {
    const r = S.results[i];
    return !!(r && r.graded);
  }

  /** 背题模式下当前题的答案是否已展开（直接显示 或 已点击过「显示答案」） */
  function studyAnswerVisible(i) {
    return S.study && (S.reveal === 'auto' || !!S.revealed[i]);
  }

  /** 该选项在原题里的字母（打乱后与当前字母不同才返回） */
  function originKeyOf(q, key) {
    if (!q.originOptions || q.type === 'judge' || q.type === 'blank') return '';
    const opt = q.options.filter((x) => x.key === key)[0];
    if (!opt) return '';
    const hit = q.originOptions.filter((x) => x.text === opt.text)[0];
    return hit && hit.key !== key ? hit.key : '';
  }

  function optTextOf(q, key, withOrigin) {
    if (q.type === 'judge') return key === 'T' ? '正确' : '错误';
    const o = q.options.filter((x) => x.key === key)[0];
    if (!o) return key;
    const origin = withOrigin ? originKeyOf(q, key) : '';
    return key + '. ' + o.text + (origin ? '（原 ' + origin + '）' : '');
  }

  function keysText(q, keys, withOrigin) {
    if (!keys || !keys.length) return '';
    return keys.slice().sort().map((k) => optTextOf(q, k, withOrigin)).join('；');
  }

  function correctText(q, withOrigin) {
    if (q.type === 'blank') {
      return q.answers
        .map((alts, i) => (q.answers.length > 1 ? '第' + (i + 1) + '空 ' : '') + alts.join(' / '))
        .join('；');
    }
    return keysText(q, q.answers, withOrigin);
  }

  function givenText(q, resp) {
    if (q.type === 'blank') {
      const arr = Array.isArray(resp) ? resp : [];
      if (!arr.some((v) => String(v == null ? '' : v).trim())) return '';
      return arr
        .map((v, i) => (q.answers.length > 1 ? '第' + (i + 1) + '空 ' : '') + (String(v == null ? '' : v).trim() || '（空）'))
        .join('；');
    }
    if (q.type === 'multiple') return keysText(q, resp || []);
    return resp ? keysText(q, [resp]) : '';
  }

  /** 解析文本里是否用字母指代选项（如「故选 C」「A、B 两项」） */
  function mentionsOptionLetters(text) {
    return /(?:^|[^A-Za-z])[A-H]{1,4}(?:$|[^A-Za-z])/.test(String(text == null ? '' : text));
  }

  /**
   * 选项被打乱过、且解析里用字母指代选项时，按原顺序列出选项。
   * 解析是按原题顺序写的，重编号后必须给一份原始对照才不会读错。
   */
  function originOrderHTML(q) {
    if (!q.originOptions || !q.originOptions.length) return '';
    if (!q.explanation || !mentionsOptionLetters(q.explanation)) return '';
    const items = q.originOptions.map((o) => o.key + '. ' + o.text).join('　');
    return (
      '<div class="origin-order">' +
      '<span class="k">原顺序</span>' +
      '<span class="v">' + esc(items) + '</span>' +
      '</div>' +
      '<p class="origin-tip">本题选项已打乱并重新编号，解析里提到的 A/B/C/D 以「原顺序」为准。</p>'
    );
  }

  function buildOptions(q, i) {
    const graded = isGraded(i);
    const resp = S.responses[i];
    const wrap = document.createElement('div');
    wrap.className = 'options' + (q.type === 'multiple' ? ' is-multi' : '');

    q.options.forEach((opt) => {
      const selected = q.type === 'multiple'
        ? (resp || []).indexOf(opt.key) >= 0
        : resp === opt.key;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      if (selected) btn.classList.add('is-selected');
      if (graded) {
        if (q.answers.indexOf(opt.key) >= 0) btn.classList.add('is-correct');
        else if (selected) btn.classList.add('is-wrong');
        btn.disabled = true;
      }
      const mark = q.type === 'judge' ? (opt.key === 'T' ? '√' : '×') : opt.key;
      btn.innerHTML =
        '<span class="opt-mark">' + mark + '</span>' +
        '<span class="opt-text">' + esc(opt.text) + '</span>';
      btn.addEventListener('click', () => toggleOption(q, i, opt.key));
      wrap.appendChild(btn);
    });

    return wrap;
  }

  /** 背题模式的选项：仅用于对照查看，不记录选择、不判题 */
  function buildStudyOptions(q) {
    const wrap = document.createElement('div');
    wrap.className = 'options is-static' + (q.type === 'multiple' ? ' is-multi' : '');
    q.options.forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'option';
      const mark = q.type === 'judge' ? (opt.key === 'T' ? '√' : '×') : opt.key;
      item.innerHTML =
        '<span class="opt-mark">' + mark + '</span>' +
        '<span class="opt-text">' + esc(opt.text) + '</span>';
      wrap.appendChild(item);
    });
    return wrap;
  }

  function buildBlanks(q, i) {
    const graded = isGraded(i);
    const resp = Array.isArray(S.responses[i]) ? S.responses[i] : [];
    const wrap = document.createElement('div');
    wrap.className = 'blank-list';

    q.answers.forEach((alts, bi) => {
      const row = document.createElement('div');
      row.className = 'blank-row';

      const label = document.createElement('span');
      label.className = 'blank-no';
      label.textContent = q.answers.length > 1 ? '第 ' + (bi + 1) + ' 空' : '答案';
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'blank-input';
      input.placeholder = '请输入答案';
      input.value = resp[bi] || '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (graded) input.disabled = true;
      input.addEventListener('input', () => {
        const arr = Array.isArray(S.responses[i]) ? S.responses[i].slice() : new Array(q.answers.length).fill('');
        while (arr.length < q.answers.length) arr.push('');
        arr[bi] = input.value;
        S.responses[i] = arr;
        renderSheet();
        updateControls();
      });
      row.appendChild(input);

      if (graded) {
        const ans = document.createElement('span');
        ans.className = 'blank-correct';
        ans.textContent = '正确答案：' + alts.join(' / ');
        row.appendChild(ans);
      }
      wrap.appendChild(row);
    });

    return wrap;
  }

  /** 背题模式的答案区：正确答案 + 原顺序对照（选项乱序时）+ 解析 */
  function renderAnswerPanel(i) {
    const el = $('#answer-panel');
    const q = S.questions[i];
    if (!q || !studyAnswerVisible(i)) {
      el.className = 'answer-panel is-hidden';
      el.innerHTML = '';
      return;
    }

    let html =
      '<div class="ans-head">' +
      '<span class="k">正确答案</span>' +
      '<b class="ans-value">' + esc(correctText(q, true)) + '</b>' +
      '</div>';
    if (q.explanation) {
      html += originOrderHTML(q);
      html += '<div class="ans-exp"><span class="k">解析</span><p>' + esc(q.explanation) + '</p></div>';
    }
    el.className = 'answer-panel';
    el.innerHTML = html;
  }

  function renderFeedback(i) {
    const el = $('#feedback');
    if (S.study || !isGraded(i) || S.mode !== 'instant') {
      el.className = 'feedback is-hidden';
      el.innerHTML = '';
      return;
    }
    const q = S.questions[i];
    const r = S.results[i];
    const answered = P.isAnswered(q, S.responses[i]);

    let html =
      '<div class="fb-head">' +
      (r.correct ? '回答正确' : answered ? '回答错误' : '本题未作答') +
      '<span class="fb-score">本题得分 ' + fmtNum(r.score) + ' / ' + fmtNum(q.score) + '</span>' +
      '</div>';

    html += '<div class="fb-line"><span class="k">正确答案</span><b>' + esc(correctText(q, true)) + '</b></div>';
    const given = givenText(q, S.responses[i]);
    if (given) html += '<div class="fb-line"><span class="k">你的答案</span><b>' + esc(given) + '</b></div>';
    if (q.explanation) {
      html += originOrderHTML(q);
      html += '<div class="fb-exp"><span class="k">解析</span><p>' + esc(q.explanation) + '</p></div>';
    }

    el.className = 'feedback ' + (r.correct ? 'is-ok' : 'is-bad');
    el.innerHTML = html;
  }

  /** 每页题数 = 固定 5 行 × 当前容器宽度能排下的列数 */
  function sheetPageSize() {
    const grid = $('#sheet-grid');
    const style = getComputedStyle(grid);
    const minWidth = parseFloat(style.getPropertyValue('--sheet-cell-min')) || 32;
    const gap = parseFloat(style.getPropertyValue('--sheet-gap')) || 6;
    const width = grid.clientWidth;
    // 视图隐藏时宽度为 0，退回桌面侧栏常见的 6 列，布局就绪后会自动校正
    if (!width) return 6 * SHEET_ROWS;
    const cols = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
    return cols * SHEET_ROWS;
  }

  function renderSheet() {
    const grid = $('#sheet-grid');
    const pageSize = sheetPageSize();
    grid.innerHTML = '';
    const aside = $('#sheet-aside');
    aside.classList.toggle('is-study', S.study);

    const total = S.questions.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    // 题量变化或页码越界时兜底，避免出现空白页
    S.sheetPage = Math.min(Math.max(S.sheetPage, 0), pageCount - 1);
    const start = S.sheetPage * pageSize;
    const end = Math.min(start + pageSize, total);

    for (let i = start; i < end; i++) {
      const q = S.questions[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheet-cell';
      b.textContent = i + 1;
      if (S.study) {
        // 背题模式不判题，只标记「已看」的题
        if (S.reveal === 'click' && S.revealed[i]) b.classList.add('is-done');
      } else {
        if (P.isAnswered(q, S.responses[i])) b.classList.add('is-done');
        if (isGraded(i)) b.classList.add(S.results[i].correct ? 'is-ok' : 'is-bad');
      }
      if (i === S.current) b.classList.add('is-current');
      b.addEventListener('click', () => goTo(i));
      grid.appendChild(b);
    }

    // 分页条：只有一页时隐藏
    const pager = $('#sheet-pager');
    pager.classList.toggle('is-hidden', pageCount <= 1);
    $('#sheet-page-info').textContent = (S.sheetPage + 1) + ' / ' + pageCount;
    $('#sheet-prev').disabled = S.sheetPage <= 0;
    $('#sheet-next').disabled = S.sheetPage >= pageCount - 1;

    const lgDone = $('.lg-done', aside);
    // 直接显示答案时所有题都没有「已看」之分，图例也隐藏这一项
    if (lgDone) lgDone.classList.toggle('is-hidden', S.study && S.reveal === 'auto');

    if (S.study) {
      const seen = S.questions.filter((q, i) => studyAnswerVisible(i)).length;
      $('#sheet-stat').textContent = S.reveal === 'auto'
        ? '共 ' + S.questions.length + ' 题'
        : '已看 ' + seen + ' / ' + S.questions.length;
      if (lgDone) lgDone.innerHTML = '<i class="dot dot-done"></i>已看';
      return;
    }

    const done = S.questions.filter((q, i) => P.isAnswered(q, S.responses[i])).length;
    $('#sheet-stat').textContent = '已答 ' + done + ' / ' + S.questions.length;
    if (lgDone) lgDone.innerHTML = '<i class="dot dot-done"></i>已答';
  }

  /** 答题卡翻页：只切换页码，不改变当前题目 */
  function turnSheetPage(delta) {
    const pageCount = Math.max(1, Math.ceil(S.questions.length / sheetPageSize()));
    const next = S.sheetPage + delta;
    if (next < 0 || next >= pageCount) return;
    S.sheetPage = next;
    renderSheet();
  }

  /* =========================================================
   * 背题搜索：输入关键词实时定位题目
   * =======================================================*/

  /** 把关键词按空格拆成多个词，任一题需全部命中才算匹配（AND 关系） */
  function searchHits(kw) {
    const terms = String(kw).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    for (let i = 0; i < S.searchTexts.length; i++) {
      const hay = S.searchTexts[i];
      if (terms.every((t) => hay.indexOf(t) >= 0)) hits.push(i);
    }
    return hits;
  }

  /** 对已转义的文本高亮关键词，返回带 <mark> 的 HTML */
  function highlightTerms(text, terms) {
    let out = text;
    terms.forEach((t) => {
      const re = new RegExp('(' + escapeRegExp(t) + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }

  /** 渲染搜索结果列表：题号 + 题干摘要，点击跳转 */
  function renderStudyResults(kw) {
    const list = $('#study-result');
    const input = $('#study-search-input');
    const terms = String(kw).toLowerCase().split(/\s+/).filter(Boolean);
    const hits = terms.length ? searchHits(kw) : [];

    $('#study-search-clear').classList.toggle('is-hidden', !input.value);

    if (!terms.length || !hits.length) {
      list.innerHTML = terms.length
        ? '<li class="sr-empty">没有找到匹配的题目</li>'
        : '';
      list.classList.toggle('is-hidden', !terms.length);
      return;
    }

    const showCount = 50; // 命中过多时只列前 50 条，避免列表过长
    let html = '';
    hits.slice(0, showCount).forEach((i) => {
      const q = S.questions[i];
      const typeLabel = { blank: '填空', judge: '判断', multiple: '多选' }[q.type] || '单选';
      html +=
        '<li class="sr-item' + (i === S.current ? ' is-current' : '') + '" data-idx="' + i + '">' +
        '<span class="sr-no">' + (i + 1) + '</span>' +
        '<span class="sr-text">' + highlightTerms(esc(q.stem), terms) + '</span>' +
        '<span class="sr-tag">' + typeLabel + '</span>' +
        '</li>';
    });
    if (hits.length > showCount) {
      html += '<li class="sr-more">还有 ' + (hits.length - showCount) + ' 条结果，请输入更精确的关键词</li>';
    }
    list.innerHTML = html;
    list.classList.remove('is-hidden');
  }

  /** 关闭搜索结果列表（保留输入内容） */
  function hideStudyResults() {
    $('#study-result').classList.add('is-hidden');
  }

  /** 绑定搜索框交互：输入防抖搜索、Enter 跳转、Esc 清空、点击外关闭 */
  function bindStudySearch() {
    const input = $('#study-search-input');
    const clear = $('#study-search-clear');
    let timer = null;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        renderStudyResults(input.value);
      }, 120);
    });

    input.addEventListener('focus', () => {
      if (input.value) renderStudyResults(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const hits = searchHits(input.value);
        if (!hits.length) return;
        // 跳到当前题之后的下一条命中，没有则回到第一条
        let target = hits[0];
        for (let k = 0; k < hits.length; k++) {
          if (hits[k] > S.current) { target = hits[k]; break; }
        }
        goTo(target);
        hideStudyResults();
      } else if (e.key === 'Escape') {
        input.value = '';
        hideStudyResults();
        $('#study-search-clear').classList.add('is-hidden');
      }
    });

    clear.addEventListener('click', () => {
      input.value = '';
      input.focus();
      hideStudyResults();
      clear.classList.add('is-hidden');
    });

    // 点击结果项跳转到对应题目
    $('#study-result').addEventListener('click', (e) => {
      const li = e.target.closest ? e.target.closest('.sr-item') : null;
      if (!li) return;
      goTo(Number(li.getAttribute('data-idx')));
      hideStudyResults();
    });

    // 点击搜索栏之外时收起结果列表
    document.addEventListener('click', (e) => {
      const box = $('#study-search');
      if (box && !box.contains(e.target)) hideStudyResults();
    });
  }

  function firstUngraded() {
    for (let i = 0; i < S.questions.length; i++) if (!isGraded(i)) return i;
    return -1;
  }

  function updateControls() {
    const total = S.questions.length;
    const i = S.current;
    const last = total - 1;
    const main = $('#btn-main');

    $('#btn-prev').disabled = i === 0;

    if (S.study) {
      if (!studyAnswerVisible(i)) main.textContent = '显示答案';
      else main.textContent = i < last ? '下一题' : '结束背题';
    } else if (S.mode === 'instant') {
      if (!isGraded(i)) main.textContent = '提交本题';
      else if (i < last) main.textContent = '下一题';
      else main.textContent = firstUngraded() >= 0 ? '继续未答题' : '查看成绩';
    } else {
      main.textContent = i < last ? '下一题' : '交卷并查看成绩';
    }

    const sub = $('#btn-submit-all');
    sub.textContent = S.study ? '结束背题' : S.mode === 'instant' ? '结束练习并结算' : '交卷';
    sub.disabled = total === 0;

    if (S.study) {
      // 背题模式没有作答进度，进度条改为浏览位置
      $('#progress-bar').style.width = (total ? ((i + 1) / total) * 100 : 0) + '%';
      $('#progress-text').textContent = '第 ' + (i + 1) + ' / ' + total + ' 题';
      return;
    }

    const done = S.questions.filter((q, idx) => P.isAnswered(q, S.responses[idx])).length;
    $('#progress-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
    $('#progress-text').textContent = '已答 ' + done + ' / ' + total;
  }

  function renderQuestion() {
    const q = S.questions[S.current];
    if (!q) return;

    $('#q-type').textContent = P.TYPE_LABEL[q.type];
    $('#q-index').textContent = '第 ' + (S.current + 1) + ' 题 / 共 ' + S.questions.length + ' 题';
    $('#q-score').textContent = fmtNum(q.score) + ' 分';

    const stemEl = $('#q-stem');
    if (q.type === 'blank') {
      stemEl.innerHTML = esc(q.stem).replace(/_{2,}/g, '<span class="blank-mark">____</span>');
    } else {
      stemEl.textContent = q.stem;
    }

    const body = $('#q-body');
    body.innerHTML = '';
    if (S.study) {
      // 背题模式：选择题只展示选项；填空题题干已包含空格标记，无需输入框
      if (q.type !== 'blank') body.appendChild(buildStudyOptions(q));
    } else {
      body.appendChild(q.type === 'blank' ? buildBlanks(q, S.current) : buildOptions(q, S.current));
    }

    renderAnswerPanel(S.current);
    renderFeedback(S.current);
    renderSheet();
    updateControls();
  }

  function toggleOption(q, i, key) {
    if (isGraded(i)) return;
    if (q.type === 'multiple') {
      const arr = Array.isArray(S.responses[i]) ? S.responses[i].slice() : [];
      const idx = arr.indexOf(key);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(key);
      S.responses[i] = arr;
    } else {
      S.responses[i] = key;
    }
    renderQuestion();
  }

  function goTo(i) {
    if (i < 0 || i >= S.questions.length) return;
    S.current = i;
    // 切题时让答题卡自动翻到该题所在页
    S.sheetPage = Math.floor(i / sheetPageSize());
    renderQuestion();
  }

  /* =========================================================
   * 练习：计时与提交
   * =======================================================*/

  function startTimer() {
    stopTimer();
    $('#timer').textContent = '00:00';
    S.timerId = setInterval(() => {
      $('#timer').textContent = fmtTime((Date.now() - S.startTs) / 1000);
    }, 500);
  }

  function stopTimer() {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = null; }
  }

  function submitCurrent() {
    const i = S.current;
    const q = S.questions[i];
    const resp = S.responses[i];
    const answered = P.isAnswered(q, resp);
    const correct = answered && P.gradeQuestion(q, resp);
    S.results[i] = { graded: true, correct: !!correct, score: correct ? q.score : 0 };
    renderQuestion();

    const fb = $('#feedback');
    if (!fb.classList.contains('is-hidden') && fb.scrollIntoView) {
      fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function onMain() {
    const total = S.questions.length;
    const i = S.current;
    const last = total - 1;

    if (S.study) {
      if (!studyAnswerVisible(i)) {
        S.revealed[i] = true;
        renderQuestion();
        const panel = $('#answer-panel');
        if (panel && panel.scrollIntoView) {
          panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (i < last) { goTo(i + 1); return; }
      endStudy();
      return;
    }

    if (S.mode === 'instant') {
      if (!isGraded(i)) { submitCurrent(); return; }
      if (i < last) { goTo(i + 1); return; }
      const target = firstUngraded();
      if (target >= 0) { goTo(target); return; }
      finish();
      return;
    }

    if (i < last) { goTo(i + 1); return; }
    confirmFinish();
  }

  async function confirmFinish() {
    let pending = 0;
    S.questions.forEach((q, i) => { if (!P.isAnswered(q, S.responses[i])) pending++; });
    if (pending > 0) {
      const ok = await ask({
        title: '还有 ' + pending + ' 题未作答',
        text: '未作答的题目将按错误计分，确定现在交卷吗？',
        okText: '确定交卷',
        cancelText: '继续作答'
      });
      if (!ok) return;
    }
    finish();
  }

  function finish() {
    stopTimer();
    S.elapsed = (Date.now() - S.startTs) / 1000;

    S.questions.forEach((q, i) => {
      if (isGraded(i)) return;
      const resp = S.responses[i];
      const answered = P.isAnswered(q, resp);
      const correct = answered && P.gradeQuestion(q, resp);
      S.results[i] = { graded: true, correct: !!correct, score: correct ? q.score : 0 };
    });

    renderResult();
    showView('result');
  }

  /** 结束背题：不计分、不出成绩，直接回到上传页 */
  function endStudy() {
    stopTimer();
    showView('upload');
    if (S.bank) {
      notice('本次背题结束：' + esc(S.bank.title) + '（共 ' + S.questions.length + ' 题），可随时重新开始。', 'ok');
    }
  }

  /** 练习用的题目副本：选项与答案都独立一份，便于单独打乱 */
  function cloneQuestion(q) {
    return {
      id: q.id,
      no: q.no,
      type: q.type,
      stem: q.stem,
      options: (q.options || []).map((o) => ({ key: o.key, text: o.text })),
      answers: q.type === 'blank' ? q.answers.map((alts) => alts.slice()) : q.answers.slice(),
      explanation: q.explanation,
      score: q.score,
      // 打乱前的原始顺序，仅用于解析对照，不参与判题
      originOptions: q.originOptions ? q.originOptions.map((o) => ({ key: o.key, text: o.text })) : null
    };
  }

  /**
   * 打乱单题的选项顺序，并按新顺序重新编号 A/B/C…
   * 答案字母同步映射，保证判题结果不变。判断题与填空题不动。
   * 原始顺序会留在 originOptions 里，供解析对照使用。
   */
  function shuffleQuestionOptions(q) {
    if (q.type !== 'single' && q.type !== 'multiple') return;
    if (!q.options || q.options.length < 2) return;

    if (!q.originOptions) {
      q.originOptions = q.options.map((o) => ({ key: o.key, text: o.text }));
    }

    shuffle(q.options);

    const oldToNew = {}; // 原字母 → 新字母
    q.options.forEach((opt, i) => {
      const newKey = String.fromCharCode(65 + i);
      oldToNew[opt.key] = newKey;
      opt.key = newKey;
    });
    q.answers = q.answers.map((k) => oldToNew[k] || k);
  }

  function modeSummary() {
    const tags = S.study
      ? ['背题模式', S.reveal === 'auto' ? '直接显示答案' : '点击显示答案']
      : [S.mode === 'instant' ? '每题提交后立即判题' : '全部作答后统一判题'];
    const orderLabel = { random: '完全随机', byType: '按题型随机' }[S.order];
    if (orderLabel) tags.push(orderLabel);
    if (S.shuffleOptions) tags.push('选项乱序');
    return tags.join(' · ');
  }

  /**
   * 按当前设置排列本轮题目：先深拷贝（打乱不污染原题库），
   * 再按出题顺序重排，最后按需打乱每题选项。
   */
  function arrangeQuestions(list) {
    const cloned = list.map(cloneQuestion);
    let qs;

    if (S.order === 'random') {
      qs = shuffle(cloned);
    } else if (S.order === 'byType') {
      // 题型固定顺序：单选 → 多选 → 判断 → 填空（选择题优先），同题型内随机
      const rank = { single: 0, multiple: 1, judge: 2, blank: 3 };
      const buckets = [[], [], [], []];
      cloned.forEach((q) => {
        const r = rank[q.type];
        buckets[r == null ? 3 : r].push(q);
      });
      qs = [];
      buckets.forEach((bucket) => {
        shuffle(bucket).forEach((q) => qs.push(q));
      });
    } else {
      qs = cloned;
    }

    if (S.shuffleOptions) qs.forEach(shuffleQuestionOptions);
    return qs;
  }

  /** 取回题库里的原始题目，避免在已打乱、已重编号的副本上再操作一次 */
  function sourceQuestion(q) {
    if (!S.bank || !S.bank.questions) return q;
    for (let i = 0; i < S.bank.questions.length; i++) {
      if (S.bank.questions[i].id === q.id) return S.bank.questions[i];
    }
    return q;
  }

  function startPractice(list, label) {
    if (!list || !list.length) return;

    S.questions = arrangeQuestions(list.map(sourceQuestion));

    S.responses = S.questions.map(P.makeEmptyResponse);
    S.results = S.questions.map(() => null);
    S.revealed = S.questions.map(() => false);
    S.current = 0;
    S.sheetPage = 0;
    S.filter = 'all';

    // 预生成背题搜索的匹配文本（题干+所有选项，小写），避免每次输入时反复拼接
    S.searchTexts = S.questions.map((q) => {
      const parts = [String(q.stem || '')];
      (q.options || []).forEach((o) => parts.push(String(o.text || '')));
      return parts.join('\n').toLowerCase();
    });

    // 搜索栏只在背题模式显示，每次开始练习时重置状态
    const searchBox = $('#study-search');
    searchBox.classList.toggle('is-hidden', !S.study);
    if (S.study) {
      const si = $('#study-search-input');
      si.value = '';
      hideStudyResults();
      $('#study-search-clear').classList.add('is-hidden');
    }

    $('#practice-title').textContent = label || (S.bank ? S.bank.title : '练习');
    $('#practice-meta').textContent = '共 ' + S.questions.length + ' 题';
    $('#mode-label').textContent = modeSummary();
    $('#kbd-tip').textContent = S.study
      ? '快捷键：Enter 显示答案 / 下一题 · ← → 切换题目'
      : '快捷键：A–H 选择选项 · Enter 提交 / 下一题 · ← → 切换题目';

    S.startTs = Date.now();
    startTimer();
    // 先显示练习页再渲染，答题卡才能按真实容器宽度计算每行列数
    showView('practice');
    renderQuestion();
  }

  /* =========================================================
   * 成绩统计
   * =======================================================*/

  function statusOf(i) {
    const q = S.questions[i];
    if (!P.isAnswered(q, S.responses[i])) return 'skip';
    const r = S.results[i];
    return r && r.correct ? 'correct' : 'wrong';
  }

  function reviewOptionsHTML(q, resp) {
    if (q.type === 'blank') return '';
    return (
      '<div class="review-opts' + (q.type === 'multiple' ? ' is-multi' : '') + '">' +
      q.options
        .map((o) => {
          const isAns = q.answers.indexOf(o.key) >= 0;
          const chosen = q.type === 'multiple' ? (resp || []).indexOf(o.key) >= 0 : resp === o.key;
          let cls = 'ropt';
          if (isAns) cls += ' is-correct';
          else if (chosen) cls += ' is-wrong';
          const mark = q.type === 'judge' ? (o.key === 'T' ? '√' : '×') : o.key;
          return '<div class="' + cls + '"><span class="opt-mark">' + mark + '</span><span>' + esc(o.text) + '</span></div>';
        })
        .join('') +
      '</div>'
    );
  }

  function reviewItemHTML(i) {
    const q = S.questions[i];
    const st = statusOf(i);
    const r = S.results[i] || { score: 0 };
    const given = givenText(q, S.responses[i]);

    const cls = st === 'correct' ? 'is-ok' : st === 'wrong' ? 'is-bad' : 'is-skip';
    const tag =
      st === 'correct'
        ? '<span class="tag tag-ok">正确</span>'
        : st === 'wrong'
        ? '<span class="tag tag-bad">错误</span>'
        : '<span class="tag tag-skip">未作答</span>';

    let html = '<article class="review-item ' + cls + '">';
    html +=
      '<header class="review-head">' +
      '<span class="badge">' + P.TYPE_LABEL[q.type] + '</span>' +
      '<span class="review-no">第 ' + (i + 1) + ' 题</span>' +
      tag +
      '<span class="review-score">得分 ' + fmtNum(r.score) + ' / ' + fmtNum(q.score) + '</span>' +
      '</header>';
    html += '<div class="review-stem">' + esc(q.stem) + '</div>';
    html += reviewOptionsHTML(q, S.responses[i]);
    html +=
      '<div class="review-answers">' +
      '<div><span class="k">你的答案</span><span class="v ' + (st === 'correct' ? 'ok' : st === 'skip' ? 'skip' : 'bad') + '">' +
      (given ? esc(given) : '未作答') +
      '</span></div>' +
      '<div><span class="k">正确答案</span><span class="v ok">' + esc(correctText(q, true)) + '</span></div>' +
      '</div>';
    if (q.explanation) {
      html += originOrderHTML(q);
      html += '<div class="review-exp"><span class="k">解析</span><p>' + esc(q.explanation) + '</p></div>';
    }
    html += '</article>';
    return html;
  }

  function renderReviewList() {
    const list = $('#review-list');
    const html = S.questions
      .map((q, i) => ({ i: i, st: statusOf(i) }))
      .filter((x) => S.filter === 'all' || x.st === S.filter)
      .map((x) => reviewItemHTML(x.i))
      .join('');

    list.innerHTML = html || '<p class="empty-rev">该分类下没有题目。</p>';
  }

  function renderRecordTable() {
    const head =
      '<thead><tr>' +
      '<th>题号</th><th>题型</th><th>你的答案</th><th>正确答案</th><th>结果</th><th>得分</th>' +
      '</tr></thead>';

    const rows = S.questions
      .map((q, i) => {
        const st = statusOf(i);
        const r = S.results[i] || { score: 0 };
        const given = givenText(q, S.responses[i]);
        const res =
          st === 'correct' ? '<td class="res-ok">正确</td>'
          : st === 'wrong' ? '<td class="res-bad">错误</td>'
          : '<td>未作答</td>';
        return (
          '<tr>' +
          '<td class="num">' + (i + 1) + '</td>' +
          '<td>' + P.TYPE_LABEL[q.type] + '</td>' +
          '<td>' + (given ? esc(given) : '—') + '</td>' +
          '<td>' + esc(correctText(q)) + '</td>' +
          res +
          '<td class="num">' + fmtNum(r.score) + ' / ' + fmtNum(q.score) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    $('#record-table').innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  function renderResult() {
    const total = S.questions.length;
    let totalScore = 0;
    let earned = 0;
    let correct = 0;
    let skip = 0;

    S.questions.forEach((q, i) => {
      totalScore += q.score;
      const r = S.results[i];
      if (r) earned += r.score;
      if (r && r.correct) correct++;
      if (!P.isAnswered(q, S.responses[i])) skip++;
    });

    const wrong = total - correct - skip;
    const acc = total ? Math.round((correct / total) * 1000) / 10 : 0;
    const pct = totalScore ? Math.min(1, earned / totalScore) : 0;

    $('#ring-score').textContent = fmtNum(earned);
    $('#ring-total').textContent = '/ ' + fmtNum(totalScore) + ' 分';

    const ring = $('#ring-fill');
    const C = 2 * Math.PI * 54;
    ring.style.strokeDasharray = String(C);
    ring.classList.toggle('is-low', pct < 0.6 && pct >= 0.3);
    ring.classList.toggle('is-bad', pct < 0.3);
    ring.style.strokeDashoffset = String(C);
    void ring.getBoundingClientRect();
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = String(C * (1 - pct));
    });

    $('#result-title').textContent = pct >= 0.85 ? '表现优秀' : pct >= 0.6 ? '练习完成' : '继续加油';
    $('#result-sub').textContent =
      '共 ' + total + ' 题，满分 ' + fmtNum(totalScore) + ' 分，答对 ' + correct + ' 题。' +
      (wrong + skip > 0 ? '建议重点复习错题与未作答题目。' : '全部答对，非常棒！');

    $('#rs-acc').textContent = acc + '%';
    $('#rs-count').textContent = correct + ' / ' + wrong + ' / ' + skip;
    $('#rs-time').textContent = fmtTime(S.elapsed);

    $('#tab-all').textContent = String(total);
    $('#tab-wrong').textContent = String(wrong);
    $('#tab-unanswered').textContent = String(skip);
    $('#tab-correct').textContent = String(correct);

    $('#btn-retry-wrong').disabled = wrong + skip === 0;

    S.filter = 'all';
    $$('#result-tabs .tab').forEach((t) => t.classList.toggle('is-active', t.getAttribute('data-filter') === 'all'));

    renderRecordTable();
    renderReviewList();
  }

  /* =========================================================
   * 事件绑定
   * =======================================================*/

  function bindUpload() {
    const dz = $('#dropzone');
    const input = $('#file-input');

    dz.addEventListener('click', (e) => {
      if (e.target === input) return; // input.click() 冒泡回来时不再触发，避免递归
      input.click();
    });
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });

    input.addEventListener('change', () => {
      if (input.files && input.files[0]) loadFile(input.files[0]);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); })
    );
    dz.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) loadFile(files[0]);
    });

    // 防止把文件拖到页面其它位置时浏览器直接打开文件
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    $('#btn-load-sample').addEventListener('click', loadSample);

    $('#btn-dl-guide').addEventListener('click', () => {
      const src = document.getElementById('guide-source');
      if (!src) return;
      const text = src.textContent.replace(/^\s*\n/, '').replace(/\s+$/, '\n');
      download('题库生成说明.md', text, 'text/markdown');
    });

    // 练习模式：普通练习 / 背题模式。背题模式下判题设置不适用，改用答案显示方式
    const fieldGrade = $('#field-grade');
    const fieldReveal = $('#field-reveal');
    const btnStart = $('#btn-start');

    const syncStudyUI = () => {
      fieldGrade.classList.toggle('is-hidden', S.study);
      fieldReveal.classList.toggle('is-hidden', !S.study);
      btnStart.textContent = S.study ? '开始背题' : '开始练习';
    };

    $$('input[name="study-mode"]').forEach((el) =>
      el.addEventListener('change', () => {
        if (!el.checked) return;
        S.study = el.value === 'study';
        syncStudyUI();
      })
    );

    $$('input[name="reveal"]').forEach((el) =>
      el.addEventListener('change', () => { if (el.checked) S.reveal = el.value; })
    );

    $$('input[name="mode"]').forEach((el) =>
      el.addEventListener('change', () => { if (el.checked) S.mode = el.value; })
    );

    // 选项乱序是独立开关，与出题顺序互不影响
    const switchEl = $('#btn-shuffle-options');
    const switchDesc = $('#switch-desc');
    const syncSwitch = () => {
      switchEl.classList.toggle('is-on', S.shuffleOptions);
      switchEl.setAttribute('aria-checked', S.shuffleOptions ? 'true' : 'false');
      if (switchDesc) {
        switchDesc.textContent = S.shuffleOptions
          ? '解析字母按原顺序，判题后附对照'
          : '单选、多选的选项重排并重新编号';
        switchDesc.classList.toggle('is-warn', S.shuffleOptions);
      }
    };

    $$('input[name="order"]').forEach((el) =>
      el.addEventListener('change', () => { if (el.checked) S.order = el.value; })
    );

    switchEl.addEventListener('click', async () => {
      if (!S.shuffleOptions) {
        const ok = await ask({
          title: '开启选项乱序？',
          text:
            '每道题的选项会重新排列并重新编号 A/B/C/D。\n' +
            '如果解析里用字母指代选项（例如「故选 C」），重编号后字母含义会与原题不同。\n' +
            '判题后的解析区会附上「原顺序」对照，请以对照为准。',
          okText: '开启',
          cancelText: '取消'
        });
        if (!ok) return;
      }
      S.shuffleOptions = !S.shuffleOptions;
      syncSwitch();
    });

    $('#btn-start').addEventListener('click', () => {
      if (!S.bank || !S.bank.questions.length) return;
      const checkedStudy = $('input[name="study-mode"]:checked');
      const checkedReveal = $('input[name="reveal"]:checked');
      const checkedMode = $('input[name="mode"]:checked');
      const checkedOrder = $('input[name="order"]:checked');
      S.study = checkedStudy ? checkedStudy.value === 'study' : false;
      S.reveal = checkedReveal ? checkedReveal.value : 'auto';
      S.mode = checkedMode ? checkedMode.value : 'instant';
      S.order = checkedOrder ? checkedOrder.value : 'seq';
      startPractice(S.bank.questions, S.bank.title);
    });

    syncSwitch();
    syncStudyUI();
  }

  /** 退出练习：有进度时先确认，避免误触丢失作答 */
  async function leavePractice() {
    const ok = await ask({
      title: S.study ? '退出背题？' : '退出本次练习？',
      text: S.study
        ? '当前浏览进度将丢失，重新开始会从第一题看起。'
        : '当前作答进度将丢失，已作答的题目不会保留。',
      okText: S.study ? '退出背题' : '退出练习',
      cancelText: S.study ? '继续看题' : '继续作答',
      danger: true
    });
    if (!ok) return;
    stopTimer();
    showView('upload');
  }

  function bindPractice() {
    $('#btn-prev').addEventListener('click', () => goTo(S.current - 1));
    $('#btn-main').addEventListener('click', onMain);
    $('#sheet-prev').addEventListener('click', () => turnSheetPage(-1));
    $('#sheet-next').addEventListener('click', () => turnSheetPage(1));
    $('#btn-submit-all').addEventListener('click', () => {
      if (S.study) { endStudy(); return; }
      confirmFinish();
    });
    $('#btn-quit').addEventListener('click', leavePractice);

    // 答题卡宽度变化会改变每行列数：重新分页，并让当前题保持可见
    let lastSheetWidth = 0;
    const syncSheetLayout = () => {
      if (!S.questions.length || $('#view-practice').classList.contains('is-hidden')) return;
      const width = $('#sheet-grid').clientWidth;
      if (!width || width === lastSheetWidth) return;
      lastSheetWidth = width;
      S.sheetPage = Math.floor(S.current / sheetPageSize());
      renderSheet();
    };
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(syncSheetLayout).observe($('#sheet-grid'));
    } else {
      window.addEventListener('resize', syncSheetLayout);
    }
  }

  /** 顶栏品牌区：点击回到上传页 */
  function bindHeader() {
    $('#brand-home').addEventListener('click', () => {
      if (modalResolve || onlineOpen) return; // 面板打开时不响应
      if (!$('#view-practice').classList.contains('is-hidden')) {
        leavePractice();
        return;
      }
      if (!$('#view-result').classList.contains('is-hidden')) {
        showView('upload');
        return;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // 标签上的 data-filter 用「未作答」，而 statusOf() 内部记为 skip，这里统一映射
  const FILTER_ALIAS = { unanswered: 'skip' };

  function bindResult() {
    $('#result-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest ? e.target.closest('.tab') : null;
      if (!tab) return;
      const raw = tab.getAttribute('data-filter');
      S.filter = FILTER_ALIAS[raw] || raw;
      $$('#result-tabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      renderReviewList();
    });

    $('#btn-retry-wrong').addEventListener('click', () => {
      const list = S.questions.filter((q, i) => statusOf(i) !== 'correct');
      if (!list.length) return;
      startPractice(list, '错题重做');
    });

    $('#btn-restart').addEventListener('click', () => {
      startPractice(S.questions, S.bank ? S.bank.title : '练习');
    });

    $('#btn-newbank').addEventListener('click', () => {
      showView('upload');
      if (S.bank) {
        notice('当前题库：' + esc(S.bank.title) + '（共 ' + S.bank.questions.length + ' 题），可直接重新开始或上传新题库。', 'ok');
      }
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (modalResolve || onlineOpen) return; // 弹窗打开时，快捷键不生效
      if ($('#view-practice').classList.contains('is-hidden')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const q = S.questions[S.current];
      if (!q) return;

      if (e.key === 'Enter') {
        if (tag === 'button') return; // 避免与按钮默认回车行为重复触发
        e.preventDefault();
        onMain();
        return;
      }

      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(S.current - 1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(S.current + 1); return; }

      if (!S.study && /^[a-hA-H]$/.test(e.key) && !isGraded(S.current)) {
        const k = e.key.toUpperCase();
        if (q.type === 'single' || q.type === 'multiple') {
          if (q.options.some((o) => o.key === k)) {
            e.preventDefault();
            toggleOption(q, S.current, k);
          }
        }
      }
    });
  }

  /* =========================================================
   * 启动
   * =======================================================*/

  function init() {
    if (!P) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">题库解析模块加载失败，请确认 js/parser.js 存在。</p>';
      return;
    }
    bindUpload();
    bindPractice();
    bindStudySearch();
    bindResult();
    bindModal();
    bindOnline();
    bindHeader();
    bindKeyboard();
    showView('upload');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
