# A2UI Telecom Service Demo

一个面向内部技术演示的 **React + A2UI v0.9.1 + 业务级 Custom Catalog** 项目。

> 核心边界：**DeepSeek Coordinator 负责理解任务并自主调用只读 Skills；业务代码负责 Tool 执行、安全确认与 UI Policy；A2UI 负责 Surface / Component / DataModel / Action；React 负责固定业务组件的结构与样式。**

## 为什么这样做

本项目不让模型临时设计 `Text / Row / Button` 的布局，而是把稳定的业务 UI 注册成 A2UI Custom Catalog：

- `AccountOverviewCard` — 账户总览
- `TrafficDetailCard` — 流量详情
- `TrafficPackageCard` — 流量包规格选择
- `OrderConfirmCard` — 办理确认
- `ResultCard` — 结果反馈
- `BillCard` — 账单
- `AnalyticsCard` — 数据分析

组件本身由 React 写死；Agent/A2UI 在运行时决定**当前 Surface 使用哪张卡、绑定什么数据、何时切换或更新、Action 如何回传**。

## 产品体验

体验参考“自然语言进入任务 → 卡片内确定性交互 → Action 推进任务”的任务型 AI UI：

```text
用户：给我办流量
        ↓
LLM: traffic_purchase
        ↓
Skill: getTrafficPackages
        ↓
A2UI: TrafficPackageCard
        ↓
用户在卡片里选择 类型 / 有效期 / 容量
        ↓
A2UI Action: purchase_traffic_package
        ↓
OrderConfirmCard
        ↓
confirm_order
        ↓
ResultCard
```

如果用户一次把参数说完整：

```text
“给我办个20G、30天、通用流量包”
```

Agent 会先通过 `getTrafficPackages` 获取真实候选，可以在 `TrafficPackageCard` 中预选对应套餐，但不会直接办理；仍需用户进入 `OrderConfirmCard` 后显式确认。

## Coordinator Agent + Skills

当前聊天主链路已经升级为 DeepSeek Tool Calling Loop：

```text
User
  ↓
TelecomCoordinatorAgent
  ↓
DeepSeek decides tool call
  ↓
Read-only Skill
  ↓
Observation returned to DeepSeek
  ↓
DeepSeek decides next tool / final task result
  ↓
UI Planner
  ↓
A2UI
  ↓
React
```

DeepSeek 可自主调用的只读 Skills：

- `getAccountInfo`
- `getTrafficUsage`
- `getTrafficPackages`
- `getBill`
- `getBusinessMetrics`
- `validateBalance`

`executeOrder` 是有副作用 Skill，**不会暴露给 DeepSeek**。只有用户点击“确认办理”，或在 `confirm_order` 状态明确输入“确认办理”，服务端 Confirmation Gate 才能授权执行。

例如：

```text
用户：我最近流量掉得很快，帮我推荐个便宜点、能用一个月的包

Coordinator
  ↓ getTrafficUsage
Observation: 当前剩余量 / 近期日均 / 预计缺口
  ↓ getTrafficPackages
Observation: 符合 30 天条件的候选套餐
  ↓ validateBalance
Observation: 余额是否足够
  ↓
推荐套餐 + 推荐理由
  ↓
TrafficPackageCard
```

右侧 Debug Inspector 会显示 `Agent`、`Agent Mode`、`Agent Trace`、`Agent Decision`。`Agent Mode = llm_tool_calling` 表示该轮由 DeepSeek 自主选择 Tool；`deterministic_fallback` 表示模型调用失败或未配置时回退到本地逻辑。

## A2UI 链路

```text
Natural Language
      ↓
Intent / Parameters
      ↓
Task Router
      ↓
Skill
      ↓
A2UI Builder
      ↓
createSurface
updateComponents
updateDataModel
      ↓
MessageProcessor (@a2ui/web_core/v0_9)
      ↓
Custom Catalog (@a2ui/react/v0_9)
      ↓
React Business Card
      ↓
Action → Next Task State
```

