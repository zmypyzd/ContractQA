# Sonnet 慢/卡 根因调查（Claude Agent SDK harness）

**日期**: 2026-05-28
**调查者**: Claude (Opus 4.7)
**触发**: 用户报告 `CONTRACTQA_LLM_MODEL=claude-sonnet-4-6` 走 autopilot deep discovery 路径时极慢甚至 100+ 分钟无结果，效果反不如 Haiku。
**相关 tuning log**: Entry 2 "Model timing finding (Sonnet excluded)"
**改动**: 本次调查仅做非侵入性探针，项目源码 0 改动。

---

## TL;DR

根因不是 Sonnet 模型本身，也不是 `max_turns` 太低 —— 是 `ClaudeAgentSDKClient.generate()`
完全没有约束 inner agent。在 discovery 形状的 prompt 下，Sonnet 把 "生成 JSON" 任务
理解成 "做 QA 工作"，进入 tool-use loop（`Read` + `Bash` + **`Task` 子 agent spawn**），
永远不收敛。Haiku 也走 tool loop，但 5-6× 更克制，能在超时前吐出结果。

---

## 假设清单（实验前）

基于 `packages/orchestrator/src/llm/claude-agent-sdk-client.ts:35-38` 的代码：

```ts
const sdkOptions: Parameters<typeof query>[0]['options'] = {
  permissionMode: 'bypassPermissions',
};
if (this.model) sdkOptions.model = this.model;
```

可能放大 Sonnet 慢的因素：

1. **不设 `cwd`** → inner agent 继承调用方 cwd → 自动加载 qa-agent 项目的
   `CLAUDE.md` + `MEMORY.md` + 100+ skill metadata + Stop hook（`laziness-self-report`）
2. **不设 `systemPrompt` / `disallowedTools`** → inner agent 拿到 CC 默认 "you are Claude Code…"
   系统提示 + 全套工具（Bash、Read、Write、Edit、Glob、Grep、`Task`、`Agent`、MCP servers）
3. **不设 `maxTurns`** → 默认上限允许 inner agent 进入近乎无限 tool loop

用户怀疑过：hook 泄露、skill 自动加载、max_turns 太低。实测哪些命中后面给。

---

## 实验设计

**目标**: 在不修改任何项目源码、不影响其他会话/进程的前提下，定位 Sonnet 慢/卡的源头。

**探针**: `/tmp/contractqa-sdk-probe.mjs`（trivial prompt）、`/tmp/contractqa-sdk-probe2.mjs`
（discovery 形状 prompt）。调用入口与 `claude-agent-sdk-client.ts:39` 完全一致：

```ts
for await (const msg of query({ prompt, options: sdkOptions })) { ... }
```

只多了：每帧的时间戳、type、stop_reason、tool_use 名称、tool_use 输入键名采集；
硬超时（90s/120s/240s）；写 `/tmp` 不写项目。

**变量**:
- 模型: Haiku 4.5 vs Sonnet 4.6
- prompt 形状: trivial（一句话 JSON 任务）vs discovery（≈复现 `interaction-discovery.ts`
  的 `buildSystemPrompt` + `FILE TREE: <真实 app 0001 79 个文件路径>` USER 段）
- cwd: inherit（继承 qa-agent 根目录的 ambient 上下文）

**目标 app**: `/Users/zmy/intership/qa-eval-fixtures/WebTestBench/web_applications/WebTestBench_0001`
（FILE TREE 取自该路径下的真实 `.tsx/.jsx/.css/.html` 文件路径列表，**不传内容**，
只传路径列表 —— 与 enumerateSurface 实际行为一致）

---

## 数据

| Probe | Model  | Prompt    | Frames | Tool calls (breakdown)            | 首帧  | 完成耗时   | 输出字符 |
|-------|--------|-----------|--------|------------------------------------|------|-----------|--------|
| A     | Haiku  | trivial   | 3      | 0                                  | 2.6s | 5.9s ✓    | 24     |
| B     | Sonnet | trivial   | 3      | 0                                  | 2.0s | 5.4s ✓    | 12     |
| C     | Haiku  | discovery | 33     | **12** (Bash 8, Read 3, Glob 1)   | 2.2s | 66.5s ✓   | 27,795 |
| D     | Sonnet | discovery | 141    | **69** (Bash 45, Read 21, **Task 3**) | 2.4s | **>240s 超时** ✗ | 0 (无 result 帧) |

