//+------------------------------------------------------------------+
//| EdgeLots.mq5 — exact lot size for your $ risk, on the chart      |
//| Drag the blue ENTRY line and the red STOP line: the panel shows   |
//| the lots (rounded DOWN to your broker's lot step), the pips, the  |
//| $ you really risk and the 1:3 target. Uses your broker's own tick |
//| value, so it is exact for every pair, metal and index.            |
//| Install: put it in MQL5/Indicators, Refresh, drag onto a chart.   |
//+------------------------------------------------------------------+
#property copyright "Edge"
#property version   "1.00"
#property description "Exact lot size: drag ENTRY and STOP, read the lots."
#property indicator_chart_window
#property indicator_plots 0

input double RiskUSD   = 25;    // $ you want to risk on the trade
input double RewardR   = 3;     // target, in R (draws the target line)

string ENTRY = "EdgeLots_Entry", STOP = "EdgeLots_Stop", TARGET = "EdgeLots_Target";

int OnInit()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double atr = (iHigh(_Symbol, PERIOD_M15, 1) - iLow(_Symbol, PERIOD_M15, 1));
   if(atr <= 0) atr = bid * 0.002;
   MakeLine(ENTRY, bid, clrDodgerBlue, true);
   MakeLine(STOP, bid - atr * 2, clrTomato, true);
   MakeLine(TARGET, bid + atr * 2 * RewardR, clrMediumSeaGreen, false);
   Update();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   ObjectDelete(0, ENTRY); ObjectDelete(0, STOP); ObjectDelete(0, TARGET);
   Comment("");
  }

int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[])
  {
   Update();
   return(rates_total);
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id == CHARTEVENT_OBJECT_DRAG || id == CHARTEVENT_OBJECT_CHANGE) Update();
  }

void MakeLine(string name, double price, color c, bool movable)
  {
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, name, OBJPROP_STYLE, movable ? STYLE_SOLID : STYLE_DASH);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, movable);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, movable);
  }

// lots so that hitting the stop loses RiskUSD (account currency), rounded DOWN to the lot step
void Update()
  {
   if(ObjectFind(0, ENTRY) < 0 || ObjectFind(0, STOP) < 0) return;
   double e = ObjectGetDouble(0, ENTRY, OBJPROP_PRICE), s = ObjectGetDouble(0, STOP, OBJPROP_PRICE);
   double dist = MathAbs(e - s);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double pip = (digits == 3 || digits == 5) ? _Point * 10 : _Point;
   string txt;
   if(dist <= 0 || tv <= 0 || ts <= 0) txt = "EdgeLots: move the STOP away from the ENTRY";
   else
     {
      double perLot = dist / ts * tv;                                  // $ lost at the stop with 1 lot
      double lots = MathFloor(RiskUSD / perLot / step + 1e-9) * step;
      bool wide = lots < vmin;
      if(lots > vmax) lots = vmax;
      double target = e + (e > s ? 1 : -1) * dist * RewardR;
      ObjectSetDouble(0, TARGET, OBJPROP_PRICE, target);
      txt = StringFormat("EdgeLots — %s %s\nLOTS: %s\nStop: %.1f pips  ·  $%.2f a pip per lot\nRisk at these lots: $%.2f (of $%.2f)\nEntry %s  ·  Stop %s  ·  1:%.0f target %s",
                         _Symbol, (e > s ? "BUY" : "SELL"),
                         wide ? "stop too wide — even the smallest lot risks $" + DoubleToString(vmin * perLot, 2) : DoubleToString(lots, 2),
                         dist / pip, pip / ts * tv, wide ? 0.0 : lots * perLot, RiskUSD,
                         DoubleToString(e, digits), DoubleToString(s, digits), RewardR, DoubleToString(target, digits));
     }
   Comment(txt);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
