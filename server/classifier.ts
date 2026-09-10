import type {Intent} from '../src/types.js';

export interface Classification {
  intent: Intent;
  parameters: Record<string, unknown>;
  classifier: 'mock' | 'llm';
  llmCalled?: boolean;
  llmStatus?: 'not_called' | 'success' | 'fallback';
}

export interface ClassificationContext {
  activeTask?: Intent;
  slots?: Record<string, unknown>;
  history?: Array<{role: 'user' | 'assistant'; content: string}>;
}

export async function classify(message: string, context: ClassificationContext = {}): Promise<Classification> {
  const llmConfigured = process.env.LLM_MODE === 'openai-compatible' && Boolean(process.env.LLM_API_KEY) && Boolean(process.env.LLM_MODEL);

  if (llmConfigured) {
    try {
      const result = await classifyWithLlm(message, context);
      return {...result, llmCalled: true, llmStatus: 'success'};
    } catch (error) {
      console.warn('LLM classifier failed, fallback to mock:', error);
      return {...mockClassify(message, context), classifier: 'mock', llmCalled: true, llmStatus: 'fallback'};
    }
  }

  return {...mockClassify(message, context), classifier: 'mock', llmCalled: false, llmStatus: 'not_called'};
}

export function mockClassify(message: string, context: ClassificationContext): Omit<Classification, 'classifier'> {
  const m = message.toLowerCase();
  const parameters: Record<string, unknown> = {};

  const size = m.match(/(\d+(?:\.\d+)?)\s*(?:g|gb)/i);
  if (size) parameters.sizeGb = Number(size[1]);

  if (/30\s*天|一个月/.test(m)) parameters.duration = '30d';
  else if (/7\s*天|一周/.test(m)) parameters.duration = '7d';

  if (/定向/.test(m)) parameters.type = 'directed';
  else if (/通用/.test(m)) parameters.type = 'general';

  if (/最便宜|便宜点|最低价/.test(m)) parameters.preference = 'cheapest';

  const budget = m.match(/(?:预算|不超过|最多|只有|就剩)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/);
  if (budget) parameters.maxPrice = Number(budget[1]);

  if (/近?7\s*天|最近一周/.test(m)) parameters.range = '7d';
  else if (/近?30\s*天|最近一个月/.test(m)) parameters.range = '30d';
  else if (/半年|6\s*个月/.test(m)) parameters.range = '6m';

  if (/只看流量|流量收入|流量业务/.test(m)) parameters.metric = 'traffic';

  const month = m.match(/(\d{1,2})\s*月/);
  if (month) parameters.month = Number(month[1]);

  if (/分析|业务情况|趋势|销量|收入|半年|(?:近|最近)\s*\d+\s*天|只看流量/.test(m)) {
    return {intent: 'business_analysis', parameters};
  }
  if (/账单|消费|花了多少/.test(m)) {
    return {intent: 'bill_query', parameters};
  }
  if (/办.*流量|买.*流量|加.*流量|流量包|最便宜.*30天|要30天|20g|10g|30g|推荐.*流量|流量.*推荐|适合.*方案|撑不到|顶不住/.test(m)) {
    return {intent: 'traffic_purchase', parameters};
  }
  if (/流量/.test(m)) {
    return {intent: 'traffic_query', parameters};
  }
  if (/客服|人工/.test(m)) {
    return {intent: 'customer_service', parameters};
  }

  if (
    context.activeTask === 'traffic_purchase' &&
    (Object.keys(parameters).length > 0 || /要|换|改|就这个|这个吧/.test(m))
  ) {
    return {intent: 'traffic_purchase', parameters};
  }

  if (
    context.activeTask === 'business_analysis' &&
    (parameters.range || parameters.metric || /换成|改成|看看/.test(m))
  ) {
    return {intent: 'business_analysis', parameters};
  }

  return {intent: 'account_query', parameters};
}

async function classifyWithLlm(message: string, context: ClassificationContext): Promise<Classification> {
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      thinking: {type: 'disabled'},
      temperature: 0,
      response_format: {type: 'json_object'},
      messages: [
        {
          role: 'system',
          content: [
            '你是运营商任务理解器，只输出 JSON。',
            'intent 只能是 account_query, traffic_query, traffic_purchase, bill_query, business_analysis, customer_service。',
            'parameters 可提取：sizeGb(number), duration(7d/30d), type(general/directed), maxPrice(number), preference(cheapest), range(7d/30d/6m), metric(traffic), month(number)。',
            '结合已有 activeTask 和 slots 理解省略表达，例如“要30天的”“20G吧”“换成半年”。',
            '不要输出 UI 名、组件名、A2UI 消息、React 代码或业务执行结果。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            currentContext: {
              activeTask: context.activeTask ?? null,
              slots: context.slots ?? {},
              recentHistory: (context.history ?? []).slice(-6),
            },
            message,
          }),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`LLM ${response.status}`);
  const json = await response.json() as any;
  const text = json.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(String(text).replace(/\`\`\`json|\`\`\`/g, '').trim());
  return {
    intent: parsed.intent as Intent,
    parameters: parsed.parameters ?? {},
    classifier: 'llm',
  };
}
