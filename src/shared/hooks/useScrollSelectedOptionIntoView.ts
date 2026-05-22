import { useEffect, useRef } from "react";

export function useScrollSelectedOptionIntoView<T extends HTMLElement>(selectedIndex: number) {
  const selectedOptionRef = useRef<T | null>(null);

  useEffect(() => {
    selectedOptionRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedIndex]);

  return selectedOptionRef;
}
