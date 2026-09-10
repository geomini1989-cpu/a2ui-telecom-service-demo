import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const out = 'artifacts/demo-story';
await fs.mkdir(out, {recursive: true});

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1680, height: 1350}, deviceScaleFactor: 1});

async function waitReady() {
  await page.goto('http://localhost:5173', {waitUntil: 'networkidle'});
  await page.waitForSelector('input[placeholder*="输入你想查询"]');
}

async function waitIdle() {
  await page.waitForTimeout(300);
  await page.waitForSelector('.typing', {state: 'detached', timeout: 15000}).catch(()=>{});
  await page.waitForTimeout(900);
}

async function submit(text) {
  const input = page.locator('input[placeholder*="输入你想查询"]');
  await input.fill(text);
  await input.press('Enter');
  await waitIdle();
}

async function shot(name) {
  await page.screenshot({path: `${out}/${name}.png`, fullPage: true});
}

await waitReady();
const debugToggle = page.locator('.app-header input[type="checkbox"]');
if (await debugToggle.isChecked()) await debugToggle.uncheck();

await submit('我最近刷视频特别猛，月底估计顶不住，看看有没有适合我的方案');
await shot('01-agent-recommendation');

await page.getByRole('button', {name: '去确认'}).click();
await waitIdle();
await shot('02-insufficient-balance');

await page.getByRole('button', {name: '看看便宜套餐'}).click();
await waitIdle();
await shot('03-affordable-packages');

const package20 = page.locator('.package-option').filter({hasText: '20GB通用流量·30天'});
await package20.click();
await page.waitForTimeout(400);
await shot('04-reselect-20gb');

await page.getByRole('button', {name: '去确认'}).click();
await waitIdle();
await shot('05-order-confirm');

await page.getByRole('button', {name: '确认办理'}).click();
await waitIdle();
await shot('06-order-success');

await waitReady();
await submit('我最近刷视频特别猛，月底估计顶不住，看看有没有适合我的方案');
await shot('07-debug-trace');

await browser.close();
