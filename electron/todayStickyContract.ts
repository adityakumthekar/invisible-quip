import type { TaskChange, TodaySnapshot } from "./dailyTaskContract";
export interface TodayStickyAPI {
  snapshot(): Promise<TodaySnapshot>;
  changeTask(value: TaskChange): Promise<void>;
  hide(): Promise<void>;
  openToday(): Promise<void>;
  privacy(): Promise<{ captureProtection: boolean }>;
  onChange(callback: (value: TodaySnapshot) => void): () => void;
}
