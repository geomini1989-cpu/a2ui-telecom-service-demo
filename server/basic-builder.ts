export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
export const VERSION = 'v0.9.1' as const;

const action = (name: string, context?: Record<string, unknown>) => ({
  event: {name, ...(context ? {context} : {})},
});

export function insufficientBalanceSurface(
  surfaceId: string,
  input: {balance: number; price: number; packageTitle: string},
) {
  const missing = Math.max(0, input.price - input.balance);
  return [
    {version: VERSION, createSurface: {surfaceId, catalogId: BASIC_CATALOG_ID}},
    {
      version: VERSION,
      updateComponents: {
        surfaceId,
        components: [
          {id: 'root', component: 'Card', child: 'body'},
          {id: 'body', component: 'Column', children: ['title', 'desc', 'divider', 'detail', 'actions']},
          {id: 'title', component: 'Text', text: '余额不足', variant: 'h3'},
          {
            id: 'desc',
            component: 'Text',
            text: `当前余额 ¥${input.balance.toFixed(1)}，${input.packageTitle} 需要 ¥${input.price}。`,
            variant: 'body',
          },
          {id: 'divider', component: 'Divider', axis: 'horizontal'},
          {id: 'detail', component: 'Text', text: `还差 ¥${missing.toFixed(1)}。你可以选择更便宜的套餐，或返回账户总览。`, variant: 'body'},
          {id: 'actions', component: 'Row', children: ['affordable', 'back'], justify: 'spaceBetween', align: 'center'},
          {id: 'affordable', component: 'Button', child: 'affordableText', variant: 'primary', action: action('show_affordable_packages', {maxPrice: input.balance})},
          {id: 'affordableText', component: 'Text', text: '看看便宜套餐'},
          {id: 'back', component: 'Button', child: 'backText', variant: 'default', action: action('back_account')},
          {id: 'backText', component: 'Text', text: '返回账户'},
        ],
      },
    },
  ];
}
