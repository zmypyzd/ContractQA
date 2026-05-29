# Contract Gaps — Decision Page 审查（68 条契约）

> **数据源**：`qa/eval/poker/run-log/decision-page.html`（68 条契约）
> **审查日期**：2026-05-26
> **审查方法**：CEO Duck 🦆 模式 — 三重对照（产品需求 vs spec 实际行为 vs 鸭总 verdict）
> **审查者**：Chinese Cute CEO Duck 🦆
>
> 与 `CONTRACT_GAPS.md`（之前的 intent-judge-decisions.txt 审查）并行存在，本文件专门聚焦 decision-page 这一批 68 条。

---

## 📊 Executive Summary

| 维度 | 数量 | 占比 |
|---|---|---|
| **总契约数** | 68 | 100% |
| 鸭总 KEEP | 54 | 79% |
| 鸭总 DROP | 14 | 21% |
| **本鸭强烈反对的 verdict** | 3 | 4.4% |
| **本鸭强烈支持的 verdict** | 14 | 21% |
| **建议 REWRITE 而非 KEEP-as-is** | 31 | 46% |
| **完全干净可直接 KEEP 的** | 14 | 21% |

### 严重度细分
- **P0（关键）**：8 条 — 多数有 DOM-after-HTTP 或 NO_EXPECTED 严重缺陷
- **P1（高）**：33 条
- **P2（中）**：21 条
- **P3（低）**：5 条
- 未分级：1 条（空契约）

---

## 🚨 Top-Level 关键发现（按严重度排序）

### 🔥 Finding 1: **6 条契约完全没有 `expected:` 字段**（schema-invalid，5 条 KEEP + 1 DROP）

这些契约的 spec 只有 actions 没有断言，**等价于没契约**：

| 契约 ID | 严重度 | 状态 |
|---|---|---|
| `api-tables-remove-agent-requires-auth` | **P0** | KEEP — 🚨 P0 等级裸奔 |
| `api-tables-create-validates-schema` | P1 | KEEP |
| `api-auth-register-validates-input` | P1 | KEEP |
| `api-agent-invites-register-invalid-token` | P1 | KEEP |
| `api-werewolf-games-create-validates-name-length` | P2 | KEEP |
| `match-replay-tab-switch-to-replay` | — | DROP（空契约） |

**Action**：必须立即补 `expected:` 块，否则这些契约在 runner 里要么 silent pass 要么 schema 校验 fail。**P0 等级的 `api-tables-remove-agent-requires-auth` 优先级最高**。

### 🔥 Finding 2: **20 条 API 契约用 `dom.*` 断言 HTTP-only 响应（Silent Pass 危机）**

完整名单见 § Group A。所有这些契约**通过 review notes 已被官方确认是 silent pass**——它们看起来在守护安全边界，实际啥都没守。

**Action**：
1. 修 runner DSL，让 `dom` 断言用在 `http` action 后 **报错而非 silent pass**
2. 引入 `http` 断言族（`status`、`body.contains_key`、`body.not_contains_key`、`headers.*`）
3. 全部 REWRITE 这 20 条 spec

### 🔥 Finding 3: **8 条契约只有 `role_count` 断言（验证元素存在 ≠ 验证行为）**

这些契约只检查"按钮 / 元素存在 N 个"，没检查**行为后果**：

| 契约 ID | 标题（自称） | 实际只测 |
|---|---|---|
| `agent-name-persists-on-edit-load` | "name field is populated" | textbox 存在（不测填了什么） |
| `appshell-invite-button-close-toggle` | "twice closes the popover" | 最后 dialog count = 0（不测中间 = 1）|
| `audience-react-heart-independent-counts` | "independent of other counts" | 两个 reaction 按钮各存在（不测独立性）|
| `audience-wolf-reaction-initial-zero` | "initialize to zero" | wolf 按钮存在（不测 count 是 0）|
| `check-action-button-visible-when-legal` | "visible when legal" | Check 按钮存在（不测条件性可见）|
| `confirm-dialog-cancel-closes-dialog` | "cancel closes dialog" | 最后 dialog 不存在（不测中间存在）|
| `table-preset-amount-sets-bet-value` | "sets bet value" | textbox 存在（不测 value 被设了）|
| `werewolf-room-wrapped-in-app-shell` | "within AppShell" | navigation 存在（不测包裹关系）|

