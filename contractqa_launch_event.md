# 🦆 ContractQA Agent v1.0 产品发布会

**时间** 2026-05-14 北京时间 19:30
**地点** 线上直播 + 上海某 livehouse 现场 200 人
**主持** 小鸭 CEO（戴金色蝴蝶结）
**幕布** 7 米黑色 LED 墙，单色光从中央切出 contractqa logo

---

## 第 0 分钟｜冷开场

```
[灯灭。全场漆黑 5 秒]
[屏幕亮起一行小字]

  "登出之后，
   你确定真的登出了吗？"

[2 秒停顿]
[屏幕切到一段录屏：用户在 SaaS 后台点击 Logout
 → 跳转到登录页
 → 浏览器地址栏手动输入 /agents
 → 页面直接进入，依然显示个人数据
 → 屏幕右上角 localStorage 面板：sb-xyz-auth-token 仍然存在]

[现场安静]
```

🦆 **小鸭 CEO 上台，戴着耳麦，第一句话：**

> 各位老板早上好嘎。
> 这个 bug，你的工程师以为修过，QA 以为测过，CI 以为绿了。
> 但它没修。
> 因为你的测试系统看的是屏幕，不是真相。

---

## 第 3 分钟｜行业现状

```
[Slide]

  目前的 web QA 长这样：

  ┌──────────────┬─────────────────────────────────────┐
  │ Playwright   │ 写脚本的体力活，靠工程师良心覆盖     │
  │ Cypress      │ 同上                                │
  │ Mabl/Octomind│ LLM 来点击，截图，乐观地说"通过"     │
  │ qa.tech 等   │ 同上                                │
  │ Sentry       │ 等 bug 跑到生产才喊                  │
  └──────────────┴─────────────────────────────────────┘

  所有产品共同的盲区：
    ❌ 看不到 localStorage、cookie、session、WebSocket、DB 真实状态
    ❌ 把"页面没崩"等价于"操作成功"
    ❌ 找到 bug 之后无人修，等工程师周一上班
```

🦆 **小鸭 CEO：**

> 我们花了两年看完所有这些产品，得到一个观察：
> **当 LLM 既负责点击页面、又负责裁判页面，它永远在自我表扬。**
> 让 AI 既当运动员又当裁判，连人都做不到，AI 凭什么能。

---

## 第 6 分钟｜揭幕

```
[全场灯灭 1 秒]
[LED 墙铺满]

           ContractQA Agent
        ───────────────────────
        产品契约驱动的 QA 与修复平台
            v1.0   今天起内测
```

🦆 **小鸭 CEO：**

> 我们不让 LLM 当裁判。
> 我们让**产品契约**当裁判，让 LLM 当**侦探**和**修理工**。

```
[Slide 切换 — 三行公式]

   Product Contracts
 + Browser/Backend Probes
 + Claude Code Fix Loop
 = ContractQA
```

---

## 第 10 分钟｜核心理念三连击

🦆 鸭 CEO 走到舞台中央，伸出三根翅膀（不存在的翅膀）：

### 第一击：契约不是测试，是产品自己的承诺。

```yaml
# qa/contracts/auth.yml
id: INV-A2
title: Logged-out users cannot access protected routes
preconditions: { auth_state: logged_in }
actions:
  - type: click
    target: { role: button, name: /logout|登出/i }
  - type: goto
    path: /agents
expected:
  auth_state: { fully_logged_out: true }
  url: { matches: "^/login" }
```

> 你的产品经理脑子里那条"登出之后不能再访问"的规则，第一次有了它自己的家。
> 不在 README 里腐烂，不在 Notion 里被遗忘，**直接被 CI 每天验证**。

### 第二击：探针看到屏幕看不到的真相。

```
[Slide 演示 — 同一个 Logout 动作，两个视角]

  ┌─────────────────────┬──────────────────────────┐
  │ 截图眼里             │ ContractQA 眼里           │
  ├─────────────────────┼──────────────────────────┤
  │ ✅ 登录界面出现      │ ❌ localStorage 仍有     │
  │ ✅ 用户头像消失      │    sb-xyz-auth-token     │
  │ ✅ 顶栏切换正确      │ ❌ /agents 仍可直接访问  │
  │ → "通过"             │ ❌ 后端 session 仍存活   │
  │                     │ → INV-A1, INV-A2 FAIL    │
  └─────────────────────┴──────────────────────────┘
```

> 截图能拿到 8 个 Apple Design Award，
> 但你的产品照样在漏 session。

### 第三击：找到 bug 不是终点，证据 + 修复 + 回归才是。

```
[Slide 切换 — Evidence Bundle 内容速览]

  artifacts/runs/AUTH-LOGOUT-001/
    ├── issue.json
    ├── repro.spec.ts        ← Claude Code 拿这个就能跑
    ├── state-diff.json      ← 一眼看出哪个 key 没清
    ├── trace.zip            ← Playwright 时间旅行
    ├── video.webm
    └── screenshots/
```

