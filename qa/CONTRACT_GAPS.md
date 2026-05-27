# 契约补充清单 / Contract Gaps Checklist

> 本文档由 Chinese Cute CEO Duck 🦆 在契约讲解过程中**自动整理**，
> 记录每条已存在契约旁边**应该补但还没补**的兄弟契约 / 配套契约 / 安全护栏。
>
> **用法**：老板审查完现有契约后，按本清单**统一补齐**。
> **同步规则**：本鸭每讲一条新契约、发现新 gap，会**实时 append** 到本文件相应位置。

- **首版日期**：2026-05-26
- **维护者**：Chinese Cute CEO Duck 🦆
- **状态图例**：🚨 红色警报 / ⚠️ 必补 / 💡 建议 / ✅ 已补齐

---

---

## 📦 批量审查：Poker Intent-Judge Decisions（2026-05-26）

**数据源**：`qa/eval/poker/run-log/intent-judge-decisions.txt`（67 条契约）
**审查方式**：CEO Duck 🦆 模式 — 在 intent-judge 自动判定基础上做 override
**关键 meta 发现**：5 个系统性反模式，详见下方 M1-M5

### Meta-Finding M1 🚨：DOM-after-HTTP Silent Pass Crisis（约 20 条 API 契约全中）

**已确认证据**（来自 `api-me-werewolf-agents-create-requires-csrf.yml` review notes）：
> *"weak-pass (flags: dom-after-http). Assertion was schema-ignored or evaluated against wrong page; the PASS was a silent / coincidental match. Phase B drift pattern."*

**模式**：API 契约用 `expected.dom.contains_text` / `not_contains_text` 去断言 HTTP-only 接口（POST / GET /api/...）的响应。HTTP 请求**不渲染 DOM**，断言被对"上一次页面状态"求值，**结果是巧合性 pass/fail**。

**Intent-judge 判定**：KEEP（"intent valid，only DSL gap"）
**本鸭判定**：**KEEP-INTENT + 强制 REWRITE-SPEC**
- 仅 KEEP 而不 REWRITE = 这些契约**事实上一直在 silent pass**，覆盖率虚高
- 必须把所有 dom 断言改成 http 响应断言

**影响范围（20 条契约，全需 REWRITE）**：
```
api-agent-invites-register-invalid-token
api-agent-invites-revoke-hash-not-found
api-decision-trace-returns-404-for-missing-match
api-decision-trace-strips-private-fields
api-matches-decision-trace-returns-match-not-found
api-matches-get-excludes-sensitive-fields
api-matches-get-not-found-invalid-id
api-matches-list-excludes-seed
api-me-werewolf-agents-create-requires-csrf
api-me-werewolf-agents-create-validates-body
api-tables-add-agent-validates-adapter-type
api-tables-get-hand-validates-hand-belongs-to-table
api-tables-get-hand-validates-table-exists
api-tables-hand-replay-requires-auth
api-tables-watch-not-found-invalid-table
api-werewolf-invite-npc-requires-csrf
api-werewolf-match-get-strips-seed
api-werewolf-matches-strips-seed
delete-agent-requires-auth
simulate-requires-csrf-token
simulate-validates-request-schema
```

**通用 REWRITE 模板**：
```yaml
# 错误的（当前）：
expected:
  dom:
    not_contains_text: ["agentId"]

# 正确的：
expected:
  http:
    status: 403            # 或 200 / 404 等具体码
    body:
      not_contains_keys: ["agentId"]   # JSON 字段级断言
      # 或更精确：
      json_schema_excludes: ["agentId", "seed", "privateStateHash"]
    headers:
      content-type: "application/json"
```

**Action**：
- [ ] 修复 runner DSL：让 `dom.contains_text` 用在 http action 后**报错而非 silent pass**（**根治这个问题的关键**）
- [ ] 引入 `http` 断言族（status / body / headers / cookies）
- [ ] 上述 20 条契约逐个 REWRITE，把 dom 断言改成 http 断言

---

### Meta-Finding M2 🚨：Tautological Click-Then-Assert（镜子断言）

**模式**：click 一个带名字"X"的按钮 → 断言 dom contains "X"。按钮文本必然在 DOM 里，**这种断言永远 pass，无关功能是否真的 work**。

**已验证案例**：
- `werewolf-lobby-recent-tab-filters-completed-games`: click "RECENT" → 断言 "RECENT" exists
- `werewolf-lobby-tab-featured-active-state`: click "FEATURED" → 断言 "FEATURED" exists（推测）
- `werewolf-lobby-tab-live-filters-games`: click "LIVE" → 断言 "LIVE" exists（推测）
- `match-replay-tab-switch-to-replay`: click "REPLAY" → 断言 "REPLAY" exists（推测）

**Intent-judge 判定**：DROP（reason 备注是 "title-says-keyboard-but-no-key-action"，但本鸭认为真实问题是镜子断言，judge 的 reason 备注与实际问题不完全吻合）
**本鸭判定**：✅ 同意 DROP，但 reason 应改为 "G17 vacuous assertion / tautological click-then-assert"

**REPLACE 建议**：每条都应该测**点击后实际筛选效果**，比如：
```yaml
# 错误的：
- click tab "RECENT" → assert contains "RECENT"

# 正确的：
- capture: initial_list_signature   # 例如列出所有 game 的 status
- click tab "RECENT"
- wait_for_network_idle
- expected:
    list:
      every_item:
        status: in ["completed", "ended"]   # 真正测筛选效果
      not_signature_equal: ${initial_list_signature}  # 列表确实变了
```

---

### Meta-Finding M3 🚨：N-Char Vacuous Assertion 群（与已 DROP 的 fire-reaction 同款）

**模式**：用 `contains_text: "<short>"` 测计数器，与 § A7 一模一样。

**Intent-judge 判定**：全部 KEEP（"default-keep: sharp body + self-consistent + has assertion"）
**本鸭判定**：**REWRITE 全部，否则 DROP**——CEO 鸭模式启发式抓不到 G17

**影响契约（6 条）**：
| 契约 ID | 断言 |
|---|---|
| `audience-react-clap-multiple-clicks` | 3 次 click → `contains_text: "3"`（已抽样确认） |
| `audience-react-heart-increments-count` | 推测同款（heart + 计数） |
| `audience-react-heart-independent-counts` | 推测同款（多 reaction 独立计数） |
| `audience-wolf-reaction-increment` | 推测同款（wolf reaction + 计数） |
| `audience-wolf-reaction-initial-zero` | 测初始值 = 0，但"0"字符也几乎全场都有 |
| `audience-strip-shows-watching-count` | 测观战人数，但"count"是数字，全页都有数字 |

**Action**：
- [ ] 全部 REWRITE 套用 § A7 的 REWRITE 模板（baseline + scoped + 算术不变量）
- [ ] 考虑用**一条结构式契约**覆盖所有 reaction（G12 反模式），而不是每个 emoji 一条

---

### Meta-Finding M4 🚨：Empty Contains Text Group（极端 G17）

**模式**：`contains_text: []`（空数组），字面上**不断言任何东西**。

**Intent-judge 判定**：DROP（reason: "weak:empty-contains-text"）
**本鸭判定**：✅ 同意 DROP

**影响契约（4 条）**：
- `lobby-seed-input-accepts-optional-value`（已抽样确认 `contains_text: []`）
- `replay-hand-select-button-updates-view`（推测同款）
- `replay-next-button-advances-timeline`（推测同款）
- `replay-street-filter-resets-on-hand-change`（推测同款）

**REPLACE 建议**：每条都应该有**具体的"应该发生什么变化"**的断言：
- seed input → 断言 input value 真的被设置了，且后续动作（开始游戏）使用了 seed
- hand-select-button → 断言 view 区域内容**真的换了**（用 diff signature）
- next-button → 断言 timeline 进度索引 +1，且显示新内容
- street-filter → 断言 filter 状态被 reset 到默认（hand 切换后）

---

### Meta-Finding M5 🚨：Hallucination Group（虚构 UI 的契约）

**模式**：autopilot 生成了**产品里根本不存在**的 UI 元素 / 路径 / 文案的契约。Review notes 直接标 "Likely hallucination"。

**已发现的标志性问题**：
- `home-route-shows-loading-state` → 断言中文 "加载中…" 但 SUT 是英文环境（i18n hallucination）
- `confirm-dialog-cancel-closes-dialog` → `paths=[]` 在 SUT 源码中找不到证据
- `audience-react-clap-multiple-clicks` → SUT 里找不到任何"React 👏"按钮证据
- `check-action-button-visible-when-legal` → `paths=["/table/test-table"]` 但无证据