**Action**：每条都是 G15 标题党 + G16 toggle 半边的混合体，**必须加状态/值断言**。

### 🔥 Finding 4: **5 条 G17 空洞断言（单字符 / 短串）**

| 契约 ID | 断言 | 问题 |
|---|---|---|
| `audience-fire-reaction-increment` | `contains_text: "2"` | 单字符 "2" 全页都有 |
| `audience-react-heart-increments-count` | `contains_text: "2"` | 同上 |
| `audience-react-clap-multiple-clicks` | `contains_text: "3"` | 单字符 "3" |
| `audience-wolf-reaction-increment` | `contains_text: "2"` | 同上 |
| `audience-reactions-start-at-zero` | `contains_text: "0"` | **已 DROP** |

**Action**：全部 REWRITE，使用 baseline 捕获 + scoped 断言 + 算术不变量（模板见下文）。

### 🔥 Finding 5: **3 条契约缺隐藏 precondition（legacy_modules disabled）**

这些契约的产品需求里**明确说**"当 legacy modules disabled 时"，但 spec 里**没有设置这个前置条件**：

| 契约 ID | 产品需求声明的前置条件 | spec 是否设置？ |
|---|---|---|
| `agents-edit-redirects-when-legacy-disabled` | "legacy modules disabled" | ❌ 没有 |
| `match-replay-redirects-when-legacy-disabled` | "legacy modules disabled" | ❌ 没有 |
| `route-table-redirect-when-disabled` | "legacy modules disabled" | ❌ 没有 |

**Action**：spec 需补 `preconditions.feature_flags.legacy_modules: false`，否则测试环境若默认 enabled，这些契约会持续 fail；若默认 disabled，则隐藏了"enabled 状态下契约会怎样"的盲区。见 G13。

---

## 📋 14 条 DROP 全部审查（本鸭对鸭总判定的复核）

| # | 契约 ID | 鸭总 DROP 理由 | 本鸭 verdict | 产品需求 | 补充建议 |
|---|---|---|---|---|---|
| 1 | `api-werewolf-start-host-only` | trivial-url-regex (`.*`) | ✅ DROP，但 **必须 REPLACE** | 只有 game creator 能 start | 这是 P0 domain rule！DROP 之前必须补一条用 status code + auth 断言的正经契约 |
| 2 | `werewolf-agent-picker-requires-login` | 无 dom/url 断言 | ✅ DROP | 匿名访客点 picker 显示登录提示 | § A3 — 与另两条 agent-picker 契约重叠，整体重新组织 |
| 3 | `all-in-button-disabled-while-submitting` | 标题党：说禁用却查"Submitting"存在 | ✅ DROP + REPLACE | All-in 提交期间按钮禁用 | 见 § D1 已记录在原 GAPS 文件 |
| 4 | `audience-reactions-start-at-zero` | noise-needles "0"/"data"/"error" | ✅ DROP | reaction count 初始为 0 | REPLACE：scoped 断言到具体 counter 元素 + 数值=0 |
| 5 | `check-action-button-disabled-while-submitting` | 标题党：说禁用却查"Check"存在 | ✅ DROP + REPLACE | Check 提交期间禁用 | 同 all-in，需 REPLACE 为真正的 disabled 断言 |
| 6 | `lobby-seed-input-accepts-optional-value` | `contains_text: []` | ✅ DROP + REPLACE | seed input 接受可选字符串 | REPLACE：断言 input value 被设置 |
| 7 | `raise-slider-shows-validation-error` | noise-needles "error" | ✅ DROP + REPLACE | 非法 raise 显示 error | REPLACE：scoped 到 error 元素 + 测试具体非法值场景 |
| 8 | `replay-hand-select-button-updates-view` | `contains_text: []` | ✅ DROP + REPLACE | 选 hand 更新 replay 视图 | REPLACE：用 diff signature 验证视图换了 |
| 9 | `replay-next-button-advances-timeline` | `contains_text: []` | ✅ DROP + REPLACE | next 按钮推进 timeline | REPLACE：测 timeline 索引 +1 |
| 10 | `replay-street-filter-resets-on-hand-change` | `contains_text: []` | ✅ DROP + REPLACE | hand 切换重置 street filter | REPLACE：测 filter UI 显示 "all" |
| 11 | `werewolf-lobby-recent-tab-filters-completed-games` | "title says keyboard but no key action" | ✅ DROP + REPLACE | RECENT tab 筛选完成的 games | 鸭总 DROP 理由文案错（不是键盘问题，是镜子断言：click "RECENT" → assert contains "RECENT"），但 DROP 决定对。REPLACE：测 list 内容真的换了 |
| 12 | `werewolf-lobby-tab-featured-active-state` | 同上 | ✅ DROP | FEATURED tab active 状态 | REPLACE：测 active class / aria-selected |
| 13 | `werewolf-lobby-tab-live-filters-games` | 同上 | ✅ DROP + REPLACE | ALL LIVE tab 筛选 live games | REPLACE：测 list 内容真的换了 |
| 14 | `match-replay-tab-switch-to-replay` | 无标题、无内容 | ✅ DROP | 空契约 | 永久删除，不需要 REPLACE |

