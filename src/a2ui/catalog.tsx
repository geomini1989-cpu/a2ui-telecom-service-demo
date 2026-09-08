import {z} from 'zod';
import ReactECharts from 'echarts-for-react';
import {Catalog, CommonSchemas} from '@a2ui/web_core/v0_9';
import {createComponentImplementation} from '@a2ui/react/v0_9';
import type {AccountData, AnalyticsData, OrderData, TrafficPackage} from '../types';

import {TELECOM_CATALOG_ID} from './constants';

export {TELECOM_CATALOG_ID};

const pct = (used: number, total: number) => Math.min(100, Math.round((used / total) * 100));

function LoadingCard() {
  return <section className="telecom-card"><div className="typing">正在同步 A2UI DataModel<span>•••</span></div></section>;
}

function UsageLine({label, used, total, unit}: {label: string; used: number; total: number; unit: string}) {
  return (
    <div className="usage-line">
      <div className="usage-line__top">
        <span>{label}</span>
        <strong>余{Math.max(0, total - used).toFixed(unit === 'GB' ? 1 : 0)}{unit}</strong>
      </div>
      <div className="usage-line__bar"><i style={{width: `${pct(used, total)}%`}} /></div>
      <small>已用 {used}{unit} · 共 {total}{unit}</small>
    </div>
  );
}

const AccountOverviewCardApi = {
  name: 'AccountOverviewCard',
  schema: z.object({
    data: CommonSchemas.DynamicValue,
    onViewTraffic: CommonSchemas.Action,
    onViewBill: CommonSchemas.Action,
    onBuyTraffic: CommonSchemas.Action,
  }),
};

const AccountOverviewCard = createComponentImplementation(AccountOverviewCardApi, ({props}) => {
  const data = props.data as unknown as AccountData | undefined;
  if (!data?.traffic || !data?.voice || !data?.sms) return <LoadingCard />;
  return (
    <section className="telecom-card account-card">
      <div className="card-eyebrow">AI专属服务为您查询到以下信息：</div>
      <div className="account-card__identity">
        <strong>{data.phone}</strong><span>{data.planName}</span>
      </div>
      <div className="balance-block"><small>当前可用余额</small><div><b>¥ {data.balance.toFixed(1)}</b><span>元</span></div></div>
      <div className="metric-grid">
        <div><span>通用流量</span><b>{data.traffic.used}GB</b><small>/ 共{data.traffic.total}GB</small></div>
        <div><span>语音通话</span><b>{data.voice.used}分钟</b><small>/ 共{data.voice.total}分钟</small></div>
        <div><span>短信</span><b>{data.sms.used}条</b><small>/ 共{data.sms.total}条</small></div>
      </div>
      <h3 className="section-title">用量明细</h3>
      <UsageLine label="通用流量" used={data.traffic.used} total={data.traffic.total} unit="GB" />
      <UsageLine label="定向流量" used={data.traffic.directedUsed} total={data.traffic.directedTotal} unit="GB" />
      <UsageLine label="语音通话" used={data.voice.used} total={data.voice.total} unit="分钟" />
      <UsageLine label="短信" used={data.sms.used} total={data.sms.total} unit="条" />
      <div className="card-actions three">
        <button onClick={props.onViewBill}>查账单</button>
        <button onClick={props.onBuyTraffic}>办流量</button>
        <button onClick={props.onViewTraffic}>看流量</button>
      </div>
    </section>
  );
});

const TrafficDetailCardApi = {
  name: 'TrafficDetailCard',
  schema: z.object({
    data: CommonSchemas.DynamicValue,
    onBuyTraffic: CommonSchemas.Action,
    onBack: CommonSchemas.Action,
  }),
};
const TrafficDetailCard = createComponentImplementation(TrafficDetailCardApi, ({props}) => {
  const data = props.data as unknown as AccountData | undefined;
  if (!data?.traffic) return <LoadingCard />;
  const remaining = data.traffic.total - data.traffic.used;
  return (
    <section className="telecom-card">
      <div className="card-heading"><div><small>流量详情</small><h2>剩余 {remaining.toFixed(1)}GB</h2></div><span className="chip">本月</span></div>
      <UsageLine label="通用流量" used={data.traffic.used} total={data.traffic.total} unit="GB" />
      <UsageLine label="定向流量" used={data.traffic.directedUsed} total={data.traffic.directedTotal} unit="GB" />
      <div className="notice">按当前使用速度预计可使用约 12 天。</div>
      <div className="card-actions"><button className="ghost" onClick={props.onBack}>返回</button><button onClick={props.onBuyTraffic}>办理流量包</button></div>
    </section>
  );
});

