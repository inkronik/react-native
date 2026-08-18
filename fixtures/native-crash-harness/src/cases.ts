import type { CrashCaseDefinition } from './types'

export const crashCases: ReadonlyArray<CrashCaseDefinition> = [
    {
        id: 'android.jvm-uncaught',
        platform: 'android',
        expectedMechanism: 'android.jvm-uncaught',
        expectsFrames: false,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'android.native-sigsegv',
        platform: 'android',
        expectedMechanism: 'android.native-tombstone',
        alternateMechanisms: ['android.native-signal'],
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'android.native-abort',
        platform: 'android',
        expectedMechanism: 'android.native-tombstone',
        alternateMechanisms: ['android.native-signal'],
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'android.native-cpp',
        platform: 'android',
        expectedMechanism: 'android.native-tombstone',
        alternateMechanisms: ['android.native-signal'],
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'android.anr',
        platform: 'android',
        expectedMechanism: 'android.application-exit',
        expectsFrames: false,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'ios.native-sigsegv',
        platform: 'ios',
        expectedMechanism: 'ios.low-level',
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'ios.native-abort',
        platform: 'ios',
        expectedMechanism: 'ios.low-level',
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'ios.native-nsexception',
        platform: 'ios',
        expectedMechanism: 'ios.low-level',
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'ios.native-cpp',
        platform: 'ios',
        expectedMechanism: 'ios.low-level',
        expectsFrames: true,
        delivery: 'immediate-after-restart',
    },
    {
        id: 'ios.hang',
        platform: 'ios',
        expectedMechanism: 'ios.metrickit-hang',
        expectsFrames: false,
        delivery: 'os-delayed',
    },
]

export const findCrashCase = (caseId: string): CrashCaseDefinition => {
    const crashCase = crashCases.find(candidate => candidate.id === caseId)
    if (crashCase === undefined) throw new Error(`Unknown crash fixture case: ${caseId}`)
    return crashCase
}
