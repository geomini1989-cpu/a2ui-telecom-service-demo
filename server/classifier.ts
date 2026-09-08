import type {Intent} from '../src/types.js';

export interface Classification {intent: Intent; parameters: Record<string, unknown>; classifier: 'mock'|'llm'}

export async function classify(message: string): Promise<Classification> {
  if (process.env.LLM_MODE === 'openai-compatible' && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    try { return await classifyWithLlm(message); } catch (error) { console.warn('LLM classifier failed, fallback to mock:', error); }
  }
  return {...mockClassify(message), classifier:'mock'};
}

function mockClassify(message: string): Omit<Classification,'classifier'> {
  const m = message.toLowerCase();
  const parameters: Record<string, unknown> = {};
  const size = m.match(/(10|20|30)\s*(?:g|gb)/i); if (size) parameters.sizeGb = Number(size[1]);
  if (/30\s*天/.test(m)) parameters.duration = '30d'; else if (/7\s*天/.test(m)) parameters.duration = '7d';
  if (/定向/.test(m)) parameters.type = 'directed'; else if (/通用/.test(m)) parameters.type = 'general';
  const month = m.match(/(\d{1,2})\s*月/); if (month) parameters.month = Number(month[1]);
  if (/分析|业务情况|趋势|销量|收入/.test(m)) return {intent:'business_analysis',parameters};
  if (/账单|消费|花了多少/.test(m)) return {intent:'bill_query',parameters};
  if (/办.*流量|买.*流量|加.*流量|流量包/.test(m)) return {intent:'traffic_purchase',parameters};
  if (/流量/.test(m)) return {intent:'traffic_query',parameters};
  if (/客服|人工/.test(m)) return {intent:'customer_service',parameters};
  return {intent:'account_query',parameters};
}

async function classifyWithLlm(message: string): Promise<Classification> {
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/,'');
  const response = await fetch(`${base}/chat/completions`, {method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${process.env.LLM_API_KEY}`},body:JSON.stringify({model:process.env.LLM_MODEL,temperature:0,messages:[{role:'system',content:'你是运营商任务意图分类器。只输出JSON。intent只能是 account_query, traffic_query, traffic_purchase, bill_query, business_analysis, customer_service。parameters可提取 sizeGb(10/20/30), duration(7d/30d), type(general/directed), month。不要输出UI或组件名。'},{role:'user',content:message}]})});
  if (!response.ok) throw new Error(`LLM ${response.status}`);
  const json = await response.json() as any;
  const text = json.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(String(text).replace(/```json|```/g,'').trim());
  return {intent:parsed.intent as Intent,parameters:parsed.parameters ?? {},classifier:'llm'};
}
