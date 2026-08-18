import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exampleRoot = join(packageRoot, 'example')
const resultFileName = 'inkronik-native-crash-harness-result.json'
const requestFileName = 'inkronik-native-crash-harness-request.txt'
const androidAnrCloseResourceId = 'android:id/aerr_close'
const applicationId = 'dev.inkronik.nativecrashharness'
const androidComponent = `${applicationId}/com.microsoft.reacttestapp.MainActivity`
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
const supportsSynchronousEsm = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12) || (nodeMajor === 20 && nodeMinor >= 19)
if (!supportsSynchronousEsm) throw new Error(`Native crash harness requires Node 20.19+, 22.12+, or 24+; found ${process.versions.node}`)
const nodeToolchainEnvironment = Object.freeze({
    NODE_BINARY: process.execPath,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
})
const immediateCases = {
    android: ['android.jvm-uncaught', 'android.native-sigsegv', 'android.native-abort', 'android.native-cpp', 'android.anr'],
    ios: ['ios.native-sigsegv', 'ios.native-abort', 'ios.native-nsexception', 'ios.native-cpp'],
}

const usage = `Usage:
  node scripts/run-native-crash-harness.mjs --platform <android|ios> --case <case|all> --confirm-destructive [--skip-build] [--device <id>]

The runner installs and clears data only for ${applicationId}. Android ANR is confirmed through ActivityManager and closed through the system dialog. MetricKit hang remains manual because delivery is controlled by the OS.`

const parseArguments = argumentsList => {
    const initial = { caseId: undefined, confirmDestructive: false, device: undefined, platform: undefined, skipBuild: false }
    const parsed = argumentsList.reduce((options, argument, index) => {
        if (argument === '--confirm-destructive') return { ...options, confirmDestructive: true }
        if (argument === '--skip-build') return { ...options, skipBuild: true }
        if (argument === '--case') return { ...options, caseId: argumentsList[index + 1] }
        if (argument === '--device') return { ...options, device: argumentsList[index + 1] }
        if (argument === '--platform') return { ...options, platform: argumentsList[index + 1] }
        if (index > 0 && ['--case', '--device', '--platform'].includes(argumentsList[index - 1] ?? '')) return options
        throw new Error(`Unknown argument: ${argument}\n\n${usage}`)
    }, initial)

    if (parsed.platform !== 'android' && parsed.platform !== 'ios') throw new Error(usage)
    if (!parsed.confirmDestructive) throw new Error(`Refusing to run destructive crashes without --confirm-destructive.\n\n${usage}`)
    const platformCases = immediateCases[parsed.platform]
    if (parsed.caseId !== 'all' && !platformCases.includes(parsed.caseId ?? '')) {
        throw new Error(`Unsupported ${parsed.platform} case: ${String(parsed.caseId)}. Allowed: ${platformCases.join(', ')}, all`)
    }
    return {
        cases: parsed.caseId === 'all' ? platformCases : [parsed.caseId],
        device: parsed.device,
        platform: parsed.platform,
        skipBuild: parsed.skipBuild,
    }
}

