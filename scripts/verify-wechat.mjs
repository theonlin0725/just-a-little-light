// 微信包静态校验：结构、体积、可解析、关键能力都在。
//   node scripts/verify-wechat.mjs
// 真机/开发者工具的行为验证不在这里，见 docs/WECHAT-QA.md。

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'wechat');
let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fail++;
};

const files = ['game.js', 'game.json', 'project.config.json', 'build-info.json'];
for (const f of files) {
  try {
    const st = await stat(path.join(OUT, f));
    ok(st.isFile() && st.size > 0, `${f} 存在 (${(st.size / 1024).toFixed(1)} KB)`);
  } catch {
    ok(false, `${f} 缺失`);
  }
}

const gameJs = await readFile(path.join(OUT, 'game.js'), 'utf8');
const gameJson = JSON.parse(await readFile(path.join(OUT, 'game.json'), 'utf8'));
const projectJson = JSON.parse(await readFile(path.join(OUT, 'project.config.json'), 'utf8'));
const info = JSON.parse(await readFile(path.join(OUT, 'build-info.json'), 'utf8'));

ok(gameJson.deviceOrientation === 'portrait', 'game.json 竖屏');
ok(projectJson.compileType === 'game', 'project.config.json 是小游戏工程 (compileType=game)');
ok(typeof projectJson.libVersion === 'string' && projectJson.libVersion.length > 0, `基础库 ${projectJson.libVersion}`);

// 语法：能被 JS 引擎解析（不执行）
let parseOk = true;
try {
  // eslint-disable-next-line no-new-func
  new Function(gameJs);
} catch (e) {
  parseOk = false;
  console.log('  解析错误:', e.message);
}
ok(parseOk, 'game.js 可被解析');

const kb = Buffer.byteLength(gameJs) / 1024;
ok(kb < 4096, `主包 ${kb.toFixed(1)} KB < 4 MB（无需分包）`);

// 关键能力确实被编进包里
ok(gameJs.includes('wx.createRewardedVideoAd'), '包含真实激励视频调用');
ok(gameJs.includes('getSystemInfoSync'), '包含设备信息适配');
ok(gameJs.includes('onTouchStart') && gameJs.includes('onTouchEnd'), '包含触摸适配');
ok(gameJs.includes('onHide') && gameJs.includes('onShow'), '包含前后台生命周期');
ok(gameJs.includes('setStorageSync'), '包含微信存储');
ok(gameJs.includes('createCanvas'), '包含小游戏画布');
ok(info.buildId && gameJs.includes(info.buildId), `包内自报 buildId 与 build-info 一致 (${info.buildId})`);
{
  const real = createHash('sha256').update(Buffer.from(gameJs, 'utf8')).digest('hex');
  ok(info.sha256 === real, `build-info 的 sha256 与最终产物一致 (${real.slice(0, 12)}…)`);
}
ok(info.qa === false, '正式包不含 QA 调试入口');
ok(!/unlockAll|jumpTo|grantSkin/.test(gameJs), '正式包没有跳关/解锁/模拟奖励代码');

console.log(`\n${fail ? `✗ ${fail} 项未通过` : '✓ 微信包静态检查全部通过'}`);
console.log(`  appid    ${info.appid || '(未配置)'}`);
console.log(`  adUnitId ${info.adUnitId || '(未配置)'}`);
console.log(`  QA 入口  ${info.qa ? '包含（勿直接提审）' : '已移除'}`);
process.exit(fail ? 1 : 0);
