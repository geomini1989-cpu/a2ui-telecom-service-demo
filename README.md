# A2UI Telecom Service Demo

一个面向内部技术演示的 **React + A2UI v0.9.1 + DeepSeek Tool Calling + 运营商业务 Catalog** POC。

> 核心边界：**Agent 决定做什么；Skill 获取或执行业务能力；UI Policy 决定当前状态该展示什么；A2UI 负责表达 UI 和交互；React 负责最终视觉。**

## 这个 Demo 想证明什么

通通代理不必只回答文字。面对“查、选、办、异常恢复”这类任务，它可以：

1. 理解用户自然语言；
2. 自主调用只读业务 Tool；
3. 根据业务结果形成 Task Result；
4. 由 UI Planner 选择合适的界面策略；
5. 通过 A2UI 把卡片、数据和 Action 交给前端；
6. 用户继续在卡片里操作，直到任务完成。

模型不生成 React，也不决定 CSS。稳定高频业务使用 Business Catalog；长尾异常可以使用 Basic Catalog 动态组合 UI。

## 主演示故事

建议从这一句话开始：

```text
我最近刷视频流量用得特别快，月底估计顶不住，帮我推荐个适合的方案
```

完整链路：

```text
用户自然语言
  ↓
TelecomCoordinatorAgent
  ↓ getTrafficUsage
剩余流量 + 近期使用速度 + 预计额外缺口
  ↓ getTrafficPackages
候选流量包
  ↓ validateBalance（只读预检查）
推荐套餐 + 推荐理由
  ↓
UI Planner
  ↓
Business Catalog / TrafficPackageCard
  ↓ 用户点击“去确认”
A2UI Action
  ↓
Business Guard 再次 validateBalance
  ├─ 余额足够 → OrderConfirmCard
  └─ 余额不足 → Basic Catalog 动态恢复 UI
                         ↓ 看看便宜套餐
                    TrafficPackageCard
                         ↓ 改选可支付套餐
                    OrderConfirmCard
                         ↓ 确认办理
                    executeOrder
                         ↓
                    ResultCard
```

Demo 数据中：

- 当前通用流量剩余 17.5GB；
- 距周期结束约 12 天；
- 为了把“近期用量激增”场景演示清楚，近期日均按 6GB 计算；
- 预计后续需要 72GB，额外缺口约 54.5GB；
- 因此推荐可覆盖缺口的 100GB / 30天 / ¥88 套餐；
- 当前账户余额 ¥56.8，用户尝试继续办理时会触发余额不足恢复 UI；
- 点击“看看便宜套餐”后，可改选余额能够支付的套餐，例如 20GB / 30天 / ¥18；
- 余额校验通过后进入 `OrderConfirmCard`，只有明确点击“确认办理”才会执行 `executeOrder`。

这条链路同时展示 Agent、Tool Calling、Skill Observation、Task State、Business Catalog、Basic Catalog、Data Binding、A2UI Action 和交易安全边界。

## Business Catalog

高频业务 UI 由 React 提前开发并注册：

- `AccountOverviewCard` — 账户总览
- `TrafficDetailCard` — 流量详情
- `TrafficPackageCard` — 套餐选择 / Agent 推荐
- `OrderConfirmCard` — 办理确认
- `ResultCard` — 办理结果
- `BillCard` — 账单
- `AnalyticsCard` — 业务数据分析

它们的结构和样式是稳定的。Agent 不会临时写 React，而是通过 Task Result 和 UI Policy 让 A2UI 选择、绑定和更新这些组件。

## Basic Catalog

长尾状态不一定值得提前开发一张专用业务页面。

本 Demo 的余额不足场景会使用 A2UI Basic Catalog 动态组合：

```text
Card
└─ Column
   ├─ Text：余额不足
   ├─ Text：当前余额 / 套餐价格
   ├─ Divider
   ├─ Text：还差多少
   └─ Row
      ├─ Button：看看便宜套餐
      └─ Button：返回账户
```

这说明 A2UI 不只是“后端决定 React switch”。稳定场景可以走业务组件，异常或长尾状态也可以在受控 Catalog 内动态组织 UI。

## DeepSeek Coordinator + Skills

配置模型后，聊天主链路使用原生 Tool Calling Loop：

```text
User
  ↓
DeepSeek
  ↓ tool_calls
Readonly Skill
  ↓ Observation
DeepSeek
  ↓ 下一 Tool / 最终 Task Result
UI Planner
  ↓
A2UI
```