> 每个 bug，附带一个**最小可复现 Playwright 测试**，
> 不是 LLM 写的自然语言报告，是**真能跑起来的代码**。

---

## 第 16 分钟｜Live Demo（真实演示，不是 GIF）

```
[屏幕分屏 — 左边 GitHub PR，右边 ContractQA Dashboard]
```

🦆 **小鸭 CEO：**
> 我们提前 5 分钟，让一位志愿者工程师在他的 Next.js + Supabase 项目里改了 AuthProvider。
> 现在他打开 PR。

```
[现场倒计时开始 — 5 分 00 秒]

  T+00:12  PR opened
  T+00:18  ContractQA detected auth/* diff
  T+00:23  Risk Engine 选中 12 条相关 invariants
  T+01:14  Critical-path Gate 跑完
  T+01:14  ❌ INV-A1, INV-A2 FAIL
  T+01:15  Evidence Bundle 生成完毕
  T+01:16  PR 上自动评论："2 invariants failed, evidence bundle attached"
  T+01:16  Shadow Fix Pipeline 启动（异步、不阻塞）
  T+02:48  Claude Code 修复完成
  T+02:48  自动开 fix-PR 引用原 PR
  T+03:32  fix-PR 重跑 Critical-path Gate
  T+03:32  ✅ 全部 invariants 通过
  T+03:35  评论："Auto-fix succeeded, evidence verified"

[现场鼓掌]
```

🦆 **小鸭 CEO：**
> 3 分 35 秒。
> 从 PR 提交，到 bug 发现，到证据生成，到 Claude Code 修复，到验证通过。
> 而这位工程师本人——还在喝他第一杯咖啡。

---

## 第 22 分钟｜与 LLM-as-oracle 的对决

```
[屏幕一分为二]
[左：Mabl / Octomind / qa.tech 风格的"截图+LLM 报告"]
[右：ContractQA 的契约 + state-diff + evidence bundle]

  对照项                LLM-as-Oracle       ContractQA
  ─────────────────────────────────────────────────────
  Logout 后 token       看不见              捕获 + 断言
  Multi-tab 一致性      模型猜              probe 验证
  权限边界              看 UI 按钮          路由矩阵
  False positive rate   ~35%                ≤10% (Phase 1 验收)
  Auto-fix              手工提 issue        Shadow PR 闭环
  证据可复现             Markdown 报告       可运行 .spec.ts
```

🦆 **小鸭 CEO：**
> 我们尊重所有同行的工作。
> 但 LLM-as-Oracle 这条路，本鸭 30 秒就能想出来，行业 3 年了还没走通。
> 不是模型不够聪明，是**架构选错了**。

---

## 第 26 分钟｜Phase 1 范围与定价

```
[Slide — Phase 1 内含]

  v1.0（今日起内测）：
    ✅ 4 个内置 auth provider：Supabase / Clerk / NextAuth / Auth0
    ✅ 契约引擎（基于 Playwright Test）
    ✅ Evidence Bundle + Repro Generator
    ✅ Claude Code Shadow Fix Pipeline
    ✅ Dashboard Run Overview + Issue Detail

  内测目标：5 个真实开源 Next.js 产品，已知 bug 复现率 ≥ 60%

  v1.5（Q4 2026）：
    后端探针、多浏览器矩阵、Persona Dogfood

  v2.0（2027 H1）：
    Property-based testing、自定义 Adapter API（首次开放）
```

```
[Slide — 定价]

  ┌─────────────────┬──────────────┬─────────────────────────────┐
  │ Hacker          │ Free         │ 1 repo, 50 contracts, 公开仓库 │
  │ Startup         │ $99/月       │ 5 repos, 无限 contracts        │
  │ Team            │ $499/月      │ 20 repos, fix-PR 优先级队列    │
  │ Enterprise      │ Contact      │ self-host, SSO, audit log     │
  └─────────────────┴──────────────┴─────────────────────────────┘

  内测期前 100 个用户：Startup 终身 5 折
```

---

## 第 30 分钟｜One More Thing

```
[全场灯灭]
[屏幕只剩一行白字]

   "Bug 不是被 AI 找出来的。
    Bug 是被产品自己的承诺找出来的。
    我们只是把这些承诺写下来，让它们自己说话。"
```

🦆 **小鸭 CEO 慢慢走到屏幕前：**

> 在我们做 ContractQA 的两年里，
> 我们发现一件事——
> 大多数 bug，不是因为团队不努力，
> 是因为**没人把产品想做成什么样这件事，写在一个 CI 能读到的地方**。
>
> ContractQA 不是让你测试更快。
> 是让你的产品**有 conscience**。

```
[屏幕切到最后一帧]

       contractqa.dev/beta
        invite code: DUCK
```

🦆 **小鸭 CEO：**
> 嘎嘎，散会。

```
[全场起立鼓掌，灯光全开]
[小鸭 CEO 鞠躬 3 次，从台侧叼着一杯奶茶下台]
```