const run = ({ allowFailure = false, argumentsList, command, cwd = packageRoot }) => {
    const result = spawnSync(command, argumentsList, {
        cwd,
        encoding: 'utf8',
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error !== undefined) throw result.error
    if (!allowFailure && result.status !== 0) {
        throw new Error(`${command} ${argumentsList.join(' ')} failed:\n${result.stderr || result.stdout}`)
    }
    return { status: result.status ?? 1, stderr: result.stderr, stdout: result.stdout.trim() }
}

const runVisible = ({ argumentsList, command, cwd = packageRoot, environment = {} }) => {
    const result = spawnSync(command, argumentsList, {
        cwd,
        env: { ...process.env, ...environment },
        shell: false,
        stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`${command} ${argumentsList.join(' ')} failed with exit code ${String(result.status)}`)
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

const waitUntil = async ({ description, poll, timeoutMs }) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const result = await poll()
        if (result !== undefined) return result
        await delay(500)
    }
    throw new Error(`Timed out waiting for ${description}`)
}

const parseResult = ({ caseId, source }) => {
    const result = JSON.parse(source)
    if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new Error('Harness result is not an object')
    if (result.caseId !== caseId) throw new Error(`Harness returned result for ${String(result.caseId)}, expected ${caseId}`)
    if (result.status !== 'passed' && result.status !== 'failed') throw new Error('Harness returned an invalid status')
    if (typeof result.message !== 'string') throw new Error('Harness returned an invalid message')
    return result
}

const resolveAndroidDevice = requestedDevice => {
    if (requestedDevice !== undefined) return requestedDevice
    const devices = run({ argumentsList: ['devices'], command: 'adb' })
        .stdout.split('\n')
        .slice(1)
        .map(line => line.trim().split(/\s+/u))
        .filter(([, state]) => state === 'device')
        .map(([serial]) => serial)
    if (devices.length !== 1) throw new Error(`Expected exactly one Android device, found ${devices.length}. Use --device <serial>.`)
    return devices[0]
}

const adb = ({ allowFailure = false, argumentsList, device }) =>
    run({ allowFailure, argumentsList: ['-s', device, ...argumentsList], command: 'adb' })

const buildAndroid = () => {
    runVisible({ argumentsList: ['run', 'build'], command: 'bun', environment: nodeToolchainEnvironment })
    runVisible({ argumentsList: ['run', '--cwd', 'example', 'build:android'], command: 'bun', environment: nodeToolchainEnvironment })
    runVisible({
        argumentsList: [':app:assembleDebug', '--no-daemon', '--console=plain'],
        command: './gradlew',
        cwd: join(exampleRoot, 'android'),
        environment: nodeToolchainEnvironment,
    })
}

const readAndroidResult = ({ caseId, device }) => {
    const result = adb({
        allowFailure: true,
        argumentsList: ['exec-out', 'run-as', applicationId, 'cat', `cache/${resultFileName}`],
        device,
    })
    if (result.status !== 0 || !result.stdout.startsWith('{')) return undefined
    return parseResult({ caseId, source: result.stdout })
}

const writeAndroidRequest = async ({ caseId, device }) => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'inkronik-native-crash-harness-'))
    const localPath = join(temporaryDirectory, requestFileName)
    const remotePath = `/data/local/tmp/${requestFileName}-${String(process.pid)}`
    try {
        await writeFile(localPath, caseId, { encoding: 'utf8', mode: 0o600 })
        adb({ argumentsList: ['push', localPath, remotePath], device })
        adb({ argumentsList: ['shell', 'run-as', applicationId, 'mkdir', '-p', 'cache'], device })
        adb({ argumentsList: ['shell', 'run-as', applicationId, 'cp', remotePath, `cache/${requestFileName}`], device })
    } finally {
        adb({ allowFailure: true, argumentsList: ['shell', 'rm', '-f', remotePath], device })
        await rm(temporaryDirectory, { force: true, recursive: true })
    }
}

const readAndroidWindowHierarchy = ({ device }) => {
    const remotePath = `/data/local/tmp/inkronik-native-crash-harness-window-${String(process.pid)}.xml`
    try {
        const dump = adb({
            allowFailure: true,
            argumentsList: ['shell', 'uiautomator', 'dump', remotePath],
            device,
        })
        if (dump.status !== 0) return undefined
        const hierarchy = adb({
            allowFailure: true,
            argumentsList: ['exec-out', 'cat', remotePath],
            device,
        })
        return hierarchy.status === 0 ? hierarchy.stdout : undefined
    } finally {
        adb({ allowFailure: true, argumentsList: ['shell', 'rm', '-f', remotePath], device })
    }
}

const findAndroidNodeCenter = ({ hierarchy, resourceId }) => {
    const nodes = hierarchy.match(/<node\b[^>]*>/gu) ?? []
    const matchingNode = nodes.find(node => node.includes(`resource-id="${resourceId}"`))
    const bounds = matchingNode?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u)
    if (bounds === undefined || bounds === null) return undefined
    const [, left, top, right, bottom] = bounds.map(Number)
    if (![left, top, right, bottom].every(Number.isSafeInteger) || right <= left || bottom <= top) return undefined
    return { x: Math.floor((left + right) / 2), y: Math.floor((top + bottom) / 2) }
}

const closeAndroidAnrDialog = async ({ device }) => {
    const center = await waitUntil({
        description: 'Android system ANR close action',
        poll: async () => {
            const hierarchy = readAndroidWindowHierarchy({ device })
            if (hierarchy === undefined) return undefined
            return findAndroidNodeCenter({ hierarchy, resourceId: androidAnrCloseResourceId })
        },
        timeoutMs: 30_000,
    })
    adb({ argumentsList: ['shell', 'input', 'tap', String(center.x), String(center.y)], device })
    await waitUntil({
        description: 'Android ANR process termination',
        poll: async () => {
            const process = adb({ allowFailure: true, argumentsList: ['shell', 'pidof', applicationId], device })
            return process.stdout === '' ? true : undefined
        },
        timeoutMs: 30_000,
    })
}

