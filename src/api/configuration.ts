import type { ResolveConfigurationInput, ResolvedConfiguration, ValidateIntegerInput, ValidateMobileConfigurationInput } from './types.js'

const publicKeyPattern = /^[A-Za-z0-9_-]{16,256}$/u
const projectIdPattern = /^[A-Za-z0-9_-]{1,128}$/u
const localHosts = new Set(['127.0.0.1', '::1', 'localhost'])

const validateInteger = ({ maximum, minimum, name, value }: ValidateIntegerInput): number => {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
    }

    return value
}

const parseCollectorUrl = ({
    allowInsecureDevelopment,
    collectorUrl,
}: Pick<ValidateMobileConfigurationInput, 'allowInsecureDevelopment' | 'collectorUrl'>): URL => {
    const parsed = new URL(collectorUrl)

    if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
        throw new Error('collectorUrl must not contain credentials, query parameters, or a fragment.')
    }

    const isAllowedLocalHttp = allowInsecureDevelopment && parsed.protocol === 'http:' && localHosts.has(parsed.hostname)

    if (parsed.protocol !== 'https:' && !isAllowedLocalHttp) {
        throw new Error('collectorUrl must use HTTPS. Plain HTTP is allowed only for explicit local development.')
    }

    return parsed
}

export const validateMobileCredentials = ({
    allowInsecureDevelopment,
    collectorUrl,
    projectId,
    publicIngestKey,
}: ValidateMobileConfigurationInput): URL => {
    const parsed = parseCollectorUrl({ allowInsecureDevelopment, collectorUrl })

    if (!publicKeyPattern.test(publicIngestKey)) {
        throw new Error('publicIngestKey must contain 16-256 URL-safe characters.')
    }

    if (!projectIdPattern.test(projectId)) {
        throw new Error('projectId must contain 1-128 URL-safe characters.')
    }

    return parsed
}

const resolveTraceOrigins = (targets: ReadonlyArray<string>): ReadonlySet<string> =>
    new Set(
        targets.map(target => {
            const parsed = new URL(target)

            if (
                parsed.protocol !== 'https:' ||
                parsed.username !== '' ||
                parsed.password !== '' ||
                parsed.pathname !== '/' ||
                parsed.search !== '' ||
                parsed.hash !== ''
            ) {
                throw new Error(`Trace propagation target must be an exact HTTPS origin: ${target}`)
            }

            return parsed.origin
        }),
    )

export const resolveConfiguration = ({ options }: ResolveConfigurationInput): ResolvedConfiguration => {
    const allowInsecureDevelopment = options.allowInsecureDevelopment === true
    const traceOrigins = resolveTraceOrigins(options.tracePropagationTargets ?? [])
    const maxBreadcrumbs = options.maxBreadcrumbs ?? 50
    const maxCacheItems = options.maxCacheItems ?? 30
    const maxEventBytes = options.maxEventBytes ?? 200000
    const maxEnvelopeBytes = options.maxEnvelopeBytes ?? 500000
    const cacheItemTtlMs = options.cacheItemTtlMs ?? 86400000
    const retryBaseDelayMs = options.retryBaseDelayMs ?? 1000
    const retryMaxDelayMs = options.retryMaxDelayMs ?? 60000
    const dedupeWindowMs = options.dedupeWindowMs ?? 10000

    validateInteger({ maximum: 100, minimum: 0, name: 'maxBreadcrumbs', value: maxBreadcrumbs })
    validateInteger({ maximum: 100, minimum: 0, name: 'maxCacheItems', value: maxCacheItems })
    validateInteger({ maximum: 500000, minimum: 1024, name: 'maxEventBytes', value: maxEventBytes })
    validateInteger({ maximum: 1000000, minimum: 1024, name: 'maxEnvelopeBytes', value: maxEnvelopeBytes })
    validateInteger({ maximum: 604800000, minimum: 1000, name: 'cacheItemTtlMs', value: cacheItemTtlMs })
    validateInteger({ maximum: 60000, minimum: 100, name: 'retryBaseDelayMs', value: retryBaseDelayMs })
    validateInteger({ maximum: 600000, minimum: 100, name: 'retryMaxDelayMs', value: retryMaxDelayMs })
    validateInteger({ maximum: 60000, minimum: 0, name: 'dedupeWindowMs', value: dedupeWindowMs })

    if (maxEnvelopeBytes < maxEventBytes) {
        throw new Error('maxEnvelopeBytes must be greater than or equal to maxEventBytes.')
    }

    if (retryMaxDelayMs < retryBaseDelayMs) {
        throw new Error('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs.')
    }

    const collectorUrl = validateMobileCredentials({
        allowInsecureDevelopment,
        collectorUrl: options.collectorUrl,
        projectId: options.projectId,
        publicIngestKey: options.publicIngestKey,
    })

    return {
        collectorUrl,
        traceOrigins,
        autoInstrumentFetch: options.autoInstrumentFetch ?? traceOrigins.size > 0,
        autoInstrumentXhr: options.autoInstrumentXhr ?? traceOrigins.size > 0,
        maxBreadcrumbs,
        maxCacheItems,
        maxEventBytes,
        maxEnvelopeBytes,
        cacheItemTtlMs,
        retryBaseDelayMs,
        retryMaxDelayMs,
        dedupeWindowMs,
    }
}
