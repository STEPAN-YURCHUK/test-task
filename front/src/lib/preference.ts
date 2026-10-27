// Настройка пользователя в localStorage с подпиской для useSyncExternalStore.
// apply переносит значение в DOM: при выборе и при смене настройки в другой вкладке (событие storage).
// Если записать в хранилище нельзя (приватный режим, переполнено), выбор живёт в памяти до перезагрузки.
export function createPreference<T extends string>(key: string, allowed: readonly T[], fallback: T, apply: (value: T) => void) {
  const listeners = new Set<() => void>();
  let memory: T | null = null;
  let storageBound = false;

  const get = (): T => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      if (stored && allowed.includes(stored)) return stored;
    } catch {
      // читаем из памяти
    }
    return memory ?? fallback;
  };

  const notify = () => listeners.forEach((listener) => listener());

  const set = (value: T) => {
    try {
      localStorage.setItem(key, value);
      memory = null;
    } catch {
      memory = value;
    }
    apply(value);
    notify();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!storageBound) {
      storageBound = true;
      window.addEventListener('storage', (e) => {
        if (e.key !== key) return;
        apply(get());
        notify();
      });
    }
    return () => void listeners.delete(listener);
  };

  return { get, set, subscribe, getServer: () => fallback };
}
