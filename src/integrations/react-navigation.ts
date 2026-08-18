/* eslint-disable functional/no-let -- The adapter retains only the last sanitized route name for deduplication. */
import { addBreadcrumb, setContext } from '../api/runtime.js'
import { redactText } from '../privacy/sanitize.js'
import type { CreateReactNavigationAdapterInput, CreateReactNavigationInstrumentationInput, ReactNavigationInstrumentation } from './types.js'

export const createReactNavigationAdapter = ({
    addBreadcrumb: addBreadcrumbValue,
    getCurrentRoute,
    setContext: setContextValue,
}: CreateReactNavigationAdapterInput): ReactNavigationInstrumentation => {
    let currentRoute: string | undefined

    const synchronizeRoute = (): void => {
        const nextRoute = getCurrentRoute()
        const routeWithoutQuery = nextRoute?.name.split(/[?#]/u, 1)[0]
        const nextRouteName = routeWithoutQuery === undefined ? undefined : redactText(routeWithoutQuery)

        if (nextRouteName === undefined || nextRouteName === '' || nextRouteName === currentRoute) {
            return
        }

        const previousRoute = currentRoute
        currentRoute = nextRouteName
        setContextValue({ name: 'navigation', value: { route: nextRouteName } })
        addBreadcrumbValue({
            category: 'navigation',
            level: 'info',
            message: nextRouteName,
            data: { ...(previousRoute === undefined ? {} : { from: previousRoute }), to: nextRouteName },
        })
    }

    return { onReady: synchronizeRoute, onStateChange: synchronizeRoute }
}

export const createReactNavigationInstrumentation = ({
    getCurrentRoute,
}: CreateReactNavigationInstrumentationInput): ReactNavigationInstrumentation =>
    createReactNavigationAdapter({ addBreadcrumb, getCurrentRoute, setContext })
