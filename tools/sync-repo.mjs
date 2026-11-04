// 把 plugin/ 的产物同步进 repo/（发布副本），并抹掉本机专有的包名。
// 发布副本里 loader id 必须等于包名 dsh-menu-hidden；本机装的那份是 @local/...。
import fs from 'node:fs'
import path from 'node:path'

const require_json = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'package.json'), 'utf8'))
const ROOT = 'D:/DeepSeek/projects/DSH-MenuHidden'
const LOCAL_ID = '@local/dsh-menu-hidden'
const PUBLIC_ID = 'dsh-menu-hidden'

const atomic = (p, s) => { fs.writeFileSync(p + '.tmp', s, 'utf8'); fs.renameSync(p + '.tmp', p) }
const notes = []

for (const file of ['client.js', 'index.js', 'reasoning.js']) {
  let text = fs.readFileSync(path.join(ROOT, 'plugin', file), 'utf8')
  if (file === 'client.js') {
    text = text.replaceAll(`id: "${LOCAL_ID}"`, `id: "${PUBLIC_ID}"`)
    text = text.replace(/const VERSION = "[^"]*"/, `const VERSION = "${require_json().version}"`)
  }
  atomic(path.join(ROOT, 'repo', file), text)
  notes.push(`${file} synced`)
}

const localPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'package.json'), 'utf8'))
const repoPath = path.join(ROOT, 'repo', 'package.json')
const repoPkg = JSON.parse(fs.readFileSync(repoPath, 'utf8'))
repoPkg.version = localPkg.version
repoPkg.name = PUBLIC_ID
atomic(repoPath, JSON.stringify(repoPkg, null, 2) + '\n')
notes.push(`package.json ${repoPkg.version}`)

const left = fs.readFileSync(path.join(ROOT, 'repo', 'client.js'), 'utf8').includes(LOCAL_ID)
notes.push(left ? 'ERROR: 发布副本里还有 @local 包名' : 'loader id clean')
console.log(notes.join('\n'))