**DROP 总结**：14 条全部同意 DROP，但其中 **10 条对应的产品功能是有价值的**，必须补 REPLACE 契约。

---

## 📋 54 条 KEEP 全部审查 — 按风险分组

### 🚨 Group A: API DOM-after-HTTP（20 条，全部需 REWRITE）

**模式**：spec 用 `dom.contains_text` / `dom.not_contains_text` 断言 HTTP-only 接口的响应。HTTP 请求不渲染 DOM，**断言被对"上一次页面状态"求值，结果是巧合性 pass/fail**。

**产品需求 vs spec 对照**：
| 契约 ID | 严重度 | 产品需求要测的 | spec 实际查的 | 差距 |
|---|---|---|---|---|
| `api-me-werewolf-agents-create-requires-csrf` | **P0** | 无 CSRF → 拒绝 (4xx) | dom 不含 "agentId" | 应测 status=403 + body 无 agentId |
| `api-tables-hand-replay-requires-auth` | **P0** | 匿名 → 拒绝 | dom 含 "Unauthorized" | 应测 status=401 |
| `simulate-requires-csrf-token` | **P0** | 无 CSRF → 拒绝 | dom 不含 "Simulation completed" | 应测 status=403 |
| `delete-agent-requires-auth` | **P0** | 匿名 → 拒绝 | dom 含 "unauthorized" | 应测 status=401 |
| `api-decision-trace-strips-private-fields` | P1 | 响应不含敏感字段 | dom 检查 | 应测 JSON body 不含 `privateStateHash`, `reasoningSummary` |
| `api-matches-list-excludes-seed` | P1 | 响应不含 seed | dom 检查 | 应测 JSON body 数组每项无 seed |
| `api-matches-get-excludes-sensitive-fields` | P1 | 响应不含敏感字段 | dom 检查 | 应测 JSON body |
| `api-werewolf-match-get-strips-seed` | P1 | 响应不含 seed | dom 检查 | 应测 JSON body |
| `api-werewolf-matches-strips-seed` | P1 | 响应不含 seed | dom 检查 | 应测 JSON body |
| `api-werewolf-invite-npc-requires-csrf` | P1 | 无 CSRF → 拒绝 | dom 检查 | 应测 status |
| `api-agent-invites-revoke-hash-not-found` | P1 | 不存在 hash → 404 | dom 检查 | 应测 status=404 |
| `api-decision-trace-returns-404-for-missing-match` | P1 | 不存在 match → 404 | dom 检查 | 应测 status=404 |
| `api-tables-get-hand-validates-hand-belongs-to-table` | P1 | 跨桌 hand → 拒绝 | dom 检查 | 应测 status + body (IDOR) |
| `api-tables-get-hand-validates-table-exists` | P1 | 不存在 table → 404 | dom 检查 | 应测 status=404 |
| `api-me-werewolf-agents-create-validates-body` | P1 | 非法 body → 拒绝 | dom 检查 | 应测 status=400 + body 含 error |
| `api-tables-add-agent-validates-adapter-type` | P1 | 非 mock adapter → 拒绝 | dom 检查 | 应测 status + body |
| `api-tables-watch-not-found-invalid-table` | P1 | 不存在 table → 404 | dom 检查 | 应测 status=404 |
| `simulate-validates-request-schema` | P1 | 非法 schema → 拒绝 | dom 检查 | 应测 status=400 |
| `api-matches-get-not-found-invalid-id` | P2 | 不存在 → 404 | dom 检查 | 应测 status=404 |
| `api-matches-decision-trace-returns-match-not-found` | P2 | 不存在 match → 404 | dom 检查 | 应测 status=404 |