const TrafficPackageCardApi = {
  name: 'TrafficPackageCard',
  schema: z.object({
    packages: CommonSchemas.DynamicValue,
    selectedType: CommonSchemas.DynamicString,
    selectedDuration: CommonSchemas.DynamicString,
    selectedPackageId: CommonSchemas.DynamicString,
    onSubmit: CommonSchemas.Action,
    onBack: CommonSchemas.Action,
  }),
};
const TrafficPackageCard = createComponentImplementation(TrafficPackageCardApi, ({props}) => {
  const packages = Array.isArray(props.packages) ? (props.packages as unknown as TrafficPackage[]) : [];
  const visible = packages.filter(p => p.type === props.selectedType && p.duration === props.selectedDuration);
  const selected = packages.find(p => p.id === props.selectedPackageId);
  return (
    <section className="telecom-card package-card">
      <div className="card-heading"><div><small>流量加油包</small><h2>选择适合你的规格</h2></div><span className="chip">可办理</span></div>
      <div className="filter-block"><label>流量类型</label><div className="segmented">
        <button className={props.selectedType === 'general' ? 'active' : ''} onClick={() => props.setSelectedType('general')}>通用流量</button>
        <button className={props.selectedType === 'directed' ? 'active' : ''} onClick={() => props.setSelectedType('directed')}>定向流量</button>
      </div></div>
      <div className="filter-block"><label>有效期</label><div className="segmented">
        <button className={props.selectedDuration === '7d' ? 'active' : ''} onClick={() => props.setSelectedDuration('7d')}>7天</button>
        <button className={props.selectedDuration === '30d' ? 'active' : ''} onClick={() => props.setSelectedDuration('30d')}>30天</button>
      </div></div>
      <div className="package-list">
        {visible.map(item => <button key={item.id} className={`package-option ${props.selectedPackageId === item.id ? 'selected' : ''}`} onClick={() => props.setSelectedPackageId(item.id)}>
          <span><b>{item.sizeGb}GB</b><small>{item.title}</small></span><strong>¥{item.price}</strong>
        </button>)}
      </div>
      <div className="selection-summary"><span>当前选择</span><b>{selected ? `${selected.title} · ¥${selected.price}` : '请选择套餐'}</b></div>
      <div className="card-actions"><button className="ghost" onClick={props.onBack}>返回</button><button disabled={!selected} onClick={props.onSubmit}>去确认</button></div>
    </section>
  );
});

const OrderConfirmCardApi = {
  name: 'OrderConfirmCard',
  schema: z.object({data: CommonSchemas.DynamicValue, onConfirm: CommonSchemas.Action, onCancel: CommonSchemas.Action}),
};
const OrderConfirmCard = createComponentImplementation(OrderConfirmCardApi, ({props}) => {
  const data = props.data as unknown as OrderData | undefined;
  if (!data?.packageId) return <LoadingCard />;
  return <section className="telecom-card confirm-card">
    <div className="confirm-icon">✓</div><h2>确认办理</h2><p>请确认以下业务信息</p>
    <dl><div><dt>手机号</dt><dd>{data.phone}</dd></div><div><dt>流量包</dt><dd>{data.title}</dd></div><div><dt>有效期</dt><dd>{data.duration}</dd></div><div><dt>费用</dt><dd className="price">¥{data.price}</dd></div></dl>
    <div className="card-actions"><button className="ghost" onClick={props.onCancel}>取消</button><button onClick={props.onConfirm}>确认办理</button></div>
  </section>;
});