const runAndroidCase = async ({ caseId, device }) => {
    console.log(`[android] ${caseId}: clearing isolated test-app data`)
    adb({ allowFailure: true, argumentsList: ['shell', 'am', 'force-stop', applicationId], device })
    adb({ allowFailure: true, argumentsList: ['shell', 'pm', 'clear', applicationId], device })
    await writeAndroidRequest({ caseId, device })
    adb({ argumentsList: ['shell', 'am', 'start', '-W', '-n', androidComponent], device })
    await delay(1_000)
    await waitUntil({
        description: `${caseId} process termination`,
        poll: async () => {
            const process = adb({ allowFailure: true, argumentsList: ['shell', 'pidof', applicationId], device })
            return process.stdout === '' ? true : undefined
        },
        timeoutMs: 30_000,
    })
    adb({ argumentsList: ['shell', 'am', 'start', '-W', '-n', androidComponent], device })
    const result = await waitUntil({
        description: `${caseId} acknowledged result`,
        poll: async () => readAndroidResult({ caseId, device }),
        timeoutMs: 45_000,
    })
    if (result.status === 'failed') throw new Error(`[android] ${caseId}: ${result.message}`)
    console.log(`[android] ${caseId}: PASS — ${result.message}`)
}

const runAndroidAnrCase = async ({ caseId, device }) => {
    console.log(`[android] ${caseId}: clearing isolated test-app data`)
    adb({ allowFailure: true, argumentsList: ['shell', 'am', 'force-stop', applicationId], device })
    adb({ allowFailure: true, argumentsList: ['shell', 'pm', 'clear', applicationId], device })
    const previousAnr = adb({ argumentsList: ['shell', 'dumpsys', 'activity', 'lastanr'], device }).stdout
    await writeAndroidRequest({ caseId, device })
    adb({ argumentsList: ['shell', 'am', 'start', '-W', '-n', androidComponent], device })
    await waitUntil({
        description: `${caseId} ActivityManager detection`,
        poll: async () => {
            const currentAnr = adb({ argumentsList: ['shell', 'dumpsys', 'activity', 'lastanr'], device }).stdout
            return currentAnr !== previousAnr && currentAnr.includes(applicationId) ? true : undefined
        },
        timeoutMs: 45_000,
    })
    console.log(`[android] ${caseId}: ActivityManager confirmed ANR; closing the isolated app through the system dialog`)
    await closeAndroidAnrDialog({ device })
    adb({ argumentsList: ['shell', 'am', 'start', '-W', '-n', androidComponent], device })
    const result = await waitUntil({
        description: `${caseId} acknowledged result`,
        poll: async () => readAndroidResult({ caseId, device }),
        timeoutMs: 45_000,
    })
    if (result.status === 'failed') throw new Error(`[android] ${caseId}: ${result.message}`)
    console.log(`[android] ${caseId}: PASS — ${result.message}`)
}

const runSelectedAndroidCase = async ({ caseId, device }) => {
    if (caseId === 'android.anr') return runAndroidAnrCase({ caseId, device })
    return runAndroidCase({ caseId, device })
}

const runAndroid = async ({ cases, device, skipBuild }) => {
    const resolvedDevice = resolveAndroidDevice(device)
    const apiLevel = Number(adb({ argumentsList: ['shell', 'getprop', 'ro.build.version.sdk'], device: resolvedDevice }).stdout)
    if (!Number.isInteger(apiLevel) || apiLevel < 24) throw new Error(`Android API 24+ is required by the harness app, found API ${String(apiLevel)}`)
    if (!skipBuild) buildAndroid()
    const apkPath = join(exampleRoot, 'android/app/build/outputs/apk/debug/app-debug.apk')
    await access(apkPath, constants.R_OK)
    adb({ argumentsList: ['install', '-r', apkPath], device: resolvedDevice })
    for (const caseId of cases) await runSelectedAndroidCase({ caseId, device: resolvedDevice })
}