**Intent-judge 判定**：部分 KEEP / 部分 DROP（不统一）
**本鸭判定**：**任何 review note 含 "hallucination" 的契约都应 DROP-PENDING-VERIFICATION**——先标待删，去 SUT 源码 grep 一下，确认真的没有就删
**Action**：
- [ ] grep SUT 源码确认元素 / 路径 / 文案是否存在
- [ ] 存在但功能没实现 → 视为 future spec（保留并标 `status: future`）
- [ ] 不存在 → DROP

---

### Per-Contract Decisions Table（67 条全量）

> 图例：✅ 同意 / ⚠️ 部分同意 / ❌ 反对 / 🔄 需要更深入审 / 🆕 新建议
> 默认遵循 intent-judge，仅在我有 override 时标注

#### Group A: API 契约（dom-after-http 大群 — 全部 REWRITE）

| 契约 ID | Judge | 本鸭 | 备注 |
|---|---|---|---|
| api-agent-invites-register-invalid-token | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-agent-invites-revoke-hash-not-found | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-decision-trace-returns-404-for-missing-match | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-decision-trace-strips-private-fields | KEEP | ⚠️ KEEP+REWRITE | M1，且这是**P0 安全契约** silent pass |
| api-matches-decision-trace-returns-match-not-found | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-matches-get-excludes-sensitive-fields | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| api-matches-get-not-found-invalid-id | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-matches-list-excludes-seed | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| api-me-werewolf-agents-create-requires-csrf | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| api-me-werewolf-agents-create-validates-body | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-tables-add-agent-validates-adapter-type | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-tables-get-hand-validates-hand-belongs-to-table | KEEP | ⚠️ KEEP+REWRITE | M1，IDOR 关键 |
| api-tables-get-hand-validates-table-exists | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-tables-hand-replay-requires-auth | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-tables-watch-not-found-invalid-table | KEEP | ⚠️ KEEP+REWRITE | M1 |
| api-werewolf-invite-npc-requires-csrf | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| api-werewolf-match-get-strips-seed | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| api-werewolf-matches-strips-seed | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| delete-agent-requires-auth | KEEP | ⚠️ KEEP+REWRITE | M1 |
| simulate-requires-csrf-token | KEEP | ⚠️ KEEP+REWRITE | M1，P0 |
| simulate-validates-request-schema | KEEP | ⚠️ KEEP+REWRITE | M1 |

#### Group B: API 契约（已是 invariant 标签，但本鸭仍要求审查 body 实现）

| 契约 ID | Judge | 本鸭 | 备注 |
|---|---|---|---|
| api-tables-create-validates-schema | KEEP（invariant） | 🔄 NEEDS-INSPECTION | 是否也 dom-after-http？需打开 spec 核 |
| api-tables-remove-agent-requires-auth | KEEP（invariant） | 🔄 NEEDS-INSPECTION | 同上 |
| api-werewolf-games-create-validates-name-length | KEEP（invariant） | 🔄 NEEDS-INSPECTION | 同上 |
| api-auth-register-validates-input | KEEP（invariant） | ⚠️ KEEP+REWRITE | **已抽样：spec 里完全没有 `expected` 字段** — schema-invalid，必须补 |

#### Group C: 导航 invariant（KEEP，但部分有隐藏风险）

| 契约 ID | Judge | 本鸭 | 备注 |
|---|---|---|---|
| appshell-login-navigates-to-login-page | KEEP | ⚠️ KEEP+审查 | 是否带 returnTo？见 § A1 |
| login-page-respects-next-param-redirect | KEEP | ⚠️ KEEP+审查 | 参数名 `next` vs `returnTo`，见 § A1 |
| logout-clears-session-and-redirects | KEEP | ⚠️ KEEP+REWRITE | 复合契约，见 § G7 拆分建议 |
| werewolf-agent-picker-login-link | KEEP | ⚠️ 见 § A3 | agent picker 三条契约重叠 |
| werewolf-agent-picker-login-navigation | KEEP | ⚠️ 见 § A3 | 同上，且是低密度契约 G9 |
| agents-edit-redirects-when-legacy-disabled | KEEP | ⚠️ 见 § A5 | deprecation 契约族待补 |
| match-replay-redirects-when-legacy-disabled | KEEP | ⚠️ 同上 | deprecation 族 |
| matches-open-replay-link-navigates | KEEP | 🔄 NEEDS-INSPECTION | 已抽样：spec 是 schema-invalid（"Expected string, received object"），需修 |
| route-table-redirect-when-disabled | KEEP | ⚠️ 见 § A5 | deprecation 族 |

#### Group D: DROP 决定（本鸭审查）

| 契约 ID | Judge | 本鸭 | 备注 |
|---|---|---|---|
| api-werewolf-start-host-only | DROP（weak:trivial-url-regex） | ⚠️ DROP+REPLACE | **重要 domain rule** "only creator can start"，DROP 之前必须**补一条正经契约**接替（见 § "Only the game creator can start a werewolf game" 章节）|
| werewolf-agent-picker-requires-login | DROP（标题党） | ✅ 同意 DROP | G15 标题党 — 已在 § A3 涉及 |
| all-in-button-disabled-while-submitting | DROP（标题党） | ✅ 同意 DROP，见 § D1 / § A6 | 首例 DROP，已记录 |
| audience-reactions-start-at-zero | DROP（weak:noise-needles-only） | ✅ 同意 DROP | M3 同款 G17 |
| check-action-button-disabled-while-submitting | DROP（标题党） | ✅ 同意 DROP | 与 all-in 同款，详见 § A6 |
| lobby-seed-input-accepts-optional-value | DROP（weak:empty-contains-text） | ✅ 同意 DROP | M4，且应补 REPLACE 契约 |
| raise-slider-shows-validation-error | DROP（weak:noise-needles-only） | ⚠️ DROP+REPLACE | raise slider 校验是有价值的，需补正经契约 |
| replay-hand-select-button-updates-view | DROP（weak:empty-contains-text） | ⚠️ DROP+REPLACE | M4，且 hand select 是核心功能，要补 |
| replay-next-button-advances-timeline | DROP（weak:empty-contains-text） | ⚠️ DROP+REPLACE | M4，timeline 推进是核心 |
| replay-street-filter-resets-on-hand-change | DROP（weak:empty-contains-text） | ⚠️ DROP+REPLACE | M4 |
| werewolf-lobby-recent-tab-filters-completed-games | DROP | ✅ 同意 DROP+REPLACE | M2 镜子断言；filter 功能是有价值的，需补 |
| werewolf-lobby-tab-featured-active-state | DROP | ✅ 同意 DROP | M2（推测）|
| werewolf-lobby-tab-live-filters-games | DROP | ✅ 同意 DROP+REPLACE | M2（推测），filter 功能要补 |
| match-replay-tab-switch-to-replay | DROP | ✅ 同意 DROP+REPLACE | M2（推测），tab 切换功能要补 |

#### Group E: KEEP-default 但实际是 G17 vacuous（本鸭反对 KEEP）

| 契约 ID | Judge | 本鸭 | 备注 |
|---|---|---|---|
| audience-fire-reaction-increment | KEEP | ❌ REWRITE/DROP | § A7 已记录 |
| audience-react-clap-multiple-clicks | KEEP | ❌ REWRITE/DROP | M3，同 fire 模式 |
| audience-react-heart-increments-count | KEEP | ❌ REWRITE/DROP | M3 |
| audience-react-heart-independent-counts | KEEP | ❌ REWRITE/DROP | M3 |
| audience-strip-shows-watching-count | KEEP | ❌ REWRITE/DROP | M3 |
| audience-wolf-reaction-increment | KEEP | ❌ REWRITE/DROP | M3 |
| audience-wolf-reaction-initial-zero | KEEP | ❌ REWRITE/DROP | M3，"0"也是单字符 |
| home-route-shows-loading-state | KEEP | ❌ DROP-PENDING | M5 hallucination：中文 "加载中…" 在英文 SUT |
| check-action-button-visible-when-legal | KEEP | ❌ DROP-PENDING | M5：`paths=["/table/test-table"]` 但无 SUT 证据 |
| confirm-dialog-cancel-closes-dialog | KEEP | ❌ DROP-PENDING | M5：`paths=[]` 无证据 |

#### Group F: KEEP-default 看起来合理（建议保留但仍需审查）

| 契约 ID | Judge | 本鸭 | 备注 |
|---|---|---|---|
| appshell-invite-button-close-toggle | KEEP（weak signal） | 🟡 KEEP+STRENGTHEN | § G16 Toggle 半边 |
| agent-endpoint-url-persists-on-edit | KEEP | ⚠️ 见 § A5 | legacy 前置条件未声明 + § Edit agent 区段所有 gap |
| agent-name-persists-on-edit-load | KEEP | ⚠️ 见 § A5 | 同上 + § A4 用词不一致 |
| invite-http-agent-copies-to-clipboard | KEEP | 🔄 NEEDS-INSPECTION | 剪贴板交互复杂，需看 spec 怎么测的 |
| invite-http-clipboard-fallback-shows-text | KEEP | 🔄 NEEDS-INSPECTION | 同上 |
| invite-popover-coding-api-error-toast | KEEP | 🔄 NEEDS-INSPECTION | toast 测试通常空洞，需审 |
| invite-popover-coding-generates-invite | KEEP | 🔄 NEEDS-INSPECTION | 生成动作的测法关键 |
| table-preset-amount-clears-error | KEEP（weak signal） | 🔄 NEEDS-INSPECTION | layout 耦合警告 |
| table-preset-amount-sets-bet-value | KEEP（weak signal） | 🔄 NEEDS-INSPECTION | 同上 |
| werewolf-room-wrapped-in-app-shell | KEEP | 🔄 NEEDS-INSPECTION | "wrapped in app shell" 怎么测的？|

