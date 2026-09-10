import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const out = 'artifacts/demo-screenshots';
await fs.mkdir(out, {recursive: true});

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1600, height: 1200}, deviceScaleFactor: 1});

async function waitReady() {
  await page.goto('http://127.0.0.1:5173', {waitUntil: 'networkidle'});
  await page.waitForSelector('input[placeholder*="输入你想查询"]');
}

async function submit(text) {
  const input = page.locator('input[placeholder*="输入你想查询"]');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForSelector('.typing', {state: 'visible'}).catch(()=>{});
  await page.waitForSelector('.typing', {state: 'detached', timeout: 10000}).catch(()=>{});
  await page.waitForTimeout(800);
}

async function shot(name) {
  await page.screenshot({path: `${out}/${name}.png`, fullPage: true});
}

await waitReady();
await submit('查一下我的套餐');
await shot('01-account-overview');

await waitReady();
await submit('我的流量还剩多少？');
await shot('02-traffic-detail');

await waitReady();
await submit('给我办个20G 30天通用流量包');
await shot('03-package-selection');

const confirmButton = page.getByRole('button', {name: '去确认'});
if (await confirmButton.count()) {
  await confirmButton.first().click();
  await page.waitForTimeout(1200);
  await shot('04-order-confirm');
}

await waitReady();
await submit('给我办100G 30天通用流量包');
await shot('05-basic-catalog-insufficient-balance');

await waitReady();
await submit('看看最近业务情况');
await shot('06-analytics');
await submit('换成半年');
await shot('07-analytics-update-datamodel');

await browser.close();
