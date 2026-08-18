import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(packageRoot, 'fixtures', 'react-native-compatibility')
const target = Object.freeze({ babelRuntime: '7.12.5', react: '17.0.2', reactNative: '0.65.0' })
const platform = process.argv[2]

assert.ok(platform === 'android' || platform === 'ios', 'Usage: node scripts/check-react-native-compatibility.mjs <android|ios>')

const run = ({ argumentsList, command, cwd, environment = {} }) => {
    const result = spawnSync(command, argumentsList, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment },
        shell: false,
        stdio: 'pipe',
    })

    assert.equal(result.error, undefined, `${command} failed to start: ${result.error?.message ?? 'unknown error'}`)
    const failureOutput = `${result.stdout}\n${result.stderr}`.slice(-40000)
    assert.equal(result.status, 0, `${command} failed:\n${failureOutput}`)
    return result.stdout
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'inkronik-rn-compatibility-'))
const npmEnvironment = Object.freeze({ npm_config_cache: join(temporaryRoot, 'npm-cache') })

const isJava11Home = javaHome => {
    if (typeof javaHome !== 'string' || javaHome === '') return false
    const result = spawnSync(join(javaHome, 'bin', 'java'), ['-version'], { encoding: 'utf8', shell: false })
    return result.status === 0 && /version "11\./u.test(`${result.stdout}${result.stderr}`)
}

const resolveJava11Home = () => {
    const macResult =
        process.platform === 'darwin' ? spawnSync('/usr/libexec/java_home', ['-v', '11'], { encoding: 'utf8', shell: false }) : undefined
    const macJavaHome = macResult?.status === 0 ? macResult.stdout.trim() : undefined
    const javaHome = [process.env.JAVA_HOME_11_X64, process.env.JAVA_HOME, macJavaHome].find(isJava11Home)
    assert.ok(javaHome !== undefined, 'React Native 0.65 Android compatibility requires JDK 11')
    return javaHome
}

try {
    const packOutput = run({
        argumentsList: ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
        command: 'npm',
        cwd: packageRoot,
        environment: npmEnvironment,
    })
    const packResults = JSON.parse(packOutput)
    assert.equal(packResults.length, 1)
    const packageTarball = join(temporaryRoot, packResults[0].filename)
    const fixtureDirectory = join(temporaryRoot, 'fixture')

    await cp(fixtureRoot, fixtureDirectory, { recursive: true })
    await writeFile(
        join(fixtureDirectory, 'package.json'),
        `${JSON.stringify(
            {
                name: 'inkronik-react-native-compatibility-fixture',
                version: '0.0.0',
                private: true,
                dependencies: {
                    '@babel/runtime': target.babelRuntime,
                    '@inkronik/react-native': `file:${packageTarball}`,
                    react: target.react,
                    'react-native': target.reactNative,
                },
            },
            null,
            2,
        )}\n`,
        { encoding: 'utf8', mode: 0o600 },
    )

    run({
        argumentsList: ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--package-lock=false'],
        command: 'npm',
        cwd: fixtureDirectory,
        environment: npmEnvironment,
    })

    await mkdir(join(fixtureDirectory, 'dist', 'assets'), { recursive: true })
    run({
        argumentsList: [
            join(fixtureDirectory, 'node_modules', 'react-native', 'cli.js'),
            'bundle',
            '--entry-file',
            'index.js',
            '--platform',
            platform,
            '--dev',
            'false',
            '--bundle-output',
            `dist/index.${platform}.bundle`,
            '--assets-dest',
            'dist/assets',
            '--reset-cache',
        ],
        command: process.execPath,
        cwd: fixtureDirectory,
        environment: { NODE_OPTIONS: '--openssl-legacy-provider' },
    })

    if (platform === 'android') {
        const gradleWrapper = join(fixtureDirectory, 'node_modules', 'react-native', 'template', 'android', 'gradlew')
        run({
            argumentsList: [
                gradleWrapper,
                '-p',
                join(fixtureDirectory, 'android'),
                ':inkronik_react-native:assembleDebug',
                '--no-daemon',
                '--stacktrace',
            ],
            command: 'bash',
            cwd: fixtureDirectory,
            environment: {
                GRADLE_OPTS: '-Djdk.tls.client.protocols=TLSv1.2 -Dhttps.protocols=TLSv1.2',
                JAVA_HOME: resolveJava11Home(),
            },
        })
    } else {
        run({ argumentsList: ['install', '--project-directory=ios'], command: 'pod', cwd: fixtureDirectory })
        run({
            argumentsList: [
                '-project',
                'ios/Pods/Pods.xcodeproj',
                '-scheme',
                'InkronikReactNative',
                '-configuration',
                'Debug',
                '-quiet',
                '-jobs',
                '1',
                '-sdk',
                'iphonesimulator',
                '-destination',
                'generic/platform=iOS Simulator',
                '-derivedDataPath',
                'ios/build/DerivedData',
                'CODE_SIGNING_ALLOWED=NO',
                'ONLY_ACTIVE_ARCH=YES',
                'ARCHS=arm64',
                'build',
            ],
            command: 'xcodebuild',
            cwd: fixtureDirectory,
        })
    }

    const bundle = await readFile(join(fixtureDirectory, 'dist', `index.${platform}.bundle`))
    assert.ok(bundle.byteLength > 0, 'React Native compatibility bundle is empty')
    console.log(`Verified React Native ${target.reactNative} with React ${target.react}: ${platform} JavaScript and native builds succeeded`)
} finally {
    await rm(temporaryRoot, { force: true, recursive: true })
}
