# Demo Script

## 主故事：流量快用完 → 推荐 → 余额不足 → 恢复 → 办理

推荐用一句自然语言开始：

`我最近刷视频流量用得特别快，月底估计顶不住，帮我推荐个适合的方案`

演示顺序：

1. **Agent 分析使用情况**：调用 `getTrafficUsage`，拿到剩余流量、近期使用速度和预计缺口。
2. **Agent 查可办理套餐**：调用 `getTrafficPackages`，根据缺口找到候选；Demo 中预计额外缺口约 54.5GB，因此推荐 100GB / 30天 / ¥88 套餐。
3. **展示推荐卡**：UI Planner 选择 Business Catalog 的 `TrafficPackageCard`。即使 Agent 已预检查余额，推荐仍可展示，但不会执行办理。
4. **用户点击「去确认」**：这是明确的 A2UI Action。服务端在真正进入交易确认前再次执行 `validateBalance`。
5. **余额不足**：当前余额 ¥56.8，小于套餐价格 ¥88。Task State 进入 `insufficient_balance`，改用 Basic Catalog 动态组合恢复界面。
6. **点击「看看便宜套餐」**：恢复动作带上 `maxPrice=56.8`，回到 Business Catalog 的 `TrafficPackageCard`，只保留当前余额可支付的候选。
7. **改选 20GB / 30天 / ¥18**：用户在卡片内完成确定性选择，不需要重新调用 LLM。
8. **再次点击「去确认」**：`validateBalance` 通过，进入 `OrderConfirmCard`。
9. **点击「确认办理」**：只有此时服务端才授权有副作用 Skill `executeOrder`，最后进入 `ResultCard`。

这条链路一次性展示：自然语言理解、Tool Calling、Skill Observation、UI Policy、Business Catalog、Basic Catalog、Data Binding、Action、Task State、异常恢复和交易安全确认。

## 辅助场景

- `查一下我的套餐` → `AccountOverviewCard`
- `我的流量还剩多少？` → `TrafficDetailCard`
- `看看最近业务情况` → `AnalyticsCard`
- 在分析卡中切换近7天 / 近30天 / 近半年 → 同一 Surface 内更新 DataModel

## 现场重点看什么

打开 Debug Inspector 后重点观察：`Agent Mode`、`Agent Trace`、`Task State`、`Selected Card`、`Catalog`、`UI Strategy` 和 A2UI Messages。

配置 DeepSeek 时，正常聊天主链路应显示 `Agent Mode = llm_tool_calling`；没有模型配置时会进入 `deterministic_fallback`。按钮 Action 始终走确定性业务路由，不依赖模型自由发挥。
