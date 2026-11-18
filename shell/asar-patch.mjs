/**
 * dsh-menu-hidden · asar 覆盖层（unpacked override）
 *
 * DSH 0.2.2 起桌面版把 `resources/app/` 打包成 `resources/app.asar`，外壳入口跟着搬进
 * `app.asar/lib/main.js`。以前那套「读文本 → 换一行 → 写回去」的路上多了两道墙：
 *
 *   1. `.asar` 是单文件归档，内部文件按 `offset` 定位，长度都写死在头部；
 *   2. 每个文件还带 per-file integrity（SHA256 + 4MB 分块），Electron 每次读都校验，
 *      对不上就 `ASAR Integrity Violation` 然后 exit(1)。
 *
 * 所以这里不走「往归档里塞字节」，而是用 Electron 自己支持的 unpacked 机制：
 * 把 `lib/main.js` 这个条目标成 `"unpacked": true`，正文改从
 * `<archive>.unpacked/lib/main.js` 读 —— 那个文件是普通文件，长度任意、内容任意、
 * 不参与 integrity 校验。归档里的原始正文一个字节都不动，还原时把条目改回 packed
 * 并重算 integrity，读到的还是原来那份。
 *
 * 头部 JSON 的长度必须保持不变（否则整个数据区要跟着平移 199MB），
 * 而删掉 main.js 的 integrity 对象正好腾出约 200 字节，塞进 `"unpacked":true` 还有富余；
 * 富余部分用空格补齐 —— `JSON.parse` 容忍尾随空白，Electron 读的也正是这串 JSON。
 *
 * 两条纪律：
 *   - 所有 fs 调用都包在 `process.noAsar = true` 里。Electron 给 fs 打了 asar 补丁，
 *     不关掉的话 `openSync('D:\\...\\app.asar', 'r+')` 会被当成「归档内路径」，
 *     报 `ENOENT: not found in ...app.asar`。
 *   - 改完必须重启应用：Electron 在进程内缓存了解析过的 asar 头部，
 *     同一个进程里再读还是老样子（实测）。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Electron 写进 asar 头部的分块大小。 */
export const ASAR_BLOCK_SIZE = 4194304
/** 头部 pickle 的固定开销：8 字节 pickle 头 + 8 字节 string 头。 */
const HEADER_BASE = 16

/**
 * 判断一个路径是不是「归档内的文件」（`...\app.asar\lib\main.js` 这种）。
 * @param {unknown} file - 任意路径。
 * @returns {boolean} 是则 true。
 */
export function isInsideAsar(file) {
  return typeof file === 'string' && /\.asar[\\/]/i.test(file)
}

/**
 * 拆出归档路径与归档内条目名。
 * @param {string} file - 形如 `D:\...\resources\app.asar\lib\main.js`。
 * @returns {{ archive: string, entry: string } | null} 拆不开则 null。
 */
export function splitAsarPath(file) {
  if (typeof file !== 'string') return null
  const match = /^(.*?\.asar)[\\/](.+)$/i.exec(file)
  if (match === null) return null
  const entry = match[2].replace(/\\/g, '/').replace(/^\/+/, '')
  if (entry === '') return null
  return { archive: match[1], entry }
}

/**
 * unpacked 目录里对应的真实文件路径。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {string} 覆盖文件路径。
 */
export function overridePath(archive, entry) {
  return join(`${archive}.unpacked`, ...entry.split('/'))
}

/**
 * 在 `process.noAsar = true` 的保护下跑一段同步代码。
 * @template T
 * @param {() => T} run - 要跑的同步逻辑。
 * @returns {T} 返回值。
 */
function withNoAsar(run) {
  const previous = process.noAsar
  process.noAsar = true
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.noAsar
    else process.noAsar = previous
  }
}

/**
 * 读满指定字节数。
 * @param {number} fd - 句柄。
 * @param {number} size - 字节数。
 * @param {number} position - 起始偏移。
 * @returns {Buffer} 内容。
 */
function readExact(fd, size, position) {
  const buffer = Buffer.allocUnsafe(size)
  let done = 0
  while (done < size) {
    const got = readSync(fd, buffer, done, size - done, position + done)
    if (got <= 0) throw new Error(`读到 ${done}/${size} 字节就结束了，归档可能被截断`)
    done += got
  }
  return buffer
}

/**
 * 头部 JSON 之后的填充字节数：asar 把头部 pickle 按 4 字节对齐，
 * 所以数据区起点是 `16 + align4(jsonLength)`，不是 `16 + jsonLength`。
 * 少算这几个字节会让所有条目读起来整体偏移，读到的正文是错位的垃圾。
 * @param {number} jsonLength - 头部 JSON 的字节数。
 * @returns {number} 对齐后的长度。
 */
function align4(jsonLength) {
  return (jsonLength + 3) & ~3
}

/**
 * 解析归档头。
 * @param {number} fd - 归档句柄。
 * @returns {{ header: any, jsonLength: number, dataStart: number }} 头信息。
 */