Agent 可自主调用的只读 Skills：

- `getAccountInfo`
- `getTrafficUsage`
- `getTrafficPackages`
- `getBill`
- `getBusinessMetrics`
- `validateBalance`

`executeOrder` 有副作用，**不会暴露给 DeepSeek 自主调用**。只有用户进入确认状态并明确确认后，服务端才能授权执行。

这是一条重要安全边界：

```text
模型可以理解、查询、推荐、预校验
            ↓
不能自行扣费 / 办理
            ↓
用户显式确认 + 服务端 Guard
            ↓
executeOrder
```

## A2UI 在链路里的位置

A2UI 不是 LLM，也不是 React 框架。它位于 Agent/业务层与前端之间：

```text
Agent / Task Result
      ↓
UI Planner
      ↓
A2UI Builder
      ↓
createSurface / updateComponents / updateDataModel
      ↓ NDJSON
MessageProcessor
      ↓
Catalog + Data Binding
      ↓
React UI
      ↓
A2UI Action
      ↓
业务服务端
```

项目保留了真实 A2UI 的 Surface 生命周期、Catalog、DataModel、Binding、Action 和 NDJSON 消息流，而不是用一个 `intent -> React component` 的普通 switch 来模拟。

## 关键 Task State

```text
traffic_purchase
  ├─ select_package        → TrafficPackageCard      / business
  ├─ insufficient_balance  → BasicCatalogRecoveryUI  / basic
  ├─ confirm_order         → OrderConfirmCard        / business
  └─ completed             → ResultCard              / business
```

UI 的选择依据是“当前任务 + 当前状态 + 业务结果”，而不是只看用户第一句话的 Intent。

## 其他演示场景

### 账户和流量

```text
查一下我的套餐
→ AccountOverviewCard

我的流量还剩多少？
→ TrafficDetailCard
```

### 账单

```text
查一下我的账单
→ BillCard
```

### 数据分析

```text
看看最近业务情况
→ AnalyticsCard
```

在 AnalyticsCard 内切换近7天 / 近30天 / 近半年时，结构不变，只更新绑定状态和图表数据，可观察 `updateDataModel`。

## Debug Inspector

右侧调试面板用于把“为什么返回这张卡”讲清楚，重点观察：

- `Agent Mode`
- `Agent Trace`
- `Agent Decision`
- `Task State`
- `Selected Card`
- `Catalog`
- `UI Strategy`
- A2UI Messages

常见 Agent Mode：

- `llm_tool_calling`：DeepSeek 正常自主选择只读 Tool；
- `deterministic_fallback`：模型未配置或调用失败时的确定性兜底；
- `deterministic_action`：卡片上的明确 A2UI Action；
- `confirmation_gate`：办理前的自然语言显式确认门。

## 本地运行

```bash
npm install
npm run dev
```

- React / Vite：`http://localhost:5173`
- Demo server：`http://localhost:8787`

默认可以不配置模型，走 deterministic fallback。

配置 OpenAI-compatible / DeepSeek：

```env
LLM_MODE=openai-compatible
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=...
LLM_MODEL=...
PORT=8787
```

## 目录

```text
src/
├── a2ui/catalog.tsx      # Business Catalog + React implementations
├── App.tsx               # Chat UI + MessageProcessor + Debug Inspector
├── lib/ndjson.ts
└── styles.css

server/
├── agent/coordinator.ts  # DeepSeek Tool Calling Loop
├── skills/               # 业务 Skills + registry
├── classifier.ts         # deterministic fallback understanding
├── planner.ts            # Task Result → UI Policy
├── a2ui-builder.ts       # Business Catalog A2UI messages
├── basic-builder.ts      # Basic Catalog recovery UI
├── session-store.ts
├── mock-data.ts
└── index.ts              # Chat / Action / Confirmation Guard
```

## 当前边界

这是用于内部技术预研的完整 POC，不是生产系统。目前业务数据和 `executeOrder` 都是 Demo/mock；尚未接真实 BSS / CRM / 计费 / 订单系统，也没有完整生产权限、幂等、审计、监控、协议协商等能力。

当前 POC 已经足够验证的核心问题是：**通通代理能否把“自然语言 → Agent 业务判断 → 业务能力 → 动态 UI → 用户操作 → 异常恢复 → 安全确认”串成一个完整任务闭环。**