---

### 批量审查总结

| 类别 | 数量 | 占比 |
|---|---|---|
| ⚠️ KEEP+REWRITE（必须重写 spec） | 21 | 31% |
| ❌ 反对 KEEP，应 REWRITE 或 DROP | 10 | 15% |
| ✅ 同意 DROP | 8 | 12% |
| ⚠️ DROP+REPLACE（DROP 但需补正经契约） | 6 | 9% |
| 🔄 NEEDS-INSPECTION（需打开 spec 才能定） | 10 | 15% |
| 🟡 KEEP+STRENGTHEN | 1 | 1.5% |
| ⚠️ KEEP+审查（含跨契约 gap） | 11 | 16% |

**最严重发现**：**约 21 条 API 契约一直在 silent pass**（M1），包括多条 P0 数据脱敏 / CSRF / IDOR 关键安全契约。**这是契约库当前最高优先级的 fix**——因为它们看起来在守护，实际啥都没守。

**下一步建议**：
1. 🚨 **本周必做**：修复 runner DSL，让 `dom` 断言用在 `http` action 后报错而非 silent pass
2. 🚨 **本周必做**：M1 的 21 条 P0/P1 安全契约全部 REWRITE 为 http 断言
3. ⚠️ **本月必做**：Group D + Group E 的 ~20 条做 DROP 或 REWRITE
4. 💡 **持续**：Group F 的 NEEDS-INSPECTION 逐条审查

---

## 🚨 红色警报区（最高优先级，可能是真 bug）

### A1. 登录流参数名不一致（**疑似真 bug**）

| 涉及契约 | 用的参数名 |
|---|---|
| `Login button navigates to login page with return URL` | `returnTo` |
| `Login page redirects authenticated users to next param destination` | `next` |

**风险**：如果代码实现确实是按契约字面写的，前端送 `returnTo`、后端读 `next`，**整套 return URL 机制根本不 work**——用户登录后永远跳默认页，深链 / 分享 / 营销链接全部失效，且没有任何报错。

**待办**：
- [ ] grep 代码确认实际使用的参数名
- [ ] 统一为同一个名字（推荐 `returnTo` 或 `next`，二选一并写入项目规范）
- [ ] 更新所有相关契约保持参数名一致
- [ ] 考虑引入"契约组（Contract Group）"机制（见 § 跨 Endpoint 通用建议）

### A7. 弱断言契约：`audience-fire-reaction-increment`（**建议 REWRITE / 否则 DROP**）

**问题**：断言只查 `contains_text: "2"`——一个**单字符**几乎在任何 poker 观战页都已存在（玩家数 / 桌号 / 时间戳 / 底池 / 倍率 / 倒计时 / 玩家名），导致**按钮完全废了也会 pass**。

**完整罪状清单**（详见对话）：
1. `contains_text: "2"` 是 silent pass 核武器，全页几乎肯定有"2"字符
2. 标题"increments on click"（单数）vs spec 双击，行为语义轻度矛盾
3. 没 baseline——假设 count 起点是 0
4. 断言无 scoping，"2"出现在哪里都算 pass
5. 没考虑反作弊 / rate limit / debouncing 的生产实现
6. 缺 preconditions / wait / goto / scope

**CEO 鸭模式 vs 本鸭判定分歧**：
- CEO 鸭模式：KEEP（sharp body + self-consistent + has assertion）
- 本鸭：⚠️ REWRITE / DROP — 启发式抓不到"断言空洞"问题

**REPLACE 建议**：见对话中"REWRITE 版本"草稿（含 baseline 捕获、scoped 断言、算术不变量验证）

**Action items**：
- [ ] DROP 或 REWRITE 本契约
- [ ] CEO 鸭模式的 default-keep 启发式增加"断言有效性"评估维度
- [ ] 全契约库 grep `contains_text: "<短字符>"` 找出类似弱断言

---

### A6. 标题党契约：`all-in-button-disabled-while-submitting`（**已判 DROP**）

**问题**：标题宣称"按钮被禁用"，spec 的 `expected` 实际只检查 `contains_text: "Submitting"`——**方向完全相反，不测它声称要测的东西**。

**完整罪状清单**（详见对话记录）：
1. 标题与断言不匹配（dom 完全无 button 状态检查）
2. preconditions 仅 `auth_state: logged_in`，缺"用户在游戏中""轮到该用户""有筹码"等
3. 无 `wait_for` / `eventually` → race condition 假阴假阳
4. `goto /table` 路径在生产路由不存在（应是 `/tables/:tableId`）
5. 标着 `area: core, severity: P1` 但实际啥都不测，**拉高 P1 虚假覆盖率**

**判定**：CEO 模式 DROP ✅ 本鸭同意

**REPLACE 建议**：
- 写一条**真正断言 `button[disabled]` 状态**的结构式契约（覆盖所有 player action 按钮）
- 配对一条**服务端 Idempotency-Key 去重**契约（见 G14 双层防御）
- 见对话中 "替代契约 A / B" 草稿

**Action items**：
- [ ] 把当前契约从契约库删除 / 归档
- [ ] 撰写并提交结构式 disable 契约（草稿见对话）
- [ ] 撰写并提交服务端 idempotency 契约
- [ ] 全契约库 grep 类似"标题党"模式（标题措辞强、spec 断言弱），见 G15

---

### A5. 之前所有 Edit agent 契约有**隐藏的 legacy 前置条件**

**触发证据**：`Agent edit route redirects to home when legacy modules disabled` 这条契约揭示了 agent 编辑功能受 `legacy_modules` feature flag 控制。

**涉及契约**：
- `Agent endpoint URL is pre-filled when editing existing agent`
- `Agent name field is populated when editing existing agent`
- （未来可能还有更多 per-field 契约）

**风险**：
- 这些契约**字面没说**有 `legacy_modules == true` 这个前置条件
- 测试环境若 legacy off → 契约根本没被执行，但报告显示"passing"（**虚假覆盖率**）
- 新开发不知道前置条件，可能误投入精力到正被弃用的功能上
- 部署改变 legacy 默认值 → 契约假阳性大面积爆发

**待办**：
- [ ] 所有 Edit agent 相关契约**显式声明前置条件**：`precondition: legacy_modules == true`
- [ ] CI 同时跑 legacy on / legacy off 两份测试矩阵，分别验证两组契约
- [ ] 在契约 metadata 里加 `feature_flag` 字段，统一管理
- [ ] 重新评估 Edit agent 契约族的投入产出比（正在被弃用 → 应**降低优先级**，把精力转移到 § Edit agent flow / Deprecation 子区段）

---

### A4. Edit agent 契约用词不一致（"pre-filled" vs "populated"）

**涉及契约**：
- `Agent endpoint URL is **pre-filled** when editing existing agent`
- `Agent name field is **populated** when editing existing agent`

**风险**：
- grep 不到全部相关契约（搜索 `pre-filled` 漏掉 name 那条）
- 自动化工具可能误判为不同行为
- 暗示心智模型分裂（开发可能把"populated"实现成 JS 注入，"pre-filled"实现成 SSR）

**待办**：
- [ ] 统一用词为 `pre-filled`（或 `populated`，二选一）
- [ ] 写入项目契约书写规范，禁止同义词混用
- [ ] grep 全契约库找出其他用词不统一处

---

### A3. agent picker 三条契约疑似重复 / 抽象层重叠

**涉及契约**：
- `Login link appears when agent picker requires authentication`
- `Clicking login link from agent picker navigates to login page`
- `Agent picker shows login required state for unauthenticated users`

**风险**：这三条契约**字面含义高度重叠**，可能是：
- 中性：先后两次写了同一件事（契约库虚胖）
- 恶意：为凑覆盖度故意拆细（契约质量降低）
- 善意：层次化分工（picker 元素 / 元素行为 / picker 整体状态），但需验证

**待办**：
- [ ] 去 `qa/contracts/` 翻这三条的实际 spec 文件，对比测试断言
- [ ] 如果断言重叠 → **合并 / 删除冗余契约**
- [ ] 如果层次化 → 在契约 metadata 里**显式标注层级**，并写注释说明分工
- [ ] 参考新增的 § 跨 Endpoint 建议 G10「抽象层重叠反模式」

