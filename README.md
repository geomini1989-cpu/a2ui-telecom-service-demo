# A2UI Telecom Service

通过 **A2UI 将 Agent 的业务结果转化为可操作界面**，把自然语言查询、套餐推荐、用户选择、确认办理和异常恢复串成连续的交互流程。用户可以在卡片中继续操作，界面随业务状态同步更新。

技术栈：**React + A2UI v0.9 消息协议 + LangGraph TypeScript + DeepSeek Tool Calling + 运营商业务 Catalog**。

> 核心边界：**Agent 决定做什么；Skill 获取或执行业务能力；UI Policy 决定当前状态该展示什么；A2UI 负责表达 UI 和交互；React 负责最终视觉。**

## A2UI 的价值

### 1. 界面随业务进展更新，让下一步操作更清楚

后端 UI Planner 根据当前任务、业务状态和查询结果选择界面，A2UI 将组件、数据绑定与可用操作传递给 React。套餐推荐、余额不足、订单确认和办理结果分别呈现对应的界面，使用户能够直接看到当前进展和下一步操作。

### 2. 用户在卡片中继续操作，推动同一个任务完成

套餐选择、确认和取消通过 A2UI Action 回传到服务端，继续推动原有任务流程。用户选择后，后端执行业务校验并返回新的界面消息；余额不足时，界面提供重新筛选套餐的入口，支持用户沿当前流程完成调整。

### 3. 复用业务组件，按状态控制界面更新范围

前端通过 Catalog 注册账户、套餐、订单确认和图表等组件，统一维护结构与样式；后端通过 A2UI 消息选择组件并绑定业务数据。结构不变时使用 `updateDataModel` 局部更新数据，状态变化时更新组件；余额不足等异常场景由 Basic Catalog 组合提示与操作入口，复用已有界面能力。

以“月底流量不够，需要选择套餐”为例：

| 业务进展 | A2UI 呈现的界面 | 用户可继续的操作 |
| --- | --- | --- |
| 套餐推荐 | `TrafficPackageCard` | 查看推荐理由、比较并选择套餐 |
| 余额不足 | Basic Catalog 恢复界面 | 查看差额、重新筛选可支付套餐 |
| 准备办理 | `OrderConfirmCard` | 核对套餐、确认或取消办理 |
| 办理完成 | `ResultCard` | 查看订单回执 |

A2UI 负责界面描述、数据绑定和操作回传。流程恢复由 LangGraph 与 SQLite 提供，订单校验与执行由业务服务负责；A2UI 将这些处理结果呈现为用户可以继续操作的界面。

## 项目目标

项目围绕“查、选、办、异常恢复”组织任务，支持以下能力：

1. 理解用户自然语言；
2. 自主调用只读业务 Tool；
3. 根据业务结果形成 Task Result；
4. 由 UI Planner 选择合适的界面策略；
5. 通过 A2UI 把卡片、数据和 Action 交给前端；
6. 用户继续在卡片里操作，直到任务完成。

模型不生成 React，也不决定 CSS。稳定高频业务使用 Business Catalog；长尾异常可以使用 Basic Catalog 动态组合 UI。

## 流量套餐推荐与办理流程

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

内置业务数据：

- 当前通用流量剩余 17.5GB；
- 距周期结束约 12 天；
- 近期日均流量按 6GB 计算；
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

余额不足场景使用 A2UI Basic Catalog 动态组合：

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

项目通过官方 A2UI SDK 处理 Surface 生命周期、Catalog、DataModel、Binding、Action 和 NDJSON 消息流，实现组件选择、数据绑定、局部更新与用户操作回传。

## 关键 Task State

```text
traffic_purchase
  ├─ select_package        → TrafficPackageCard      / business
  ├─ insufficient_balance  → BasicCatalogRecoveryUI  / basic
  ├─ confirm_order         → OrderConfirmCard        / business
  └─ completed             → ResultCard              / business
```

UI 的选择依据是“当前任务 + 当前状态 + 业务结果”，而不是只看用户第一句话的 Intent。

## 其他业务场景

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

## LangGraph 持久化业务流程

