import { redactStack, redactText, sanitizeUrl } from '../privacy/sanitize.js'
import type { MobileStackFrame } from '../protocol/types.js'

const stackLinePattern = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/u
const hermesStackLinePattern = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/u

const isApplicationFrame = (filename: string): boolean =>
    !filename.includes('/node_modules/') && !filename.startsWith('node:') && !filename.includes('native code')

const toFrame = (line: string): MobileStackFrame | undefined => {
    const match = stackLinePattern.exec(line) ?? hermesStackLinePattern.exec(line)

    if (match === null) {
        return undefined
    }

    const functionName = redactText(match[1] === '' ? '<anonymous>' : match[1])
    const rawFilename = match[2]
    const filename = rawFilename.includes('://') ? sanitizeUrl({ value: rawFilename }) : redactText(rawFilename.split(/[?#]/u, 1)[0] ?? '')
    const parsedLine = Number(match[3])
    const parsedColumn = Number(match[4])

    return {
        function: functionName,
        filename,
        ...(Number.isSafeInteger(parsedLine) ? { line: parsedLine } : {}),
        ...(Number.isSafeInteger(parsedColumn) ? { column: parsedColumn } : {}),
        in_app: isApplicationFrame(filename),
    }
}

export const parseStack = (stack: string | undefined): ReadonlyArray<MobileStackFrame> => {
    if (stack === undefined) {
        return []
    }

    return stack
        .split('\n')
        .slice(0, 200)
        .map(toFrame)
        .filter((frame): frame is MobileStackFrame => frame !== undefined)
}

export const sanitizeRawStack = (stack: string | undefined): string | undefined => (stack === undefined ? undefined : redactStack(stack))
