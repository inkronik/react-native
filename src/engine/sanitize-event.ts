import { redactStack, redactText, sanitizeRecord } from '../privacy/sanitize.js'
import type { MobileException } from '../protocol/types.js'
import type { EngineEvent } from './types.js'

const sanitizeExceptions = (exceptions: ReadonlyArray<MobileException> | undefined): ReadonlyArray<MobileException> | undefined =>
    exceptions?.slice(0, 5).map(exception => ({
        ...exception,
        type: redactText(exception.type),
        value: redactText(exception.value),
        ...(exception.raw_stack === undefined ? {} : { raw_stack: redactStack(exception.raw_stack) }),
        frames: exception.frames.slice(-100).map(frame => ({
            ...frame,
            filename: redactText(frame.filename),
            function: redactText(frame.function),
        })),
    }))

const sanitizeBreadcrumbs = (event: EngineEvent): EngineEvent['breadcrumbs'] =>
    event.breadcrumbs?.slice(-100).map(breadcrumb => sanitizeRecord({ value: breadcrumb }))

export const sanitizeEngineEvent = (event: EngineEvent): EngineEvent => {
    const eventWithoutForbiddenFields = Object.fromEntries(
        Object.entries(event).filter(([key]) => key !== 'request' && key !== 'server_name' && key !== 'user'),
    ) as unknown as EngineEvent
    const safeUserId = typeof event.user?.id === 'string' ? redactText(event.user.id) : undefined

    return {
        ...eventWithoutForbiddenFields,
        ...(event.message === undefined ? {} : { message: redactText(event.message) }),
        ...(event.exceptions === undefined ? {} : { exceptions: sanitizeExceptions(event.exceptions) }),
        ...(event.breadcrumbs === undefined ? {} : { breadcrumbs: sanitizeBreadcrumbs(event) }),
        ...(event.contexts === undefined ? {} : { contexts: sanitizeRecord({ value: event.contexts }) }),
        ...(event.extra === undefined ? {} : { extra: sanitizeRecord({ value: event.extra }) }),
        ...(event.tags === undefined ? {} : { tags: sanitizeRecord({ value: event.tags }) as Readonly<Record<string, string>> }),
        ...(event.span === undefined
            ? {}
            : {
                  span: {
                      ...event.span,
                      name: redactText(event.span.name),
                      attributes: sanitizeRecord({ value: event.span.attributes }),
                  },
              }),
        ...(safeUserId === undefined ? {} : { user: { id: safeUserId } }),
    }
}