**通用 REWRITE 模板**（按需求类型）：

```yaml
# 类型 1：鉴权 / CSRF 边界
expected:
  http:
    status: 401   # or 403
    body:
      contains: ["error"]   # 或具体错误码字段

# 类型 2：数据脱敏
expected:
  http:
    status: 200
    body:
      not_contains_keys: ["seed", "privateStateHash", "reasoningSummary"]
      # 或更严：用 JSON schema 校验只含白名单字段

# 类型 3：输入校验
expected:
  http:
    status: 400
    body:
      contains: ["validation_error"]

# 类型 4：资源不存在
expected:
  http:
    status: 404
```

**Action**：
- [ ] 🚨 **本周必做**：修 runner DSL，让 `dom` 用在 `http` 后报错
- [ ] 🚨 **本周必做**：上述 8 条 P0/P1 安全契约（数据脱敏 + 鉴权）全部 REWRITE
- [ ] ⚠️ 本月：剩余 12 条 P1/P2 REWRITE

---

### ⚠️ Group B: 完全无 expected（5 条 KEEP）

**模式**：spec 只有 actions，没有任何 expected 断言 — 测试啥都不验证，必然 silent pass。

| 契约 ID | 严重度 | 产品需求 | 补充建议 |
|---|---|---|---|
| `api-tables-remove-agent-requires-auth` | **P0** | DELETE 需鉴权 | 补 `expected.http.status: 401` |
| `api-tables-create-validates-schema` | P1 | 非法 body 拒绝 | 补 `expected.http.status: 400` |
| `api-auth-register-validates-input` | P1 | 非法注册数据拒绝 | 补 `expected.http.status: 400` |
| `api-agent-invites-register-invalid-token` | P1 | 不存在 token → 404 | 补 `expected.http.status: 404` |
| `api-werewolf-games-create-validates-name-length` | P2 | name 超长拒绝 | 补 `expected.http.status: 400` |

**Action**：5 条全部补 `expected:` 块。**P0 的 `api-tables-remove-agent-requires-auth` 是最高优先级**。

---

### ❌ Group C: 本鸭强烈反对 KEEP（5 条 G17 空洞断言）

CEO 鸭模式的 default-keep 启发式（sharp body + self-consistent + has assertion）**抓不到 G17 vacuous assertion** —— 这些契约都通过启发式，但实际是 silent pass 装置。

| 契约 ID | 严重度 | 鸭总判定 | 本鸭判定 | 问题 |
|---|---|---|---|---|
| `audience-fire-reaction-increment` | P2 | KEEP | ❌ **REWRITE/DROP** | `contains_text: "2"` 全页都有 |
| `audience-react-heart-increments-count` | P2 | KEEP | ❌ **REWRITE/DROP** | 同款，"2" |
| `audience-react-clap-multiple-clicks` | P3 | KEEP | ❌ **REWRITE/DROP** | 同款，"3" |
| `audience-wolf-reaction-increment` | P2 | KEEP | ❌ **REWRITE/DROP** | 同款，"2" |
| `audience-strip-shows-watching-count` | P2 | KEEP | ⚠️ KEEP+STRENGTHEN | "watching" + "AUDIENCE" 是字符串而非单字符，稍好但仍弱 |