const ResultCardApi = {
  name: 'ResultCard',
  schema: z.object({data: CommonSchemas.DynamicValue, onBack: CommonSchemas.Action}),
};
const ResultCard = createComponentImplementation(ResultCardApi, ({props}) => {
  const data = props.data as unknown as {title: string; description: string} | undefined;
  if (!data?.title) return <LoadingCard />;
  return <section className="telecom-card result-card"><div className="result-mark">✓</div><h2>{data.title}</h2><p>{data.description}</p><button className="primary-wide" onClick={props.onBack}>返回账户总览</button></section>;
});

const BillCardApi = {
  name: 'BillCard',
  schema: z.object({data: CommonSchemas.DynamicValue, onBack: CommonSchemas.Action}),
};
const BillCard = createComponentImplementation(BillCardApi, ({props}) => {
  const data = props.data as unknown as {month: string; total: number; items: {label: string; value: number}[]} | undefined;
  if (!data?.items) return <LoadingCard />;
  return <section className="telecom-card"><div className="card-heading"><div><small>{data.month}</small><h2>本月账单 ¥{data.total.toFixed(2)}</h2></div><span className="chip">已出账</span></div><div className="bill-list">{data.items.map(i => <div key={i.label}><span>{i.label}</span><b>¥{i.value.toFixed(2)}</b></div>)}</div><button className="primary-wide" onClick={props.onBack}>返回账户</button></section>;
});

const AnalyticsCardApi = {
  name: 'AnalyticsCard',
  schema: z.object({data: CommonSchemas.DynamicValue, selectedRange: CommonSchemas.DynamicString}),
};
const AnalyticsCard = createComponentImplementation(AnalyticsCardApi, ({props}) => {
  const data = props.data as unknown as AnalyticsData | undefined;
  if (!data?.ranges) return <LoadingCard />;
  const current = data.ranges[props.selectedRange] ?? data.ranges['30d'];
  const axis = {axisLine: {lineStyle: {color: '#77719b'}}, axisLabel: {color: '#b7b0d9', fontSize: 10}, splitLine: {lineStyle: {color: 'rgba(255,255,255,.08)'}}};
  return <section className="telecom-card analytics-card">
    <div className="analytics-title"><i /><div><h2>数据可视化组件</h2><p>折线 / 柱状 / 环形三类稳定业务视图</p></div></div>
    <div className="segmented analytics-filter"><button className={props.selectedRange==='7d'?'active':''} onClick={()=>props.setSelectedRange('7d')}>近7天</button><button className={props.selectedRange==='30d'?'active':''} onClick={()=>props.setSelectedRange('30d')}>近30天</button><button className={props.selectedRange==='6m'?'active':''} onClick={()=>props.setSelectedRange('6m')}>近半年</button></div>
    <ChartBox title="用户活跃趋势"><ReactECharts style={{height: 165}} option={{grid:{left:34,right:14,top:26,bottom:28},xAxis:{type:'category',data:current.labels,...axis},yAxis:{type:'value',...axis},series:[{type:'line',data:current.activeUsers,smooth:true,symbolSize:6,lineStyle:{width:3},areaStyle:{opacity:.08}}],tooltip:{trigger:'axis'}}}/></ChartBox>
    <ChartBox title="套餐销量对比"><ReactECharts style={{height: 165}} option={{grid:{left:34,right:14,top:24,bottom:28},xAxis:{type:'category',data:current.labels,...axis},yAxis:{type:'value',...axis},series:[{type:'bar',data:current.packageSales,barWidth:'42%',itemStyle:{borderRadius:[4,4,0,0]}}],tooltip:{trigger:'axis'}}}/></ChartBox>
    <ChartBox title="业务收入构成"><ReactECharts style={{height: 190}} option={{legend:{orient:'vertical',right:4,top:'middle',textStyle:{color:'#ddd8f2',fontSize:10}},series:[{type:'pie',radius:['42%','67%'],center:['34%','50%'],label:{show:false},data:current.revenue}],tooltip:{trigger:'item'}}}/></ChartBox>
  </section>;
});

function ChartBox({title, children}: {title: string; children: React.ReactNode}) {return <div className="chart-box"><h3>{title}</h3>{children}</div>}

export const telecomCatalog = new Catalog(TELECOM_CATALOG_ID, [
  AccountOverviewCard,
  TrafficDetailCard,
  TrafficPackageCard,
  OrderConfirmCard,
  ResultCard,
  BillCard,
  AnalyticsCard,
]);
