import { createSignal, onCleanup } from "solid-js";

export interface PaneResizerProps {
  readonly onResize: (deltaX: number) => void;
  readonly onDragEnd?: () => void;
  readonly ariaLabel?: string;
  readonly ariaValueNow?: number;
  readonly ariaValueMin?: number;
  readonly ariaValueMax?: number;
}

const keyboardStep = 20;

export function PaneResizer(props: PaneResizerProps) {
  const [isDragging, setIsDragging] = createSignal(false);
  let lastPointerX = 0;
  let previousBodyUserSelect: string | null = null;

  function handleMouseMove(event: MouseEvent) {
    const deltaX = event.clientX - lastPointerX;
    lastPointerX = event.clientX;
    props.onResize(deltaX);
  }

  function handleMouseUp() {
    cleanup();
    props.onDragEnd?.();
  }

  function handleTouchMove(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    if (touch === undefined) {
      return;
    }
    const deltaX = touch.clientX - lastPointerX;
    lastPointerX = touch.clientX;
    props.onResize(deltaX);
  }

  function handleTouchEnd() {
    cleanup();
    props.onDragEnd?.();
  }

  function cleanup() {
    setIsDragging(false);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", handleTouchEnd);
    if (previousBodyUserSelect !== null) {
      document.body.style.userSelect = previousBodyUserSelect;
      previousBodyUserSelect = null;
    }
  }

  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    lastPointerX = event.clientX;
    previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    setIsDragging(true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch === undefined) {
      return;
    }
    lastPointerX = touch.clientX;
    setIsDragging(true);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      props.onResize(-keyboardStep);
      props.onDragEnd?.();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      props.onResize(keyboardStep);
      props.onDragEnd?.();
      return;
    }
  };

  onCleanup(cleanup);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.ariaLabel ?? "Resize pane"}
      aria-valuenow={props.ariaValueNow}
      aria-valuemin={props.ariaValueMin}
      aria-valuemax={props.ariaValueMax}
      tabindex="0"
      class="group flex h-full w-[8px] cursor-col-resize touch-none select-none items-center justify-center"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onKeyDown={onKeyDown}
    >
      <div
        class={`h-full w-px transition-colors ${isDragging() ? "bg-ring" : "bg-border group-hover:bg-ring group-focus-visible:bg-ring"}`}
      />
    </div>
  );
}
