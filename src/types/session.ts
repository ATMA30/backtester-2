export interface ForexSession {
  id: string;
  name: string;
  startHour: number; // UTC
  endHour: number;   // UTC
  color: string;
  enabled: boolean;
}
