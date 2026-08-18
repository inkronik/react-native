import assert from 'node:assert/strict'
import { lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const resolvePackagePath = value => {
    assert.ok(value.endsWith('.tgz'), 'The package path must end with .tgz')
    assert.equal(isAbsolute(value), false, 'The package path must be relative to the package root')

    const packagePath = resolve(packageRoot, value)
    const relativePackagePath = relative(packageRoot, packagePath)
    assert.ok(relativePackagePath !== '' && !relativePackagePath.startsWith('..'), 'The package path must stay inside the package root')
    return packagePath
}

const readPackageArgument = () => {
    const argumentsList = process.argv.slice(2)

    if (argumentsList.length === 0) {
        return undefined
    }

    assert.deepEqual(argumentsList.slice(0, 1), ['--package'], 'Usage: node scripts/check-package-consumer.mjs [--package relative/path.tgz]')
    assert.equal(argumentsList.length, 2, 'Usage: node scripts/check-package-consumer.mjs [--package relative/path.tgz]')
    return resolvePackagePath(argumentsList[1] ?? '')
}

const run = ({ argumentsList, command, cwd = packageRoot }) => {
    const result = spawnSync(command, argumentsList, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: join(packageRoot, '.cache', 'npm') },
        shell: false,
    })

    assert.equal(result.error, undefined, `${command} failed to start: ${result.error?.message ?? 'unknown error'}`)
    assert.equal(result.status, 0, `${command} failed:\n${result.stderr || result.stdout}`)
    return result.stdout
}

const hasPath = path =>
    lstat(path).then(
        () => true,
        () => false,
    )

const suppliedPackagePath = readPackageArgument()
const generatedPackagePath = resolvePackagePath(`.cache/package-consumer-${process.pid}.tgz`)
const packagePath = suppliedPackagePath ?? generatedPackagePath
const consumerDirectory = await mkdtemp(join(tmpdir(), 'inkronik-react-native-consumer-'))

try {
    if (suppliedPackagePath === undefined) {
        run({ argumentsList: ['scripts/check-package.mjs', '--output', relative(packageRoot, packagePath)], command: process.execPath })
    }

    run({
        argumentsList: [
            'install',
            '--prefix',
            consumerDirectory,
            '--ignore-scripts',
            '--legacy-peer-deps',
            '--offline',
            '--package-lock=false',
            '--no-audit',
            '--no-fund',
            packagePath,
        ],
        command: 'npm',
    })

    const installedPackageRoot = join(consumerDirectory, 'node_modules', '@inkronik', 'react-native')
    const manifest = JSON.parse(await readFile(join(installedPackageRoot, 'package.json'), 'utf8'))

    for (const packageFile of [manifest.main, manifest.source, manifest.types]) {
        assert.equal(typeof packageFile, 'string', 'The installed package manifest has an invalid entrypoint')
        assert.equal(await hasPath(join(installedPackageRoot, packageFile)), true, `The installed package is missing ${packageFile}`)
    }

    const consumerReactPath = join(consumerDirectory, 'node_modules', 'react')
    if (!(await hasPath(consumerReactPath))) {
        const developmentReactPath = join(packageRoot, 'node_modules', 'react')
        assert.equal(await hasPath(developmentReactPath), true, 'The exact React peer must be installed before running the consumer check')
        await symlink(developmentReactPath, consumerReactPath, 'junction')
    }

    const runtimeCheck = `
        import assert from 'node:assert/strict'
        const sdk = await import('@inkronik/react-native')
        const functions = ['addBreadcrumb', 'captureException', 'captureMessage', 'clearUser', 'createInkronikClient', 'flush', 'init', 'isInitialized', 'setContext', 'setTag', 'setUser', 'shutdown', 'wrap']
        for (const name of functions) assert.equal(typeof sdk[name], 'function', 'Missing public function: ' + name)
        assert.equal(typeof sdk.ErrorBoundary, 'function')
        assert.equal(sdk.isInitialized(), false)
        assert.equal(sdk.captureException({ error: new Error('consumer check') }), '')
    `
    run({ argumentsList: ['--input-type=module', '--eval', runtimeCheck], command: process.execPath, cwd: consumerDirectory })

    console.log(`Installed and imported ${manifest.name}@${manifest.version} from the verified tarball`)
} finally {
    await rm(consumerDirectory, { force: true, recursive: true })
    if (suppliedPackagePath === undefined) {
        await rm(generatedPackagePath, { force: true })
    }
}
