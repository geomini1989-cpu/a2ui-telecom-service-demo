export type Intent =
  | 'account_query'
  | 'traffic_query'
  | 'traffic_purchase'
  | 'bill_query'
  | 'business_analysis'
  | 'customer_service';

export interface DebugMeta {
  intent: Intent;
  parameters: Record<string, unknown>;
  skill: string;
  taskState: string;
  selectedCard: string;
  surfaceId: string;
  classifier: 'mock' | 'llm';
}

export interface AccountData {
  phone: string;
  planName: string;
  balance: number;
  traffic: {used: number; total: number; directedUsed: number; directedTotal: number};
  voice: {used: number; total: number};
  sms: {used: number; total: number};
}

export interface TrafficPackage {
  id: string;
  type: 'general' | 'directed';
  duration: '7d' | '30d';
  sizeGb: number;
  price: number;
  title: string;
}

export interface OrderData {
  packageId: string;
  title: string;
  sizeGb: number;
  duration: string;
  type: string;
  price: number;
  phone: string;
}

export interface AnalyticsData {
  ranges: Record<
    string,
    {
      labels: string[];
      activeUsers: number[];
      packageSales: number[];
      revenue: {name: string; value: number}[];
    }
  >;
}
