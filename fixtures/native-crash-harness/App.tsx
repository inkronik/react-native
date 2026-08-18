import React, { useEffect, useMemo, useState } from 'react'
import { Button, NativeModules, Platform, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { init, isInitialized, setUser } from '@inkronik/react-native'

import { crashCases, findCrashCase } from './src/cases'
import type {
    AwaitAcknowledgementInput,
    CrashCaseDefinition,
    CrashCaseId,
    CrashFixtureModule,
    HarnessResult,
    HarnessStatus,
    NativeQueueModule,
} from './src/types'
import { validateAcknowledgement, validateDeliveredEnvelope } from './src/validation'

/* eslint-disable functional/immutable-data -- This isolated test app installs a reversible mock collector and owns UI lifecycle state. */

const COLLECTOR_URL = 'https://collector.inkronik.codemask.dev'
const COLLECTOR_ENDPOINT = `${COLLECTOR_URL}/v1/mobile/envelopes`
const RELEASE = 'dev.inkronik.native-crash-harness@0.1.0+1'
const PROJECT_ID = 'native-crash-harness'
const PUBLIC_INGEST_KEY = 'public_native_crash_harness_key'
const ACKNOWLEDGEMENT_DELAY_MS = 250
const DEFAULT_ACKNOWLEDGEMENT_ATTEMPTS = 12

const fixture = NativeModules.InkronikCrashFixture as CrashFixtureModule
const nativeQueue = NativeModules.Inkronik as NativeQueueModule

const expectedUserId = (caseId: CrashCaseId): string => `fixture-user-${caseId}`
const delay = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds))
const writeResult = (result: HarnessResult): Promise<boolean> => fixture.writeResult(JSON.stringify(result))
const optionalCrashCase = (caseId: string | null | undefined): CrashCaseDefinition | undefined =>
    caseId === null || caseId === undefined ? undefined : findCrashCase(caseId)

const awaitAcknowledgement = async ({
    eventId,
    nativeQueue: queue,
    maximumAttempts = DEFAULT_ACKNOWLEDGEMENT_ATTEMPTS,
}: AwaitAcknowledgementInput): Promise<void> => {
    const verify = async (remainingAttempts: number): Promise<void> => {
        const pendingEventsJson = await queue.drainPendingEvents()
        try {
            validateAcknowledgement({ eventId, pendingEventsJson })
        } catch (error) {
            if (remainingAttempts <= 1) throw error
            await delay(ACKNOWLEDGEMENT_DELAY_MS)
            return verify(remainingAttempts - 1)
        }
    }
    return verify(maximumAttempts)
}

const requestUrl = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    return input.url
}

const requestBody = (input: RequestInfo | URL, init?: RequestInit): string => {
    if (typeof init?.body === 'string') return init.body
    if (typeof input !== 'string' && !(input instanceof URL) && typeof input.body === 'string') return input.body
    throw new Error('Fixture collector requires a string envelope body')
}

