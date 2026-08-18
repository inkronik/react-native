import { describe, expect, test } from 'bun:test'

import { resolveConfiguration, validateMobileCredentials } from './configuration.js'

const validKey = 'public_mobile_key_1234567890'

describe('mobile configuration', () => {
    test('validates an Inkronik collector URL without encoding credentials into it', () => {
        expect(
            validateMobileCredentials({
                allowInsecureDevelopment: false,
                collectorUrl: 'https://collector.inkronik.codemask.dev',
                projectId: 'mobile-app',
                publicIngestKey: validKey,
            }),
        ).toEqual(new URL('https://collector.inkronik.codemask.dev'))
    })

    test('rejects credentials, insecure remote endpoints, and secret-like invalid keys', () => {
        expect(() =>
            validateMobileCredentials({
                allowInsecureDevelopment: false,
                collectorUrl: 'http://collector.example',
                projectId: 'project',
                publicIngestKey: validKey,
            }),
        ).toThrow('HTTPS')
        expect(() =>
            validateMobileCredentials({
                allowInsecureDevelopment: false,
                collectorUrl: 'https://user:password@collector.example',
                projectId: 'project',
                publicIngestKey: validKey,
            }),
        ).toThrow('credentials')
        expect(() =>
            validateMobileCredentials({
                allowInsecureDevelopment: false,
                collectorUrl: 'https://collector.example',
                projectId: 'project',
                publicIngestKey: 'too short',
            }),
        ).toThrow('publicIngestKey')
    })

    test('allows HTTP only for explicit local development', () => {
        expect(
            validateMobileCredentials({
                allowInsecureDevelopment: true,
                collectorUrl: 'http://127.0.0.1:8080',
                projectId: 'local',
                publicIngestKey: validKey,
            }),
        ).toEqual(new URL('http://127.0.0.1:8080'))
    })

    test('accepts only exact HTTPS trace origins', () => {
        const configuration = resolveConfiguration({
            options: {
                collectorUrl: 'https://collector.example',
                projectId: 'project',
                publicIngestKey: validKey,
                tracePropagationTargets: ['https://api.example'],
            },
        })

        expect(configuration.traceOrigins).toEqual(new Set(['https://api.example']))
        expect(() =>
            resolveConfiguration({
                options: {
                    collectorUrl: 'https://collector.example',
                    projectId: 'project',
                    publicIngestKey: validKey,
                    tracePropagationTargets: ['https://api.example/private'],
                },
            }),
        ).toThrow('exact HTTPS origin')
    })

    test('resolves bounded queue defaults and rejects inconsistent byte and retry limits', () => {
        const configuration = resolveConfiguration({
            options: {
                collectorUrl: 'https://collector.example',
                projectId: 'project',
                publicIngestKey: validKey,
            },
        })

        expect(configuration).toMatchObject({
            cacheItemTtlMs: 86_400_000,
            dedupeWindowMs: 10_000,
            maxBreadcrumbs: 50,
            maxCacheItems: 30,
            maxEnvelopeBytes: 500_000,
            maxEventBytes: 200_000,
            retryBaseDelayMs: 1_000,
            retryMaxDelayMs: 60_000,
        })
        expect(() =>
            resolveConfiguration({
                options: {
                    collectorUrl: 'https://collector.example',
                    maxEnvelopeBytes: 2_000,
                    maxEventBytes: 3_000,
                    projectId: 'project',
                    publicIngestKey: validKey,
                },
            }),
        ).toThrow('maxEnvelopeBytes')
        expect(() =>
            resolveConfiguration({
                options: {
                    collectorUrl: 'https://collector.example',
                    projectId: 'project',
                    publicIngestKey: validKey,
                    retryBaseDelayMs: 2_000,
                    retryMaxDelayMs: 1_000,
                },
            }),
        ).toThrow('retryMaxDelayMs')
    })
})
