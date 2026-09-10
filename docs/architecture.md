# Architecture

## 一句话边界

**LLM / Agent 决定做什么；Skill 获取或执行真实业务能力；UI Policy 决定当前任务状态对应什么界面；A2UI 负责把界面和数据表达给前端；React 决定最终长什么样。**

## 职责边界

| 层 | 负责 | 不负责 |
|---|---|---|
| DeepSeek Coordinator | 理解自然语言、自主选择只读 Tool、根据 Observation 形成 Task Result | React、样式、直接执行付费业务 |
| Skill | 查询账户/流量/套餐/账单、校验余额、执行受控业务动作 | UI 布局 |
| UI Planner / Policy | Task Result + Task State → UI Strategy / Catalog / Card | 自然语言推理 |
| A2UI Builder | Surface、Component、DataModel、Binding、Action | CSS 和品牌视觉 |
| React Catalog | 固定高频业务卡片的结构、样式和交互体验 | Agent 推理 |
| Confirmation / Business Guard | 交易前校验、显式授权副作用 Skill | 自由推理 |

## 主业务闭环

```text
用户：最近刷视频流量用得特别快，月底估计顶不住
  ↓
Coordinator Agent
  ↓ getTrafficUsage
使用情况 / 预计流量缺口
  ↓ getTrafficPackages
候选套餐
  ↓ validateBalance（只读预检查）
Task Result：推荐具体套餐 + 推荐理由
  ↓
UI Planner
  ↓
Business Catalog / TrafficPackageCard
  ↓ 用户点击“去确认”
A2UI Action
  ↓
Business Guard 再次 validateBalance
  ├─ 余额足够 → OrderConfirmCard
  └─ 余额不足 → Basic Catalog Recovery UI
                         ↓ 看看便宜套餐
                    TrafficPackageCard
                         ↓ 改选可支付套餐
                    OrderConfirmCard
                         ↓ 确认办理
                    executeOrder
                         ↓
                    ResultCard
```

## 为什么推荐卡和余额不足 UI 属于两种 Catalog

`TrafficPackageCard` 是稳定、高频、品牌要求明确的运营商业务 UI，因此使用 Business Catalog，由 React 提前开发并注册。

余额不足属于任务执行中的异常恢复。Demo 使用 Basic Catalog 动态组合 `Card / Column / Text / Divider / Row / Button`，证明长尾状态不一定需要提前开发一张专用 React 页面。

## Task State 示例

```text
traffic_purchase
  ├─ select_package        → TrafficPackageCard       (business)
  ├─ insufficient_balance  → BasicCatalogRecoveryUI   (basic)
  ├─ confirm_order         → OrderConfirmCard         (business)
  └─ completed             → ResultCard               (business)
```

关键不是 `intent -> React switch`，而是任务在多轮交互中持续维护状态，A2UI Surface 可以替换组件、更新 DataModel，并通过 Action 把用户操作重新送回业务流程。