**REWRITE 模板**（参考已记录的 § A7）：

```yaml
preconditions:
  fixture: active-match-with-reactions-enabled
  initial_user_reactions_for_fire: 0
actions:
  - type: goto
    path: /tables/${fixture.table_id}
  - type: capture
    name: baseline_fire_count
    selector: '[data-reaction="fire"] .count'
    as_number: true
  - type: click
    target: { role: button, name_regex: "React 🔥" }
  - type: wait_for_network_idle
expected:
  dom:
    within: { selector: '[data-reaction="fire"] .count' }
    text_equals_number: "${baseline_fire_count + 1}"
```

**结构式版本**（推荐，G12 + G17 一并解决）：
```yaml
# 一条契约覆盖所有 reaction 按钮
title: All reaction buttons increment their scoped counter by 1 per click
actions:
  - foreach: reaction in ["fire", "heart", "clap", "wolf"]
    do:
      - capture: baseline[${reaction}]
        selector: '[data-reaction="${reaction}"] .count'
      - click: button[name_regex="React ${reaction_emoji}"]
      - wait_for_network_idle
      - assert:
          selector: '[data-reaction="${reaction}"] .count'
          equals_number: "${baseline[${reaction}] + 1}"
```

---

### 🟡 Group D: KEEP-with-STRENGTHEN（8 条 role-count-only / 标题党温和版）

| 契约 ID | 严重度 | 问题 | 建议加什么 |
|---|---|---|---|
| `agent-name-persists-on-edit-load` | P1 | 只测 textbox 存在，不测 value | 加 `attribute: value, equals: ${fixture.agent.name}` |
| `appshell-invite-button-close-toggle` | P3 | G16 toggle 半边 | 中间加 `assert dialog count == 1` |
| `audience-react-heart-independent-counts` | P3 | G15 标题党：标题说独立，spec 只测存在 | 改为：点 ❤️ → ❤️ count +1 且 🔥 count 不变 |
| `audience-wolf-reaction-initial-zero` | P3 | G15：标题说 zero，spec 只测按钮存在 | 加 `count.text_equals: "0"` |
| `check-action-button-visible-when-legal` | P1 | G15：标题说"when legal"，spec 不设置 game state | 加 preconditions（用户处于可 check 的牌局阶段）|
| `confirm-dialog-cancel-closes-dialog` | P1 | G16 toggle 半边 + 无 preconditions（dialog 怎么打开的没说） | 加：先打开 dialog → assert count==1 → click cancel → assert count==0 |
| `table-preset-amount-sets-bet-value` | P1 | G15：标题说设值，spec 只测 textbox 存在 | 加 `input.value: <对应预设值>` |
| `werewolf-room-wrapped-in-app-shell` | P2 | G17：navigation 元素全页都有 | 加 scoped 到 app shell 容器，且测 inner content 是 werewolf room |

---

### ⚠️ Group E: KEEP 但有跨契约 gap / 隐藏 precondition（3 条）

| 契约 ID | 严重度 | 隐藏问题 |
|---|---|---|
| `agents-edit-redirects-when-legacy-disabled` | P2 | 产品需求显式说"当 legacy disabled"，但 spec 没设置 precondition |
| `match-replay-redirects-when-legacy-disabled` | P2 | 同上 |
| `route-table-redirect-when-disabled` | P1 | 同上 |

**Action**：spec 必须加 `preconditions.feature_flags.legacy_modules: false`，且 CI 应跑 legacy on/off 双矩阵。

---

### ✅ Group F: 本鸭赞同 KEEP（14 条干净契约）

这些契约 **断言强、行为可验、与产品需求匹配**。

