export let dragCount = 0;

// NOTE: We COULD use setPointerCapture, however... we are only doing dragging, so the only mouse events
//  we would be stopping other handlers from receiving would be mouse movement, which... isn't that important.

export function performDrag2(
    config: {
        e: MouseEvent;
        onMove?: (offset: { x: number, y: number }) => void;
        /** If not passedSlop, we do not call finish */
        onDone?: (offset: { x: number, y: number }) => void;
        /** If not passedSlop, it means it was considered a click. */
        onFinally?: (passedSlop: boolean) => void;
        // Defaults to 5
        slop?: number;
    }
) {
    let { e, onDone, onFinally } = config;
    let slop = config.slop ?? 5;
    let onMove = config.onMove ?? (() => { });
    dragCount++;

    let startMouseX = e.clientX;
    let startMouseY = e.clientY;
    let lastMouseX = e.clientX;
    let lastMouseY = e.clientY;

    let passedSlop = slop ? false : true;

    let finished = false;
    function triggerMove() {
        let deltaX = lastMouseX - startMouseX;
        let deltaY = lastMouseY - startMouseY;
        if (slop) {
            let dist = Math.sqrt(deltaX ** 2 + deltaY ** 2);
            if (dist > slop) passedSlop = true;
            if (!passedSlop) return;
        }
        onMove({ x: deltaX, y: deltaY });
    }

    const onMouseMove = (e: MouseEvent) => {
        if (finished) return;
        if (lastMouseX === e.clientX && lastMouseY === e.clientY) return;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        triggerMove();
    };
    let finish = () => {
        try {
            if (finished) return;
            finished = true;
            dragCount--;
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", finish);
            document.removeEventListener("keydown", keyDown);
            triggerMove();
            if (onDone) {
                let deltaX = lastMouseX - startMouseX;
                let deltaY = lastMouseY - startMouseY;
                if (slop) {
                    let dist = Math.sqrt(deltaX ** 2 + deltaY ** 2);
                    if (dist > slop) passedSlop = true;
                    if (!passedSlop) return;
                }
                onDone({ x: deltaX, y: deltaY });
            }
        } finally {
            // NOTE: Wait, otherwise our synchronous triggering causes issues
            //  - I BELIEVE the mouseup happens before the click, and so we re-render and
            //      the click gets owned by a different node, breaking things. We can't
            //      even wait a microtick, as apparently the click happens even after that.
            //      - We also can't fix this at a framework level, as re-renders CANNOT
            //          be delayed by a full tick, as then we're basically halving our framerate.
            setTimeout(() => {
                onFinally?.(passedSlop);
            });
        }
    };

    const keyDown = (e: KeyboardEvent) => {
        if (finished) return;
        if (e.code === "Escape") {
            lastMouseX = startMouseX;
            lastMouseY = startMouseY;
            finish();
        }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", finish);
    document.addEventListener("keydown", keyDown);

    // Trigger a move right away
    if (!slop) {
        onMove({ x: 0, y: 0 });
    }
}