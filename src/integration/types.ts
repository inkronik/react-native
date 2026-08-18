export interface NodeSignal {
    readonly signal_type: string
    readonly payload: Readonly<Record<string, unknown>>
}

export interface NodeBatch {
    readonly signals: ReadonlyArray<NodeSignal>
}

export interface NodeSpanPayload {
    readonly trace_id?: string
    readonly span_id?: string
    readonly parent_span_id?: string
    readonly span_attributes?: Readonly<Record<string, unknown>>
}
