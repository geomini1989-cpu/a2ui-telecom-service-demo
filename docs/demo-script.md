# Demo Script

1. `查一下我的套餐`：展示 AccountOverviewCard 与调试链路。
2. 点击 `办流量`：证明明确 Action 不需要再次调用 LLM。
3. 切换通用/定向、7天/30天、套餐容量：证明卡片内部确定性交互。
4. 点击 `立即办理`：A2UI Action → OrderConfirmCard。
5. 点击 `确认办理`：ResultCard。
6. 重新输入 `给我办个20G 30天通用流量包`：证明自然语言参数完整时可跳步骤。
7. 输入 `看看最近业务情况`：AnalyticsCard + 三类图表。
8. 打开/关闭调试开关：对比产品视图与协议视图。
