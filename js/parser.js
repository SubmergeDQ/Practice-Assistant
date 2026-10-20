/*!
 * parser.js —— 题库解析 + 判题逻辑
 * 支持 JSON / TXT 两种题库格式，覆盖单选、多选、判断、填空四种题型。
 * 该模块不依赖 DOM，可直接在 Node 中单元测试。
 */
(function (root) {
  'use strict';

  const TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题', blank: '填空题' };
  const DEFAULT_SCORE = 5;

  /* =========================================================
   * 一、通用小工具
   * =======================================================*/

  function pick(obj, keys) {
    if (!obj) return undefined;
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  function brief(str, n) {
    const s = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
    const max = n || 24;
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  /** 把各种写法的题型名统一成 single / multiple / judge / blank */
  function normType(raw) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    if (/多选|多项|不定项|multiple|multi|checkbox/.test(s)) return 'multiple';
    if (/判断|judge|truefalse|bool|^tf$/.test(s)) return 'judge';
    if (/填空|blank|fill|completion/.test(s)) return 'blank';
    if (/单选|单项|single|radio/.test(s)) return 'single';
    return null;
  }

  /** 从各种答案写法里抽取选项字母，返回按字母排序的数组 */
  function lettersFrom(raw) {
    const out = [];
    const push = (ch) => {
      if (!ch) return;
      const u = String(ch).toUpperCase();
      if (/^[A-H]$/.test(u) && out.indexOf(u) < 0) out.push(u);
    };
    const eat = (value) => {
      const t = String(value == null ? '' : value).trim();
      if (!t) return;
      // "ABD" / "abd"
      if (/^[A-Ha-h]{2,}$/.test(t)) { t.split('').forEach(push); return; }
      // "A" / "A、B、D" / "A,B" / "A B"
      if (/^[A-Ha-h](?:\s*[、,，;；\/|\s]\s*[A-Ha-h])*\s*$/.test(t)) {
        t.replace(/[^A-Ha-h]/g, '').split('').forEach(push);
        return;
      }
      // "B. 选项内容" / "(C) 选项内容"
      const m = t.match(/^[（(]?\s*([A-Ha-h])\s*[）)]?\s*[.．、:：,，)）]/);
      if (m) push(m[1]);
    };
    if (Array.isArray(raw)) raw.forEach(eat);
    else if (raw !== undefined && raw !== null) eat(raw);
    return out.sort();
  }

  /** 判断题答案统一为 'T' / 'F'，无法识别返回 null */
  function judgeFlag(raw) {
    if (typeof raw === 'boolean') return raw ? 'T' : 'F';
    if (Array.isArray(raw)) raw = raw[0];
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim().toLowerCase().replace(/[\s。．.、]/g, '');
    if (!s) return null;
    const T = ['t', 'true', 'y', 'yes', '1', 'a', '对', '正确', '是', '真', '√', '✓', 'v'];
    const F = ['f', 'false', 'n', 'no', '0', 'b', '错', '错误', '否', '假', '×', '✗', 'x'];
    if (T.indexOf(s) >= 0) return 'T';
    if (F.indexOf(s) >= 0) return 'F';
    if (/不正确|不对|错误|错|否/.test(s)) return 'F';
    if (/正确|对|是/.test(s)) return 'T';
    return null;
  }

  /** 填空题答案 → 每个空的可接受答案数组。多空用 || 分隔，同空多解用 | 分隔 */
  function blanksFrom(raw) {
    const splitAlts = (s) => String(s == null ? '' : s).split('|').map((x) => x.trim()).filter(Boolean);
    if (Array.isArray(raw)) {
      return raw
        .map((v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : splitAlts(v)))
        .filter((a) => a.length);
    }
    if (raw === undefined || raw === null) return [];
    return String(raw)
      .split(/\|\||;{2}|；；/)
      .map((part) => splitAlts(part.trim()))
      .filter((a) => a.length);
  }

  /** 选项标准化为 [{ key: 'A', text: '...' }] */
  function normalizeOptions(raw) {
    const list = [];
    if (!raw) return list;

    if (Array.isArray(raw)) {
      raw.forEach((item, i) => {
        const defKey = String.fromCharCode(65 + i);
        if (item && typeof item === 'object') {
          const rawKey = pick(item, ['key', 'label', 'letter', 'id', 'option']);
          const rawText = pick(item, ['text', 'content', 'value', 'title', 'name', 'desc']);
          const key = rawKey ? String(rawKey).toUpperCase().replace(/[^A-H]/g, '') : '';
          list.push({ key: key || defKey, text: rawText === undefined ? '' : String(rawText).trim() });
          return;
        }
        const s = String(item == null ? '' : item).trim();
        const m = s.match(/^[（(]?\s*([A-Ha-h])\s*[）)]?\s*[.．、:：,，)）]\s*([\s\S]*)$/);
        if (m) list.push({ key: m[1].toUpperCase(), text: m[2].trim() });
        else list.push({ key: defKey, text: s });
      });
      return list;
    }

    if (typeof raw === 'object') {
      Object.keys(raw).forEach((k) => {
        const key = String(k).toUpperCase().replace(/[^A-H]/g, '') || String(k);
        list.push({ key: key, text: String(raw[k]).trim() });
      });
    }
    return list;
  }

  /* =========================================================
   * 二、题目构造与校验
   * =======================================================*/

  /**
   * 把「中间态」转换为标准题目对象
   * src: { id, stem, options, answerRaw, explanation, score, typeHint, sectionType }
   */
  function makeQuestion(src, warnings, ordinal) {
    const stem = String(src.stem == null ? '' : src.stem).trim();
    if (!stem) {
      warnings.push('第 ' + ordinal + ' 题缺少题干，已跳过');
      return null;
    }

    const options = src.options || [];
    const rawAns = src.answerRaw;
    const rawStr = Array.isArray(rawAns) ? rawAns.map(String).join(',') : rawAns == null ? '' : String(rawAns);

    if (rawStr.trim() === '') {
      warnings.push('第 ' + ordinal + ' 题缺少「答案」，已跳过');
      return null;
    }

    // 推断题型
    let type = src.typeHint || src.sectionType || null;
    if (!type) {
      if (options.length) {
        type = lettersFrom(rawAns).length > 1 ? 'multiple' : 'single';
      } else {
        const compact = rawStr.trim().replace(/[\s。．.]/g, '');
        const strictJudge = /^(对|错|正确|错误|√|×|t|f|true|false)$/i.test(compact);
        type = strictJudge && judgeFlag(rawAns) ? 'judge' : 'blank';
      }
    }

    // 按题型归一化答案
    let answers;
    if (type === 'single' || type === 'multiple') {
      if (!options.length) {
        warnings.push('第 ' + ordinal + ' 题声明为选择题，但缺少选项，已跳过');
        return null;
      }
      answers = lettersFrom(rawAns);
      if (!answers.length) {
        warnings.push('第 ' + ordinal + ' 题的答案无法识别（' + brief(rawStr, 18) + '），已跳过');
        return null;
      }
      if (answers.length > 1) type = 'multiple';
      const keys = options.map((o) => o.key);
      const bad = answers.filter((a) => keys.indexOf(a) < 0);
      if (bad.length) {
        warnings.push('第 ' + ordinal + ' 题的答案 ' + bad.join('、') + ' 不在选项 ' + keys.join('') + ' 范围内');
      }
    } else if (type === 'judge') {
      const flag = judgeFlag(rawAns);
      if (!flag) {
        warnings.push('第 ' + ordinal + ' 题判断题答案无法识别（' + brief(rawStr, 18) + '），已跳过');
        return null;
      }
      answers = [flag];
    } else {
      answers = blanksFrom(rawAns);
      if (!answers.length) {
        warnings.push('第 ' + ordinal + ' 题填空题答案为空，已跳过');
        return null;
      }
    }

    const score = Number(src.score);
    return {
      id: src.id != null && src.id !== '' ? String(src.id) : 'q' + ordinal,
      no: ordinal,
      type: type,
      stem: stem,
      options: type === 'judge'
        ? [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }]
        : options,
      answers: answers,
      explanation: String(src.explanation == null ? '' : src.explanation).trim(),
      score: isFinite(score) && score > 0 ? score : DEFAULT_SCORE
    };
  }

  /* =========================================================
   * 三、JSON 题库解析
   * =======================================================*/

  function parseJSON(text) {
    const warnings = [];
    let data;
    try {
      data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    } catch (e) {
      throw new Error('JSON 格式错误：' + e.message);
    }

    const root_ = Array.isArray(data) ? { questions: data } : data || {};
    const list = pick(root_, ['questions', '题目', 'list', 'items', 'data']);
    if (!Array.isArray(list)) {
      throw new Error('JSON 中未找到题目数组，请把题目放在 questions 字段里');
    }

    const questions = [];
    list.forEach((item, i) => {
      if (!item || typeof item !== 'object') {
        warnings.push('第 ' + (i + 1) + ' 条记录不是有效的题目对象，已跳过');
        return;
      }
      const src = {
        id: pick(item, ['id', 'no', '编号']),
        stem: pick(item, ['stem', 'question', 'title', 'content', '题干', '题目']),
        options: normalizeOptions(pick(item, ['options', 'choices', '选项'])),
        answerRaw: pick(item, ['answer', 'answers', 'correct', 'key', '答案']),
        explanation: pick(item, ['explanation', 'analysis', 'explain', '解析', '答案解析']),
        typeHint: normType(pick(item, ['type', '题型', 'category'])),
        score: pick(item, ['score', 'points', '分值', '分数'])
      };
      const q = makeQuestion(src, warnings, i + 1);
      if (q) questions.push(q);
    });

    return {
      title: String(pick(root_, ['title', 'name', '标题', '题库名称']) || '未命名题库').trim(),
      description: String(pick(root_, ['description', 'desc', '描述', '说明']) || '').trim(),
      questions: questions,
      warnings: warnings,
      format: 'json'
    };
  }

  /* =========================================================
   * 四、TXT 题库解析
   * =======================================================*/

  const RE_SECTION = /^[\[【(（]?\s*(单选题?|多选题?|不定项选择题?|判断题?|填空题?)\s*[\]】)）]?$/;
  const RE_STEM = /^(?:题干|题目|问题|试题)\s*[:：]\s*([\s\S]*)$/;
  const RE_ANSWER = /^(?:参考答案|正确答案|标准答案|答案)\s*[:：]\s*([\s\S]*)$/;
  const RE_EXP = /^(?:答案解析|试题解析|解析|说明|分析)\s*[:：]\s*([\s\S]*)$/;
  const RE_SCORE = /^(?:分值|分数|得分)\s*[:：]\s*([\s\S]*)$/;
  const RE_TYPE = /^(?:题型|类型)\s*[:：]\s*([\s\S]*)$/;
  const RE_OPTION = /^[（(]?\s*([A-Ha-h])\s*(?:[.．、:：,，]|[）)])\s*([\s\S]*)$/;
  const RE_NUMBER = /^(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.．、)）:：]\s*([\s\S]*)$/;

  function matchSection(line) {
    const t = line
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/[（(][^）)]*[）)]\s*$/, '')
      .trim();
    if (!t || t.length > 8) return null;
    const m = t.match(RE_SECTION);
    return m ? normType(m[1]) : null;
  }

  /** 向前探测：接下来的这一段里是否出现选项行或答案行（用于判断是否为新题） */
  function lookaheadIsQuestion(lines, start) {
    for (let j = start; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) return false;
      if (RE_ANSWER.test(t)) return true;
      if (RE_OPTION.test(t)) return true;
      if (matchSection(t)) return true;
    }
    return false;
  }

  function parseText(text) {
    const warnings = [];
    const src0 = String(text == null ? '' : text);
    const lines = src0.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

    let title = '';
    let titleLocked = false;
    let sectionType = null;
    let cur = null;
    let lastField = null;
    let blankBefore = false;
    let seq = 0;
    const items = [];

    const startQ = () => {
      cur = {
        id: null,
        typeHint: null,
        sectionType: sectionType,
        stem: '',
        options: [],
        answerRaw: null,
        explanation: '',
        score: null
      };
      lastField = null;
    };

    const appendTo = (field, extra) => {
      if (!cur || !extra) return;
      if (field === 'stem') cur.stem = cur.stem ? cur.stem + '\n' + extra : extra;
      else if (field === 'explanation') cur.explanation = cur.explanation ? cur.explanation + '\n' + extra : extra;
      else if (field === 'answer') cur.answerRaw = String(cur.answerRaw || '') + ' ' + extra;
      else if (field === 'option') {
        const last = cur.options[cur.options.length - 1];
        if (last) last.text = last.text ? last.text + ' ' + extra : extra;
      }
    };

    const flush = () => {
      if (!cur) return;
      if (!cur.stem.trim() && !cur.options.length) { cur = null; lastField = null; return; }
      seq++;
      if (cur.answerRaw === null || String(cur.answerRaw).trim() === '') {
        warnings.push('第 ' + seq + ' 题未找到「答案」，已跳过：' + brief(cur.stem));
      } else {
        const q = makeQuestion(cur, warnings, seq);
        if (q) items.push(q);
      }
      cur = null;
      lastField = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();

      if (!t) { blankBefore = true; continue; }
      const wasBlank = blankBefore;
      blankBefore = false;

      // 1) 题型分区
      const sec = matchSection(t);
      if (sec) { flush(); sectionType = sec; continue; }

      // 2) 标题 / 注释（以 # 开头）
      if (t.charAt(0) === '#') {
        if (!titleLocked && !items.length && !cur) {
          title = t.replace(/^#+\s*/, '').replace(/^(?:题库)?(?:标题|名称)\s*[:：]\s*/, '').trim();
          titleLocked = true;
        }
        continue;
      }

      let m;

      // 3) 单题声明题型
      if ((m = t.match(RE_TYPE))) {
        const ty = normType(m[1]);
        if (ty) {
          if (!cur) startQ();
          cur.typeHint = ty;
        }
        continue;
      }

      // 4) 题干
      if ((m = t.match(RE_STEM))) {
        flush();
        startQ();
        cur.stem = m[1].trim();
        lastField = 'stem';
        continue;
      }

      // 5) 答案
      if ((m = t.match(RE_ANSWER))) {
        if (!cur) startQ();
        cur.answerRaw = m[1].trim();
        lastField = 'answer';
        continue;
      }

      // 6) 解析
      if ((m = t.match(RE_EXP))) {
        if (!cur) startQ();
        cur.explanation = m[1].trim();
        lastField = 'explanation';
        continue;
      }

      // 7) 分值
      if ((m = t.match(RE_SCORE))) {
        if (!cur) startQ();
        const n = parseFloat(m[1]);
        cur.score = isFinite(n) ? n : null;
        continue;
      }

      // 8) 选项
      if ((m = t.match(RE_OPTION))) {
        const key = m[1].toUpperCase();
        if (cur && cur.options.some((o) => o.key === key)) {
          // 又出现 A，说明是新的一题
          flush();
          startQ();
        }
        if (!cur) startQ();
        cur.options.push({ key: key, text: m[2].trim() });
        lastField = 'option';
        continue;
      }

      // 9) 编号行：1. / 1、 / 第1题
      if ((m = t.match(RE_NUMBER))) {
        if (cur && cur.answerRaw !== null) { flush(); startQ(); }
        if (!cur) startQ();
        if (!cur.stem.trim()) {
          cur.stem = m[2].trim();
          lastField = 'stem';
        } else if (lastField === 'option') {
          cur.options[cur.options.length - 1].text += ' ' + t;
        } else {
          appendTo(lastField || 'stem', t);
        }
        continue;
      }

      // 10) 普通文本
      if (!cur) {
        startQ();
        cur.stem = t;
        lastField = 'stem';
        continue;
      }
      if (wasBlank && cur.answerRaw !== null && lookaheadIsQuestion(lines, i)) {
        // 空行之后出现「能被判定为题目」的内容 → 视为新题
        flush();
        startQ();
        cur.stem = t;
        lastField = 'stem';
        continue;
      }
      appendTo(lastField || 'stem', t);
    }

    flush();

    if (!items.length) {
      throw new Error('没有解析到任何题目。请检查文件是否使用「答案：」标注答案，或改用 JSON 格式');
    }

    return {
      title: (title || '未命名题库').trim(),
      description: '',
      questions: items,
      warnings: warnings,
      format: 'text'
    };
  }

  /* =========================================================
   * 五、文件读取
   * =======================================================*/

  function decodeBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder('gbk').decode(bytes);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }

  function parseFile(file) {
    return file.arrayBuffer().then((buf) => {
      const text = decodeBuffer(buf);
      const isJson = /\.json$/i.test(file.name || '') || /^[\s\uFEFF]*[\[{]/.test(text.slice(0, 200));
      const bank = isJson ? parseJSON(text) : parseText(text);
      bank.fileName = file.name || '';
      return bank;
    });
  }

  /* =========================================================
   * 六、判题
   * =======================================================*/

  function normalizeBlank(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, '')
      .replace(/[。．.，,；;：:！!？?、"'“”‘’()（）]/g, '')
      .toLowerCase();
  }

  function makeEmptyResponse(q) {
    if (q.type === 'blank') return new Array(q.answers.length).fill('');
    if (q.type === 'multiple') return [];
    return null;
  }

  function isAnswered(q, resp) {
    if (q.type === 'blank') {
      return Array.isArray(resp) && resp.some((v) => String(v == null ? '' : v).trim() !== '');
    }
    if (q.type === 'multiple') return Array.isArray(resp) && resp.length > 0;
    return resp !== null && resp !== undefined && resp !== '';
  }

  /** 返回 true / false */
  function gradeQuestion(q, resp) {
    if (!isAnswered(q, resp)) return false;

    if (q.type === 'single' || q.type === 'judge') {
      return String(resp) === String(q.answers[0]);
    }

    if (q.type === 'multiple') {
      const given = resp.slice().sort().join('');
      const right = q.answers.slice().sort().join('');
      return given === right;
    }

    if (q.type === 'blank') {
      return q.answers.every((alts, i) => {
        const given = normalizeBlank(Array.isArray(resp) ? resp[i] : '');
        if (!given) return false;
        return alts.some((a) => normalizeBlank(a) === given);
      });
    }

    return false;
  }

  /* =========================================================
   * 导出
   * =======================================================*/

  const api = {
    TYPE_LABEL: TYPE_LABEL,
    DEFAULT_SCORE: DEFAULT_SCORE,
    normType: normType,
    normalizeOptions: normalizeOptions,
    parseText: parseText,
    parseJSON: parseJSON,
    parseFile: parseFile,
    decodeBuffer: decodeBuffer,
    makeEmptyResponse: makeEmptyResponse,
    isAnswered: isAnswered,
    gradeQuestion: gradeQuestion,
    normalizeBlank: normalizeBlank
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QBParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
