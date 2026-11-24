import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import type { ReleaseVersionCommandInput, ReleaseVersionFixtureInput } from './types.js'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const releaseCli = join(repository, 'node_modules/release-it/bin/release-it.js')

const execute = ({ cwd, command }: ReleaseVersionCommandInput): string => {
    const result = Bun.spawnSync({
        cmd: [...command],
        cwd,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0' },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 15_000,
    })
    if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString())
    return Buffer.from(result.stdout).toString().trim()
}

const calculateFixtureVersion = async ({ tag, subject, prerelease }: ReleaseVersionFixtureInput): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'inkronik-release-version-'))
    const git = (args: ReadonlyArray<string>): string => execute({ cwd: directory, command: ['git', ...args] })
    try {
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'inkronik-release-fixture', version: '1.0.1', private: true }))
        await writeFile(join(directory, '.release-it.json'), await readFile(join(repository, '.release-it.json')))
        await writeFile(join(directory, '.gitignore'), 'node_modules/\n')
        await symlink(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir')
        git(['init', '--initial-branch=main'])
        git(['config', 'user.email', 'fixture@example.test'])
        git(['config', 'user.name', 'Release fixture'])
        git(['add', '.'])
        git(['commit', '-m', 'chore: initial fixture'])
        git(['tag', tag])
        await writeFile(join(directory, 'change.txt'), subject)
        git(['add', '.'])
        git(['commit', '-m', subject])
        // Fetch and upstream checks use a local-only remote, without network credentials.
        git(['remote', 'add', 'origin', directory])
        git(['fetch', 'origin'])
        git(['branch', '--set-upstream-to=origin/main', 'main'])
        const before = git(['rev-parse', 'HEAD'])
        const tags = git(['tag', '--list'])
        const version = execute({
            cwd: directory,
            command: [process.execPath, releaseCli, '--release-version', '--ci', ...(prerelease ? ['--preRelease=rc'] : [])],
        })
        expect(git(['rev-parse', 'HEAD'])).toBe(before)
        expect(git(['tag', '--list'])).toBe(tags)
        expect(git(['status', '--porcelain'])).toBe('')
        expect(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown).toEqual({
            name: 'inkronik-release-fixture',
            version: '1.0.1',
            private: true,
        })
        return version
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

describe('artifact release version calculation', () => {
    test('increments the last Git release instead of recreating a tag from the stale manifest', async () => {
        expect(await calculateFixtureVersion({ tag: 'v1.0.2', subject: 'fix: preserve trace context', prerelease: false })).toBe('1.0.3')
    }, 20_000)

    test('keeps Conventional Commit minor-version recommendations', async () => {
        expect(await calculateFixtureVersion({ tag: 'v1.0.2', subject: 'feat: add monitoring signal', prerelease: false })).toBe('1.1.0')
    }, 20_000)

    test('increments an existing release candidate without using the stable manifest', async () => {
        expect(await calculateFixtureVersion({ tag: 'v1.1.0-rc.1', subject: 'fix: preserve trace context', prerelease: true })).toBe('1.1.0-rc.2')
    }, 20_000)
})
