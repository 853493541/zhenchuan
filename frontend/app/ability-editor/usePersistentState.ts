"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";

const pageSessionState = new Map<string, unknown>();

export function usePersistentState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (pageSessionState.has(key)) return pageSessionState.get(key) as T;
    return initialValue;
  });

  useEffect(() => {
    pageSessionState.set(key, value);
  }, [key, value]);

  return [value, setValue];
}