**Sonnet/Haiku 在 discovery prompt 下的放大系数**:
- 工具调用: 69 / 12 = **5.75×**
- 帧数: 141 / 33 = **4.3×**
- 时间: ≥240s / 66.5s ≥ **3.6×**，实际上限是 ∞（240s 内不收敛）

**关键时间线（Sonnet probe D 节选）**:
- 0 - 2.4s: SDK init
- 4.8s - 15.6s: 22 个 `Read` 并行调用（看到 FILE TREE 真去读文件）
- 19s - 81s: 35+ 次 `Bash` 调用（在 inner cwd 里乱跑 shell）
- 64s: **第一次 `Task` 子 agent spawn**
- 110s - 144s: 又一轮 `Bash` + `Read`
- 234s: **第二次 `Task` 子 agent spawn**
- 240s: 硬超时

每个 `Task` 都是一个新的 Claude Code subagent，自带：完整 CC 系统提示 + 100+ skill metadata 加载 +
所有 MCP server 注册（claude-in-chrome, supabase, vercel）+ deferred tool 名单 + 自己的 hook 链。
理论上可以递归。tuning log 里的 "100 分钟无结果" 与这条递归路径高度一致。

---

## 根因分析（按权重）

### 1. 主因: `ClaudeAgentSDKClient` 把 inner agent 当成了完整 CC session（`claude-agent-sdk-client.ts:35-38`）

`query()` 是 Claude Agent SDK 的 high-level 接口。当不传 `disallowedTools` / `maxTurns` /
`systemPrompt` 时，inner agent 默认就是一个 **完整的 Claude Code 会话**：
- 拿到全套工具（Bash, Read, Write, Edit, Glob, Grep, **Task**, Agent, WebFetch, WebSearch, MCP 工具）
- 走 CC 默认 "you are Claude Code, Anthropic's official CLI…" 系统提示（强烈鼓励 agentic 行为）
- `maxTurns` 默认上限大到等同 "随便 loop"
- 继承调用方 `process.cwd()`，自动加载该目录下的 `CLAUDE.md` / `MEMORY.md` / hooks / skill metadata

Sonnet 是这套放大效应最大的模型：agentic 能力强于 Haiku → 看到 FILE TREE 路径就真去 `Read` →
看到任务复杂就 spawn `Task` 子 agent。Haiku 不是没有这个问题（probe C 也调用 12 次工具），
只是它的 agentic 倾向弱，会更快放弃工具去吐 JSON。

### 2. 次因: `Task` 子 agent spawn 是递归放大器

每个子 agent 加载全部 skill metadata + MCP server + hook 链。
两次 Task spawn 之间间隔 170s —— 每次都是一次重型启动。

### 3. Prompt 形状是触发条件（必要而非充分）

trivial prompt（probe A/B）下 Sonnet **比 Haiku 快**（5.4s vs 5.9s），完全无 tool 调用。
问题只在 prompt 提供 "可探索的世界"（文件路径列表）时出现。
`interaction-discovery.ts:267-305` 的 system prompt 写 "You are an expert QA engineer reading
a project" 加上 user 段的 `FILE TREE:`，Sonnet 把 "读项目" 当真，工具是它的实现路径。

### 4. 用户假设的逐项核验

| 用户的怀疑 | 实测结论 |
|----------|---------|
| hook 泄露（`laziness-self-report` 等强制 re-emit） | **不是这里**。未观测到 stop_reason 异常或重复 emit。SDK `query()` 路径上 host 端 Stop hook 不触发 inner agent —— hook 只在外层 CC session 终止时跑。 |
| skill 自动加载拖累 | 部分相关，**不是主因**。trivial prompt（probe B）下 metadata 也加载了，Sonnet 仍然 5.4s 完成。它的角色是放大 `Task` spawn 的代价。 |
| `max_turns` 太低 | **反过来**：默认 maxTurns 太宽，141 帧 / 240s 还没 stop。**降低 maxTurns 反而是解药之一**。 |