---

### A2. Open Redirect 漏洞防护契约缺失（**OWASP A10 高危**）

涉及 endpoint：登录流的 `?returnTo` / `?next` 参数。

**风险**：攻击者构造 `https://你的产品.com/login?next=https://钓鱼站.com/fake-dashboard`，
- 受害者看到的 URL 是合法域名，警觉性低
- 登录后被服务端 302 跳到钓鱼站
- 钓鱼站伪装产品 UI 二次窃取信息

**待办（参见 § Login Flow 区段，复述于此以提高可见度）**：
- [ ] **return URL 同源白名单契约**——只接受相对路径开头（`/...`），拒绝绝对 URL、protocol-relative（`//...`）、`javascript:`、`data:`、`/path@evil.com` 等绕过技巧

---

## 📋 按 Endpoint 整理的补充清单

### Endpoint: `GET /tables/:tableId/hands/:handId/replay`（手牌回放）

**已有契约**：
- ✅ `Hand replay endpoint requires authentication`

**需要补充**：
- [ ] ⚠️ **authZ 契约**：登录用户必须有权限访问该 table（防止跨 table 越权看 replay）
- [ ] ⚠️ **handId / tableId 归属校验（IDOR）**：handId 必须真属于 tableId
- [ ] 💡 **响应脱敏契约**：replay 含玩家行为时序，需按"摊牌阶段"过滤未亮明的牌
- [ ] 💡 **rate limiting 契约**：防 replay 数据被爬虫批量抓取
- [ ] 💡 **SEO / 索引契约**：robots.txt + meta noindex（与 401 双保险）

---

### Endpoint: `DELETE /tables/:tableId/agents/:agentId`（踢 agent 出桌子）

**已有契约**：
- ✅ `DELETE /tables/:tableId/agents/:agentId requires authentication`

**需要补充（覆盖度严重不足，目前 1/8）**：
- [ ] ⚠️ **CSRF token 契约**：DELETE 是状态变更，必须有 CSRF
- [ ] ⚠️ **authZ 契约**：只能删除你有权限管理的 table 里的 agent（防跨 table 恶意删除）
- [ ] ⚠️ **tableId / agentId 归属校验**（IDOR）
- [ ] ⚠️ **状态机校验**：进行中的 hand 是否允许 DELETE，DELETE 时 agent 是否自动 fold
- [ ] ⚠️ **审计日志契约**：DELETE 必须留 audit trail
- [ ] 💡 **rate limiting 契约**：防批量删除整桌
- [ ] 💡 **幂等性契约**：第二次 DELETE 已删除资源返回 404 还是 200

---

### Endpoint: `DELETE /me/agents/:agentId`（永久删除用户名下的 agent）

**已有契约**：
- ✅ `DELETE /me/agents/:agentId requires authentication`

**需要补充（覆盖度约 11%，**`/me/` + DELETE 双重危险，强烈警报**）**：
- [ ] 🚨 **CSRF token 契约**：`/me/` 是 cookie 鉴权重灾区，CSRF 必备
- [ ] 🚨 **ownership authZ 契约**：`agentId` 必须真属于 session 用户（防 `/me/agents/<别人 id>` 删别人）
- [ ] ⚠️ **状态机校验**：进行中的 agent 是否允许删除
- [ ] ⚠️ **级联策略契约**：关联的 matches / hands / 排行榜数据如何处理（cascade / anonymize / orphan）
- [ ] ⚠️ **软删除 vs 硬删除契约**：数据保留期限、恢复窗口
- [ ] ⚠️ **审计日志契约**：删除事件留 trail
- [ ] 💡 **rate limiting 契约**：防止脚本批量删完用户所有 agent
- [ ] 💡 **幂等性契约**：第二次 DELETE 行为
- [ ] 💡 **账号注销 bulk delete 边界契约**：账号注销时如何 bulk 删，是否绕过这些契约

---

### Endpoint: `POST /werewolf-games/:gameId/start`（开始狼人杀游戏）

**已有契约**：
- ✅ `Only the game creator can start a werewolf game`

**需要补充（领域规则契约族）**：
- [ ] ⚠️ **状态机契约**：游戏状态必须是 `lobby` 才能 start（已经 in-progress 的不能再 start）
- [ ] ⚠️ **最小玩家数契约**：玩家数量 ≥ 业务最小值（如 6 人）
- [ ] ⚠️ **最大玩家数契约**：玩家数量 ≤ 上限（防 100 人塞一局）
- [ ] ⚠️ **幂等性 / 锁契约**：房主连点 5 下，不能开 5 局
- [ ] ⚠️ **lobby 冻结契约**：start 后自动 freeze lobby
- [ ] ⚠️ **CSRF token 契约**：POST 状态变更必备
- [ ] 💡 **authN 前置契约**：必须先登录（隐含但应显式）

---

### UI Component: `Audience Reactions`（观战者表情反应按钮族：🔥 / 👍 / 👏 / etc.）

**已有契约**：
- ⚠️ `Fire reaction button increments count on click`（**建议 REWRITE / 否则 DROP，详见 § A7**）

**需要补充**：
- [ ] 🚨 **重写本契约**（见 A7 REWRITE 草稿）：捕获 baseline + scoped 断言 + 算术不变量
- [ ] ⚠️ **反作弊契约族**：
  - 同一用户重复点 reaction 是否只计 1 次
  - 客户端 debouncing 契约（如 500ms 内多次点击合并）
  - 服务端 rate limit 契约
- [ ] ⚠️ **未登录用户行为契约**：匿名观战能否点 reaction？是否要求登录？
- [ ] ⚠️ **实时同步契约**：其他观战者点击后本用户 count 是否实时更新（WebSocket）
- [ ] ⚠️ **乐观更新 / 失败回滚契约**：客户端先 +1 后请求失败的处理
- [ ] 💡 **其他 reaction 按钮的结构式契约**：不要每个 emoji 一条枚举式契约（见 G12），用结构式覆盖所有 reaction
- [ ] 💡 **emoji 编码兼容契约**：跨平台 / 跨浏览器 emoji 渲染一致

---

### UI Component: `AppShell Invite Button`（app header 里的邀请按钮 + popover toggle）

**已有契约**：
- 🟡 `Clicking invite button twice closes the popover`（**KEEP 但建议 STRENGTHEN**）
  - **CEO 鸭模式判定**：sharp body + weak signal（layout 耦合）— KEEP
  - **本鸭补充**：spec 是 **Toggle 半边契约反模式**（见 G16），只测"关闭"不测"打开"
    - 按钮完全失效的实现（点击无反应）也会让本契约 pass —— **silent pass 模式**
  - **STRENGTHEN 建议**：在两次 click 之间加一条 assert，验证第一次点击后 `dialog count == 1`，让"按钮完全坏了"的实现 fail

**需要补充**：
- [ ] ⚠️ **加强本契约**：在 actions 中间加 `assert dialog count == 1`，闭合 silent pass 漏洞
- [ ] ⚠️ **preconditions 显式化**：明确"邀请"按钮可见所需条件（auth_state? 路由角色? feature flag?）
- [ ] ⚠️ **name_regex 收紧**：当前 `邀请` 会匹配"邀请记录""取消邀请"等多个按钮，建议 `^邀请$` 或加 data-attribute 定位
- [ ] ⚠️ **wait / 动画稳定性契约**：两次 click 之间加 wait，避免命中 popover 动画中间态
- [ ] 💡 **popover 其他关闭路径契约族**：Esc 键关闭 / click-outside 关闭 / 内置 X 按钮关闭（独立契约）
- [ ] 💡 **popover 打开后内容渲染契约**（不能打开后是空 popover）
- [ ] 💡 **重设计提示**：spec 与当前 popover 实现强耦合，若改 modal / sidebar 需同步 refactor

---

### UI Component: `Poker Player Action Buttons`（poker 游戏中的玩家行动按钮族：Fold / Check / Call / Raise / All-in）

**已有契约**：
- 🗑️ ~~`All-in button is disabled while action is being submitted`~~ **已 DROP**（标题党契约，详见 § A6）

**需要补充（覆盖度约 8%，**严重空白区**，且涉及真实金钱）**：

**枚举式 → 结构式重写**
- [ ] ⚠️ **结构式 disable 契约重写**：将本条契约推广为「any player action button (Fold/Check/Call/Raise/All-in) is disabled while any action submission is in-flight」，见 G12

**其他 action 按钮的并行 disable 契约（如继续枚举式写法）**
- [ ] ⚠️ Fold 按钮 disable 期间防双击
- [ ] ⚠️ Check 按钮 disable 期间防双击
- [ ] ⚠️ Call 按钮 disable 期间防双击
- [ ] ⚠️ Raise 按钮 disable 期间防双击
- （以上 4 条若用结构式契约一次性覆盖，则无需逐条）