function readHeader(fd) {
  const prologue = readExact(fd, HEADER_BASE, 0)
  // [0..4) pickle 头 = 4；[4..8) 头部 pickle 的 payload 长度；[8..12) 该 pickle 的 size 前缀；
  // [12..16) 头部 JSON 字符串长度；[16..) JSON 本体；之后补齐到 4 字节边界才是数据区。
  if (prologue.readUInt32LE(0) !== 4) throw new Error('不是 asar 归档：头部 pickle 前缀异常')
  const jsonLength = prologue.readUInt32LE(12)
  return { header: JSON.parse(readExact(fd, jsonLength, HEADER_BASE).toString('utf8')), jsonLength, dataStart: HEADER_BASE + align4(jsonLength) }
}

/**
 * 按 `/` 分段在 `header.files` 里找条目。
 * @param {any} header - 头 JSON。
 * @param {string} entry - 归档内路径。
 * @returns {any | null} 条目对象（含 size/offset/integrity/unpacked）。
 */
function findEntry(header, entry) {
  let node = header
  for (const part of entry.split('/').filter((part) => part !== '')) {
    if (node === null || typeof node !== 'object' || node.files === null || typeof node.files !== 'object') return null
    node = node.files[part]
    if (node === undefined) return null
  }
  if (node === null || typeof node !== 'object' || typeof node.size !== 'number' || node.files !== undefined) return null
  return node
}

/**
 * 把缓冲区整段写到指定位置：`writeSync` 一次可能只写一部分（Windows 上尤其），
 * 剩下没写的部分必须接着补，否则头部就残缺了 —— 那是直接让应用起不来的事故。
 * @param {number} fd - 归档句柄。
 * @param {Buffer} buffer - 内容。
 * @param {number} position - 起始偏移。
 * @returns {void}
 */
function writeExact(fd, buffer, position) {
  let done = 0
  while (done < buffer.length) {
    const wrote = writeSync(fd, buffer, done, buffer.length - done, position + done)
    if (wrote <= 0) throw new Error(`写到 ${done}/${buffer.length} 字节就停了，归档可能被锁`)
    done += wrote
  }
}

/**
 * 头部 JSON 原长度写回，短的用空格补齐，写完立刻回读校验。
 * @param {number} fd - 归档句柄。
 * @param {any} header - 头对象。
 * @param {number} jsonLength - 原始 JSON 长度（字节）。
 * @returns {void}
 */
