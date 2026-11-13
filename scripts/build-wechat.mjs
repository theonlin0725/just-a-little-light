// 构建微信小游戏工程。
//
//   npm run build:wechat          # 两个产物：wechat/（正式干净）+ wechat-dev/（带 QA 口）
//   npm run build:wechat:release  # 只构建 wechat/
//
// wechat/      提审/上传用：QA 入口被替换成空模块，minify 后彻底消失
// wechat-dev/  自测用：带跳关 / 解锁 / 模拟奖励，绝不能上传

import { build } from 'esbuild';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(await readFile(path.join(ROOT, 'config/wechat.config.json'), 'utf8'));
const appid = process.env.WX_APPID || cfg.appid || '';
const adUnitId = process.env.WX_AD_UNIT_ID || cfg.adUnitId || '';
const onlyRelease = process.argv.includes('--release-only');

const stubPath = path.join(ROOT, 'config', '.qa-stub.js');
await writeFile(stubPath, 'export function installQa() {}\n');

const qaStubPlugin = {
  name: 'qa-stub',
  setup(b) {
    b.onResolve({ filter: /qa-wx\.js$/ }, () => ({ path: stubPath }));
  },
};

async function bundleInto(outDir, { qa, minify }) {
  const OUT = path.join(ROOT, outDir);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const common = {
    entryPoints: [path.join(ROOT, 'src/main-wx.js')],
    bundle: true,
    format: 'iife',
    target: ['es2017'],
    charset: 'utf8', // 中文保持可读，也省体积（\uXXXX 是 6 字节，UTF-8 是 3 字节）
    platform: 'neutral',
    outfile: path.join(OUT, 'game.js'),
    legalComments: 'none',
    minify,
    plugins: qa ? [] : [qaStubPlugin],
    logLevel: 'warning',
  };

  // 先构建一遍拿哈希，再把 buildId 写回包内，保证自报版本与产物一致
  await build({ ...common, define: { __WX_AD_UNIT_ID__: JSON.stringify(adUnitId), __WX_QA__: 'true', __WX_BUILD_ID__: JSON.stringify('pending') } });
  const first = await readFile(path.join(OUT, 'game.js'));
  const buildId = createHash('sha256').update(first).digest('hex').slice(0, 12);
  await build({ ...common, define: { __WX_AD_UNIT_ID__: JSON.stringify(adUnitId), __WX_QA__: qa ? 'true' : 'false', __WX_BUILD_ID__: JSON.stringify(buildId) } });

  await writeFile(path.join(OUT, 'game.json'), JSON.stringify({
    deviceOrientation: 'portrait',
    showStatusBar: false,
    networkTimeout: { request: 10000, connectSocket: 10000, uploadFile: 10000, downloadFile: 10000 },
  }, null, 2));

  await writeFile(path.join(OUT, 'project.config.json'), JSON.stringify({
    appid: appid || 'touristappid',
    projectname: cfg.projectname,
    description: cfg.description,
    compileType: 'game',
    libVersion: cfg.libVersion,
    setting: { urlCheck: false, es6: false, enhance: false, postcss: false, minified: false, uglyCompile: false },
    packOptions: { ignore: [], include: [] },
  }, null, 2));

  const body = await readFile(path.join(OUT, 'game.js'));
  // buildId 只是包内自报的标签（来自第一遍构建），真正的产物身份用最终文件哈希
  const sha256 = createHash('sha256').update(body).digest('hex');
  const info = {
    buildId,
    builtAt: new Date().toISOString(),
    channel: qa ? 'qa' : 'release',
    appid: appid || null,
    adUnitId: adUnitId || null,
    qa,
    minified: minify,
    libVersion: cfg.libVersion,
    bytes: body.length,
    sha256,
    files: ['game.js', 'game.json', 'project.config.json'],
  };
  await writeFile(path.join(OUT, 'build-info.json'), JSON.stringify(info, null, 2));
  return { outDir, info };
}

const results = [];
if (!process.env.ONLY_QA) results.push(await bundleInto('wechat', { qa: false, minify: true }));
if (!onlyRelease) results.push(await bundleInto('wechat-dev', { qa: true, minify: false }));

for (const { outDir, info } of results) {
  console.log(`${outDir}/  ${info.channel}  ${(info.bytes / 1024).toFixed(1)} KB  buildId=${info.buildId}`);
  console.log(`  sha256   ${info.sha256}`);
}
console.log(`  appid     ${appid || '(未配置，占位 touristappid)'}`);
console.log(`  adUnitId  ${adUnitId || '(未配置，激励视频会返回不可用)'}`);
if (!appid) console.log('\n没有 AppID：只能本地导入体验，上传与体验版二维码需要你填入真实 AppID。');