**服务端配套契约族（🚨 高优先级 — 防 UI 绕过）**
- [ ] 🚨 **action endpoint 服务端 idempotency 契约**（同一 actionId / requestId 提交多次只生效一次）—— 见 G14
- [ ] 🚨 **action endpoint 状态机校验契约**（拒绝在错误时刻触发的 action，如 fold 之后又来 raise）
- [ ] ⚠️ **action endpoint rate limiting 契约**（防止脚本攻击）

**前端配套契约族**
- [ ] ⚠️ **loading indicator 显示契约**（disable 期间必须有 spinner / progress / 文案）
- [ ] ⚠️ **响应回来后 re-enable 契约**（成功 / 失败 / 超时三种情况都要正确恢复）
- [ ] ⚠️ **超时自动恢复契约**（如 5s 无响应 → 显示错误并 re-enable）
- [ ] ⚠️ **键盘快捷键防重复契约**（disable button 通常只防 click，键盘事件要单独防）
- [ ] ⚠️ **disabled 状态无障碍契约**（aria-disabled / 屏幕阅读器播报）
- [ ] ⚠️ **disabled 视觉样式契约**（灰化 / cursor / hover 行为）
- [ ] 💡 **网络中断 / 重连后状态恢复契约**
- [ ] 💡 **optimistic UI 更新契约**（点 all-in 后立即更新筹码显示）
- [ ] 💡 **双击 / 误操作埋点契约**

---

### Flow: `Edit agent`（编辑现有 agent 的表单流程）

> 🚨 **重要语境**：`Agent edit route redirects to home when legacy modules disabled` 揭示了
> agent 编辑功能受 `legacy_modules` feature flag 控制，正在被**弃用**。
> 这影响下面所有契约的**有效期和优先级**——建议把精力优先投入"优雅死亡"而非"功能修补"。

**已有契约**：
- ✅ `Agent endpoint URL is pre-filled when editing existing agent`（**precondition: legacy_modules == true**）
- ✅ `Agent name field is populated when editing existing agent`（**precondition: legacy_modules == true**）⚠️ 用词不一致见 § A4
- ✅ `Agent edit route redirects to home when legacy modules disabled`（deprecation 契约）
- ⚠️ **观察**：契约采用**枚举式**（一字段一条），见 § 跨 Endpoint 建议 G12 —— 强烈建议改为**结构式**（一条契约管所有字段）

**需要补充（覆盖度约 13%，进展中）**：

**表单状态契约族**
- [ ] ⚠️ **所有可编辑字段都预填契约 — 结构式优先**（除 URL、name 外还有 model / persona / strategy / maxRounds 等；建议用结构式一条覆盖所有，而不是继续枚举）—— 见 G12
- [ ] ⚠️ **read-only 字段正确标识契约**（id / 创建时间 / owner 等不可编辑字段应显示但 readonly）
- [ ] ⚠️ **未保存修改离开页面警告契约**（dirty form guard）
- [ ] ⚠️ **并发编辑保护契约**（etag / version 字段 / 乐观锁，防 lost update）

**endpoint URL 安全契约族（**🚨 高优先级，潜在 SSRF**）**
- [ ] 🚨 **协议白名单契约**（仅允许 `https://`，拒绝 `http://`、`file://`、`javascript:` 等）
- [ ] 🚨 **内网 / loopback 地址拒绝契约**（`127.0.0.1`、`localhost`、`169.254.169.254`、`10.x.x.x`、`192.168.x.x`、`172.16-31.x.x` 全部拒）
- [ ] 🚨 **DNS rebinding 防护契约**（解析后再校验 IP，不只看域名字符串）
- [ ] ⚠️ **URL 长度 / 字符上限契约**
- [ ] ⚠️ **URL 中敏感片段（token / credential）的 UI 脱敏契约**（避免预填时屏幕外泄）

**name 字段安全契约族（🚨 stored XSS 主战场）**
- [ ] 🚨 **预填时 HTML 转义契约**：name 注入到 `<input value="...">` 时必须正确转义，防止恶意 payload 立刻执行
- [ ] 🚨 **显示 name 时 HTML 转义契约**（列表 / 排行榜 / match 历史 / 观战页都要测）
- [ ] ⚠️ **name 字符白名单 / 长度上限契约**（防止 XSS payload 入库）
- [ ] 💡 **name 唯一性契约**（同一用户的 agent 不能重名 / 全系统不重名等业务规则）

**通用编辑流契约族**
- [ ] ⚠️ **authN + authZ 契约**（编辑是状态变更，且操作目标必须属于 session 用户）
- [ ] ⚠️ **CSRF 保护契约**
- [ ] ⚠️ **审计日志契约**（谁在何时改了什么字段）
- [ ] 💡 **变更摘要 / diff 展示契约**（保存前确认改了啥）
- [ ] 💡 **撤销 / 历史版本恢复契约**

**Add / Edit 一致性契约（见 G11）**
- [ ] 🚨 **add 流程 schema 与 edit 流程 schema 必须一致契约**（防止 "add 严 / edit 宽" 导致越权字段从 edit 偷渡）—— 当前 `Adding agent rejects non-mock adapter` 严格限制，但 edit 流是否也守同样规则未知

**Deprecation 契约族（🚨 高优先级 — 弃用中功能的"优雅死亡"）**
- [ ] ⚠️ **弃用提示 banner / toast 契约**：legacy off 时 302 → / **必须附带**用户可见提示（"agent 编辑功能已下线，迁移至 X"）
- [ ] ⚠️ **redirect 带来源标记契约**：跳首页时带 query param（如 `/?from=deprecated-edit`），让首页可识别并显示提示
- [ ] ⚠️ **API 层弃用契约**：底层 API（如 `PUT /me/agents/:id`）也必须遵循 legacy off 的 deprecation，否则用户用 curl / 集成方绕过路由限制依然能编辑
- [ ] ⚠️ **legacy_modules 默认值契约**：生产环境默认 on 还是 off？必须显式声明
- [ ] ⚠️ **其他 legacy 路由统一处理契约**：删除 agent / 复制 agent 等 legacy 路由是否也 redirect？
- [ ] ⚠️ **HTTP 状态码语义契约**：当前用 302（临时重定向），是否应改用 410 Gone（永久弃用，SEO 更友好）？
- [ ] 💡 **弃用时间表契约**：声明何时彻底从代码删除（迫使团队不要无限期保留 dead code）
- [ ] 💡 **弃用埋点契约**：统计还有多少人在访问 deprecated 路由，决定何时真删
- [ ] 💡 **专门的 deprecated 着陆页**：而不是粗暴跳首页，给用户清晰的"该去哪"信息

---

### Component: `agent picker`（选 agent 的 UI 组件，未登录态）

**已有契约**：
- ✅ `Login link appears when agent picker requires authentication`
- ⚠️ `Clicking login link from agent picker navigates to login page` ← **低信息密度警报**：契约只说"跳到 login 页"，**没规定带 returnTo**，等于允许实现写 `<a href="/login">登录</a>` 这种偷懒做法，导致整条转化链断裂
- 🚨 `Agent picker shows login required state for unauthenticated users` ← **疑似与上两条重复 / 抽象层不明**（见 § A3）：若是层次化（整体 state vs 单一元素），需在 metadata 显式标层；若断言重叠，应合并删除

**需要补充（affordance 契约族）**：
- [ ] 🚨 **登录链接带 return URL 契约**（**最关键 — 仍未被任何已有契约覆盖**）：链接必须是 `/login?returnTo=<当前页 URL-encoded>`，登完能回来。建议把现有的 `Clicking login link from agent picker navigates to login page` **强化或拆出新契约**：`Clicking login link from agent picker navigates to /login with returnTo set to current path`
- [ ] ⚠️ **picker 不假装可用契约**：未登录时不能让用户能点 agent 才报错，必须前置阻断
- [ ] ⚠️ **登录链接无障碍可达契约**：aria-label / 键盘焦点 / Enter 键触发 / 颜色对比度（WCAG AA）—— 现有契约说的是"clicking"，没覆盖键盘交互
- [ ] ⚠️ **链接文案明确性契约**：必须解释 why（如"登录以选择 agent"），不能只是"登录"或"点击此处"
- [ ] ⚠️ **移动端布局契约**：小屏下 picker 不能挤掉登录链接
- [ ] ⚠️ **同 tab 跳转契约**：必须是同 tab 软跳，不能 `target="_blank"` 开新 tab 打乱体验
- [ ] 💡 **登录链接视觉层级契约**：应比其他 secondary action 更突出（CTA 颜色 / 字号）
- [ ] 💡 **登录后 picker 自动更新契约**：登录回来后 picker 状态实时变成登录态展示，无需手动刷新
- [ ] 💡 **防双击 / 链接幂等性契约**：用户连点 N 下不要产生 N 次跳转 / N 个新 tab

---

