import { imageSize } from 'image-size'

const malformedIcns = Buffer.alloc(16)
malformedIcns.write('icns')
malformedIcns.writeUInt32BE(16, 4)
malformedIcns.write('ic07', 8)
malformedIcns.writeUInt32BE(0, 12)

const rejected = (() => {
    try {
        imageSize(malformedIcns)
        return false
    } catch (error) {
        return error instanceof Error && error.message === 'Invalid ICNS image entry length'
    }
})()

if (!rejected) {
    throw new Error('The image-size ICNS denial-of-service patch is missing or ineffective.')
}

// Fail the audit gate if the locally mitigated braces advisory becomes unpatched.
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
