// 验证 asar 布局那套补丁：写覆盖层、撤销、逐字节回到官方正文。
// 不碰真实安装的 app.asar，全部在临时目录里造一个迷你归档。
// 用法：node test/shell-asar.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearOverride,
  fileIntegrity,
  hasAsarEntry,
  isBrokenOverride,
  isOverridden,
  overridePath,
  readEffectiveText,
  readPackedEntry,
  splitAsarPath,
  writeOverride,
} from '../shell/asar-patch.mjs'

const root = path.resolve(import.meta.dirname, '..')
const cliPath = path.join(root, 'shell', 'patch-shell-menu.mjs')

let failures = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` → got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`)
}

// ---- 1) 路径拆分 ----
check('拆 asar 内路径', splitAsarPath('D:\\App\\resources\\app.asar\\lib\\main.js'), { archive: 'D:\\App\\resources\\app.asar', entry: 'lib/main.js' })
check('拆正斜杠', splitAsarPath('D:/App/resources/app.asar/lib/main.js'), { archive: 'D:/App/resources/app.asar', entry: 'lib/main.js' })
check('普通文件拆不开', splitAsarPath('D:\\App\\resources\\app\\lib\\main.js'), null)
check('unpacked 目录不算归档内', splitAsarPath('D:\\App\\resources\\app.asar.unpacked\\lib\\main.js'), null)
check('覆盖文件路径', overridePath('D:\\App\\app.asar', 'lib/main.js'), path.join('D:\\App\\app.asar.unpacked', 'lib', 'main.js'))

// ---- 2) 造一个迷你 asar（头部布局与真实 app.asar 一致） ----
const original = [
  'const development = !app.isPackaged',
  'const applicationItems = () => [',
  '  aboutMenu,',
  '  { type: "separator" },',
  '  ...development ? [',
  '    { label: "刷新页面", role: "reload" },',
  '    { label: "重启应用与 Host" },',
  '  ] : [],',
  '  { role: "quit" },',
  ']',
  '',
].join('\n')

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'menuhidden-asar-'))
const archive = path.join(sandbox, 'app.asar')

/**
 * 按 Electron 的字段顺序造归档：16 字节 pickle 头 + 头 JSON + 4 字节对齐填充 + 数据区。
 *
 * 填充这一步是真实格式的一部分（真实 app.asar 的头部 5,671,389 字节，补到 5,671,392 才是数据区）。
 * 少了它，读出来的正文整体偏移，测试也测不出这个坑，所以这里照真实格式补。
 * @param {string} body - `lib/main.js` 的正文。
 * @returns {Buffer} 归档字节。
 */
function buildArchive(body) {
  const packed = Buffer.from(body, 'utf8')
  const header = { files: { lib: { files: { 'main.js': { size: packed.length, offset: '0', integrity: fileIntegrity(packed) } } } } }
  let json = JSON.stringify(header)
  // 故意让头部长度不是 4 的倍数，逼出对齐填充，否则这条坑测不到。
  for (let index = 0; Buffer.byteLength(json, 'utf8') % 4 === 0 && index < 4; index += 1) {
    header[`_pad${index}`] = index
    json = JSON.stringify(header)
  }
  const jsonLength = Buffer.byteLength(json, 'utf8')
  const aligned = (jsonLength + 3) & ~3
  const prologue = Buffer.alloc(16)
  prologue.writeUInt32LE(4, 0)
  prologue.writeUInt32LE(aligned + 8, 4)
  prologue.writeUInt32LE(aligned + 4, 8)
  prologue.writeUInt32LE(jsonLength, 12)
  return Buffer.concat([prologue, Buffer.from(json, 'utf8'), Buffer.alloc(aligned - jsonLength), packed])
}

const pristine = buildArchive(original)
fs.writeFileSync(archive, pristine)
const entryPath = `${archive}${path.sep}lib${path.sep}main.js`

/**
 * 读归档的原始字节（绕开 Electron 的 asar 层）。
 * @returns {Buffer} 内容。
 */
function readArchive() {
  process.noAsar = true
  try {
    return fs.readFileSync(archive)
  } finally {
    delete process.noAsar
  }
}

/**
 * 解析当前头部，顺带拿到 JSON 长度。
 * @param {Buffer} buf - 归档字节。
 * @returns {{ header: any, jsonLength: number, dataStart: number }} 头信息。
 */
function parseHeader(buf) {
  const jsonLength = buf.readUInt32LE(12)
  const aligned = (jsonLength + 3) & ~3
  return { header: JSON.parse(buf.subarray(16, 16 + jsonLength).toString('utf8')), jsonLength, aligned, dataStart: 16 + aligned }
}

// 头部长度不是 4 的倍数才有填充，这个断言保证下面确实测到了填充那 3 个字节。
check('头部需要 4 字节对齐填充', parseHeader(readArchive()).aligned > parseHeader(readArchive()).jsonLength, true)

check('归档里有条目', hasAsarEntry(archive, 'lib/main.js'), true)
check('归档里没乱写的条目', hasAsarEntry(archive, 'lib/nope.js'), false)
check('初始 packed 正文', readPackedEntry(archive, 'lib/main.js').toString('utf8') === original, true)
check('初始未被覆盖', isOverridden(archive, 'lib/main.js'), false)
check('初始生效正文', readEffectiveText(archive, 'lib/main.js') === original, true)

