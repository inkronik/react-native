import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const resolveArtifactPath = value => {
    assert.equal(isAbsolute(value), false, 'Artifact paths must be relative to the package root')
    const artifactPath = resolve(packageRoot, value)
    const relativeArtifactPath = relative(packageRoot, artifactPath)
    assert.ok(relativeArtifactPath !== '' && !relativeArtifactPath.startsWith('..'), 'Artifact paths must stay inside the package root')
    return artifactPath
}

const argumentsList = process.argv.slice(2)
assert.deepEqual(
    argumentsList.filter((_, index) => index % 2 === 0),
    ['--package', '--output'],
    'Usage: node scripts/generate-sbom.mjs --package relative/package.tgz --output relative/package.cdx.json',
)
assert.equal(argumentsList.length, 4, 'Usage: node scripts/generate-sbom.mjs --package relative/package.tgz --output relative/package.cdx.json')

const packagePath = resolveArtifactPath(argumentsList[1] ?? '')
const outputPath = resolveArtifactPath(argumentsList[3] ?? '')
assert.ok(packagePath.endsWith('.tgz'), 'The package path must end with .tgz')
assert.ok(outputPath.endsWith('.cdx.json'), 'The SBOM output path must end with .cdx.json')

const manifestResult = spawnSync('tar', ['-xOf', packagePath, 'package/package.json'], {
    cwd: packageRoot,
    encoding: 'utf8',
    shell: false,
})
assert.equal(manifestResult.error, undefined, `tar failed to start: ${manifestResult.error?.message ?? 'unknown error'}`)
assert.equal(manifestResult.status, 0, `Could not read the packed manifest:\n${manifestResult.stderr || manifestResult.stdout}`)

const manifest = JSON.parse(manifestResult.stdout)
assert.equal(manifest.name, '@inkronik/react-native')
assert.deepEqual(manifest.dependencies ?? {}, {}, 'The runtime SBOM generator must be updated when runtime dependencies are introduced')

const tarball = await readFile(packagePath)
const sha256 = createHash('sha256').update(tarball).digest('hex')
const packageUrl = `pkg:npm/%40inkronik/react-native@${manifest.version}`
const nativeRecorderUrl = 'pkg:cocoapods/KSCrash@2.5.1'
const component = {
    type: 'library',
    'bom-ref': packageUrl,
    group: '@inkronik',
    name: 'react-native',
    version: manifest.version,
    hashes: [{ alg: 'SHA-256', content: sha256 }],
    licenses: [{ license: { id: manifest.license } }],
    purl: packageUrl,
    externalReferences: [{ type: 'vcs', url: 'https://github.com/inkronik/react-native' }],
}
const nativeRecorder = {
    type: 'library',
    'bom-ref': nativeRecorderUrl,
    name: 'KSCrash',
    version: '2.5.1',
    hashes: [{ alg: 'SHA-256', content: '3b427333a643b683ec5121b5eb74538e89783dfc9e3780fc5af578c5b1dc1d44' }],
    licenses: [{ license: { id: 'MIT' } }],
    purl: nativeRecorderUrl,
    externalReferences: [
        { type: 'distribution', url: 'https://github.com/kstenerud/KSCrash/archive/refs/tags/2.5.1.tar.gz' },
        { type: 'vcs', url: 'https://github.com/kstenerud/KSCrash/tree/95a8895d75f3c22aa9ad9f2a15d2fbd97b0a55e2' },
    ],
    properties: [
        { name: 'inkronik:cocoapods-subspec', value: 'Recording' },
        { name: 'inkronik:source-revision', value: '95a8895d75f3c22aa9ad9f2a15d2fbd97b0a55e2' },
    ],
}
const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: { component },
    components: [nativeRecorder],
    dependencies: [
        { ref: packageUrl, dependsOn: [nativeRecorderUrl] },
        { ref: nativeRecorderUrl, dependsOn: [] },
    ],
}

await writeFile(outputPath, `${JSON.stringify(sbom, undefined, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
console.log(`Generated CycloneDX SBOM for ${manifest.name}@${manifest.version}: ${relative(packageRoot, outputPath)}`)
