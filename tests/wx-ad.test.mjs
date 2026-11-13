// 微信激励视频状态机单测（用假的 wx，不是真机验收）
//   node tests/wx-ad.test.mjs

const { ads, ERROR_TEXT } = await import('../src/ads.js');

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeWx({ isEndedSeq = [], error = null, showFails = 0 } = {}) {
  let instance = null;
  const log = { created: 0, show: 0, load: 0 };
  const wx = {
    __log: log,
    __ad: () => instance,
    createRewardedVideoAd({ adUnitId }) {
      log.created++;
      log.adUnitId = adUnitId;
      const close = [];
      const errCbs = [];
      let shows = 0;
      instance = {
        onClose(f) { close.push(f); },
        onError(f) { errCbs.push(f); },
        load() { log.load++; return Promise.resolve(); },
        show() {
          log.show++;
          shows++;
          if (shows <= showFails) return Promise.reject({ errCode: 1000, errMsg: 'show fail' });
          return Promise.resolve();
        },
        __close(res) { close.forEach((f) => f(res)); },
        __error(e) { errCbs.forEach((f) => f(e)); },
      };
      return instance;
    },
  };
  return wx;
}

console.log('\n[1] 配成 wx 但环境没有广告 API → 不可用，且不回退模拟');
{
  ads._reset();
  console.log('\n[8] 广告位为空时绝不创建实例');
{
  ads._reset();
  const wx = fakeWx();
  globalThis.wx = wx;
  ads.configure({ provider: 'wx', adUnitId: '' });
  const res = await ads.showRewarded(() => {});
  ok(res.status === 'unavailable', '返回 unavailable');
  ok(wx.__log.created === 0, '没有调用 createRewardedVideoAd');
}

delete globalThis.wx;
  ads.configure({ provider: 'wx', adUnitId: 'adunit-x' });
  const t0 = Date.now();
  const res = await ads.showRewarded(() => {});
  ok(res.status === 'unavailable', '返回 unavailable');
  ok(Date.now() - t0 < 500, '没有退回 4.5 秒模拟播放器');
}

console.log('\n[2] 完整观看才发奖');
{
  ads._reset();
  globalThis.wx = fakeWx();
  ads.configure({ provider: 'wx', adUnitId: 'adunit-1' });
  const p = ads.showRewarded(() => {});
  await wait(10);
  ok(wx.__log.created === 1 && wx.__log.adUnitId === 'adunit-1', '用配置的广告位创建了实例');
  ok(wx.__log.show === 1, '调用了 show');
  wx.__ad().__close({ isEnded: true });
  const res = await p;
  ok(res.status === 'completed', 'isEnded=true → completed');
}

console.log('\n[3] 提前关闭 / 缺 isEnded 都不发奖');
{
  for (const [res, label] of [[{ isEnded: false }, 'isEnded=false'], [undefined, '无参数']]) {
    ads._reset();
    globalThis.wx = fakeWx();
    ads.configure({ provider: 'wx', adUnitId: 'adunit-1' });
    const p = ads.showRewarded(() => {});
    await wait(10);
    wx.__ad().__close(res);
    const r = await p;
    ok(r.status === 'cancelled', `${label} → cancelled`);
  }
}

console.log('\n[4] 错误映射：无填充 / 单元无效');
{
  for (const [code, want] of [[1004, 'nofill'], [1002, 'unavailable'], [1000, 'error']]) {
    ads._reset();
    globalThis.wx = fakeWx();
    ads.configure({ provider: 'wx', adUnitId: 'adunit-1' });
    const p = ads.showRewarded(() => {});
    await wait(10);
    wx.__ad().__error({ errCode: code, errMsg: 'x' });
    const r = await p;
    ok(r.status === want, `errCode ${code} → ${want}`);
  }
  ok(!!ERROR_TEXT.nofill && !!ERROR_TEXT.unavailable, '错误文案齐全');
}

console.log('\n[5] 并发展示只接受一个请求');
{
  ads._reset();
  globalThis.wx = fakeWx();
  ads.configure({ provider: 'wx', adUnitId: 'adunit-1' });
  const p1 = ads.showRewarded(() => {});
  const p2 = ads.showRewarded(() => {});
  const r2 = await p2;
  ok(r2.status === 'busy', '第二次请求返回 busy');
  await wait(10);
  wx.__ad().__close({ isEnded: true });
  ok((await p1).status === 'completed', '第一个请求正常完成');
}

console.log('\n[6] show 失败会重试一次');
{
  ads._reset();
  globalThis.wx = fakeWx({ showFails: 1 });
  ads.configure({ provider: 'wx', adUnitId: 'adunit-1' });
  const p = ads.showRewarded(() => {});
  await wait(20);
  ok(wx.__log.load >= 1 && wx.__log.show >= 2, `失败后 load+show 重试（load ${wx.__log.load} / show ${wx.__log.show}）`);
  wx.__ad().__close({ isEnded: true });
  ok((await p).status === 'completed', '重试成功后可以完成');
}

console.log('\n[7] 已结算的请求不会被迟到的回调二次触发');
{
  ads._reset();
  globalThis.wx = fakeWx();
  ads.configure({ provider: 'wx', adUnitId: 'adunit-1' });
  let rewards = 0;
  const p = ads.showRewarded(() => {});
  await wait(10);
  wx.__ad().__close({ isEnded: true });
  const r = await p;
  if (r.status === 'completed') rewards++;
  wx.__ad().__close({ isEnded: true }); // 迟到 / 重复回调
  await wait(20);
  ok(rewards === 1, '奖励只计一次');
  ok(ads.isBusy() === false, '状态已复位，可以再次请求');
}

console.log('\n[8] 广告位为空时绝不创建实例');
{
  ads._reset();
  const wx = fakeWx();
  globalThis.wx = wx;
  ads.configure({ provider: 'wx', adUnitId: '' });
  const res = await ads.showRewarded(() => {});
  ok(res.status === 'unavailable', '返回 unavailable');
  ok(wx.__log.created === 0, '没有调用 createRewardedVideoAd');
}

delete globalThis.wx;
console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