### Login Flow 完整契约族（**目前覆盖度 < 20%**）

**已有契约**：
- ✅ `Login button navigates to login page with return URL`（FE）
- ✅ `Login page redirects authenticated users to next param destination`（BE）

**需要补充**：

**🖥️ 客户端 / UX 契约**
- [ ] 💡 已登录态下按钮显示契约（应显示 logout 而非 login）
- [ ] 💡 登录失败时 return URL 参数保留契约

**🌐 服务端 — Login 页面契约**
- [ ] 🚨 **return URL 同源白名单契约**（防 open redirect — **最关键的安全契约**，见 § A2）
  - 只接受相对路径（`/path`）
  - 拒绝绝对 URL、protocol-relative、`javascript:`、路径 trick（`/path@evil.com`）
- [ ] ⚠️ return URL 缺失时跳默认页契约
- [ ] ⚠️ 未登录用户看到登录表单契约

**🌐 服务端 — Login 提交契约**
- [ ] ⚠️ 登录成功后跳 return URL 契约（和现有契约对称）
- [ ] 🚨 return URL 同样要白名单（同 § A2）
- [ ] ⚠️ 登录失败信息不泄露契约（不区分"账号不存在"和"密码错"）
- [ ] ⚠️ rate limit 防爆破契约
- [ ] ⚠️ CSRF token 契约
- [ ] ⚠️ 响应中无密码哈希契约

**🌐 服务端 — Logout 契约**
- [ ] ⚠️ **server-side session 真正销毁契约**（不只是清 cookie；现有 `Clicking logout clears session and redirects to home` 只说了"clears session"，没明确 server-side session record 真被销毁）
- [ ] ⚠️ **所有相关 cookie 清理契约**（session、CSRF token、refresh token、remember-me 等都要清）
- [ ] ⚠️ **销毁与跳转的顺序契约**（必须先销毁 session 再 response 302，防止 race 导致已登录态短暂渲染）
- [ ] ⚠️ **CSRF token 契约**（防 Logout CSRF — 攻击者强制受害者下线的烦扰性攻击）
- [ ] 💡 **logout 支持 return URL 跳转契约**（当前契约写死跳首页，无法支持"登出后回到某个公开页"场景）
- [ ] 💡 **多 session 销毁策略契约**（点 desktop 的 logout 是只清这个设备 vs 清所有设备？应显式声明）
- [ ] 💡 **复合契约拆分建议**：将现有 `Clicking logout clears session and redirects to home` 拆成两条独立契约，分别测"session 清除"和"跳转目的地"，便于定位失败原因

---

## 🌐 跨 Endpoint 通用补充建议

### G1. 引入「契约组（Contract Group）」机制
将协同工作的契约**显式标记为一组**，让参数名、协议、数据格式**一改全改**：

```yaml
contract_group:
  id: "login-flow-with-return-url"
  shared_vocab:
    return_url_param_name: "returnTo"   # 单一来源
  members:
    - FE-001: "Login button puts ?{return_url_param_name} in URL"
    - BE-001: "Login page reads ?{return_url_param_name}, redirects authenticated users"
    - BE-002: "Login submit reads ?{return_url_param_name}, redirects after success"
    - BE-003: "?{return_url_param_name} must be same-origin whitelisted"
```

**好处**：避免 § A1 那类参数名漂移导致的隐形 bug。

### G2. `/me/` 类 endpoint 通用契约模板
**所有 `/me/` 前缀的 endpoint 必备**：
- authN
- ownership authZ（操作目标真属于"我"）
- CSRF（cookie 鉴权天然重灾区）
- 按方法补充：
  - GET    → 脱敏
  - POST   → schema 校验 + 业务规则
  - PUT    → schema 校验 + 状态机
  - DELETE → 状态机 + 级联 + 审计 + 幂等
- rate limit

### G3. DELETE / PUT 类 endpoint 通用契约模板
**至少 6-8 条契约**：
authN + authZ + CSRF + 状态机 + 级联 + 审计 + 幂等 + rate limit

### G4. 嵌套资源 URL 契约模板
URL 路径里出现 ≥ 2 个 ID 时，必须有归属校验契约：
- `/A/:aId/B/:bId` → 1 条契约：B 必属于 A
- `/A/:aId/B/:bId/C/:cId` → 2-3 条契约：B⊂A, C⊂B, （可显式 C⊂A）

### G5. 契约必须绑定**环境**
同一个 URL 在 fixture / staging / production **可以有完全相反的契约**（如 mock-only adapter）。
**契约文件路径或元数据中必须显式标注 `environment: fixture | staging | production`**，
防止契约被跨环境复制粘贴造成事故。

### G6. "requires authentication" 不是天花板
看到 `POST` / `PUT` / `DELETE` 仅有一条 authN 契约时，**立即怀疑契约不全**，
按 G2 / G3 模板对照补齐。

### G17. 弱断言契约 / Vacuous Assertion（空洞断言）— Silent Pass 三连之三

**反模式案例**：`audience-fire-reaction-increment`
- 断言：`contains_text: "2"`
- 问题：单字符断言在复杂 UI 上几乎 100% 自动满足（玩家数 / 时间戳 / 底池 / 桌号都含 "2"）
- 等价于：**没有断言**

**核心原则**：
> 断言必须**对'被测行为彻底失效'的实现 fail**。
> 如果断言条件在不执行任何 action 的情况下也大概率成立，它是空洞的，不守护任何东西。

**经典空洞断言模式**：
| 模式 | 例子 | 问题 |
|---|---|---|
| 单字符 / 短字符串 | `contains_text: "2"` | UI 上几乎肯定已存在 |
| 通用词 | `contains_text: "ok"` / `"加载"` / `"loading"` | 通用 UI 反复出现 |
| 非空检查 | `not_empty` | 页面只要不是空白都过 |
| HTTP 200 | `status: 200` | 不能区分"成功"和"返回错误页但状态码 200" |
| 包含某域名 | `contains_text: "yourbrand.com"` | 全站 footer 都有 |

**强化方法**：
1. **加 baseline 捕获**：测增量而非绝对值
2. **加 scope 锚定**：断言限定在具体 selector / 区域内
3. **用算术 / 结构断言**：`equals_number` / `attribute: data-count: 3` 而非字符串包含
4. **用否定断言验证 silent pass**：注释掉 action，看断言会不会还过——如果会，断言空洞

**判断 checklist**：
- [ ] 断言是单字符 / 短字符串？→ 几乎肯定空洞
- [ ] 断言不带 scope？→ 高度可疑
- [ ] 断言是字符串包含而非数值 / 结构？→ 警觉
- [ ] 不执行 action，断言会自动成立吗？→ 是 = 空洞

**Silent Pass 三连总结**（G15 / G16 / G17）：

| | 撒谎方式 | 修复成本 | 严重度 |
|---|---|---|---|
| **G15 标题党** | 主动撒谎（标题 vs 断言相反） | 必须重写 | 🔴 高 |
| **G16 Toggle 半边** | 被动撒谎（断言不全） | 加 1-2 行断言 | 🟡 中 |
| **G17 空洞断言** | 隐性撒谎（断言条件自动满足）| 重写断言 + 加 scope | 🔴 高 |

**CEO 鸭模式启发式补丁建议**：
- 当前 default-keep 启发式：sharp body + self-consistent + has assertion → KEEP
- 漏掉的维度：**assertion strength** — 断言能否真正区分"功能正常"和"功能失效"
- 建议加：「单字符断言 / 无 scope 断言」自动降级为 NEEDS-REVIEW，不进入 default-keep

---

### G16. Toggle / 状态切换契约必须**测两端**（防 Silent Pass）

**反模式案例**：`appshell-invite-button-close-toggle`
- spec 测：点 2 次后 `dialog count == 0`
- silent pass：按钮**完全失效**的实现（永远 0 个 dialog）也通过

**核心原则**：
> 任何切换类契约（toggle / open-close / show-hide / expand-collapse / focus-blur）
> **必须同时验证起点状态 + 终点状态**，否则"功能彻底失效"的实现会静默通过。

**强化模板**：
```yaml
actions:
  - assert: state_before == OFF       # 起点必须明确
  - trigger: open_action
  - assert: state_intermediate == ON  # ⭐ 关键：验证 toggle 真的有效
  - trigger: close_action
expected:
  - state_final == OFF                # 终点
```

**对比 G15 标题党契约**：
| 维度 | G15 标题党 | G16 Toggle 半边 |
|---|---|---|
| 撒谎方式 | 主动（标题 vs 断言相反） | 被动（断言不全） |
| Silent pass 范围 | 任何不符标题的实现 | 功能完全失效的实现 |
| 严重度 | 🔴 高 | 🟡 中 |
| 修复成本 | 必须重写 | 加 1-2 行断言 |
| 判定建议 | DROP + REPLACE | KEEP + STRENGTHEN |