#### Login Flow 子组（验证了 `next` 参数机制，A1 警报作废）

| 契约 ID | 严重度 | 断言强度 | 备注 |
|---|---|---|---|
| `appshell-login-navigates-to-login-page` | **P0** | ✅ 强：`url.matches: "^/login\?next=%2F$"` | 精确测 `next` 参数包含。**这条契约证明实际实现用 `next` 而非 `returnTo`**——之前 § A1 警报作废 |
| `login-page-respects-next-param-redirect` | P2 | ✅ 强：`url.matches: "^/dashboard"` | 已登录用户带 next 参数应跳到 next 目标 |
| `logout-clears-session-and-redirects` | **P0** | ✅ 强：`url.matches: "^/$"` + `auth_state.fully_logged_out: true` | 双断言闭合 G7（复合契约只要双断言对应就健康） |
| `werewolf-agent-picker-login-navigation` | P1 | ✅ 中：`url.matches: "/login"` | URL 子串匹配，server-truthful |
| `werewolf-agent-picker-login-link` | P1 | ⚠️ 弱：`contains_text: ["Login"]` | "Login" 单词较通用，建议改用 selector 锁定到 picker 内的 login link |

#### Navigation Redirect 子组（URL 断言精确）

| 契约 ID | 严重度 | 断言 | 备注 |
|---|---|---|---|
| `matches-open-replay-link-navigates` | P1 | `url.matches: "/replay/[^/]+$"` | 强：测路径模式 |
| `match-replay-redirects-when-legacy-disabled` | P2 | `url.matches: "^/$"` | 强（但缺 precondition，见 Group E） |
| `agents-edit-redirects-when-legacy-disabled` | P2 | `url.matches: ^/$` | 同上 |
| `route-table-redirect-when-disabled` | P1 | `url.matches: ^/$` | 同上 |

#### Specific-String UI 子组（用具体中文文案做 needle）

| 契约 ID | 严重度 | 断言 |
|---|---|---|
| `invite-http-agent-copies-to-clipboard` | P1 | `contains: "已复制 HTTP Agent 邀请文案到剪贴板"` ✅ 长 needle 难误中 |
| `invite-http-clipboard-fallback-shows-text` | P2 | `contains: "邀请已生成,自动复制失败"` ✅ |
| `invite-popover-coding-api-error-toast` | P2 | `contains: "邀请生成失败"` ✅ |
| `invite-popover-coding-generates-invite` | P1 | `contains: "已复制 Coding Agent 邀请文案到剪贴板"` ✅ |
| `home-route-shows-loading-state` | P2 | `contains: "加载中…"` ✅ — SUT 是中文产品，i18n hallucination 警报作废 |

#### 中度 KEEP（弱断言但可接受）

| 契约 ID | 严重度 | 备注 |
|---|---|---|
| `audience-strip-shows-watching-count` | P2 | `contains: "watching" + "AUDIENCE"` 比单字符强，但应进一步加数字断言 |
| `table-preset-amount-clears-error` | P2 | `not_contains: "Invalid amount"` — 弱（依赖之前页面状态），建议加 baseline |
| `agent-endpoint-url-persists-on-edit` | P2 | `contains: "Endpoint"` — 太弱，"Endpoint" 可能只是 label。建议加 input.value 断言（同 Group D 的 agent-name 问题） |

---

## 🌐 Meta-Findings：5 个反模式（沿用 CONTRACT_GAPS.md 的 G1-G17）

| ID | 反模式 | 本次出现次数 | G-Ref |
|---|---|---|---|
| **M1** | DOM-after-HTTP silent pass | 20 | 新增（应归为 G18）|
| **M2** | NO_EXPECTED（schema-invalid） | 6 | 新增（应归为 G19）|
| **M3** | ROLE_COUNT_ONLY（只测元素存在） | 8 | G15 + G16 杂交 |
| **M4** | VACUOUS（单字符断言） | 5 | G17 |
| **M5** | 隐藏 precondition（legacy flag） | 3 | G13 |

