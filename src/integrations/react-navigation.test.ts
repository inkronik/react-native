import { describe, expect, test } from 'bun:test'

import type { BreadcrumbInput, SetContextInput } from '../types.js'
import { createReactNavigationAdapter } from './react-navigation.js'

describe('React Navigation instrumentation', () => {
    test('records only sanitized route names and suppresses unchanged routes', () => {
        const breadcrumbs: Array<BreadcrumbInput> = []
        const contexts: Array<SetContextInput> = []
        const state = { route: { name: 'Orders?token=secret' } }
        const integration = createReactNavigationAdapter({
            addBreadcrumb: breadcrumb => breadcrumbs.push(breadcrumb),
            getCurrentRoute: () => state.route,
            setContext: context => contexts.push(context),
        })

        integration.onReady()
        integration.onStateChange()
        state.route = { name: 'OrderDetails' }
        integration.onStateChange()

        expect(breadcrumbs).toHaveLength(2)
        expect(contexts).toHaveLength(2)
        expect(JSON.stringify([breadcrumbs, contexts])).not.toContain('secret')
        expect(contexts[1]).toEqual({ name: 'navigation', value: { route: 'OrderDetails' } })
    })
})
