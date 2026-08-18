import assert from 'node:assert/strict'
import { constants, copyFile, lstat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredFiles = new Set([
    'LICENSE',
    'InkronikReactNative.podspec',
    'NOTICE',
    'docs/native-dependencies.md',
    'README.md',
    'SECURITY.md',
    'lib/module/index.js',
    'lib/module/index.native.js',
    'lib/module/package.json',
    'lib/typescript/package.json',
    'lib/typescript/src/index.d.ts',
    'package.json',
    'src/index.native.ts',
    'src/index.ts',
    'android/build.gradle',
    'android/src/main/AndroidManifest.xml',
    'android/src/main/cpp/CMakeLists.txt',
    'android/src/main/cpp/inkronik_crash.cpp',
    'android/src/main/cpp/inkronik_crash.map.txt',
    'ios/Inkronik.mm',
])
const rootFiles = new Set(['InkronikReactNative.podspec', 'LICENSE', 'NOTICE', 'README.md', 'SECURITY.md', 'package.json'])
const forbiddenPathPattern = /(?:^|\/)(?:\.env(?:\.|$)|\.git|\.planning|fixtures?|node_modules|patches|scripts|specs?|tests?)(?:\/|\.|$)/iu
const forbiddenExtensionPattern = /\.(?:a|aar|jks|key|keystore|mobileprovision|o|p12|pem|so)$/iu
const secretPattern =
    /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{16}\b)/u
const localPathPattern = /(?:\/Users\/[^/]+\/|[A-Za-z]:\\Users\\[^\\]+\\)/u
const maxPackedBytes = 1_000_000
const maxUnpackedBytes = 2_000_000
const maxEntries = 500

const isAllowedPath = path => {
    if (rootFiles.has(path)) {
        return true
    }

    if (/^src\/(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+(?:\.native)?|Native[A-Za-z0-9]+)\.tsx?$/u.test(path)) {
        return true
    }

    if (path === 'android/build.gradle' || path === 'android/src/main/AndroidManifest.xml') {
        return true
    }

    if (/^android\/src\/main\/cpp\/(?:CMakeLists\.txt|inkronik_crash\.(?:cpp|map\.txt))$/u.test(path)) {
        return true
    }

    if (path === 'docs/native-dependencies.md') {
        return true
    }

    if (/^android\/src\/main\/java\/com\/inkronik\/reactnative\/[A-Za-z0-9]+\.kt$/u.test(path)) {
        return true
    }

    if (/^ios\/(?:Internal\/)?[A-Za-z0-9]+\.(?:h|m|mm)$/u.test(path)) {
        return true
    }

    if (/^lib\/module\/(?:[a-z0-9-]+\/)*(?:(?:[a-z0-9-]+(?:\.native)?|Native[A-Za-z0-9]+)\.js(?:\.map)?|package\.json)$/u.test(path)) {
        return true
    }

    return /^lib\/typescript\/(?:src\/(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+(?:\.native)?|Native[A-Za-z0-9]+)\.d\.ts(?:\.map)?|package\.json)$/u.test(path)
}

const readOutputPath = () => {
    const argumentsList = process.argv.slice(2)

    if (argumentsList.length === 0) {
        return undefined
    }

    assert.deepEqual(argumentsList.slice(0, 1), ['--output'], 'Usage: node scripts/check-package.mjs [--output relative/path.tgz]')
    assert.equal(argumentsList.length, 2, 'Usage: node scripts/check-package.mjs [--output relative/path.tgz]')

    const value = argumentsList[1]
    assert.ok(value !== undefined && value.endsWith('.tgz'), 'The output path must end with .tgz')
    assert.equal(isAbsolute(value), false, 'The output path must be relative to the package root')

    const outputPath = resolve(packageRoot, value)
    const relativeOutputPath = relative(packageRoot, outputPath)
    assert.ok(relativeOutputPath !== '' && !relativeOutputPath.startsWith('..'), 'The output path must stay inside the package root')

    return outputPath
}

const run = ({ argumentsList, command }) => {
    const result = spawnSync(command, argumentsList, {
        cwd: packageRoot,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: join(packageRoot, '.cache', 'npm') },
        shell: false,
    })

    assert.equal(result.error, undefined, `${command} failed to start: ${result.error?.message ?? 'unknown error'}`)
    assert.equal(result.status, 0, `${command} failed:\n${result.stderr || result.stdout}`)
    return result.stdout
}

const readPackedManifest = tarballPath => {
    const manifest = run({ argumentsList: ['-xOf', tarballPath, 'package/package.json'], command: 'tar' })
    return JSON.parse(manifest)
}

const validateTarIndex = ({ files, tarballPath }) => {
    const tarPaths = run({ argumentsList: ['-tzf', tarballPath], command: 'tar' })
        .trim()
        .split('\n')
        .map(path => {
            assert.ok(path.startsWith('package/'), `Tar entry escaped the package root: ${path}`)
            return path.slice('package/'.length)
        })

    const reportedPaths = files.map(file => file.path)
    assert.deepEqual(tarPaths.toSorted(), reportedPaths.toSorted(), 'The physical tar index differs from the npm pack report')
}

