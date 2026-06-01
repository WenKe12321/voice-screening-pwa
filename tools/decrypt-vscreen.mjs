import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const VERIFIER = 'voice-screening-vault-ready'

function usage() {
  console.log('用法: npm run decrypt:vscreen -- <输入文件.vscreen> [输出文件.json]')
}

function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('请在交互式终端中运行此命令，以便安全输入访问口令。')
  }
  return new Promise((resolveSecret, reject) => {
    let value = ''
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const onData = (character) => {
      if (character === '\u0003') {
        cleanup()
        reject(new Error('已取消解密。'))
        return
      }
      if (character === '\r' || character === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolveSecret(value)
        return
      }
      if (character === '\u0008' || character === '\u007f') {
        if (value) {
          value = value.slice(0, -1)
          process.stdout.write('\b \b')
        }
        return
      }
      value += character
      process.stdout.write('*')
    }
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdin.on('data', onData)
  })
}

function decryptPayload(key, payload) {
  const encrypted = Buffer.from(payload.ciphertext, 'base64')
  const authenticationTag = encrypted.subarray(encrypted.length - 16)
  const ciphertext = encrypted.subarray(0, encrypted.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
  decipher.setAuthTag(authenticationTag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    usage()
    process.exitCode = 1
    return
  }
  const absoluteInput = resolve(inputPath)
  const outputPath = resolve(process.argv[3] ?? absoluteInput.replace(/\.vscreen$/i, '') + '.decrypted.json')
  const researchPackage = JSON.parse(readFileSync(absoluteInput, 'utf8'))
  if (researchPackage.format !== 'voice-screening-research-package') throw new Error('这不是有效的 .vscreen 研究包。')
  if (researchPackage.schemaVersion !== 2 || !researchPackage.vaultMetadata) {
    throw new Error('这是旧版导出包，缺少独立解密所需的盐值。请回到原浏览器，从本地记录重新导出。')
  }
  const passphrase = process.env.VSCREEN_PASSPHRASE ?? await readSecret('请输入本地保险箱访问口令: ')
  const { salt, iterations, verifier } = researchPackage.vaultMetadata
  const key = pbkdf2Sync(passphrase, Buffer.from(salt, 'base64'), iterations, 32, 'sha256')
  const marker = decryptPayload(key, verifier)
  if (marker.marker !== VERIFIER) throw new Error('访问口令不正确。')
  const decrypted = decryptPayload(key, researchPackage.session.payload)
  writeFileSync(outputPath, JSON.stringify(decrypted, null, 2), 'utf8')
  console.log(`解密完成: ${outputPath}`)
}

main().catch((error) => {
  console.error(`解密失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
