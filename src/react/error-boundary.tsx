import { Component, createElement } from 'react'

import { captureException } from '../api/runtime.js'
import type { InkronikErrorBoundaryProps, InkronikErrorBoundaryState, WrapInput } from '../types.js'

export class ErrorBoundary extends Component<InkronikErrorBoundaryProps, InkronikErrorBoundaryState> {
    public state: InkronikErrorBoundaryState = {}

    public static getDerivedStateFromError(error: Error): InkronikErrorBoundaryState {
        return { error }
    }

    public componentDidCatch(error: Error, info: React.ErrorInfo): void {
        try {
            this.props.beforeCapture?.(error, info)
        } catch {
            // A host callback must not prevent the original React error from being captured.
        }

        captureException({
            error,
            context: {
                contexts: { react: { component_stack: info.componentStack ?? '' } },
                tags: { 'inkronik.mechanism': 'react.error-boundary' },
            },
        })

        try {
            this.props.onError?.(error, info)
        } catch {
            // Error reporting callbacks must not break fallback rendering.
        }
    }

    public render(): React.ReactNode {
        const { error } = this.state

        if (error === undefined) {
            return this.props.children
        }

        return typeof this.props.fallback === 'function' ? createElement(this.props.fallback, { error }) : this.props.fallback
    }
}

export const wrap = <TProps extends object>({ component: RootComponent, fallback }: WrapInput<TProps>): React.ComponentType<TProps> => {
    const WrappedComponent = (props: TProps) =>
        createElement(ErrorBoundary, { fallback }, createElement(RootComponent, props as TProps & React.Attributes))

    return WrappedComponent
}
