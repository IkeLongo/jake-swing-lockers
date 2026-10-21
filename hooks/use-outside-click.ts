"use client";

import { useEffect, type RefObject } from "react";

type OutsideClickEvent = MouseEvent | TouchEvent;

export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  callback: (event: OutsideClickEvent) => void,
): void {
  useEffect(() => {
    function listener(event: OutsideClickEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!ref.current || ref.current.contains(target)) return;
      callback(event);
    }

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, callback]);
}
