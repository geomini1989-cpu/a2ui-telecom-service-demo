import type {Intent, TrafficPackage} from '../../src/types.js';
import {
  mockClassify,
  type Classification,
  type ClassificationContext,
} from '../classifier.js';
import type {TaskSession} from '../session-store.js';
import {AGENT_READONLY_SKILLS, runSkill} from '../skills/registry.js';
import type {SkillName, SkillObservation} from '../skills/types.js';

export interface AgentTraceStep {
  step: number;
  kind: 'llm' | 'tool_call' | 'skill' | 'decision' | 'fallback';
  label: string;
  detail: unknown;
}

export interface CoordinatorResult {
  classification: Classification;
  agentName: 'TelecomCoordinatorAgent';
  agentMode: 'llm_tool_calling' | 'deterministic_fallback';
  observations: SkillObservation[];
  trace: AgentTraceStep[];
  decision: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface AssistantMessage {
  role: 'assistant';
  content?: string | null;
  tool_calls?: ToolCall[];
}

const MAX_TOOL_ROUNDS = 4;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'getAccountInfo',
      description: '读取当前用户的套餐、账户余额、流量、语音和短信信息。需要账户事实时调用。',
      parameters: {type: 'object', properties: {}, additionalProperties: false},
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTrafficUsage',
      description: '读取当前流量使用情况、剩余流量、近期日均使用量和预计流量缺口。用户说流量不够、掉得快、撑不到月底或需要按使用情况推荐时优先调用。',
      parameters: {type: 'object', properties: {}, additionalProperties: false},
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTrafficPackages',
      description: '查询可办理流量包。可以按容量、有效期、流量类型和预算筛选。推荐套餐前必须基于此工具返回的真实候选。',
      parameters: {
        type: 'object',
        properties: {
          sizeGb: {type: 'number', description: '期望流量容量，单位 GB'},
          duration: {type: 'string', enum: ['7d', '30d'], description: '有效期'},
          type: {type: 'string', enum: ['general', 'directed'], description: '通用流量或定向流量'},
          maxPrice: {type: 'number', description: '最高预算，单位元'},
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getBill',
      description: '读取当前账期账单总额和费用明细。查询消费或账单时调用。',
      parameters: {
        type: 'object',
        properties: {
          month: {type: 'number', description: '用户明确提到的月份，例如 8 表示 8 月'},
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getBusinessMetrics',
      description: '读取业务活跃、套餐销量和收入构成等分析数据。业务趋势或数据分析请求时调用。',
      parameters: {
        type: 'object',
        properties: {
          range: {type: 'string', enum: ['7d', '30d', '6m'], description: '分析时间范围'},
          metric: {type: 'string', enum: ['traffic'], description: '只分析流量业务时传 traffic'},
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validateBalance',
      description: '校验当前账户余额能否支付某个具体流量包。准备推荐一个具体可办理套餐时调用。此工具只读，不会扣费。',
      parameters: {
        type: 'object',
        properties: {
          packageId: {type: 'string', description: '由 getTrafficPackages 返回的套餐 id'},
        },
        required: ['packageId'],
        additionalProperties: false,
      },
    },
  },
] as const;

const SYSTEM_PROMPT = [
  '你是 TelecomCoordinatorAgent，负责运营商任务编排。',
  '你可以自主决定调用哪些只读业务工具，并根据 Observation 再决定下一步。',
  '必须通过工具获取账户、流量、套餐、账单和业务指标事实，不得臆造业务数据。',
  '如果用户说流量不够、掉得快、撑不到月底、想要合适/划算套餐，先调用 getTrafficUsage，再调用 getTrafficPackages；准备推荐具体套餐时再调用 validateBalance。',
  '如果用户明确指定套餐条件，也应调用 getTrafficPackages 获取真实候选。',
  'executeOrder 不在你的工具列表中。你绝不能声称已经办理、扣费或执行交易。',
  '涉及办理时你的最高权限只是推荐套餐或进入待确认状态，最终执行由服务端显式确认门负责。',
  '结合 activeTask、taskState、slots 和最近对话理解“要30天的”“20G吧”“换成半年”等省略表达。',
  '当你不再需要工具时，只输出一个 JSON 对象，不要 Markdown，不要解释文字。',
  '最终 JSON 格式：',
  '{"intent":"account_query|traffic_query|traffic_purchase|bill_query|business_analysis|customer_service","parameters":{},"decision":{"reason":"简短原因","summary":"面向UI策略的简短结论"}}',
  'parameters 允许字段：sizeGb(number), duration(7d/30d), type(general/directed), maxPrice(number), preference(cheapest), range(7d/30d/6m), metric(traffic), month(number), recommendedPackageId(string), recommendationReason(string), balanceSufficient(boolean), balanceAmount(number)。',
  'recommendedPackageId 必须来自 getTrafficPackages 的返回结果；如果没有足够依据就不要填写。',
  '不要输出组件名、React、A2UI 消息或私有思维过程。',
].join('\n');

function llmConfigured() {
  return process.env.LLM_MODE === 'openai-compatible'
    && Boolean(process.env.LLM_API_KEY)
    && Boolean(process.env.LLM_MODEL);
}

function apiBase() {
  return (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
}

async function requestLlm(
  messages: Array<Record<string, unknown>>,
  withTools: boolean,
): Promise<AssistantMessage> {
  const body: Record<string, unknown> = {
    model: process.env.LLM_MODEL,
    thinking: {type: 'disabled'},
    temperature: 0,
    messages,
  };

  if (withTools) {
    body.tools = TOOL_DEFINITIONS;
    body.tool_choice = 'auto';
  } else {
    body.response_format = {type: 'json_object'};
  }

  const response = await fetch(`${apiBase()}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const json = await response.json() as any;
  const message = json.choices?.[0]?.message as AssistantMessage | undefined;
  if (!message) throw new Error('LLM returned no assistant message');
  return message;
}

function parseJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.replace(/\`\`\`json|\`\`\`/g, '').trim();
  try {
    const value = JSON.parse(cleaned);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeIntent(value: unknown, fallback?: Intent): Intent {
  const allowed: Intent[] = [
    'account_query',
    'traffic_query',
    'traffic_purchase',
    'bill_query',
    'business_analysis',
    'customer_service',
  ];
  return typeof value === 'string' && allowed.includes(value as Intent)
    ? value as Intent
    : (fallback ?? 'account_query');
}

function sanitizeParameters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  if (typeof input.sizeGb === 'number' && Number.isFinite(input.sizeGb)) output.sizeGb = input.sizeGb;
  if (input.duration === '7d' || input.duration === '30d') output.duration = input.duration;
  if (input.type === 'general' || input.type === 'directed') output.type = input.type;
  if (typeof input.maxPrice === 'number' && Number.isFinite(input.maxPrice)) output.maxPrice = input.maxPrice;
  if (input.preference === 'cheapest') output.preference = input.preference;
  if (input.range === '7d' || input.range === '30d' || input.range === '6m') output.range = input.range;
  if (input.metric === 'traffic') output.metric = input.metric;
  if (typeof input.month === 'number' && Number.isFinite(input.month)) output.month = input.month;
  if (typeof input.recommendedPackageId === 'string') output.recommendedPackageId = input.recommendedPackageId;
  if (typeof input.recommendationReason === 'string') output.recommendationReason = input.recommendationReason;
  if (typeof input.balanceSufficient === 'boolean') output.balanceSufficient = input.balanceSufficient;
  if (typeof input.balanceAmount === 'number' && Number.isFinite(input.balanceAmount)) output.balanceAmount = input.balanceAmount;

  return output;
}

function parseToolArgs(raw: string) {
  const parsed = parseJsonObject(raw);
  return parsed ?? {};
}

function isReadonlySkill(name: string): name is SkillName {
  return AGENT_READONLY_SKILLS.includes(name as SkillName);
}

function observedPackageIds(observations: SkillObservation[]) {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (observation.skill !== 'getTrafficPackages' || !Array.isArray(observation.output)) continue;
    for (const item of observation.output as TrafficPackage[]) ids.add(item.id);
  }
  return ids;
}

function enrichAndValidateAgentParameters(
  parameters: Record<string, unknown>,
  decision: Record<string, unknown>,
  observations: SkillObservation[],
) {
  const output = {...parameters};
  const packageIds = observedPackageIds(observations);

  if (typeof output.recommendedPackageId === 'string' && !packageIds.has(output.recommendedPackageId)) {
    delete output.recommendedPackageId;
    delete output.recommendationReason;
  }

  const balanceObservation = [...observations]
    .reverse()
    .find(item => item.skill === 'validateBalance');

  if (balanceObservation) {
    const balance = balanceObservation.output as {
      balance?: unknown;
      sufficient?: unknown;
    };
    if (typeof balance.balance === 'number') output.balanceAmount = balance.balance;
    if (typeof balance.sufficient === 'boolean') output.balanceSufficient = balance.sufficient;
  }

  if (
    typeof output.recommendedPackageId === 'string'
    && typeof output.recommendationReason !== 'string'
    && typeof decision.summary === 'string'
  ) {
    output.recommendationReason = decision.summary;
  }

  return output;
}

async function finalizeAfterToolLimit(
  message: string,
  context: ClassificationContext,
  observations: SkillObservation[],
) {
  const finalizerMessages: Array<Record<string, unknown>> = [
    {role: 'system', content: SYSTEM_PROMPT},
    {
      role: 'user',
      content: JSON.stringify({
        currentContext: {
          activeTask: context.activeTask ?? null,
          slots: context.slots ?? {},
          recentHistory: (context.history ?? []).slice(-6),
        },
        message,
        observations: observations.map(item => ({
          skill: item.skill,
          args: item.args,
          output: item.output,
          summary: item.summary,
        })),
        instruction: '工具阶段结束。基于以上真实 Observation 直接输出最终 JSON，不再请求工具。',
      }),
    },
  ];
  return requestLlm(finalizerMessages, false);
}

async function runLlmToolCallingAgent(
  message: string,
  session: TaskSession,
  context: ClassificationContext,
): Promise<CoordinatorResult> {
  const trace: AgentTraceStep[] = [];
  const observations: SkillObservation[] = [];
  const messages: Array<Record<string, unknown>> = [
    {role: 'system', content: SYSTEM_PROMPT},
    {
      role: 'user',
      content: JSON.stringify({
        currentContext: {
          activeTask: context.activeTask ?? null,
          taskState: session.taskState ?? null,
          slots: context.slots ?? {},
          recentHistory: (context.history ?? []).slice(-6),
        },
        message,
      }),
    },
  ];

  let finalPayload: Record<string, unknown> | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const assistant = await requestLlm(messages, true);
    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];

    trace.push({
      step: trace.length + 1,
      kind: 'llm',
      label: `DeepSeek decision round ${round + 1}`,
      detail: {
        requestedTools: toolCalls.map(call => call.function.name),
        hasFinalContent: Boolean(assistant.content),
      },
    });

    messages.push({
      role: 'assistant',
      content: assistant.content ?? null,
      ...(toolCalls.length ? {tool_calls: toolCalls} : {}),
    });

    if (!toolCalls.length) {
      finalPayload = parseJsonObject(assistant.content);
      if (finalPayload) break;

      const finalized = await finalizeAfterToolLimit(message, context, observations);
      finalPayload = parseJsonObject(finalized.content);
      if (!finalPayload) throw new Error('LLM final task result is not valid JSON');
      break;
    }

    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      if (!isReadonlySkill(name)) {
        trace.push({
          step: trace.length + 1,
          kind: 'tool_call',
          label: 'Rejected tool call',
          detail: {name, reason: 'tool_not_allowed_or_has_side_effect'},
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({error: 'Tool is not allowed for autonomous agent execution'}),
        });
        continue;
      }

      const args = parseToolArgs(toolCall.function.arguments);
      trace.push({
        step: trace.length + 1,
        kind: 'tool_call',
        label: name,
        detail: {args},
      });

      const observation = await runSkill(name, args, session, false);
      observations.push(observation);

      trace.push({
        step: trace.length + 1,
        kind: 'skill',
        label: `${name} observation`,
        detail: {
          summary: observation.summary,
          output: observation.output,
        },
      });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          data: observation.output,
          summary: observation.summary,
        }),
      });
    }
  }

  if (!finalPayload) {
    const finalized = await finalizeAfterToolLimit(message, context, observations);
    finalPayload = parseJsonObject(finalized.content);
  }
  if (!finalPayload) throw new Error('LLM could not produce a final task result');

  const decision = finalPayload.decision && typeof finalPayload.decision === 'object'
    ? finalPayload.decision as Record<string, unknown>
    : {};

  let parameters = sanitizeParameters(finalPayload.parameters);
  parameters = enrichAndValidateAgentParameters(parameters, decision, observations);

  const classification: Classification = {
    intent: normalizeIntent(finalPayload.intent, context.activeTask),
    parameters,
    classifier: 'llm',
    llmCalled: true,
    llmStatus: 'success',
  };

  trace.push({
    step: trace.length + 1,
    kind: 'decision',
    label: 'Coordinator final task result',
    detail: {
      intent: classification.intent,
      parameters: classification.parameters,
      decision,
    },
  });

  return {
    classification,
    agentName: 'TelecomCoordinatorAgent',
    agentMode: 'llm_tool_calling',
    observations,
    trace,
    decision: {
      ...decision,
      toolCalling: true,
      toolCallCount: observations.length,
      autonomousTools: observations.map(item => item.skill),
    },
  };
}

function wantsUsageAwareRecommendation(message: string) {
  return /掉得快|用得快|不够|撑到|撑一个月|最近.*流量|推荐|合适|性价比|够用/.test(message);
}

function chooseFallbackPackage(
  packages: TrafficPackage[],
  slots: Record<string, unknown>,
  projectedExtraGb?: number,
) {
  if (!packages.length) return null;

  if (projectedExtraGb && projectedExtraGb > 0) {
    const enough = packages
      .filter(p => p.sizeGb >= projectedExtraGb)
      .sort((a, b) => a.price - b.price || a.sizeGb - b.sizeGb);
    if (enough.length) return enough[0];
  }

  if (slots.preference === 'cheapest' || typeof slots.maxPrice === 'number') {
    return [...packages].sort((a, b) => a.price - b.price || b.sizeGb - a.sizeGb)[0];
  }

  if (typeof slots.sizeGb === 'number') {
    return packages.find(p => p.sizeGb === slots.sizeGb) ?? null;
  }

  return null;
}

async function runDeterministicFallback(
  message: string,
  session: TaskSession,
  context: ClassificationContext,
  attemptedLlm: boolean,
  error?: unknown,
): Promise<CoordinatorResult> {
  const trace: AgentTraceStep[] = [];
  const observations: SkillObservation[] = [];
  const base = mockClassify(message, context);
  const classification: Classification = {
    intent: base.intent,
    parameters: {...base.parameters},
    classifier: 'mock',
    llmCalled: attemptedLlm,
    llmStatus: attemptedLlm ? 'fallback' : 'not_called',
  };

  if (error) {
    trace.push({
      step: 1,
      kind: 'fallback',
      label: 'LLM tool-calling fallback',
      detail: {error: error instanceof Error ? error.message : String(error)},
    });
  }

  const observe = async (name: SkillName, args: Record<string, unknown>) => {
    const observation = await runSkill(name, args, session, false);
    observations.push(observation);
    trace.push({
      step: trace.length + 1,
      kind: 'skill',
      label: name,
      detail: {summary: observation.summary, output: observation.output},
    });
    return observation;
  };

  const mergedSlots = {...session.slots, ...classification.parameters};
  const decision: Record<string, unknown> = {
    reason: 'deterministic_fallback',
    toolCalling: false,
  };

  switch (classification.intent) {
    case 'account_query':
      await observe('getAccountInfo', {});
      break;
    case 'traffic_query':
      await observe('getTrafficUsage', {});
      break;
    case 'traffic_purchase': {
      let projectedExtraGb: number | undefined;
      if (wantsUsageAwareRecommendation(message)) {
        const usage = await observe('getTrafficUsage', {});
        projectedExtraGb = (usage.output as {projectedExtraGb?: number}).projectedExtraGb;
      }
      const packageObservation = await observe('getTrafficPackages', mergedSlots);
      const packages = packageObservation.output as TrafficPackage[];
      const selected = chooseFallbackPackage(packages, mergedSlots, projectedExtraGb);
      if (selected) {
        const balanceObservation = await observe('validateBalance', {packageId: selected.id});
        const balance = balanceObservation.output as {sufficient?: boolean; balance?: number};
        classification.parameters = {
          ...classification.parameters,
          recommendedPackageId: selected.id,
          recommendationReason: projectedExtraGb
            ? `按近期流量缺口估算，推荐 ${selected.title}。`
            : `根据当前条件推荐 ${selected.title}。`,
          balanceSufficient: Boolean(balance.sufficient),
          balanceAmount: typeof balance.balance === 'number' ? balance.balance : undefined,
        };
      }
      break;
    }
    case 'bill_query':
      await observe('getBill', mergedSlots);
      break;
    case 'business_analysis':
      await observe('getBusinessMetrics', mergedSlots);
      break;
    case 'customer_service':
      break;
  }

  trace.push({
    step: trace.length + 1,
    kind: 'decision',
    label: 'Fallback task result',
    detail: {intent: classification.intent, parameters: classification.parameters},
  });

  return {
    classification,
    agentName: 'TelecomCoordinatorAgent',
    agentMode: 'deterministic_fallback',
    observations,
    trace,
    decision,
  };
}

export async function runCoordinatorAgent(
  message: string,
  session: TaskSession,
  context: ClassificationContext,
): Promise<CoordinatorResult> {
  if (!llmConfigured()) {
    return runDeterministicFallback(message, session, context, false);
  }

  try {
    return await runLlmToolCallingAgent(message, session, context);
  } catch (error) {
    console.warn('LLM tool-calling agent failed, fallback to deterministic coordinator:', error);
    return runDeterministicFallback(message, session, context, true, error);
  }
}
