export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export const isPhone = (v: string) =>
  v.trim() === "" || /^[+\d][\d\s()-]{6,}$/.test(v.trim());

export type Errors<T> = Partial<Record<keyof T, string>>;
