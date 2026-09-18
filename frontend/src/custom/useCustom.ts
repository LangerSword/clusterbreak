import { useEffect, useState } from "react";
import type { Device, Model } from "../sim";

/** User-added devices and models, persisted in localStorage. */

const DEV_KEY = "clusterbreak.customDevices.v1";
const MOD_KEY = "clusterbreak.customModels.v1";

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function persist<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* storage full/blocked — session-only */
  }
}

export function useCustomDevices() {
  const [customDevices, setItems] = useState<Device[]>(() => load<Device>(DEV_KEY));
  useEffect(() => persist(DEV_KEY, customDevices), [customDevices]);
  const addCustomDevice = (d: Device) =>
    setItems((xs) => [...xs.filter((x) => x.id !== d.id), d]);
  const removeCustomDevice = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));
  return { customDevices, addCustomDevice, removeCustomDevice };
}

export function useCustomModels() {
  const [customModels, setItems] = useState<Model[]>(() => load<Model>(MOD_KEY));
  useEffect(() => persist(MOD_KEY, customModels), [customModels]);
  const addCustomModel = (m: Model) => setItems((xs) => [...xs.filter((x) => x.id !== m.id), m]);
  const removeCustomModel = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));
  return { customModels, addCustomModel, removeCustomModel };
}