服务端返回 NDJSON，逐条发送 A2UI 消息，便于观察 progressive rendering。

## 本地运行

```bash
npm install
npm run dev
```

- React/Vite: `http://localhost:5173`
- Demo server: `http://localhost:8787`

默认不需要模型 API：`LLM_MODE=mock` 使用确定性的关键词分类器。

要接 OpenAI-compatible API：

```bash
cp .env.example .env
```

然后设置：

```env
LLM_MODE=openai-compatible
LLM_BASE_URL=https://your-endpoint/v1
LLM_API_KEY=...
LLM_MODEL=...
```

模型现在不只是做分类：它会收到 `tools` 与 `tool_choice: auto`，可以返回 `tool_calls`。服务端执行只读 Skill 后把 Observation 以 `role=tool` 回传给 DeepSeek，直到模型输出结构化 Task Result。模型仍然不输出 Card 名、样式、React 代码或 A2UI 组件树。

## 推荐演示脚本

### 1. 账户查询

输入：`查一下我的套餐`

观察 Debug 面板：

```text
Intent        account_query
Skill         getAccountInfo
Selected Card AccountOverviewCard
```

### 2. 卡片 Action 推进任务

在账户卡点 **办流量** → `TrafficPackageCard`。

规格选择不会重复调用 LLM；选择状态通过 A2UI DataModel 绑定维护。点击 **去确认** 才进入 `OrderConfirmCard`，之后必须显式“确认办理”。

### 3. DeepSeek Tool Calling

输入：`我最近流量掉得挺快，帮我推荐个便宜点、能用一个月的流量包`

观察 `Agent Mode = llm_tool_calling`，以及 `Agent Trace` 中 DeepSeek 自主调用 `getTrafficUsage -> getTrafficPackages -> validateBalance` 的过程。

### 4. 数据分析

输入：`看看最近业务情况`

进入 `AnalyticsCard`。切换 **近7天 / 近30天 / 近半年** 时卡片结构不变，只改变绑定状态和图表数据。

## 与“普通 intent -> React switch”的区别

如果只是：

```tsx
if (intent === 'traffic') return <TrafficCard />;
```

那只是 Intent Routing。

这个 Demo 中仍然保留真实 A2UI 协议层：

- Surface 生命周期
- Custom Catalog
- `updateComponents`
- `updateDataModel`
- Data Binding
- Client Action
- NDJSON 流式消息

因此它展示的是 **业务级 Custom Catalog 的 A2UI 用法**，而不是用 JSON 伪装的 React switch。

## 目录

```text
src/
├── a2ui/catalog.tsx      # 自定义业务 Catalog + React implementation
├── App.tsx               # Chat UI + MessageProcessor + Debug inspector
├── lib/ndjson.ts         # NDJSON 流读取
└── styles.css

server/
├── agent/
│   └── coordinator.ts    # DeepSeek Tool Calling Loop
├── skills/               # 业务 Skills + registry
├── classifier.ts         # deterministic fallback understanding
├── planner.ts            # Task Result → UI state
├── a2ui-builder.ts       # Task State → A2UI messages
├── basic-builder.ts      # Basic Catalog dynamic UI
├── session-store.ts
├── mock-data.ts
└── index.ts              # Chat/Action stream endpoints
```

## 设计原则

1. **业务卡片样式固定**，不允许 LLM 改布局。
2. **DeepSeek 可自主调用只读 Tool**；明确按钮 Action 走确定性路由。
3. **卡片内筛选/规格选择不反复请求 LLM**。
4. **Task State 比 Intent 更接近真正的页面控制状态**。
5. **Debug 模式必须能看到 Intent → Skill → Card → A2UI messages**。
6. 当前目标协议为 **A2UI v0.9.1**。

## 后续可扩展

- 使用真实业务 API 替换 `mock-data.ts`
- 增加 Agent Card / A2A，用于多 Agent 能力发现
- 增加基础 Catalog 与业务 Catalog 混合示例
- 增加权限、交易确认和敏感操作二次确认
- 加入 A2UI schema validation / capabilities negotiation