**审查问题**：
- 这个契约能让"功能完全失效"的实现 fail 吗？
- 不能 → 是 Toggle 半边契约 / Silent Pass 反模式
- 加 1-2 个中间态断言即可修复

---

### G15. 契约审查必须**读 spec 不能只读标题** — 警惕"标题党契约"

**反模式案例**：`all-in-button-disabled-while-submitting`（见 § A6 / § D1）
- 标题：宣称按钮 disable 状态
- spec 的 expected：只检查 `contains_text: "Submitting"`
- 标题与断言**方向完全相反**

**为什么这是最危险的契约类型**：

| 契约类型 | 危险度 | 原因 |
|---|---|---|
| 缺契约 | 🟡 中 | 团队心里有数 |
| 模糊契约（G9） | 🟡 中 | 守护少但不撒谎 |
| 抽象层重叠（G10） | 🟡 中 | 凑数但单条诚实 |
| **标题党契约** | 🔴 **最高** | **看着守护一件事，实际守护另一件**，给虚假安全感 |

**审查方法（CEO 鸭模式）**：
1. 读完标题先**别相信**
2. 打开 spec，看 `expected` / 断言到底**测了什么**
3. 问自己：「**这个断言能让标题宣称的失败模式 fail 吗？**」
4. 不能 → 标题党契约，**DROP + REPLACE**

**全契约库筛查 grep 模板**：
- 标题含 `disabled / hidden / removed / required / rejected / validated` 等"动作动词"
- 但 spec 的 expected 只用 `contains_text / status_code / not_empty` 等"存在性"断言
- → 高概率是标题党，进入人工 review

**预防机制**：
- 契约 schema 校验阶段加 lint 规则：标题动词（如 disabled）必须与 expected 字段类型匹配（如 has_attribute: disabled）
- PR review 模板加一行："本契约的断言能让标题宣称的失败模式 fail 吗？"

---

### G14. 防双提交契约必须 Client + Server **双层防御**（Defense in Depth）

**反模式案例**：`All-in button is disabled while action is being submitted`
（只写了客户端 UI 防护，没有任何对应的服务端 idempotency 契约）

**核心原则**：
> 客户端 disable 只防"乖用户的手抖"，**服务端 idempotency 才防"绕过 UI 的所有路径"**。
> 任何只有客户端防护、没有服务端 idempotency 的"防双提交"都是纸糊的。

**服务端绕过路径**（客户端 disable 防不住）：
- curl / Postman 手动调 API
- 自动化脚本 / 集成方
- 浏览器扩展 / 用户脚本
- 恶意攻击者
- 浏览器 / 代理 / CDN 的自动 retry
- 移动 app 的弱网重试逻辑
- WebSocket 重连后的状态恢复重发

**双层防御契约组合模板**：
```
Client 层契约：
  - Action button is disabled while submission is in-flight
  - Loading indicator visible during submission
  - Button re-enables on success / error / timeout

Server 层契约（同一动作必备）：
  - POST /actions accepts and respects an Idempotency-Key header
  - Duplicate Idempotency-Key returns the same response as the first request
  - Without Idempotency-Key, server uses (userId + actionType + tableState) as natural key
  - Server-side state machine rejects out-of-turn actions
```

**判断规则**：每条 client 防双提交契约写出来，**立刻问"对应的 server 端 idempotency 契约在哪？"**——找不到 = 防御链断裂。

**特别警告**：涉及**金钱 / 不可逆资源**（如 poker all-in、电商下单、银行转账）的操作，**没有服务端 idempotency 契约 = 上线即事故**。

---

### G13. Feature Flag / 条件行为契约必须**显式**

**反模式案例**：
- `Agent endpoint URL is pre-filled when editing existing agent`（**字面没说**有 `legacy_modules == true` 前置条件）
- `Agent edit route redirects to home when legacy modules disabled`（弃用契约，但其他 edit 契约不知道这层关系）

**风险**：
- **虚假覆盖率**：测试环境若 flag 关闭，契约根本没执行但报告"passing"
- **隐藏依赖**：新人看契约不知背后有 flag 控制，可能误投入精力
- **配置漂移爆发**：某次部署改 flag 默认值，多条契约状态同时翻转，难溯源

**强制规则**：
1. **任何与 feature flag 行为相关的契约**，必须在 metadata 显式声明：
   ```yaml
   precondition:
     feature_flags:
       legacy_modules: true
   ```
2. **CI 跑契约测试时**，要按 flag 矩阵分别跑（如 legacy on 一份、legacy off 一份），各自报告
3. **契约 review 时**，每条契约问"它依赖哪些 flag？默认值是什么？"
4. **新增 flag 时**，必须同步审计所有契约，标注新依赖
5. **配套 metadata 契约**：每个 flag 应有自己的"默认值"契约，固化预期

**Deprecation 是 feature flag 的特殊场景**：弃用契约应额外配套
- 用户可见的弃用提示契约
- 替代方案指引契约
- 弃用时间表契约（避免无限期保留 dead code）

---

### G12. 枚举式契约 vs 结构式契约

**反模式案例**：Edit agent flow 出现的同结构 per-field 契约
- `Agent endpoint URL is pre-filled when editing existing agent`
- `Agent name field is populated when editing existing agent`
- 预计还有 model / persona / strategy / maxRounds 各一条……

**枚举式契约（Enumerative）**：每个字段 / 每个 case 一条契约
- ❌ 数量随字段线性增长
- ❌ 新加字段必须新加契约，否则**silent regression**
- ❌ 用词易漂移（见 § A4）
- ❌ 信息密度低（每条只排除少数错实现）

**结构式契约（Structural）**：用结构性断言一次性覆盖一族行为
- ✅ 数量 = 1
- ✅ schema 加字段，契约自动覆盖（**self-extending**）
- ✅ 用词集中，难漂移
- ✅ 信息密度高

**改写示范**：
```
枚举式（差）：
  - Agent endpoint URL is pre-filled when editing existing agent
  - Agent name field is populated when editing existing agent
  - Agent model is pre-filled when editing existing agent
  - ...

结构式（好）：
  Edit agent form pre-fills every field listed in the GET response,
  with field-to-field correspondence:
    response.<field> → form input named "<field>"
  for all fields in the agent schema definition.
```

**判断什么时候用枚举式**：仅当不同字段**有显著不同的语义 / 安全约束**时（例如 URL 要测 SSRF，name 要测 XSS）—— 这时枚举式才有独立信息密度，但应该聚焦在**差异**而非"预填"这件共性事。

**预防机制**：契约 review 时问"如果 schema 加字段，这条契约还能守住吗？"——答否 → 推荐改结构式。

---

### G11. Add 流程与 Edit 流程的 Schema 必须一致

**反模式案例**：
- `Adding agent rejects non-mock adapter types` 严格禁止真 adapter
- `Agent endpoint URL is pre-filled when editing existing agent` 暗示编辑流可以改 URL
- 但**没有契约说"Editing agent 也必须遵守 adapter 限制"**

**风险**：
- 攻击者用 add 流程创建合法的 mock agent → 通过 edit 流程把 adapter 改成真 adapter / 把 URL 改成内网地址
- 经典的 "Time-of-Check vs Time-of-Use" 攻击面
- Mass Assignment 漏洞的另一种表现

**原则**：
> **任何创建时被严格校验的字段，编辑时必须同样严格校验。**
> 任何不允许在创建时设置的字段，更不允许在编辑时设置。

**预防机制**：
- 创建（POST）和编辑（PUT/PATCH）应**共享同一份 schema 校验代码**（DRY），而不是各写一份
- 契约层面应有显式的 "Add / Edit schema parity contract"，断言两端校验逻辑一致
- Code review 检查清单：每次给 add 加新约束，必须问"edit 也加了吗"

**实战 grep 模式**：在契约库 grep "Adding" 或 "Creating"，看每条结果是否有对应的 "Editing" / "Updating" 契约配对。

---

### G10. 契约「抽象层重叠」反模式
**反模式案例**：agent picker 的三条契约（见 § A3）

**症状**：同一组件 / 同一 endpoint 有多条契约描述"相似的事"，但**层次关系不明**。

**追问诊断**：每对契约问以下问题：
- 它们的**断言**是否能 grep 到相同字符串模式？→ 是 = 重复
- 它们处于**不同抽象层**吗？（元素 / 行为 / 整体状态 / 性能 / 安全）→ 是 = 健康
- 删掉一条，另一条**还能独立守护**那个层面的价值吗？→ 不能 = 该条契约无独立价值

**判断决策树**：
```
两条契约描述相似行为
  │
  ├─ 断言重叠？
  │   ├─ 是 → 合并 / 删除冗余
  │   └─ 否 → 继续
  │
  ├─ 处于不同抽象层？
  │   ├─ 是 → 在 metadata 里**显式标注层级**
  │   │      （contract_layer: element | interaction | mode | regression | a11y）
  │   └─ 否 → 警觉是凑数契约，重新审视
  │
  └─ 删一条，另一条能独立守护？
      ├─ 能 → 保留两条 + 显式分工
      └─ 不能 → 删冗余
```