**建议在 CONTRACT_GAPS.md 中新增**：
- **G18：HTTP action 必须用 http 断言**（不能用 dom）
- **G19：每条契约必须有可执行的 expected 块**（spec lint 强制）

---

## 🎯 优先级 Action 矩阵

### 🔥 本周必做（P0 安全契约的 silent pass）

1. **修 runner DSL**：让 `dom.*` 用在 `http` action 后**报错而非 silent pass**——这是根治 20 条 silent pass 的关键
2. **补 5 条 NO_EXPECTED 契约**：
   - 🚨 `api-tables-remove-agent-requires-auth` (P0)
   - `api-tables-create-validates-schema`、`api-auth-register-validates-input` 等 4 条 P1/P2
3. **REWRITE 8 条 P0/P1 安全契约（dom → http）**：
   - 数据脱敏：`api-decision-trace-strips-private-fields` 等 5 条
   - CSRF：`api-me-werewolf-agents-create-requires-csrf`、`simulate-requires-csrf-token`、`api-werewolf-invite-npc-requires-csrf`
   - 鉴权：`api-tables-hand-replay-requires-auth`、`delete-agent-requires-auth`

### ⚠️ 本月必做

4. **REWRITE 剩余 12 条 P1/P2 API 契约**（同 Group A 模板）
5. **REPLACE 10 条 DROP 但功能有价值的契约**（lobby filter / replay timeline / hand select 等）
6. **STRENGTHEN 8 条 Group D 契约**（加 value / state 断言）
7. **补 3 条 Group E 的 precondition**（legacy_modules flag）

### 💡 持续优化

8. **REWRITE 4 条 audience reaction 契约**（用结构式契约一条覆盖所有 reaction）
9. **统一 agent picker 三条契约的关系**（沿用原 § A3 建议）
10. **agent-endpoint-url-persists-on-edit / table-preset-amount-clears-error 加 value 断言**

---

## 📎 附录 A：本次审查与上次（intent-judge-decisions.txt）的差异

| 维度 | 上次（67 条 txt） | 本次（68 条 HTML） |
|---|---|---|
| 数据源 | 简单 tab-separated 决议 | 富信息 HTML（含 productAssertion + duckReason + sourceYaml）|
| 验证产品需求 | 推测 | 直接对照 productAssertion |
| 验证 spec | 部分抽样 | 全部 68 条系统化扫描 |
| 发现的 NO_EXPECTED | 1（提到 api-auth-register） | 6 |
| 发现的 dom-after-http | ~20 | 20（精确计数）|
| 发现的 role-count-only | 未单独识别 | 8（新增类别） |
| 主要新发现 | 整体反模式 | **G18 HTTP/DOM 分离 + G19 强制 expected** |

## 📎 附录 B：已被本次审查作废 / 修正的旧警报

| 旧警报 ID | 原内容 | 现状 |
|---|---|---|
| § A1（参数名 returnTo vs next 不一致） | 担心是真 bug | ✅ **作废**：实际实现统一用 `next`，旧契约文档中的 "return URL" 只是英文标题翻译，不是参数名 |
| Meta-Finding M5（hallucination "加载中…"） | 担心是 i18n hallucination | ✅ **作废**：invite-* 系列契约用了多条具体中文文案 needle，SUT 确实是中文产品 |

---

## 🦆 一句话总结

> "decision-page 这 68 条契约**有 46% 存在 spec 缺陷**，最严重的两类是：
> ① **20 条 API silent pass（dom-after-http）** —— 包括多条 P0 安全契约一直在裸奔
> ② **6 条契约根本没 expected 块** —— 包括 1 条 P0
>
> 但好消息也有：**14 条契约是真正可信的（21%）**，特别是 login flow 那一组 URL 断言精确、auth_state 双断言、长 needle 中文文案的契约都很健康。
>
> 老板执行优先级：先修 runner DSL（让 dom-after-http 报错而非 silent pass），再 REWRITE 8 条 P0/P1 安全契约，再补 5 条 NO_EXPECTED，这是堵漏的最短路径。"