function writeHeader(fd, header, jsonLength) {
  let text = JSON.stringify(header)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > jsonLength) throw new Error(`头部变长了（${bytes} > ${jsonLength}），拒绝写回`)
  if (bytes < jsonLength) text += ' '.repeat(jsonLength - bytes)

  const buffer = Buffer.from(text, 'utf8')
  writeExact(fd, buffer, HEADER_BASE)

  // 回读校验：长度、字节、可解析性三项都得对上，否则宁可抛错也不留半截头部。
  const back = readExact(fd, jsonLength, HEADER_BASE)
  if (!back.equals(buffer)) throw new Error('头部回读与写入不一致（归档被占用或被回滚）')
  try {
    JSON.parse(back.toString('utf8'))
  } catch (error) {
    throw new Error(`头部回读无法解析：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 算 sha256 十六进制。
 * @param {Buffer} buffer - 内容。
 * @returns {string} 小写十六进制。
 */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 按 Electron 的算法算 integrity：整文件 hash + 每 4MB 一块。
 * @param {Buffer} buffer - 文件内容。
 * @param {number} blockSize - 块大小。
 * @returns {{ algorithm: 'SHA256', hash: string, blockSize: number, blocks: string[] }} integrity。
 */
export function fileIntegrity(buffer, blockSize = ASAR_BLOCK_SIZE) {
  const blocks = []
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    blocks.push(sha256Hex(buffer.subarray(offset, Math.min(offset + blockSize, buffer.length))))
  }
  return { algorithm: 'SHA256', hash: sha256Hex(buffer), blockSize, blocks }
}

/**
 * 归档里有没有这个条目。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {boolean} 有则 true。
 */
export function hasAsarEntry(archive, entry) {
  return withNoAsar(() => {
    let fd
    try {
      fd = openSync(archive, 'r')
      return findEntry(readHeader(fd).header, entry) !== null
    } catch {
      return false
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  })
}

/**
 * 读归档内一个条目的**原始**字节（走 packed 正文，不受覆盖层影响）。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {Buffer} 内容。
 */
export function readPackedEntry(archive, entry) {
  return withNoAsar(() => {
    const fd = openSync(archive, 'r')
    try {
      const { header, dataStart } = readHeader(fd)
      const found = findEntry(header, entry)
      if (found === null) throw new Error(`归档里没有 ${entry}`)
      return readExact(fd, found.size, dataStart + Number(found.offset))
    } finally {
      closeSync(fd)
    }
  })
}

/**
 * 读「实际生效」的正文：有覆盖文件读覆盖文件，没有就读 packed 正文。
 * 两者都是普通文件读 / 归档读，不经过 Electron 的 asar 层，所以同一进程内改完立刻可见。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {string} UTF-8 文本。
 */
export function readEffectiveText(archive, entry) {
  const override = overridePath(archive, entry)
  if (existsSync(override)) return withNoAsar(() => readFileSync(override, 'utf8'))
  return readPackedEntry(archive, entry).toString('utf8')
}

/**
 * 覆盖层是否已装（条目标了 unpacked 且覆盖文件在）。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {boolean} 已装则 true。
 */
export function isOverridden(archive, entry) {
  if (!existsSync(overridePath(archive, entry))) return false
  return withNoAsar(() => {
    let fd
    try {
      fd = openSync(archive, 'r')
      return findEntry(readHeader(fd).header, entry)?.unpacked === true
    } catch {
      return false
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  })
}

/**
 * 归档处于「半改」状态：条目说自己是 unpacked，覆盖文件却不在。
 *
 * 这是唯一会让 Electron 起不来的组合（读不到 main.js）。正常流程不会产生它，
 * 但断电、强杀进程、或者旧版本先改头部再写文件的顺序都可能留下这种残局，
 * 所以状态检查要能认出来，并且能一键收拾干净。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {boolean} 是半改状态则 true。
 */
export function isBrokenOverride(archive, entry) {
  return withNoAsar(() => {
    let fd
    try {
      fd = openSync(archive, 'r')
      const unpacked = findEntry(readHeader(fd).header, entry)?.unpacked === true
      return unpacked && !existsSync(overridePath(archive, entry))
    } catch {
      return false
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  })
}

/**
 * 安装 / 更新覆盖层：正文先落到 `.unpacked`，**最后**才把条目改标 unpacked（去掉 integrity）。
 *
 * 顺序是有讲究的：反过来的话，中途断电 / 进程被杀就会留下「条目说自己是 unpacked，
 * 覆盖文件却不存在」的状态，Electron 下次启动直接崩。现在最坏情况只是多了一个没人读的文件，
 * 归档仍是完整可启动的 packed 态。
 *
 * 幂等：已经是覆盖态时只重写覆盖文件，不动头部。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @param {string} text - 新的正文（长度任意）。
 * @returns {{ changed: boolean, bytes: number, headerTouched: boolean }} 结果。
 */
export function writeOverride(archive, entry, text) {
  const override = overridePath(archive, entry)
  const bytes = Buffer.byteLength(text, 'utf8')

  // 1) 先写覆盖文件：失败也不会让归档进入半改状态。
  mkdirSync(dirname(override), { recursive: true })
  writeFileSync(override, text, 'utf8')

  // 2) 再改头部；失败就把覆盖文件删掉，保持「没有覆盖层」的一致状态。
  return withNoAsar(() => {
    let headerTouched = false
    let fd
    try {
      fd = openSync(archive, 'r+')
      const { header, jsonLength } = readHeader(fd)
      const found = findEntry(header, entry)
      if (found === null) throw new Error(`归档里没有 ${entry}`)
      if (found.unpacked !== true || found.integrity !== undefined) {
        delete found.integrity
        found.unpacked = true
        writeHeader(fd, header, jsonLength)
        headerTouched = true
      }
    } catch (error) {
      if (!headerTouched && existsSync(override)) unlinkSync(override)
      throw error
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
    return { changed: true, bytes, headerTouched }
  })
}

/**
 * 卸掉覆盖层：删覆盖文件、条目改回 packed、按 packed 正文重算 integrity。
 *
 * packed 正文从头到尾没被动过，所以还原后 Electron 读到的就是原始 main.js（逐字节）。
 * @param {string} archive - 归档路径。
 * @param {string} entry - 条目名。
 * @returns {{ changed: boolean }} 结果。
 */
export function clearOverride(archive, entry) {
  const override = overridePath(archive, entry)
  return withNoAsar(() => {
    let changed = false
    const fd = openSync(archive, 'r+')
    try {
      const { header, jsonLength, dataStart } = readHeader(fd)
      const found = findEntry(header, entry)
      if (found === null) throw new Error(`归档里没有 ${entry}`)
      if (found.unpacked === true || found.integrity === undefined) {
        const packed = readExact(fd, found.size, dataStart + Number(found.offset))
        delete found.unpacked
        found.integrity = fileIntegrity(packed)
        writeHeader(fd, header, jsonLength)
        changed = true
      }
    } finally {
      closeSync(fd)
    }
    if (existsSync(override)) {
      unlinkSync(override)
      changed = true
    }
    return { changed }
  })
}

/**
 * 归档本身的字节数（走 noAsar，否则 stat 会把 `.asar` 当目录返回 size 0）。
 * @param {string} archive - 归档路径。
 * @returns {number} 字节数。
 */
export function asarSize(archive) {
  return withNoAsar(() => statSync(archive).size)
}
