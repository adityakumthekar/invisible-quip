// src/lib/utils.ts

type ClassValue = string | undefined | null | false | 0 | ""

export function cn(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(" ")
}
