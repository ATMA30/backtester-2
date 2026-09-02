export type IndicatorType =
  | 'EMA'
  | 'SMA'
  | 'RSI'
  | 'MACD'
  | 'BB'
  | 'ATR'
  | 'SUPERTREND'
  | 'VOLUME_PROFILE';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  name: string;
  params: Record<string, any>;
  color: string;
  visible: boolean;
  pane: 'main' | 'sub';
}