const App = (): React.JSX.Element => {
    const [status, setStatus] = useState<HarnessStatus>({ kind: 'waiting', message: 'Checking restart state…' })
    const platformCases = useMemo(() => crashCases.filter(crashCase => crashCase.platform === Platform.OS), [])

    useEffect(() => {
        const originalFetch = globalThis.fetch
        const lifecycle = { mounted: true }
        const activeCase: { value?: CrashCaseDefinition } = {}

        const start = async (): Promise<void> => {
            const [pendingCaseId, requestedCaseId] = await Promise.all([fixture.getPendingCase(), fixture.getRequestedCase()])
            const pendingCase = optionalCrashCase(pendingCaseId)
            const requestedCase = optionalCrashCase(requestedCaseId)
            if (requestedCase !== undefined && requestedCase.platform !== Platform.OS) {
                throw new Error(`Requested case ${requestedCase.id} is not available on ${Platform.OS}`)
            }
            if (pendingCase !== undefined && requestedCase !== undefined && pendingCase.id !== requestedCase.id) {
                throw new Error(`Pending case ${pendingCase.id} conflicts with requested case ${requestedCase.id}`)
            }
            activeCase.value = pendingCase ?? requestedCase

            globalThis.fetch = (async (input, requestInit) => {
                if (requestUrl(input) !== COLLECTOR_ENDPOINT) return originalFetch(input, requestInit)
                if (pendingCase === undefined) throw new Error('Unexpected native envelope without an armed crash case')

                const result = validateDeliveredEnvelope({
                    body: requestBody(input, requestInit),
                    crashCase: pendingCase,
                    expectedRelease: RELEASE,
                    expectedUserId: expectedUserId(pendingCase.id),
                })
                void awaitAcknowledgement({ eventId: result.eventId, nativeQueue }).then(
                    async () => {
                        await writeResult({
                            caseId: pendingCase.id,
                            message: `delivered, minimized and acknowledged (${result.frameCount} frames)`,
                            status: 'passed',
                        })
                        await fixture.clearPendingCase()
                        if (lifecycle.mounted) {
                            setStatus({
                                kind: 'passed',
                                message: `${pendingCase.id}: delivered, minimized and acknowledged (${result.frameCount} frames)`,
                            })
                        }
                    },
                    async error => {
                        await writeResult({
                            caseId: pendingCase.id,
                            message: error instanceof Error ? error.message : String(error),
                            status: 'failed',
                        }).catch(() => false)
                        if (lifecycle.mounted) setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
                    },
                )
                return { status: 202 } as Response
            }) as typeof globalThis.fetch

            if (!isInitialized()) {
                init({
                    collectorUrl: COLLECTOR_URL,
                    publicIngestKey: PUBLIC_INGEST_KEY,
                    projectId: PROJECT_ID,
                    release: RELEASE,
                    environment: 'native-crash-fixture',
                    maxCacheItems: 10,
                })
            }

            if (!lifecycle.mounted) return
            if (pendingCase !== undefined) {
                setStatus({
                    kind: 'waiting',
                    message:
                        pendingCase.delivery === 'os-delayed'
                            ? `${pendingCase.id}: waiting for delayed OS diagnostics; relaunch again after delivery.`
                            : `${pendingCase.id}: waiting for restart delivery…`,
                })
                return
            }
            if (requestedCase !== undefined) {
                const persisted = await fixture.prepareCase(requestedCase.id)
                if (!persisted) throw new Error('Could not persist the requested crash case')
                setUser({ id: expectedUserId(requestedCase.id) })
                setStatus({ kind: 'armed', message: `${requestedCase.id}: armed by runner; triggering in 750 ms…` })
                setTimeout(() => fixture.trigger(requestedCase.id), 750)
                return
            }
            setStatus({ kind: 'ready', message: 'Choose one destructive case. The application will terminate or hang.' })
        }

        void start().catch(async error => {
            const crashCase = activeCase.value
            if (crashCase !== undefined) {
                await writeResult({
                    caseId: crashCase.id,
                    message: error instanceof Error ? error.message : String(error),
                    status: 'failed',
                }).catch(() => false)
            }
            if (lifecycle.mounted) setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
        })
        return () => {
            lifecycle.mounted = false
            globalThis.fetch = originalFetch
        }
    }, [])

    const arm = async (crashCase: CrashCaseDefinition): Promise<void> => {
        try {
            const persisted = await fixture.prepareCase(crashCase.id)
            if (!persisted) throw new Error('Could not persist the armed crash case')
            setUser({ id: expectedUserId(crashCase.id) })
            setStatus({ kind: 'armed', message: `${crashCase.id}: armed; triggering in 750 ms…` })
            setTimeout(() => fixture.trigger(crashCase.id), 750)
        } catch (error) {
            setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
        }
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.title}>Inkronik native crash harness</Text>
                <Text selectable style={[styles.status, styles[status.kind]]}>
                    {status.message}
                </Text>
                {platformCases.map(crashCase => (
                    <View key={crashCase.id} style={styles.caseRow}>
                        <Text selectable style={styles.caseName}>
                            {crashCase.id}
                        </Text>
                        <Text style={styles.caseDetail}>{crashCase.delivery}</Text>
                        <Button title="Arm and trigger" disabled={status.kind === 'armed'} onPress={() => void arm(crashCase)} />
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#0d1117', flex: 1 },
    content: { gap: 16, padding: 20 },
    title: { color: '#f0f6fc', fontSize: 24, fontWeight: '700' },
    status: { borderRadius: 8, color: '#f0f6fc', padding: 12 },
    ready: { backgroundColor: '#1f6f43' },
    armed: { backgroundColor: '#9e6a03' },
    waiting: { backgroundColor: '#1f4b99' },
    passed: { backgroundColor: '#238636' },
    failed: { backgroundColor: '#da3633' },
    caseRow: { backgroundColor: '#161b22', borderRadius: 8, gap: 6, padding: 14 },
    caseName: { color: '#f0f6fc', fontSize: 16, fontWeight: '600' },
    caseDetail: { color: '#8b949e' },
})

export default App
