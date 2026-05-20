import {
  useCallback,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type PointerEvent,
} from "react";

type RepeatButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onPress: () => void;
  repeatDelay?: number;
  repeatInterval?: number;
};

const defaultRepeatDelay = 350;
const defaultRepeatInterval = 65;

export function RepeatButton({
  onPress,
  repeatDelay = defaultRepeatDelay,
  repeatInterval = defaultRepeatInterval,
  disabled,
  onBlur,
  onLostPointerCapture,
  onPointerCancel,
  onPointerDown,
  onPointerUp,
  ...buttonProps
}: RepeatButtonProps) {
  const onPressRef = useRef(onPress);
  const delayTimerRef = useRef<number | null>(null);
  const intervalTimerRef = useRef<number | null>(null);
  const pointerClickRef = useRef(false);

  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  const stopRepeating = useCallback(() => {
    if (delayTimerRef.current !== null) {
      window.clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }

    if (intervalTimerRef.current !== null) {
      window.clearInterval(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopRepeating, [stopRepeating]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented || disabled || event.button !== 0) return;

    pointerClickRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    stopRepeating();
    onPressRef.current();

    delayTimerRef.current = window.setTimeout(() => {
      intervalTimerRef.current = window.setInterval(() => {
        onPressRef.current();
      }, repeatInterval);
    }, repeatDelay);
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event);
    stopRepeating();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerCancel?.(event);
    pointerClickRef.current = false;
    stopRepeating();
  };

  const handleLostPointerCapture = (event: PointerEvent<HTMLButtonElement>) => {
    onLostPointerCapture?.(event);
    stopRepeating();
  };

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    onBlur?.(event);
    pointerClickRef.current = false;
    stopRepeating();
  };

  const handleClick = () => {
    if (pointerClickRef.current) {
      pointerClickRef.current = false;
      return;
    }

    onPressRef.current();
  };

  return (
    <button
      {...buttonProps}
      disabled={disabled}
      onBlur={handleBlur}
      onClick={handleClick}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    />
  );
}
