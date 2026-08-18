import { describe, expect, test } from 'bun:test'

import { sanitizeEngineEvent } from './sanitize-event.js'

describe('engine event sanitization', () => {
    test('drops request, server name, and all user fields except opaque ID', () => {
        const result = sanitizeEngineEvent({
            message: 'authorization=super-secret',
            request: { cookies: { session: 'secret' }, headers: { authorization: 'secret' } },
            server_name: 'private-device-name',
            user: { email: 'person@example.com', id: 'user-123', ip_address: '127.0.0.1', name: 'Person' },
        })

        expect(result).toEqual({ message: 'authorization=[REDACTED]', user: { id: 'user-123' } })
    })

    test('redacts exception values, breadcrumbs, contexts, extras, and tags', () => {
        const result = sanitizeEngineEvent({
            breadcrumbs: [{ data: { setupToken: 'secret' }, message: 'safe' }],
            contexts: { payment: { cardNumber: '4111111111111111', outcome: 'declined' } },
            exceptions: [{ frames: [], handled: true, mechanism: 'manual', type: 'PaymentError', value: 'api_key=secret' }],
            extra: { password: 'secret' },
            tags: { authorization: 'secret', safe: 'visible' },
        })

        expect(result).toMatchObject({
            breadcrumbs: [{ data: { setupToken: '[REDACTED]' }, message: 'safe' }],
            contexts: { payment: { cardNumber: '[REDACTED]', outcome: 'declined' } },
            exceptions: [{ frames: [], handled: true, mechanism: 'manual', type: 'PaymentError', value: 'api_key=[REDACTED]' }],
            extra: { password: '[REDACTED]' },
            tags: { authorization: '[REDACTED]', safe: 'visible' },
        })
    })
})
