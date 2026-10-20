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

  /* =========================================================
   * 状态
   * =======================================================*/

  const S = {
    bank: null,          // { title, questions:[], warnings:[] }
    questions: [],       // 本轮实际练习的题目
    responses: [],       // 每题作答内容
    results: [],         // { graded, correct, score }
    current: 0,
    mode: 'instant',     // instant | defer
    order: 'seq',
    shuffleOptions: false, // 随机打乱题目的同时，是否也打乱每题选项顺序
    startTs: 0,
    elapsed: 0,
    timerId: null,
    filter: 'all'
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

  function optTextOf(q, key) {
    if (q.type === 'judge') return key === 'T' ? '正确' : '错误';
    const o = q.options.filter((x) => x.key === key)[0];
    return o ? key + '. ' + o.text : key;
  }

  function keysText(q, keys) {
    if (!keys || !keys.length) return '';
    return keys.slice().sort().map((k) => optTextOf(q, k)).join('；');
  }

  function correctText(q) {
    if (q.type === 'blank') {
      return q.answers
        .map((alts, i) => (q.answers.length > 1 ? '第' + (i + 1) + '空 ' : '') + alts.join(' / '))
        .join('；');
    }
    return keysText(q, q.answers);
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

  function renderFeedback(i) {
    const el = $('#feedback');
    if (!isGraded(i) || S.mode !== 'instant') {
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

    html += '<div class="fb-line"><span class="k">正确答案</span><b>' + esc(correctText(q)) + '</b></div>';
    const given = givenText(q, S.responses[i]);
    if (given) html += '<div class="fb-line"><span class="k">你的答案</span><b>' + esc(given) + '</b></div>';
    if (q.explanation) {
      html += '<div class="fb-exp"><span class="k">解析</span><p>' + esc(q.explanation) + '</p></div>';
    }

    el.className = 'feedback ' + (r.correct ? 'is-ok' : 'is-bad');
    el.innerHTML = html;
  }

  function renderSheet() {
    const grid = $('#sheet-grid');
    grid.innerHTML = '';

    S.questions.forEach((q, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheet-cell';
      b.textContent = i + 1;
      if (P.isAnswered(q, S.responses[i])) b.classList.add('is-done');
      if (isGraded(i)) b.classList.add(S.results[i].correct ? 'is-ok' : 'is-bad');
      if (i === S.current) b.classList.add('is-current');
      b.addEventListener('click', () => goTo(i));
      grid.appendChild(b);
    });

    const done = S.questions.filter((q, i) => P.isAnswered(q, S.responses[i])).length;
    $('#sheet-stat').textContent = '已答 ' + done + ' / ' + S.questions.length;
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

    if (S.mode === 'instant') {
      if (!isGraded(i)) main.textContent = '提交本题';
      else if (i < last) main.textContent = '下一题';
      else main.textContent = firstUngraded() >= 0 ? '继续未答题' : '查看成绩';
    } else {
      main.textContent = i < last ? '下一题' : '交卷并查看成绩';
    }

    const sub = $('#btn-submit-all');
    sub.textContent = S.mode === 'instant' ? '结束练习并结算' : '交卷';
    sub.disabled = total === 0;

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
    body.appendChild(q.type === 'blank' ? buildBlanks(q, S.current) : buildOptions(q, S.current));

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

  function confirmFinish() {
    let pending = 0;
    S.questions.forEach((q, i) => { if (!P.isAnswered(q, S.responses[i])) pending++; });
    if (pending > 0 && !window.confirm('还有 ' + pending + ' 题未作答，未作答的题目将按错误计分。确定提交吗？')) return;
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
      score: q.score
    };
  }

  /**
   * 打乱单题的选项顺序，并按新顺序重新编号 A/B/C…
   * 答案字母同步映射，保证判题结果不变。判断题与填空题不动。
   */
  function shuffleQuestionOptions(q) {
    if (q.type !== 'single' && q.type !== 'multiple') return;
    if (!q.options || q.options.length < 2) return;

    shuffle(q.options);

    const oldToNew = {}; // 原字母 → 新字母
    q.options.forEach((opt, i) => {
      const newKey = String.fromCharCode(65 + i);
      oldToNew[opt.key] = newKey;
      opt.key = newKey;
    });
    q.answers = q.answers.map((k) => oldToNew[k] || k);
  }

  function modeSummary(shuffleOpt) {
    const tags = [S.mode === 'instant' ? '每题提交后立即判题' : '全部作答后统一判题'];
    if (S.order === 'random') tags.push(shuffleOpt ? '题目随机 · 选项乱序' : '题目随机');
    return tags.join(' · ');
  }

  function startPractice(list, label) {
    if (!list || !list.length) return;

    // 深拷贝一份，避免打乱选项时污染原始题库（「重新练习」还要用）
    const shuffleOpt = S.order === 'random' && S.shuffleOptions;
    S.questions = list.map(cloneQuestion);
    if (S.order === 'random') shuffle(S.questions);
    if (shuffleOpt) S.questions.forEach(shuffleQuestionOptions);

    S.responses = S.questions.map(P.makeEmptyResponse);
    S.results = S.questions.map(() => null);
    S.current = 0;
    S.filter = 'all';

    $('#practice-title').textContent = label || (S.bank ? S.bank.title : '练习');
    $('#practice-meta').textContent = '共 ' + S.questions.length + ' 题';
    $('#mode-label').textContent = modeSummary(shuffleOpt);

    S.startTs = Date.now();
    startTimer();
    renderQuestion();
    showView('practice');
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
      '<div class="review-opts">' +
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
      '<div><span class="k">正确答案</span><span class="v ok">' + esc(correctText(q)) + '</span></div>' +
      '</div>';
    if (q.explanation) {
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

    $$('input[name="mode"]').forEach((el) =>
      el.addEventListener('change', () => { if (el.checked) S.mode = el.value; })
    );

    // 选项乱序是「随机打乱」的附属项，只在随机出题时可用
    const chkShuffleOpts = $('#chk-shuffle-options');
    const choiceShuffleOpts = $('#choice-shuffle-options');
    const syncSubOption = () => {
      const on = S.order === 'random';
      chkShuffleOpts.disabled = !on;
      choiceShuffleOpts.classList.toggle('is-off', !on);
    };

    $$('input[name="order"]').forEach((el) =>
      el.addEventListener('change', () => {
        if (!el.checked) return;
        S.order = el.value;
        syncSubOption();
      })
    );

    chkShuffleOpts.addEventListener('change', () => { S.shuffleOptions = chkShuffleOpts.checked; });

    $('#btn-start').addEventListener('click', () => {
      if (!S.bank || !S.bank.questions.length) return;
      const checkedMode = $('input[name="mode"]:checked');
      const checkedOrder = $('input[name="order"]:checked');
      S.mode = checkedMode ? checkedMode.value : 'instant';
      S.order = checkedOrder ? checkedOrder.value : 'seq';
      S.shuffleOptions = chkShuffleOpts.checked;
      startPractice(S.bank.questions, S.bank.title);
    });

    syncSubOption();
  }

  function bindPractice() {
    $('#btn-prev').addEventListener('click', () => goTo(S.current - 1));
    $('#btn-main').addEventListener('click', onMain);
    $('#btn-submit-all').addEventListener('click', confirmFinish);

    $('#btn-quit').addEventListener('click', () => {
      if (!window.confirm('确定退出本次练习？当前作答进度将丢失。')) return;
      stopTimer();
      showView('upload');
    });
  }

  function bindResult() {
    $('#result-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest ? e.target.closest('.tab') : null;
      if (!tab) return;
      S.filter = tab.getAttribute('data-filter');
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

      if (/^[a-hA-H]$/.test(e.key) && !isGraded(S.current)) {
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
    bindResult();
    bindKeyboard();
    showView('upload');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