外层业务流程由 `StateGraph` 执行；原有 Coordinator 在 `understand` 节点中继续使用原生只读 Tool Calling Loop。模型推荐结果经过 UI Policy 和确定性订单约束后，才进入确认流程。

```text
understand → plan_ui → present
                 └→ prepare_order → await_confirmation (interrupt)
                                       ├→ execute_order → present
                                       └→ cancel_order → present
```

- `await_confirmation` 使用 LangGraph 的 `interrupt` 暂停，用户按钮或精确文本“确认办理”通过 `Command` 恢复同一个图。其他文本不会授权办理；“取消”可以取消待办订单。
- SQLite 保存会话、版本、余额账本、不可变的订单快照、结果回执、完整的当前 A2UI Surface 和 LangGraph 检查点。前端使用稳定的会话标识，刷新页面或重启服务可以恢复当前界面。
- Node 24 内置 `node:sqlite` 驱动实现 `BaseCheckpointSaver` 接口；无需安装 `better-sqlite3` 或 Windows C++ 编译工具。
- 每个 Action 携带界面生成时的会话版本，确认 Action 还绑定待办订单标识。旧卡片、错配套餐和跨会话提交会被拒绝。
- 本地扣费记录、回执和会话更新在同一 SQLite 事务中完成，重复确认同一订单返回原结果。办理前重新检查套餐快照和余额；余额不足返回恢复卡片，套餐变化则要求重新选择。
- 单个服务实例按会话串行执行请求；SQLite 事务和版本校验保护账本写入。当前没有多实例工作流调度，也不提供真实运营商交易的“恰好一次”保证。
- NDJSON 发送的是 A2UI 和执行结果消息，不是模型 token 流；消息按业务处理进展发送，不额外添加固定延迟。

### 接口与恢复

```text
GET  /api/health
GET  /api/session/:id
POST /api/chat/stream    { sessionId, message, expectedVersion }
POST /api/action/stream  { sessionId, action }
```

聊天请求的 `expectedVersion` 来自恢复接口或响应调试信息中的 `sessionVersion`；Action 的 `context.sessionVersion` 与 `context.pendingOrderId` 由服务端写入 A2UI。发生 409 时前端恢复最新状态并提示用户重新操作。浏览器“新会话”按钮新建独立会话及账户状态，不删除旧会话。

默认持久化目录为 `.data`，可通过 `TELECOM_DATA_DIR` 修改；运行数据不会提交到 Git。

## 本地运行

```bash
npm ci
npm run dev
```

需要 Node.js 24.13 或更新的 24.x 版本。

- React / Vite：`http://localhost:5173`
- Express 业务服务：`http://localhost:8787`

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
├── workflow.ts           # LangGraph 节点、interrupt / Command 与会话串行化
├── checkpointer.ts       # Node SQLite 检查点适配
├── database.ts           # 会话 / 订单 / 余额账本事务
├── app.ts                # 可测试的 Express 应用与恢复接口
├── action-router.ts      # 受控界面操作路由
├── session-store.ts
└── index.ts              # Chat / Action / Confirmation Guard
```

## 当前边界

项目使用仓库内置的账户、流量、账单和套餐数据，账户余额、订单快照、扣费记录和结果回执保存在本地 SQLite。已实现持久化、确认后的流程恢复与订单幂等。目前尚未接入运营商 BSS / CRM / 计费 / 订单系统，也未提供生产级认证授权、完整审计、监控或协议协商。持有会话标识即可访问对应会话，外网部署需要补充认证和会话归属校验。

项目将 **“自然语言 → Agent 业务判断 → 业务能力 → 动态 UI → 用户操作 → 异常恢复 → 用户确认”** 串成完整任务流程。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

集成测试真实执行 LangGraph 与 SQLite，覆盖重启恢复、并发重复确认、旧卡片/跨会话拒绝、确认前余额和套餐变化、模型工具循环、越权工具拒绝及模型失败兜底。模型调用使用协议夹具，不代表真实模型效果成绩。

浏览器测试使用独立端口 5178/8790 和 `.data/e2e` 数据库，验证刷新恢复、余额不足重选与跨标签页冲突。默认使用本机 Microsoft Edge；CI 使用安装的 Playwright Chromium。
