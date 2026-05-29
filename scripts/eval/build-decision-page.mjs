#!/usr/bin/env node
// Build a self-contained HTML decision interface in the voice of 鸭总
// (Chinese cute CEO duck). UI labels + reason translations are
// duck-flavored; contract YAML and verdict semantics stay literal.
// localStorage-backed, keyboard-driven, no server, no deps.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const DEC_FILE = 'qa/eval/poker/run-log/intent-judge-decisions.txt';
const OUT = 'qa/eval/poker/run-log/decision-page.html';

function findContract(id) {
  for (const sub of ['agents', 'api', 'auth', 'core', '_smoke', 'dashboard', 'issues', 'simulate', 'tables']) {
    const p = join(FIXTURE, sub, `${id}.yml`);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

// Build a per-contract "what is this trying to test" description from
// title + actions. Used inside duckifyReason so the explanation is
// specific to THIS contract, not boilerplate.
function intentSummary(doc) {
  const title = doc?.title ?? '';
  const actions = doc?.actions ?? [];
  const http = actions.find((a) => a.type === 'http');
  if (http) {
    return `**${http.method} ${http.path}** — ${title}`;
  }
  const goto = actions.find((a) => a.type === 'goto');
  if (goto) {
    const interact = actions.filter((a) => a.type === 'click' || a.type === 'fill');
    const interactSummary = interact.length > 0
      ? `，然后${interact.map((a) => a.type === 'click' ? `点 ${a.target?.role || ''}${a.target?.name_regex ? `"${a.target.name_regex}"` : ''}` : `往 ${a.target?.role || ''}${a.target?.name_regex ? `"${a.target.name_regex}"` : ''}里填值`).join('，')}`
      : '';
    return `**打开 ${goto.path}**${interactSummary} — ${title}`;
  }
  const click = actions.find((a) => a.type === 'click');
  if (click) {
    return `**点击 ${click.target?.role || '元素'}${click.target?.name_regex ? `"${click.target.name_regex}"` : ''}** — ${title}`;
  }
  return title;
}

// Translate the contract title + body into a plain-Chinese restatement of
// what product behavior is being asserted. This is the PRIMARY thing the
// human reviewer needs to read to judge "is this a real product rule?".
//
// Heuristic title parsing — covers common Phase B patterns; falls back to
// just quoting + augmenting with body context when nothing matches.
function productAssertion(doc) {
  const title = (doc?.title ?? '').trim();
  const t = title.toLowerCase();
  const actions = doc?.actions ?? [];
  const http = actions.find((a) => a.type === 'http');
  const goto = actions.find((a) => a.type === 'goto');
  const click = actions.find((a) => a.type === 'click');
  const auth = doc?.preconditions?.auth_state;
  const userLabel = auth === 'logged_in' ? '已登录用户' : auth === 'anonymous' ? '匿名访客' : '用户';

  // Build a "what does the user do" phrase from actions
  let actionDesc = '';
  if (http) actionDesc = `向 \`${http.method} ${http.path}\` 发请求`;
  else if (goto && click) actionDesc = `打开 \`${goto.path}\` 后点击 ${click.target?.role || '某元素'}${click.target?.name_regex ? `（${click.target.name_regex}）` : ''}`;
  else if (goto) actionDesc = `打开 \`${goto.path}\``;
  else if (click) actionDesc = `点击 ${click.target?.role || '某元素'}${click.target?.name_regex ? `（${click.target.name_regex}）` : ''}`;

  // Pattern-match common title shapes
  if (/\brequires?\s+(authentication|auth|login|bearer|csrf|session|cookie|token)/i.test(title)) {
    const what = title.match(/requires?\s+([a-z\s\-]+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '认证';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 时，**必须满足 "${what}" 的要求**，否则后端拒绝（一般返回 401/403）。\n\n这是一条认证/授权护栏：没有 ${what} 不让进。`;
  }
  if (/\brejects?\s+/i.test(title)) {
    const what = title.match(/rejects?\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '非法输入';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''}，并提供 "${what}" 时，**后端要拒绝它**（不能让脏数据进系统）。\n\n这是一条输入校验断言。`;
  }
  if (/\bvalidates?\s+/i.test(title)) {
    const what = title.match(/validates?\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '请求';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 时，**系统要校验 "${what}"**，校验失败要返回错误而不是默默接受。\n\n这是输入合法性校验。`;
  }
  if (/\breturns?\s+(20\d|2xx|201|200|202)/i.test(title)) {
    const what = title.match(/returns?\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '成功响应';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 成功时，**响应应该是 "${what}"**。\n\n这是成功路径的契约：状态码 + 响应体形状。`;
  }
  if (/\breturns?\s+(4\d\d|4xx|404|401|403|400|429)/i.test(title)) {
    const what = title.match(/returns?\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '错误响应';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 出错时（比如资源不存在、权限不够、参数非法），**应该返回 "${what}"**。\n\n这是错误响应契约：状态码要诚实，不能用 200 包错误。`;
  }
  if (/\bredirects?\s+(to|when)/i.test(title)) {
    const target = title.match(/redirects?\s+to\s+(.+?)(?:\s*$|\.|,| when)/i)?.[1]?.trim();
    const cond = title.match(/redirects?.+?when\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim();
    return `${cond ? `当 "${cond}" 时，` : ''}${userLabel}${actionDesc ? ` ${actionDesc}` : ''}，**页面应跳转到 "${target ?? '某路由'}"**。\n\n这是路由/导航不变量。`;
  }
  if (/\bnavigates?\s+to/i.test(title)) {
    const target = title.match(/navigates?\s+to\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim();
    return `${userLabel} ${actionDesc || '完成某操作'} 后，**应该跳到 "${target ?? '某页面'}"**。\n\n这是用户流的下一步契约。`;
  }
  if (/\b(disabled|hidden)\b/i.test(title)) {
    const cond = title.match(/(?:disabled|hidden)\s+(when|while|during|on)\s+(.+?)(?:\s*$|\.|,)/i)?.[2]?.trim();
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''}，在 "${cond ?? '某状态'}" 时，**对应元素要被禁用或隐藏**。\n\n这是 UI 状态机不变量。`;
  }
  if (/\bdisplays?|shows?|renders?\b/i.test(title)) {
    const what = title.match(/(?:displays?|shows?|renders?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某内容';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 后，**页面要显示 "${what}"**。\n\n这是 UI 渲染契约。`;
  }
  if (/\bnot\s+(found|exist)|non[\-\s]existent/i.test(title)) {
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''}，但目标资源（表/比赛/用户/agent）不存在时，**系统要返回明确的 404**，而不是 5xx 或假装成功。\n\n这是错误响应契约。`;
  }
  if (/\bexcludes?|strips?|no\s+secret|no\s+seed|no.+leak/i.test(title)) {
    const what = title.match(/(?:excludes?|strips?|no\s+)([a-z\s\-]+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '敏感字段';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 收到的响应里，**不能包含 "${what}"**（避免敏感信息泄露给客户端）。\n\n这是数据安全护栏。`;
  }
  if (/\bclears?|resets?\b/i.test(title)) {
    const what = title.match(/(?:clears?|resets?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某状态';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 后，**"${what}" 要被清空/重置**。\n\n这是状态清理契约。`;
  }
  if (/\bopens?|toggles?\b/i.test(title)) {
    const what = title.match(/(?:opens?|toggles?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某面板';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 后，**"${what}" 应该被打开/切换**。\n\n这是 UI 交互契约。`;
  }
  if (/\bcloses?|dismisses?\b/i.test(title)) {
    const what = title.match(/(?:closes?|dismisses?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某对话框';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 后，**"${what}" 应该被关闭**。\n\n这是 UI 交互契约。`;
  }
  if (/\bsubmits?|triggers?|invokes?|calls?\b/i.test(title)) {
    const what = title.match(/(?:submits?|triggers?|invokes?|calls?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某动作';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 后，**应该触发 "${what}"**（前端调对应回调/后端收到对应请求）。\n\n这是交互→效果契约。`;
  }
  if (/\baccepts?|persists?\b/i.test(title)) {
    const what = title.match(/(?:accepts?|persists?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '输入';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 时，**"${what}" 应被接受并保留**（不会丢失、不会篡改）。\n\n这是数据持久性契约。`;
  }
  if (/\baccessible\s+(to|by)\s+anonymous|public\s+access/i.test(title)) {
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''}，**应当能访问**（无需登录）。\n\n这是公共可访问性契约：标明哪些资源允许匿名读取。`;
  }
  if (/\bcreates?\s+/i.test(title)) {
    const what = title.match(/creates?\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '资源';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 时，**应当成功创建 "${what}"**，并返回相应数据。\n\n这是 CRUD 创建路径契约。`;
  }
  if (/\bremoves?|deletes?\b/i.test(title)) {
    const what = title.match(/(?:removes?|deletes?)\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某资源';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 时，**应当真正删除 "${what}"**（而不是软标记或残留）。\n\n这是 CRUD 删除路径契约。`;
  }
  if (/\bupdates?\b/i.test(title)) {
    const what = title.match(/updates?\s+(.+?)(?:\s*$|\.|,)/i)?.[1]?.trim() ?? '某资源';
    return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''} 时，**应当更新 "${what}"** 并把新数据返回。\n\n这是 CRUD 更新路径契约。`;
  }

  // Fallback: state what action is being tested and quote the title
  return `${userLabel}${actionDesc ? ` ${actionDesc}` : ''}。\n\n合同声称（原文）："${title}"\n\n（鸭总没自动识别出这是哪类规则，请直接读原文 + 看下面的合同 YAML 判断。）`;
}

// Translate the raw technical reason into 鸭总 voice, with per-contract specifics.
function duckifyReason(raw, verdict, doc) {
  const r = raw.toLowerCase();
  const intent = intentSummary(doc);
  const isApi = (doc?.actions ?? []).some((a) => a.type === 'http');

  if (r.includes('intent valid') && r.includes('runner dsl gap')) {
    // dom-after-http with strong invariant — KEEP with note
    return `鸭总细看了这条想测的产品行为：\n${intent}\n\n这是个真实需求 鸭！但 agent 把它写成了"看页面里有没有某段字"，而它的 action 是 HTTP 请求，浏览器根本没打开页面——表达方式是 broken 的（运行器 DSL 装不下"HTTP 响应体包含 xxx"这种断言）。\n\n意图本身没问题：留！将来修运行器表达方式或重写 expected 即可。`;
  }
  if (r.includes('dom on http-only action') && verdict === 'BORDERLINE') {
    return `这条合同想测：\n${intent}\n\n表达方式不太对：agent 在一个纯 HTTP action 上断言了"页面里有 xxx 字"。如果它指的是 HTTP 响应里包含 xxx，那意图算合理（你来定 keep）；如果指的真是浏览器渲染后的页面，那就是张冠李戴（drop）。\n你觉得呢？`;
  }
  if (r.includes('mismatch:title-says-keyboard')) {
    return `这条合同的麻烦：\n${intent}\n\n标题嘴上说"按 Escape 关闭对话框"之类的键盘动作，但 actions 里压根没按键动作。自相矛盾。删。`;
  }
  if (r.includes('mismatch:title-says-navigation')) {
    return `这条合同的麻烦：\n${intent}\n\n标题说"跳转到 xxx"，但 expected 没断言 url。说了等于没说，删。`;
  }
  if (r.includes('mismatch:title-says-visible')) {
    return `这条合同的麻烦：\n${intent}\n\n标题说"显示了某东西"，可 expected 里既没查 dom 也没查 url。在测啥？删。`;
  }
  if (r.includes('mismatch:title-says-removal-but-asserts-presence')) {
    return `这条合同的麻烦：\n${intent}\n\n标题说"按钮被禁用/隐藏"，expected 却查"存在"——方向相反。删。`;
  }
  if (r.includes('weak:trivial-url-regex')) {
    return `这条合同想测：\n${intent}\n\n但 expected.url.matches 写的是 \`.*\`——任何网址都算过。等于没规则。删。`;
  }
  if (r.includes('weak:noise-needles-only')) {
    return `这条合同想测：\n${intent}\n\n但要找的字是 "data"/"error"/"ok" 这种烂大街的词。哪个页面没几个？测不出真问题。删。`;
  }
  if (r.includes('weak:empty-contains-text')) {
    return `这条合同想测：\n${intent}\n\n但 expected.dom.contains_text 是空数组——啥也没断言，纯占位。删。`;
  }
  if (r.includes('weak:micro-needles')) {
    return `这条合同想测：\n${intent}\n\n但要找的字短得离谱（1-2 字符），瞎匹配概率极高。删。`;
  }
  if (r.startsWith('silent:') || r.includes('silent:top-key') || r.includes('silent:')) {
    const key = (raw.match(/silent:([^\s,]+)/)?.[1]) || '某字段';
    return `这条合同想测：\n${intent}\n\n但用了 \`${key}\` 这种 schema 不认的字段，运行器默默忽略——等于一行没写。删。`;
  }
  if (r.includes('invariant: auth/csrf boundary')) {
    return `这条合同想测：\n${intent}\n\n没登录不让进、跨站请求要带 CSRF 头——产品底线鸭！必须留。`;
  }
  if (r.includes('invariant: security/error response')) {
    return `这条合同想测：\n${intent}\n\n错误码该 401 就 401、该 404 就 404，是 API 的诚实承诺。留！`;
  }
  if (r.includes('invariant: input validation')) {
    return `这条合同想测：\n${intent}\n\n校验用户输入是 P0 级护城河——脏数据进系统就出事。留！`;
  }
  if (r.includes('invariant: navigation invariant')) {
    return `这条合同想测：\n${intent}\n\n用户点哪去哪、登出回登录、未授权重定向——页面跳转是体验骨架。留！`;
  }
  if (r.includes('data leak prevention')) {
    return `这条合同想测：\n${intent}\n\n不让客户端摸到种子/密钥/敏感字段。性命攸关，留！`;
  }
  if (r.includes('auth-state invariant')) {
    return `这条合同想测：\n${intent}\n\n登出后必须真清干净 session/token——登出的承诺。留！`;
  }
  if (r.startsWith('default-keep')) {
    return `这条合同想测：\n${intent}\n\n鸭总扫了一遍：行为自洽、断言明确、表达没毛病。没意见——留！`;
  }
  return `这条合同想测：\n${intent}\n\n鸭总的原始理由：${raw}`;
}

const lines = readFileSync(DEC_FILE, 'utf8').split('\n');
const decisions = [];
for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [id, verdict, ...rest] = line.split('\t');
  if (!id || !verdict) continue;
  const opposite = verdict === 'KEEP' ? 'DROP' : verdict === 'DROP' ? 'KEEP' : null;
  const sourceYaml = findContract(id) ?? '(找不到原始合同文件 鸭)';
  let gtCurrentStatus = '—';
  let gtTitle = '', gtArea = '', gtSeverity = '', gtAuthState = '';
  try {
    const sourceDoc = parseYaml(sourceYaml);
    gtTitle = sourceDoc?.title ?? '';
    gtArea = sourceDoc?.area ?? '';
    gtSeverity = sourceDoc?.severity ?? '';
    gtAuthState = sourceDoc?.preconditions?.auth_state ?? '';
  } catch {}
  const gtPath = join(GT_DIR, `${id}.yml`);
  if (existsSync(gtPath)) {
    try { gtCurrentStatus = parseYaml(readFileSync(gtPath, 'utf8'))?.provenance?.status ?? '—'; } catch {}
  }
  let sourceDoc = null;
  try { sourceDoc = parseYaml(sourceYaml); } catch {}
  decisions.push({
    id, verdict, opposite,
    rawReason: rest.join('\t'),
    productAssertion: productAssertion(sourceDoc),
    duckReason: duckifyReason(rest.join('\t'), verdict, sourceDoc),
    title: gtTitle, area: gtArea, severity: gtSeverity, authState: gtAuthState,
    currentGt: gtCurrentStatus,
    sourceYaml,
  });
}

function verdictLabel(v) {
  if (v === 'KEEP') return '留着！';
  if (v === 'DROP') return '删！';
  return v;
}

const dataJson = JSON.stringify(decisions);

const html = `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<title>🦆 鸭总今日合同审批会 · 扑克测试场</title>
<style>
  :root {
    --bg: #0f1115; --fg: #e8e8e8; --muted: #8a8f98;
    --card: #181b22; --border: #262b34; --accent: #f4d03f;
    --keep: #4ade80; --drop: #f87171; --skip: #8a8f98;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, "SF Pro Display", "Geist", "PingFang SC", system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; flex-direction: column; gap: 8px; }
  .hdr-row { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 19px; font-weight: 500; letter-spacing: 0.3px; }
  h1 span { color: var(--muted); font-weight: 400; font-size: 14px; }
  .stats { color: var(--muted); font-size: 13px; }
  .stats b { color: var(--fg); }
  .progress { flex: 1; min-width: 200px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .progress > div { height: 100%; background: var(--accent); transition: width 0.2s; }
  .filter { display: flex; gap: 6px; }
  .filter button { background: transparent; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .filter button.active { color: var(--fg); border-color: var(--accent); }
  .export { background: var(--accent); color: #0f1115; border: 0; border-radius: 2px; padding: 6px 14px; font: inherit; font-weight: 600; cursor: pointer; }
  .export:disabled { opacity: 0.4; cursor: not-allowed; }
  main { padding: 24px; max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .intro { color: var(--muted); font-size: 13px; padding: 14px 16px; border: 1px dashed var(--border); border-radius: 2px; background: #14161c; }
  .intro b { color: var(--fg); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 2px; padding: 18px; display: flex; flex-direction: column; gap: 14px; transition: opacity 0.15s, border-color 0.15s; }
  .card.done { opacity: 0.5; }
  .card.done.kept { border-left: 3px solid var(--keep); }
  .card.done.dropped { border-left: 3px solid var(--drop); }
  .card.done.skipped { border-left: 3px solid var(--skip); }
  .card-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .card-head .area { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--accent); }
  .card-head .id { font-family: "SF Mono", "Geist Mono", ui-monospace, monospace; font-size: 13px; color: var(--muted); }
  .card-head .meta { font-size: 11px; color: var(--muted); margin-left: auto; }
  .card-head .meta span { padding: 1px 6px; border: 1px solid var(--border); border-radius: 2px; margin-left: 4px; }
  .title { font-family: "Instrument Serif", "Geist", serif; font-size: 22px; line-height: 1.3; color: var(--fg); font-weight: 400; }
  .assertion { background: #14161c; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 2px; padding: 14px 16px; }
  .assertion-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  .assertion-body { color: #e8eaee; font-size: 15px; line-height: 1.65; white-space: pre-wrap; }
  .assertion-body strong { color: var(--accent); font-weight: 500; font-family: "SF Mono", ui-monospace, monospace; font-size: 13px; }
  .assertion-body code { background: #262b34; padding: 1px 6px; border-radius: 2px; font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; color: #cfd2d8; }
  .quack { background: #1a1d25; border: 1px solid var(--border); border-radius: 2px; padding: 10px 14px; display: flex; gap: 10px; align-items: flex-start; }
  .quack-avatar { font-size: 22px; flex-shrink: 0; line-height: 1.1; }
  .quack-body { flex: 1; font-size: 13px; }
  .quack-verdict { display: inline-block; padding: 2px 10px; background: var(--accent); color: #0f1115; font-weight: 600; border-radius: 2px; font-size: 11px; margin-bottom: 4px; letter-spacing: 0.5px; }
  .quack-verdict.drop { background: var(--drop); color: #0f1115; }
  .quack-verdict.keep { background: var(--keep); color: #0f1115; }
  .quack-reason { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .quack-reason strong { color: #cfd2d8; font-weight: 500; }
  .question { font-family: "Instrument Serif", serif; font-size: 18px; color: var(--fg); padding: 8px 0; }
  .question .you { color: var(--accent); }
  .quack-raw { color: var(--muted); font-size: 11px; font-family: "SF Mono", ui-monospace, monospace; margin-top: 6px; }
  details { background: #0f1115; border: 1px solid var(--border); border-radius: 2px; }
  details summary { padding: 8px 12px; cursor: pointer; font-size: 12px; color: var(--muted); list-style: none; }
  details summary::after { content: " ▾"; }
  details[open] summary::after { content: " ▴"; }
  details pre { margin: 0; padding: 12px; font-family: "SF Mono", "Geist Mono", ui-monospace, monospace; font-size: 12px; color: #cfd2d8; overflow-x: auto; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .actions button { flex: 1; min-width: 130px; padding: 10px 12px; border: 1px solid var(--border); background: transparent; color: var(--fg); font: inherit; font-weight: 500; border-radius: 2px; cursor: pointer; transition: all 0.1s; }
  .actions button.accept:hover { background: rgba(244, 208, 63, 0.15); border-color: var(--accent); }
  .actions button.override:hover { background: rgba(248, 113, 113, 0.15); border-color: var(--drop); }
  .actions button.skip:hover { background: rgba(138, 143, 152, 0.15); }
  .card.done .actions button { opacity: 0.5; }
  .card.done .actions button.chosen { opacity: 1; background: var(--accent); color: #0f1115; border-color: var(--accent); font-weight: 600; }
  kbd { background: #262b34; padding: 1px 6px; border-radius: 2px; font-size: 11px; font-family: "SF Mono", monospace; color: #cfd2d8; }
  .empty { text-align: center; padding: 60px 20px; color: var(--muted); font-family: "Instrument Serif", serif; font-size: 18px; }
  footer { padding: 30px 24px; text-align: center; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); margin-top: 40px; }
</style>
</head>
<body>
<header>
  <div class="hdr-row">
    <h1>🦆 鸭总今日合同审批会 <span>· 扑克测试场 · 2026-05-26</span></h1>
    <div class="stats">
      盖章了 <b id="stat-done">0</b> / ${decisions.length} ·
      顺从 <b id="stat-accept">0</b> ·
      抬杠 <b id="stat-override">0</b> ·
      摸鱼 <b id="stat-skip">0</b>
    </div>
  </div>
  <div class="hdr-row">
    <div class="progress"><div id="progress-bar" style="width:0%"></div></div>
    <div class="filter">
      <button data-f="undecided" class="active">还没盖章的</button>
      <button data-f="accepted">顺从过的</button>
      <button data-f="overridden">抬过杠的</button>
      <button data-f="skipped">摸鱼的</button>
      <button data-f="all">都看</button>
    </div>
    <button class="export" id="reset-btn" style="background:transparent;color:var(--muted);border:1px solid var(--border);">🔄 重新开始</button>
    <button class="export" id="export-btn" disabled>📜 下载鸭总决议书</button>
  </div>
</header>
<main id="cards">
  <div class="intro">
    🦆 <b>嘎嘎！同事们好，鸭总驾到。</b>
    今天有 ${decisions.length} 份合同要审。每份鸭总都先看过了，给了倾向（留还是删），你只要决定：
    <b>顺从鸭总</b>（点 ✓）、<b>抬杠</b>（点 ✗ 改成相反决定）、还是 <b>先摸鱼放一放</b>（点 ⊘）。
    不懂就点开下面的「翻翻合同原文」看看。鸭总很贴心，每次点击都自动存档，关掉浏览器再开也不丢。
  </div>
</main>
<footer>
  嘎嘎键位表：<kbd>A</kbd> 顺从鸭总 · <kbd>O</kbd> 抬杠 · <kbd>S</kbd> 摸鱼 · <kbd>↑/↓</kbd> 看下一份 · <kbd>E</kbd> 翻合同原文
  <br>全部盖完章按右上「下载鸭总决议书」，然后命令行跑：<kbd>node scripts/eval/apply-intent-judge.mjs --apply</kbd>
</footer>
<script>
const data = ${dataJson};
const STORAGE_KEY = "contractqa-intent-judge-2026-05-26-v3";
const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
let currentFilter = "undecided";
let focusIdx = 0;

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function render() {
  const root = document.getElementById("cards");
  // preserve intro on first render
  const intro = root.querySelector(".intro");
  root.innerHTML = "";
  if (intro) root.appendChild(intro);

  const filtered = data.filter(d => {
    const c = state[d.id]?.choice;
    if (currentFilter === "undecided") return !c;
    if (currentFilter === "accepted") return c === "accept";
    if (currentFilter === "overridden") return c === "override";
    if (currentFilter === "skipped") return c === "skip";
    return true;
  });
  if (filtered.length === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = currentFilter === "undecided" ? "🦆 全部盖完章咯，鸭总下班。" : "这一栏空空如也。";
    root.appendChild(e);
  } else {
    filtered.forEach((d, i) => {
      const ch = state[d.id]?.choice;
      const klass = ch === "accept" ? (d.verdict === "KEEP" ? "kept" : "dropped") : ch === "override" ? (d.opposite === "KEEP" ? "kept" : "dropped") : ch === "skip" ? "skipped" : "";
      const card = document.createElement("div");
      card.className = "card " + (ch ? "done " + klass : "");
      card.dataset.id = d.id;
      card.dataset.idx = i;
      const verdictLower = d.verdict.toLowerCase();
      const verdictLabel = d.verdict === "KEEP" ? "留着！" : d.verdict === "DROP" ? "删掉！" : d.verdict;
      const oppositeLabel = d.opposite === "KEEP" ? "留着" : d.opposite === "DROP" ? "删掉" : d.opposite;
      card.innerHTML = \`
        <div class="card-head">
          <span class="area">\${d.area}</span>
          <span class="id">\${d.id}</span>
          <span class="meta">
            \${d.severity ? "鸭总级别 " + d.severity : ""}
            \${d.authState ? "<span>" + d.authState + "</span>" : ""}
            <span>现在的章: \${d.currentGt}</span>
          </span>
        </div>
        <div class="title">\${escapeHtml(d.title)}</div>
        <div class="assertion">
          <div class="assertion-label">🦆 这条契约说产品该做到的事</div>
          <div class="assertion-body">\${renderDuckReason(d.productAssertion)}</div>
        </div>
        <div class="question">
          <span class="you">你判断：</span>这是你的产品该坚持的规则吗？
        </div>
        <div class="quack">
          <div class="quack-avatar">🦆</div>
          <div class="quack-body">
            <span class="quack-verdict \${verdictLower}">鸭总倾向：\${verdictLabel}</span>
            <div class="quack-reason">\${renderDuckReason(d.duckReason)}<br><span style="color:#5a5f68;font-family:'SF Mono',monospace;font-size:10px;">原始判定: \${d.verdict} — \${escapeHtml(d.rawReason)}</span></div>
          </div>
        </div>
        <details>
          <summary>🦆 翻翻合同原文</summary>
          <pre>\${escapeHtml(d.sourceYaml)}</pre>
        </details>
        <div class="actions">
          <button class="accept \${ch === "accept" ? "chosen" : ""}" data-act="accept">✓ 听鸭总的：\${verdictLabel}</button>
          <button class="override \${ch === "override" ? "chosen" : ""}" data-act="override">✗ 鸭总错了，应该\${oppositeLabel}</button>
          <button class="skip \${ch === "skip" ? "chosen" : ""}" data-act="skip">⊘ 先摸鱼放着</button>
        </div>
      \`;
      card.querySelectorAll("button[data-act]").forEach(btn => {
        btn.addEventListener("click", () => choose(d.id, btn.dataset.act));
      });
      root.appendChild(card);
    });
  }
  updateStats();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Convert **bold** markdown to <strong> in the duck reason so the
// per-contract intent (e.g. **POST /tables**) stands out.
function renderDuckReason(s) {
  return escapeHtml(s).replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
}

function choose(id, choice) {
  state[id] = { choice };
  save();
  render();
}

function updateStats() {
  const counts = { accept: 0, override: 0, skip: 0 };
  for (const d of data) {
    const c = state[d.id]?.choice;
    if (c) counts[c]++;
  }
  const done = counts.accept + counts.override + counts.skip;
  document.getElementById("stat-done").textContent = done;
  document.getElementById("stat-accept").textContent = counts.accept;
  document.getElementById("stat-override").textContent = counts.override;
  document.getElementById("stat-skip").textContent = counts.skip;
  document.getElementById("progress-bar").style.width = (done / data.length * 100) + "%";
  document.getElementById("export-btn").disabled = (counts.accept + counts.override) === 0;
}

document.getElementById("reset-btn").addEventListener("click", () => {
  if (confirm("🦆 真的要清空所有已盖的章重新开始吗？")) {
    localStorage.removeItem(STORAGE_KEY);
    for (const k of Object.keys(state)) delete state[k];
    render();
  }
});

document.querySelectorAll(".filter button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".filter button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    currentFilter = b.dataset.f;
    render();
  });
});

document.getElementById("export-btn").addEventListener("click", () => {
  const lines = [
    "# 🦆 鸭总决议书 · 导出时间 " + new Date().toISOString(),
    "# 应用到 GT：node scripts/eval/apply-intent-judge.mjs --apply",
    "",
  ];
  for (const d of data) {
    const c = state[d.id]?.choice;
    if (c === "accept") lines.push(\`\${d.id}\\t\${d.verdict}\\thuman: 顺从鸭总\`);
    else if (c === "override") lines.push(\`\${d.id}\\t\${d.opposite}\\thuman: 抬杠鸭总\`);
    else if (c === "skip") lines.push(\`# 摸鱼中 \${d.id} — 鸭总当时建议是 \${d.verdict}\`);
  }
  const blob = new Blob([lines.join("\\n") + "\\n"], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "intent-judge-decisions.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const cards = [...document.querySelectorAll(".card")];
  if (cards.length === 0) return;
  if (focusIdx >= cards.length) focusIdx = cards.length - 1;
  const card = cards[focusIdx];
  const id = card.dataset.id;
  if (e.key === "a" || e.key === "A") { choose(id, "accept"); }
  else if (e.key === "o" || e.key === "O") { choose(id, "override"); }
  else if (e.key === "s" || e.key === "S") { choose(id, "skip"); }
  else if (e.key === "e" || e.key === "E") { card.querySelector("details").toggleAttribute("open"); }
  else if (e.key === "ArrowDown") { focusIdx = Math.min(focusIdx + 1, cards.length - 1); cards[focusIdx].scrollIntoView({ block: "center", behavior: "smooth" }); }
  else if (e.key === "ArrowUp") { focusIdx = Math.max(focusIdx - 1, 0); cards[focusIdx].scrollIntoView({ block: "center", behavior: "smooth" }); }
});

render();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`  ${decisions.length} 条决议等鸭总审`);
console.log(`  open: open ${OUT}`);
