import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Bound the regression probe so an infinite-loop regression fails instead of hanging CI.
const imageSizeCheck = spawnSync(process.execPath, [fileURLToPath(new URL('./verify-image-size.mjs', import.meta.url))], {
    encoding: 'utf8',
    timeout: 5000,
})
assert.equal(imageSizeCheck.error, undefined, `image-size regression probe failed: ${imageSizeCheck.error?.message}`)
assert.equal(imageSizeCheck.status, 0, `image-size regression probe failed:\n${imageSizeCheck.stderr || imageSizeCheck.stdout}`)

// Retain the existing braces depth-limit hardening even though its advisory was withdrawn.
const { default: braces } = await import('braces')
const nestedPattern = '{'.repeat(150) + 'a,b' + '}'.repeat(150)
for (const operation of ['parse', 'compile', 'expand', 'stringify']) {
    const rejectsDepth = (() => {
        try {
            braces[operation](nestedPattern)
            return false
        } catch (error) {
            return error instanceof SyntaxError && error.message === 'Brace nesting exceeds maximum depth'
        }
    })()
    if (!rejectsDepth) throw new Error(`The braces depth patch is missing or ineffective for ${operation}.`)
}
if (JSON.stringify(braces.expand('src/{engine,api}/*.ts')) !== JSON.stringify(['src/engine/*.ts', 'src/api/*.ts'])) {
    throw new Error('The braces depth patch broke ordinary brace expansion.')
}
for (const operation of ['compile', 'expand', 'stringify']) {
    const ast = Array.from({ length: 150 }).reduce(child => ({ type: 'root', nodes: [child] }), { type: 'text', value: 'a' })
    const rejectsAstDepth = (() => {
        try {
            braces[operation](ast)
            return false
        } catch (error) {
            return error instanceof SyntaxError && error.message === 'Brace nesting exceeds maximum depth'
        }
    })()
    if (!rejectsAstDepth) throw new Error(`The braces AST depth patch is missing or ineffective for ${operation}.`)
}
