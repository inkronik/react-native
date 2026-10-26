import assert from 'node:assert/strict'
import { imageSize } from 'image-size'

// Buffer writes construct binary fixtures for the external parser API.
const malformedIcns = Buffer.from('69636e73000000106963303700000000', 'hex')
assert.throws(() => imageSize(malformedIcns), TypeError, 'ICNS must reject a zero-sized entry')

const box = ({ type, payload }) => {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(header.length + payload.length)
    header.write(type, 4)
    return Buffer.concat([header, payload])
}
const zeroSizedJxlBox = Buffer.from('000000006a786c70', 'hex')
const zeroSizedHeifBox = Buffer.from('0000000069737065000000000000000100000001', 'hex')
const malformedJxl = Buffer.concat([
    box({ type: 'JXL ', payload: Buffer.from('0d0a870a', 'hex') }),
    box({ type: 'ftyp', payload: Buffer.from('jxl ') }),
    zeroSizedJxlBox,
])
const malformedHeif = Buffer.concat([
    box({ type: 'ftyp', payload: Buffer.from('heic') }),
    box({
        type: 'meta',
        payload: Buffer.concat([Buffer.alloc(4), box({ type: 'iprp', payload: box({ type: 'ipco', payload: zeroSizedHeifBox }) })]),
    }),
])
assert.throws(() => imageSize(malformedJxl), TypeError, 'JXL must terminate when a container box has zero size')
assert.throws(() => imageSize(malformedHeif), TypeError, 'HEIF must terminate when a container box has zero size')

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7uoAAAAASUVORK5CYII=', 'base64')
assert.deepEqual(imageSize(validPng), { width: 1, height: 1, type: 'png' })
