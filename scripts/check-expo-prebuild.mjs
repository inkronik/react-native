import assert from 'node:assert/strict'
import { access, cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(packageRoot, 'fixtures', 'expo-prebuild')
const target = Object.freeze({
    expo: '55.0.29',
    react: '19.2.0',
    reactNative: '0.83.10',
    template: 'expo-template-bare-minimum@55.0.41',
})

const run = ({ argumentsList, command, cwd, environment = {} }) => {
    const result = spawnSync(command, argumentsList, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment },
        maxBuffer: 10 * 1024 * 1024,
        shell: false,
        stdio: 'pipe',
    })
    assert.equal(result.error, undefined, `${command} failed to start: ${result.error?.message ?? 'unknown error'}`)
    const failureOutput = `${result.stdout}\n${result.stderr}`.slice(-40_000)
    assert.equal(result.status, 0, `${command} failed:\n${failureOutput}`)
    return result.stdout.trim()
}

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

const assertAutolinked = ({ config, installedPackageRoot, platform }) => {
    const dependency = config.dependencies?.['@inkronik/react-native']
    assert.equal(dependency?.root, installedPackageRoot, `${platform} resolved a different SDK root`)
    if (platform === 'android') {
        assert.equal(dependency.platforms?.android?.sourceDir, join(installedPackageRoot, 'android'))
        assert.match(dependency.platforms?.android?.packageImportPath ?? '', /com\.inkronik\.reactnative\.InkronikPackage/u)
        return
    }
    assert.equal(dependency.platforms?.ios?.podspecPath, join(installedPackageRoot, 'InkronikReactNative.podspec'))
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'inkronik-expo-prebuild-'))
const fixtureDirectory = join(temporaryRoot, 'fixture')
const npmEnvironment = Object.freeze({
    CI: '1',
    EXPO_NO_GIT_STATUS: '1',
    NODE_BINARY: process.execPath,
    npm_config_cache: join(packageRoot, '.cache', 'npm'),
})

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

    await cp(fixtureRoot, fixtureDirectory, { recursive: true })
    await writeFile(
        join(fixtureDirectory, 'package.json'),
        `${JSON.stringify(
            {
                name: 'inkronik-expo-prebuild-fixture',
                version: '0.0.0',
                private: true,
                main: 'index.js',
                dependencies: {
                    '@inkronik/react-native': `file:${packageTarball}`,
                    expo: target.expo,
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
        argumentsList: ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--package-lock=false', '--prefer-offline'],
        command: 'npm',
        cwd: fixtureDirectory,
        environment: npmEnvironment,
    })

    const expoCli = join(fixtureDirectory, 'node_modules', 'expo', 'bin', 'cli')
    run({
        argumentsList: [
            expoCli,
            'prebuild',
            '--clean',
            '--no-install',
            '--template',
            target.template,
            '--skip-dependency-update',
            'expo,react,react-native',
        ],
        command: process.execPath,
        cwd: fixtureDirectory,
        environment: npmEnvironment,
    })

    await Promise.all(
        ['android/settings.gradle', 'android/app/src/main/AndroidManifest.xml', 'ios/Podfile'].map(path => access(join(fixtureDirectory, path))),
    )

    const autolinkingCli = join(fixtureDirectory, 'node_modules', 'expo', 'bin', 'autolinking')
    const readNativeConfig = platform =>
        JSON.parse(
            run({
                argumentsList: [autolinkingCli, 'react-native-config', '--platform', platform, '--json'],
                command: process.execPath,
                cwd: fixtureDirectory,
                environment: npmEnvironment,
            }),
        )
    const installedPackageRoot = await realpath(join(fixtureDirectory, 'node_modules', '@inkronik', 'react-native'))
    assertAutolinked({ config: readNativeConfig('android'), installedPackageRoot, platform: 'android' })
    assertAutolinked({ config: readNativeConfig('ios'), installedPackageRoot, platform: 'ios' })

    const generatedManifest = await readJson(join(fixtureDirectory, 'package.json'))
    assert.equal(generatedManifest.dependencies.expo, target.expo)
    assert.equal(generatedManifest.dependencies.react, target.react)
    assert.equal(generatedManifest.dependencies['react-native'], target.reactNative)

    const easConfig = await readJson(join(fixtureDirectory, 'eas.json'))
    assert.equal(easConfig.build.development.developmentClient, true)
    assert.equal(easConfig.build.preview.ios.simulator, true)
    assert.deepEqual(easConfig.build.production, {})

    console.log(`Verified Expo ${target.expo} / React Native ${target.reactNative}: clean prebuild and Android/iOS tarball autolinking succeeded`)
} finally {
    await rm(temporaryRoot, { force: true, recursive: true })
}