const validateManifest = ({ localManifest, packedManifest }) => {
    assert.equal(packedManifest.name, '@inkronik/react-native')
    assert.equal(packedManifest.name, localManifest.name)
    assert.equal(packedManifest.version, localManifest.version)
    assert.equal(packedManifest.main, './lib/module/index.js')
    assert.equal(packedManifest.types, './lib/typescript/src/index.d.ts')
    assert.equal(packedManifest.exports?.['.']?.['react-native'], './lib/module/index.native.js')
    assert.equal(packedManifest['react-native'], './lib/module/index.native.js')
    assert.equal(packedManifest.codegenConfig, undefined, 'The compatibility bridge must not require React Native Codegen')
    assert.equal(packedManifest.exports?.['.']?.types, './lib/typescript/src/index.d.ts')
    assert.equal(packedManifest.exports?.['.']?.default, './lib/module/index.js')
    assert.equal(packedManifest.publishConfig?.access, 'public')
    assert.equal(packedManifest.publishConfig?.provenance, true)
    assert.deepEqual(packedManifest.dependencies ?? {}, {}, 'Runtime dependencies require an explicit package security review')
    assert.deepEqual(packedManifest.bundledDependencies ?? [], [], 'Bundled dependencies are not allowed')
    assert.equal(packedManifest.bin, undefined, 'Executable package bins are not allowed')

    for (const lifecycleScript of ['preinstall', 'install', 'postinstall', 'prepack', 'prepare']) {
        assert.equal(packedManifest.scripts?.[lifecycleScript], undefined, `${lifecycleScript} lifecycle scripts are not allowed`)
    }
}

const validatePackedFiles = async files => {
    const paths = files.map(file => file.path)
    const uniquePaths = new Set(paths)

    assert.equal(uniquePaths.size, paths.length, 'The tarball contains duplicate paths')
    assert.ok(paths.length > 0 && paths.length <= maxEntries, `The tarball must contain 1-${maxEntries} files`)

    for (const requiredFile of requiredFiles) {
        assert.ok(uniquePaths.has(requiredFile), `The tarball is missing ${requiredFile}`)
    }

    await Promise.all(
        files.map(async file => {
            assert.ok(isAllowedPath(file.path), `Unexpected package file: ${file.path}`)
            assert.doesNotMatch(file.path, forbiddenPathPattern, `Forbidden package path: ${file.path}`)
            assert.doesNotMatch(file.path, forbiddenExtensionPattern, `Sensitive file type in package: ${file.path}`)
            assert.equal(file.mode & 0o111, 0, `Executable file mode is not allowed: ${file.path}`)

            const sourcePath = join(packageRoot, file.path)
            const sourceStats = await lstat(sourcePath)
            assert.equal(sourceStats.isSymbolicLink(), false, `Symbolic links are not allowed: ${file.path}`)
            assert.equal(sourceStats.isFile(), true, `Non-file package entry is not allowed: ${file.path}`)

            const source = await readFile(sourcePath, 'utf8')
            assert.doesNotMatch(source, secretPattern, `Secret-shaped value found in ${file.path}`)
            assert.doesNotMatch(source, localPathPattern, `Local developer path found in ${file.path}`)
        }),
    )
}

const outputPath = readOutputPath()
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'inkronik-react-native-package-'))

try {
    const packOutput = run({
        argumentsList: ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryDirectory],
        command: 'npm',
    })
    const packResults = JSON.parse(packOutput)

    assert.equal(packResults.length, 1, 'Expected npm pack to produce exactly one tarball')

    const packResult = packResults[0]
    assert.equal(packResult.name, '@inkronik/react-native')
    assert.match(packResult.integrity, /^sha512-[A-Za-z0-9+/]+=*$/u)
    assert.match(packResult.shasum, /^[0-9a-f]{40}$/u)
    assert.ok(packResult.size > 0 && packResult.size <= maxPackedBytes, `Packed size exceeds ${maxPackedBytes} bytes`)
    assert.ok(packResult.unpackedSize > 0 && packResult.unpackedSize <= maxUnpackedBytes, `Unpacked size exceeds ${maxUnpackedBytes} bytes`)
    assert.equal(packResult.entryCount, packResult.files.length)
    assert.deepEqual(packResult.bundled ?? [], [], 'Bundled dependencies are not allowed')

    const tarballPath = join(temporaryDirectory, packResult.filename)
    const localManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const packedManifest = readPackedManifest(tarballPath)

    validateManifest({ localManifest, packedManifest })
    validateTarIndex({ files: packResult.files, tarballPath })
    await validatePackedFiles(packResult.files)

    if (outputPath !== undefined) {
        await copyFile(tarballPath, outputPath, constants.COPYFILE_EXCL)
    }

    console.log(`Validated ${packResult.filename}: ${packResult.entryCount} files, ${packResult.size} bytes, ${packResult.integrity}`)
} finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
}