**预防**：契约创建时强制要求填 `contract_layer` 字段，避免事后发现重叠。

---

### G9. 警惕「Checkbox 契约 / 低信息密度契约」
**反模式案例**：`Clicking login link from agent picker navigates to login page`
（看起来覆盖了功能，实际只能排除"链接是死的"这一种错实现，**没规定 returnTo 等核心细节**）

**信息密度公式**：
```
契约信息密度 = (该契约能让多少种错实现 fail) / (描述长度)
```

**审查金标准**：每条契约问自己「**这条契约能让多少种错误的实现 fail？**」
- ≥ 5 种 → 高质量契约 ✅
- 1-2 种 → 警觉是否"摆设契约" ⚠️
- 0 种（写得太模糊以至于啥实现都过）→ 必须重写 🚨

**高密度契约的几个常用元素**：
- **具体参数 / 字段**（`returnTo=<encoded current path>` 而非"带参数"）
- **具体时间 / 数值边界**（`within 100ms` 而非"快速"）
- **具体响应码 / 状态**（`404` 而非"报错"）
- **具体路径 / 协议**（`/login` 而非"登录页"）
- **明确的否定项**（`且不开新 tab` 而非默认沉默）

**改写示范**：
```
低密度：Clicking login link navigates to login page
高密度：Clicking login link (or pressing Enter when focused) navigates 
        in the same tab to `/login?returnTo=<URL-encoded current path>`, 
        with no new tab and no client-side state lost
```

---

### G8. Affordance 契约模板（UI 元素的"可见性 / 行动指引"）
**适用场景**：任何"根据登录态 / 权限 / 状态展示不同 UI"的组件。

**必备契约组合**：
- 关键功能在不可用时**必须显示降级 UI**（如登录链接 / 升级提示），**不能消失**
- 降级 UI 必须**解释 why**（"请登录以使用此功能" 而不是只显示"登录"）
- 降级 UI 必须**带行动路径**（链接 / 按钮直达解决方案）
- 行动路径必须**带 return URL**（解决后能回到当前场景）
- 必须**无障碍可达**（aria-label / 键盘焦点 / 颜色对比度 WCAG AA）
- 必须**无前置假象**（不能让用户以为可用，点了才报错）
- 状态变化后必须**自动更新**（无需手动刷新）

**反模式信号**：
- 看到 UI 契约只说"显示 X"但不说"X 的内容 / 跳向 / 无障碍" → 契约不完整
- 看到组件设计文档说"未登录时隐藏" → 警觉，这是 affordance 反模式

---

### G7. 避免复合契约（Compound Contract）
**反模式案例**：`Clicking logout clears session and redirects to home`（一条契约同时断言两件事）

**问题**：
- 失败时难定位（哪一半失败？）
- 部分失败被掩盖（一半对一半错，整体 fail，开发可能只修一半）
- 阻碍演化（"必须跳首页"被焊死，难加 return URL 支持）

**应拆为**：
- `Clicking logout destroys server-side session`
- `Clicking logout clears all auth-related cookies`
- `Clicking logout redirects to home (or to safe return URL if provided)`

**判断规则**：契约描述里出现 "and" / "并" / "同时" / 多个动词 → 90% 是复合契约，需要拆。

---

## 📝 维护规则

- 本鸭每讲一条契约、发现 gap → **立刻 append 到本文件相应位置**
- 老板审查完后逐项打勾 / 删除 / 反驳
- 已补齐项移到底部 § 已补齐区段，保留历史
- 重大架构级发现（如契约组机制）单列章节
- 参数名 / endpoint 路径如有更新，应同步更新对应条目

---

## ✅ 已补齐 / 🗑️ 已驳回区

### 🗑️ 已驳回（DROP）

#### D1. `all-in-button-disabled-while-submitting` （2026-05-26 by CEO duck mode）
- **原因**：标题党契约 — 标题宣称按钮 disable，spec 实际只查 `contains_text: "Submitting"`，方向相反
- **完整罪状**：见 § A6
- **替代方案**：等待结构式 disable 契约 + 服务端 idempotency 契约的撰写
- **状态**：待从契约库实际删除（A6 待办列表中）

---

## 📎 附录：契约风格地图（截至当前进度）

```
契约风格地图（双世界版）
│
├─ 🌐 服务端世界
│   ├─ 第 0 层：authN（你是谁）
│   ├─ 第 1 层：CSRF（请求来源真实）
│   ├─ 第 2 层：Schema（请求内容合法）
│   ├─ 第 3 层：authZ（你能访问该资源吗）
│   ├─ 第 4 层：错误路径（4xx 优雅）
│   ├─ 第 5 层：脱敏（响应数据干净）
│   ├─ 环境隔离 / 能力封锁（mock-only 等）
│   └─ 领域规则（产品独有的玩法约束）
│
└─ 🖥️ 客户端 / UX 世界
    ├─ 导航 / 跳转契约
    ├─（隐含）UI 状态契约
    ├─（隐含）表单契约
    ├─（隐含）loading / error 状态契约
    ├─（隐含）键盘 / 无障碍契约
    └─（隐含）responsive 契约
```

---

### G18. `http` action 必须配 `expected.http` 断言（DOM-after-HTTP 强制护栏）

**来源**：2026-05-27 Stream 1（runner DSL 扩展）；根治 Meta-Finding M1 的"DOM-after-HTTP silent pass"危机。

**反模式案例**：`api-me-werewolf-agents-create-requires-csrf`（以及 M1 列出的 20 条 API 契约）
- actions 只有 `{type: http, method: POST, path: /api/...}`
- expected 写 `dom.contains_text: "csrf"` 或 `dom.not_contains_text: ["agentId"]`
- 问题：HTTP 不渲染 DOM。dom 断言被对**上一次页面状态**求值，结果是巧合性 pass。覆盖率虚高。

**护栏规则（runner 强制）**：
> 如果 `expected.dom` 被设置，`actions` 必须**至少包含一个** `goto` / `click` / `fill`。
> 否则 `compileContract` 在编译期 **throw `Error('G18: ...')`**，Layer 7 lenient loader 会把它跳过并打印明确错误。

**正确写法**：
```yaml
# API-only 契约 — 用 expected.http 断 HTTP 响应
actions:
  - { type: http, method: POST, path: /api/me/werewolf/agents }
expected:
  http:
    status: [400, 403]
    body:
      not_contains_keys: ["agentId", "seed"]
    headers:
      content-type: "application/json"
```

```yaml
# 混合契约 — DOM 断言必须配 goto/click/fill 真的让浏览器去那一页
actions:
  - { type: http, method: POST, path: /api/x }
  - { type: goto, path: /lobby }     # 这一行让 DOM 断言有意义
expected:
  http: { status: 201 }
  dom: { contains_text: ["Created"] }
```

**判断 checklist**：
- [ ] 我的 actions 全是 `http`？→ 必须用 `expected.http`，不能用 `expected.dom`
- [ ] 我的 expected 有 dom？→ actions 必须有真正的 page 操作

**Detect via lint**：`grep -rL 'type: goto\|type: click\|type: fill' qa/contracts/api/ | xargs grep -l 'dom:'`

---

### G19. 每条契约必须有**可求值**的 expected block（ExpectedBlock strict mode）

**来源**：2026-05-27 Stream 1；配合 Layer 7 lenient loader 的语义升级。

**反模式案例**：
1. `expected: {}` — 空 block，runner 永远返回 PASS（无东西可挂掉）
2. `expected: { http_status: 200 }` — 拼写错误的字段（应该是 `expected.http.status`），strict 之前会**silently 忽略**，contract 等价于"无断言"
3. `expected: { dom: { contains: ["x"] } }` — 错的 key（应该是 `contains_text`），同样 silently 忽略

**规则（schema 强制）**：
> `ExpectedBlock` 加了 `.strict()`：任何不在白名单的顶层 key
> （`url` / `localStorage` / `sessionStorage` / `cookies` / `dom` / `auth_state` / `backend_state` / `watch_keys` / `http`）
> 都会被 zod 拒绝。Layer 7 lenient loader 把它路由到 skip 而非 silent pass。

**注意**：strict 只在 ExpectedBlock 的**顶层**生效，以及全新的 `http` / `http.body` block。
历史 nested block（`dom`、`localStorage` 等）暂时保留 lenient，以避免破坏老契约 — 后续迁移见 Stream 2。

**判断 checklist**：
- [ ] expected 不是空对象 `{}`
- [ ] expected 里的每个顶层 key 都在白名单内（schema 会帮你检查；如果 contract load 失败说"unrecognized key"，就是这个）
- [ ] 至少有一个**真正会挂的**断言（不是 G17 那种空洞断言）

