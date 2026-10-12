import {test,expect,type Page} from '@playwright/test';
async function send(page:Page,text:string) {
  await page.getByPlaceholder('输入你想查询或办理的内容...').fill(text);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
}
test('restores a pending confirmation after refresh and applies it once',async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
  await send(page,'给我办个20G 30天通用流量包');
  await page.getByRole('button',{name:'去确认',exact:true}).click();
  await expect(page.locator('.confirm-card')).toBeVisible();
  await page.reload();await expect(page.locator('.confirm-card')).toBeVisible();
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
  await page.screenshot({path:'test-results/confirmation-restored.png',fullPage:true});
  await page.getByRole('button',{name:'确认办理',exact:true}).click();
  await expect(page.getByRole('heading',{name:'模拟办理成功'})).toBeVisible();
  await page.getByRole('button',{name:'返回账户总览',exact:true}).click();
  await expect(page.locator('.balance-block')).toContainText('38.8');
  await page.reload();await expect(page.locator('.balance-block')).toContainText('38.8');
  expect(errors).toEqual([]);
});
test('handles insufficient balance and presents affordable packages',async ({page}) => {
  await page.goto('/');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
  await send(page,'给我办个100G 30天通用流量包');
  await page.getByRole('button',{name:'去确认',exact:true}).click();
  await expect(page.getByText('余额不足',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'看看便宜套餐',exact:true}).click();
  const latest=page.locator('.package-card').last();
  await expect(latest).toBeVisible();await expect(latest).not.toContainText('100GB');
  await latest.getByRole('button').filter({hasText:'20GB通用流量·30天'}).click();
  await latest.getByRole('button',{name:'去确认',exact:true}).click();
  await expect(page.locator('.confirm-card')).toBeVisible();
});
test('shows an API conflict and restores the current card after another tab changes the session',async ({page}) => {
  await page.goto('/');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
  await send(page,'给我办个20G 30天通用流量包');
  const id=await page.evaluate(()=>localStorage.getItem('telecom-session-id'));
  const saved=await page.request.get(`/api/session/${id}`).then(r=>r.json());
  await page.request.post('/api/chat/stream',{data:{sessionId:id,message:'查一下我的套餐',expectedVersion:saved.version}});
  await page.getByRole('button',{name:'去确认',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('界面已失效');
  await expect(page.locator('.account-card')).toBeVisible();
  await page.getByRole('button',{name:'恢复会话',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