---

## 建议修复路径（按 ROI 排序）

> 本调查不改源码，只列假设修复，待用户决策。

### 1. Quick win: 强制约束 inner agent（修一处即可）

`packages/orchestrator/src/llm/claude-agent-sdk-client.ts:35-38`，假设改为：

```ts
const sdkOptions: Parameters<typeof query>[0]['options'] = {
  permissionMode: 'bypassPermissions',
  disallowedTools: [
    'Bash', 'Read', 'Write', 'Edit', 'NotebookEdit',
    'Glob', 'Grep', 'Task', 'Agent',
    'WebFetch', 'WebSearch',
  ],
  maxTurns: 1,
  cwd: mkdtempSync(join(tmpdir(), 'cqa-llm-')),
  systemPrompt: { type: 'preset', preset: 'minimal' },  // 或显式传 ''
};
```

**预期效果**: Sonnet 在 discovery prompt 下回归到 3 帧路径（system → assistant → result），
时间从 ≥240s 降到 ~6-30s 量级。
**风险**: 低。改动局限在 LLM client 内部，不影响 autopilot 业务逻辑。
**验证方式**: 复跑 `/tmp/contractqa-sdk-probe2.mjs` 的 Sonnet 变体，对比 probe D。

### 2. 更彻底: discovery 路径上强制走 `AnthropicSDKClient`

`pickClient` 已经支持 `ANTHROPIC_API_KEY` 优先返回 `AnthropicSDKClient`（直接 HTTP 调
Anthropic API，不走 Claude Code 子进程，没有任何 agent harness）。
tuning log Entry 2 已给出这条路径作为 "right escape hatch for Sonnet"。

可以让 autopilot 在启动时检测：如果模型是 Sonnet 且没设 `ANTHROPIC_API_KEY`，
打印 warning 推荐用户改用直接 SDK。

### 3. 架构层: 拆分 client 接口

当前 `LLMClient` 把 "agentic 任务" 与 "无状态 JSON 生成" 共用一个接口。
discovery 是后者，不该共用 harness。考虑拆出 `JSONGenerateClient` 子接口，
契约里禁止工具/turn loop。

---

## 实验副作用与可复现性

- **项目文件**: 0 改动（`git status` 与会话开始一致，仅前置未追踪文件不变）
- **临时文件**: `/tmp/contractqa-sdk-probe.mjs`、`/tmp/contractqa-sdk-probe2.mjs`、
  `/tmp/sonnet-probe-output.log`。ephemeral，可 `rm /tmp/contractqa-sdk-probe*` 清理。
- **其他会话/进程**: 无影响。inner SDK 调用是新进程，独立 session id，无 daemon。
- **复现命令**:
  ```bash
  # Probe C — Haiku discovery (66s)
  PROBE_MODEL=claude-haiku-4-5-20251001 PROBE_CWD=inherit PROBE_TIMEOUT_MS=150000 \
    node /tmp/contractqa-sdk-probe2.mjs

  # Probe D — Sonnet discovery (≥240s 超时)
  PROBE_MODEL=claude-sonnet-4-6 PROBE_CWD=inherit PROBE_TIMEOUT_MS=240000 \
    node /tmp/contractqa-sdk-probe2.mjs
  ```

---

## 下一步建议

1. **验证修复假设**: 在 `claude-agent-sdk-client.ts` 上加 `disallowedTools` + `maxTurns: 1` +
   `cwd=tmp` + `systemPrompt` 后重跑 Probe D。若 Sonnet 回到 3 帧 ~6-30s 范围，根因确认，
   可以 land 修复。
2. **写入 tuning log**: 修复后跑一遍 batch 1-10，更新 Entry 3（Sonnet 重新可用后的
   per-app 表现）。
3. **保留逃生阀**: 即便 fix 后，`ANTHROPIC_API_KEY` 走 direct SDK 仍应是推荐路径
   —— 没有 SDK 子进程 = 没有 transient exit code 1 + 无 harness overhead。