// ---- 3) 写覆盖层 ----
const before = parseHeader(readArchive())
const patchedText = original.replace('...development ? [', '...(development || true) ? [')
writeOverride(archive, 'lib/main.js', patchedText)

const after = parseHeader(readArchive())
check('头部 JSON 长度没变', after.jsonLength, before.jsonLength)
check('条目被标成 unpacked', after.header.files.lib.files['main.js'].unpacked, true)
check('条目 integrity 被删掉', after.header.files.lib.files['main.js'].integrity, undefined)
check('正在被覆盖', isOverridden(archive, 'lib/main.js'), true)
check('生效正文是补丁版', readEffectiveText(archive, 'lib/main.js').includes('...(development || true) ? ['), true)
check('覆盖文件真的写出来了', fs.readFileSync(overridePath(archive, 'lib/main.js'), 'utf8') === patchedText, true)
check('packed 正文一个字没动', readPackedEntry(archive, 'lib/main.js').toString('utf8') === original, true)
check('归档数据区没平移', readArchive().subarray(after.dataStart).equals(pristine.subarray(before.dataStart)), true)
check('归档总长度没变', readArchive().length, pristine.length)

// 幂等：再写一次不重复动头
writeOverride(archive, 'lib/main.js', patchedText)
check('重复写入头部长度仍然没变', parseHeader(readArchive()).jsonLength, before.jsonLength)

// ---- 4) 卸掉覆盖层，逐字节回到原样 ----
clearOverride(archive, 'lib/main.js')
check('卸掉后没在覆盖', isOverridden(archive, 'lib/main.js'), false)
check('覆盖文件被删掉', fs.existsSync(overridePath(archive, 'lib/main.js')), false)
check('生效正文回到原样', readEffectiveText(archive, 'lib/main.js') === original, true)
const restored = parseHeader(readArchive())
check('integrity 被重算回来', restored.header.files.lib.files['main.js'].integrity.hash, fileIntegrity(Buffer.from(original, 'utf8')).hash)
check('unpacked 标记被移除', restored.header.files.lib.files['main.js'].unpacked, undefined)
check('还原后整个归档逐字节一致', readArchive().equals(pristine), true)
check('干净状态下不算半改', isBrokenOverride(archive, 'lib/main.js'), false)

// ---- 4B) 半改残局（条目 unpacked、覆盖文件被删）能被认出来，并且一次还原就修好 ----
writeOverride(archive, 'lib/main.js', patchedText)
fs.rmSync(overridePath(archive, 'lib/main.js'), { force: true })
check('残局被认出来', isBrokenOverride(archive, 'lib/main.js'), true)
check('残局下不算已覆盖', isOverridden(archive, 'lib/main.js'), false)
clearOverride(archive, 'lib/main.js')
check('修好后不再算半改', isBrokenOverride(archive, 'lib/main.js'), false)
check('修好后归档逐字节回到原样', readArchive().equals(pristine), true)

// ---- 5) CLI 直接对着归档内路径跑 apply / revert ----
const run = (...args) => execFileSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' })
const status = JSON.parse(run('--file', entryPath))
check('CLI 认出 asar 布局', status.asar, true)
check('CLI 初始未打补丁', status.patched, false)
check('CLI 初始 originalHits', status.originalHits, 1)
check('CLI 提示要重启', status.needsRestart, true)

const applied = JSON.parse(run('--apply', '--file', entryPath))
check('CLI apply ok', applied.ok, true)
check('CLI apply 是自检模式', applied.mode, 'self-check')
check('CLI apply 后覆盖生效', applied.override, true)
check('CLI apply 后归档内是自检代码', fs.readFileSync(overridePath(archive, 'lib/main.js'), 'utf8').includes('node_modules'), true)
check('CLI apply 不碰归档正文', readArchive().subarray(parseHeader(readArchive()).dataStart).equals(pristine.subarray(before.dataStart)), true)

const reverted = JSON.parse(run('--revert', '--file', entryPath))
check('CLI revert ok', reverted.ok, true)
check('CLI revert 后未覆盖', reverted.override, false)
check('CLI revert 后逐字节回到官方正文', readArchive().equals(pristine), true)

// 归档正文本身被老版本改过（0.2.26/0.2.27 的恒真标记）时，revert 也要能收干净
const legacyBody = original.replace('...development ? [', '...(development || true) ? [')
fs.writeFileSync(archive, buildArchive(legacyBody))
const legacyBytes = readArchive()
const cleaned = JSON.parse(run('--revert', '--file', entryPath))
check('脏归档 revert ok', cleaned.ok, true)
check('脏归档 revert 后落成自检外的原样', readEffectiveText(archive, 'lib/main.js').includes('...development ? ['), true)
check('脏归档 revert 没重写数据区', readArchive().subarray(parseHeader(readArchive()).dataStart).equals(legacyBytes.subarray(parseHeader(legacyBytes).dataStart)), true)

fs.rmSync(sandbox, { recursive: true, force: true })
console.log(JSON.stringify({ ok: failures === 0, failures }))
process.exit(failures === 0 ? 0 : 1)
