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
