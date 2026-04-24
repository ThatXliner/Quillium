type EventWithType = { type: string };

export type EventOfType<TEvent extends EventWithType, TType extends TEvent["type"]> = Extract<
    TEvent,
    { type: TType }
>;

type Listener<TEvent extends EventWithType, TType extends TEvent["type"]> = (
    event: EventOfType<TEvent, TType>,
) => void;

type AnyListener<TEvent extends EventWithType> = (event: TEvent) => void;

export class TypedEventBus<TEvent extends EventWithType> {
    private listeners = new Map<TEvent["type"], Set<AnyListener<TEvent>>>();

    on<TType extends TEvent["type"]>(
        type: TType,
        listener: Listener<TEvent, TType>,
    ): () => void {
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        const fn: AnyListener<TEvent> = (event) => listener(event as EventOfType<TEvent, TType>);
        set.add(fn);
        return () => set.delete(fn);
    }

    emit(event: TEvent): void {
        const set = this.listeners.get(event.type);
        if (!set) return;
        for (const listener of set) {
            listener(event);
        }
    }
}
