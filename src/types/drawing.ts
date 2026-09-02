export type DrawingTool =
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'hline'
  | 'vline'
  | 'rect'
  | 'channel'
  | 'fib'
  | 'brush'
  | 'text'
  | 'pos_long'
  | 'pos_short';

export interface Point {
  time: number;
  price: number;
  _x?: number;
  _y?: number;
}

export interface DrawingStyle {
  color: string;
  width: number;
  fill?: string;
  fillOpacity?: number;
  dash?: number[];
  fontSize?: number;
  text?: string;
  riskReward?: number;
}

export interface Drawing {
  id: string;
  type: DrawingTool;
  pts: Point[];
  style: DrawingStyle;
  locked?: boolean;
  hidden?: boolean;
}

export interface Handle {
  ptIdx: number | string;
  axis: 'x' | 'y' | 'xy' | 'x0' | 'x1' | 'y0' | 'y1' | 'w' | 'rot' | 'time';
  x: number;
  y: number;
}