const resolveIosDevice = requestedDevice => {
    if (requestedDevice !== undefined) return requestedDevice
    const output = run({ argumentsList: ['simctl', 'list', 'devices', 'booted', '--json'], command: 'xcrun' }).stdout
    const devicesByRuntime = JSON.parse(output).devices
    const devices = Object.values(devicesByRuntime)
        .flat()
        .filter(device => device.state === 'Booted')
    if (devices.length !== 1) throw new Error(`Expected exactly one booted iOS Simulator, found ${devices.length}. Use --device <UDID>.`)
    return devices[0].udid
}

const simctl = ({ allowFailure = false, argumentsList, device }) =>
    run({ allowFailure, argumentsList: ['simctl', ...argumentsList.map(argument => (argument === 'DEVICE' ? device : argument))], command: 'xcrun' })

const buildIos = ({ device }) => {
    runVisible({ argumentsList: ['run', 'build'], command: 'bun', environment: nodeToolchainEnvironment })
    runVisible({ argumentsList: ['run', '--cwd', 'example', 'build:ios'], command: 'bun', environment: nodeToolchainEnvironment })
    runVisible({ argumentsList: ['install'], command: 'pod', cwd: join(exampleRoot, 'ios'), environment: nodeToolchainEnvironment })
    runVisible({
        argumentsList: [
            '-quiet',
            '-workspace',
            'InkronikNativeCrashHarness.xcworkspace',
            '-scheme',
            'InkronikNativeCrashHarness',
            '-configuration',
            'Debug',
            '-destination',
            `id=${device}`,
            '-sdk',
            'iphonesimulator',
            '-derivedDataPath',
            'build',
            'CLANG_ADDRESS_SANITIZER=NO',
            'CLANG_UNDEFINED_BEHAVIOR_SANITIZER=NO',
            'CODE_SIGNING_ALLOWED=NO',
            'ENABLE_THREAD_SANITIZER=NO',
            'build',
        ],
        command: 'xcodebuild',
        cwd: join(exampleRoot, 'ios'),
        environment: nodeToolchainEnvironment,
    })
}

const waitForIosProcessExit = async ({ device, pid }) =>
    waitUntil({
        description: `iOS process ${String(pid)} termination`,
        poll: async () => {
            const process = simctl({
                allowFailure: true,
                argumentsList: ['spawn', 'DEVICE', '/bin/kill', '-0', String(pid)],
                device,
            })
            return process.status === 0 ? undefined : true
        },
        timeoutMs: 30_000,
    })

const readIosResult = async ({ caseId, device }) => {
    const container = simctl({ argumentsList: ['get_app_container', 'DEVICE', applicationId, 'data'], device })
    if (container.status !== 0 || container.stdout === '') return undefined
    const path = join(container.stdout, 'Library', 'Caches', resultFileName)
    const source = await readFile(path, 'utf8').catch(() => undefined)
    return source === undefined ? undefined : parseResult({ caseId, source })
}

const runIosCase = async ({ appPath, caseId, device }) => {
    console.log(`[ios] ${caseId}: reinstalling isolated test app`)
    simctl({ allowFailure: true, argumentsList: ['terminate', 'DEVICE', applicationId], device })
    simctl({ allowFailure: true, argumentsList: ['uninstall', 'DEVICE', applicationId], device })
    simctl({ argumentsList: ['install', 'DEVICE', appPath], device })
    const launch = simctl({
        argumentsList: ['launch', 'DEVICE', applicationId, '--inkronik-crash-case', caseId],
        device,
    })
    const pid = Number(launch.stdout.split(':').at(-1)?.trim())
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Could not read launched iOS process ID from: ${launch.stdout}`)
    await waitForIosProcessExit({ device, pid })
    simctl({ argumentsList: ['launch', 'DEVICE', applicationId], device })
    const result = await waitUntil({
        description: `${caseId} acknowledged result`,
        poll: async () => readIosResult({ caseId, device }),
        timeoutMs: 45_000,
    })
    if (result.status === 'failed') throw new Error(`[ios] ${caseId}: ${result.message}`)
    console.log(`[ios] ${caseId}: PASS — ${result.message}`)
}

const runIos = async ({ cases, device, skipBuild }) => {
    const resolvedDevice = resolveIosDevice(device)
    if (!skipBuild) buildIos({ device: resolvedDevice })
    const appPath = join(exampleRoot, 'ios/build/Build/Products/Debug-iphonesimulator/ReactTestApp.app')
    await access(appPath, constants.R_OK)
    for (const caseId of cases) await runIosCase({ appPath, caseId, device: resolvedDevice })
}

const options = parseArguments(process.argv.slice(2))
if (options.platform === 'android') await runAndroid(options)
else await runIos(options)
