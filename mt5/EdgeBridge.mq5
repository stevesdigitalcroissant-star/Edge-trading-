//+------------------------------------------------------------------+
//| EdgeBridge.mq5 — Edge ↔ MetaTrader 5                              |
//| Places the trades you send from the Edge app (with stop, target   |
//| and a lot size worked out from your risk) and reports your        |
//| account, open trades and closed trades back to Edge's journal.    |
//| Edge never logs in to your broker: this EA holds the connection.  |
//|                                                                   |
//| Setup: Tools → Options → Expert Advisors → tick "Allow algorithmic|
//| trading" and "Allow WebRequest for listed URL", add your Edge     |
//| address. Drag EdgeBridge onto ONE chart, paste the MT5 key from   |
//| Edge → Settings → MetaTrader 5, turn on Algo Trading.             |
//+------------------------------------------------------------------+
#property copyright "Edge"
#property version   "1.00"
#property description "Places the trades you send from Edge and reports your account back."

#include <Trade/Trade.mqh>

input string EdgeUrl      = "https://edge-trading-steel.vercel.app"; // Edge address (add it to the WebRequest list too)
input string EdgeKey      = "";      // MT5 key from Edge → Settings → MetaTrader 5
input string SymbolPrefix = "";      // only if your broker's symbols start with something, e.g. "m"
input string SymbolSuffix = "";      // only if your broker's symbols end with something, e.g. ".x" for EURUSD.x
input double MaxRiskUSD   = 100;     // safety: refuse any order that would risk more than this
input long   Magic        = 77001;   // tag on Edge's orders

CTrade   trade;
string   g_acks = "";           // acks waiting to be reported (JSON objects, comma-separated)
string   g_done[];              // command ids already handled (never place the same order twice)
string   g_doneAck[];           // the ack for each, re-sent if Edge asks again
datetime g_lastCall = 0;
datetime g_closedSince = 0;     // closed trades already reported up to this time
datetime g_warned = 0;

int OnInit()
  {
   if(StringLen(EdgeKey) < 10)
     {
      Alert("EdgeBridge: paste your MT5 key from Edge → Settings → MetaTrader 5 into the EA inputs.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   trade.SetExpertMagicNumber(Magic);
   trade.SetDeviationInPoints(20);
   g_closedSince = TimeCurrent() - 3 * 86400;
   EventSetTimer(1);
   Print("EdgeBridge: connected to ", EdgeUrl, " — waiting for trades from Edge.");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }

// every 5 s with a trade or order open, every 20 s when flat, every 60 s at the weekend
void OnTimer()
  {
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   int every = (t.day_of_week == 0 || t.day_of_week == 6) ? 60 : (PositionsTotal() + OrdersTotal() > 0 ? 5 : 20);
   if(StringLen(g_acks) > 0) every = 1;
   if(TimeLocal() - g_lastCall < every) return;
   g_lastCall = TimeLocal();
   Cycle();
  }

//+------------------------------------------------------------------+
string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return(s);
  }
string Num(double v, int d) { return(DoubleToString(v, d)); }
// MT5 times are the broker's server time; Edge wants real UTC
long Utc(long serverTime) { return(serverTime + (long)(TimeGMT() - TimeTradeServer())); }

int Http(string body, string &out)
  {
   char data[], result[];
   string resHeaders;
   string headers = "Authorization: Bearer " + EdgeKey + "\r\nContent-Type: application/json\r\n";
   int n = StringToCharArray(body, data, 0, -1, CP_UTF8);
   if(n > 0) ArrayResize(data, n - 1); // drop the trailing 0
   ResetLastError();
   int code = WebRequest("POST", EdgeUrl + "/api/mt5", headers, 8000, data, result, resHeaders);
   if(code == -1)
     {
      if(TimeLocal() - g_warned > 300)
        {
         Print("EdgeBridge: can't reach Edge (error ", GetLastError(), "). Add ", EdgeUrl, " in Tools → Options → Expert Advisors → Allow WebRequest for listed URL.");
         g_warned = TimeLocal();
        }
      return(-1);
     }
   out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200 && TimeLocal() - g_warned > 300)
     {
      Print("EdgeBridge: Edge answered ", code, ": ", out);
      g_warned = TimeLocal();
     }
   return(code);
  }

//+------------------------------------------------------------------+
//| one cycle: report to Edge, place whatever Edge sends back          |
//+------------------------------------------------------------------+
void Cycle()
  {
   string out;
   datetime upTo = TimeCurrent();
   string sentAcks = g_acks;
   int code = Http(Report(upTo), out);
   if(code != 200) return;
   if(StringLen(sentAcks) > 0) g_acks = StringSubstr(g_acks, StringLen(sentAcks)); // keep acks added meanwhile
   if(StringGetCharacter(g_acks, 0) == ',') g_acks = StringSubstr(g_acks, 1);
   g_closedSince = upTo;
   string lines[];
   int n = StringSplit(out, '\n', lines);
   for(int i = 0; i < n; i++)
     {
      string ln = lines[i];
      StringTrimLeft(ln);
      StringTrimRight(ln);
      if(StringLen(ln) > 3) Handle(ln);
     }
  }

void Handle(string ln)
  {
   string f[];
   int n = StringSplit(ln, '|', f);
   if(n < 3) return;
   string id = f[0];
   for(int i = 0; i < ArraySize(g_done); i++)
      if(g_done[i] == id) { AddAck(g_doneAck[i]); return; } // already done: just confirm again
   if(f[1] == "open" && n >= 9)
      Open(id, f[2], f[3], f[4], StringToDouble(f[5]), StringToDouble(f[6]), StringToDouble(f[7]), StringToDouble(f[8]));
   else if(f[1] == "close")
     {
      bool ok = trade.PositionClose((ulong)StringToInteger(f[2]));
      Ack(id, ok, (ulong)StringToInteger(f[2]), 0, ok ? "" : trade.ResultRetcodeDescription());
     }
   else if(f[1] == "cancel")
     {
      bool ok = trade.OrderDelete((ulong)StringToInteger(f[2]));
      Ack(id, ok, (ulong)StringToInteger(f[2]), 0, ok ? "" : trade.ResultRetcodeDescription());
     }
  }

// lots so that hitting the stop loses `risk` in the account currency
double Lots(string s, double dist, double risk)
  {
   double tv = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE);
   if(tv <= 0 || ts <= 0 || dist <= 0) return(0);
   double perLot = dist / ts * tv;
   double step = SymbolInfoDouble(s, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(s, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(s, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   double lots = MathFloor(risk / perLot / step) * step;
   if(lots < vmin) return(0);
   return(NormalizeDouble(MathMin(lots, vmax), 2));
  }

void Open(string id, string sym, string side, string type, double entry, double sl, double tp, double risk)
  {
   if(!SymbolSelect(sym, true)) { Ack(id, false, 0, 0, "Unknown symbol " + sym + " - set SymbolPrefix / SymbolSuffix in the EA inputs"); return; }
   if(risk > MaxRiskUSD) { Ack(id, false, 0, 0, "Risk $" + Num(risk, 2) + " is above MaxRiskUSD in the EA inputs"); return; }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK), bid = SymbolInfoDouble(sym, SYMBOL_BID);
   bool buy = (side == "buy");
   // a limit that price has already passed becomes a market order (at the real price, sized for the real stop)
   bool market = (type == "market") || (buy && entry >= ask) || (!buy && entry <= bid) || entry <= 0;
   double price = market ? (buy ? ask : bid) : entry;
   price = NormalizeDouble(price, digits);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);
   if(buy ? (sl >= price || tp <= price) : (sl <= price || tp >= price)) { Ack(id, false, 0, 0, "Stop / target on the wrong side of the price " + Num(price, digits)); return; }
   double lots = Lots(sym, MathAbs(price - sl), risk);
   if(lots <= 0) { Ack(id, false, 0, 0, "Even the smallest lot risks more than $" + Num(risk, 2) + " with this stop"); return; }
   string cm = "edge:" + id;
   bool ok;
   if(market) ok = buy ? trade.Buy(lots, sym, 0, sl, tp, cm) : trade.Sell(lots, sym, 0, sl, tp, cm);
   else       ok = buy ? trade.BuyLimit(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, cm) : trade.SellLimit(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, cm);
   uint rc = trade.ResultRetcode();
   if(ok && (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL))
      Ack(id, true, market ? trade.ResultDeal() : trade.ResultOrder(), lots, "");
   else
      Ack(id, false, 0, lots, trade.ResultRetcodeDescription());
  }

void AddAck(string a) { g_acks = (StringLen(g_acks) > 0 ? g_acks + "," : "") + a; }
void Ack(string id, bool ok, ulong ticket, double lots, string err)
  {
   string a = "{\"id\":\"" + Esc(id) + "\",\"ok\":" + (ok ? "true" : "false") + ",\"ticket\":\"" + IntegerToString((long)ticket) + "\",\"volume\":" + Num(lots, 2) + ",\"err\":\"" + Esc(err) + "\"}";
   int k = ArraySize(g_done);
   ArrayResize(g_done, k + 1);
   ArrayResize(g_doneAck, k + 1);
   g_done[k] = id;
   g_doneAck[k] = a;
   AddAck(a);
   Print("EdgeBridge: ", ok ? "done " : "refused ", id, " ", err);
  }

//+------------------------------------------------------------------+
//| the report: account, open trades, pending orders, closed trades   |
//+------------------------------------------------------------------+
string Report(datetime upTo)
  {
   string j = "{\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
            + ",\"server\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\""
            + ",\"currency\":\"" + Esc(AccountInfoString(ACCOUNT_CURRENCY)) + "\""
            + ",\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE), 2)
            + ",\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY), 2)
            + ",\"dayPnl\":" + Num(DayPnl(), 2)
            + ",\"prefix\":\"" + Esc(SymbolPrefix) + "\",\"suffix\":\"" + Esc(SymbolSuffix) + "\"";
   // open trades
   j += ",\"positions\":[";
   int np = PositionsTotal(), w = 0;
   for(int i = 0; i < np; i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      string s = PositionGetString(POSITION_SYMBOL);
      int d = (int)SymbolInfoInteger(s, SYMBOL_DIGITS);
      j += (w++ > 0 ? "," : "") + "{\"ticket\":\"" + IntegerToString((long)t) + "\",\"symbol\":\"" + Esc(s) + "\""
         + ",\"type\":\"" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "buy" : "sell") + "\""
         + ",\"volume\":" + Num(PositionGetDouble(POSITION_VOLUME), 2)
         + ",\"open\":" + Num(PositionGetDouble(POSITION_PRICE_OPEN), d)
         + ",\"sl\":" + Num(PositionGetDouble(POSITION_SL), d) + ",\"tp\":" + Num(PositionGetDouble(POSITION_TP), d)
         + ",\"profit\":" + Num(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2)
         + ",\"time\":" + IntegerToString(Utc((long)PositionGetInteger(POSITION_TIME)))
         + ",\"comment\":\"" + Esc(PositionGetString(POSITION_COMMENT)) + "\"}";
     }
   // pending orders
   j += "],\"orders\":[";
   int no = OrdersTotal(); w = 0;
   for(int i = 0; i < no; i++)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      string s = OrderGetString(ORDER_SYMBOL);
      int d = (int)SymbolInfoInteger(s, SYMBOL_DIGITS);
      ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      bool sell = (ot == ORDER_TYPE_SELL_LIMIT || ot == ORDER_TYPE_SELL_STOP || ot == ORDER_TYPE_SELL_STOP_LIMIT);
      j += (w++ > 0 ? "," : "") + "{\"ticket\":\"" + IntegerToString((long)t) + "\",\"symbol\":\"" + Esc(s) + "\""
         + ",\"type\":\"" + (sell ? "sell_limit" : "buy_limit") + "\""
         + ",\"volume\":" + Num(OrderGetDouble(ORDER_VOLUME_CURRENT), 2)
         + ",\"price\":" + Num(OrderGetDouble(ORDER_PRICE_OPEN), d)
         + ",\"sl\":" + Num(OrderGetDouble(ORDER_SL), d) + ",\"tp\":" + Num(OrderGetDouble(ORDER_TP), d)
         + ",\"comment\":\"" + Esc(OrderGetString(ORDER_COMMENT)) + "\"}";
     }
   j += "],\"closed\":[" + Closed(upTo) + "],\"acks\":[" + g_acks + "]}";
   return(j);
  }

// profit closed today (server day) + what's open now
double DayPnl()
  {
   datetime now = TimeCurrent(), dayStart = now - (now % 86400);
   double p = 0;
   if(HistorySelect(dayStart, now + 60))
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
        {
         ulong d = HistoryDealGetTicket(i);
         ENUM_DEAL_TYPE dt = (ENUM_DEAL_TYPE)HistoryDealGetInteger(d, DEAL_TYPE);
         if(dt != DEAL_TYPE_BUY && dt != DEAL_TYPE_SELL) continue; // skip deposits and payouts
         p += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP);
        }
   for(int i = 0; i < PositionsTotal(); i++)
      if(PositionGetTicket(i) > 0) p += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   return(p);
  }

// trades closed since the last report: one object per position, from its entry and exit deals
string Closed(datetime upTo)
  {
   if(!HistorySelect(TimeCurrent() - 4 * 86400, upTo + 60)) return("");
   long   pid[]; double op[], vol[], cp[], prof[]; long ot[], ct[]; string sym[], typ[], cmt[];
   int n = HistoryDealsTotal(), k = 0;
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      ENUM_DEAL_TYPE dt = (ENUM_DEAL_TYPE)HistoryDealGetInteger(d, DEAL_TYPE);
      if(dt != DEAL_TYPE_BUY && dt != DEAL_TYPE_SELL) continue;
      long p = HistoryDealGetInteger(d, DEAL_POSITION_ID);
      ENUM_DEAL_ENTRY en = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(d, DEAL_ENTRY);
      int at = -1;
      for(int x = 0; x < k; x++) if(pid[x] == p) { at = x; break; }
      if(at < 0)
        {
         at = k++;
         ArrayResize(pid, k); ArrayResize(op, k); ArrayResize(vol, k); ArrayResize(cp, k); ArrayResize(prof, k);
         ArrayResize(ot, k); ArrayResize(ct, k); ArrayResize(sym, k); ArrayResize(typ, k); ArrayResize(cmt, k);
         pid[at] = p; op[at] = 0; vol[at] = 0; cp[at] = 0; prof[at] = 0; ot[at] = 0; ct[at] = 0; sym[at] = HistoryDealGetString(d, DEAL_SYMBOL); typ[at] = ""; cmt[at] = "";
        }
      prof[at] += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP);
      if(en == DEAL_ENTRY_IN)
        {
         op[at] = HistoryDealGetDouble(d, DEAL_PRICE);
         vol[at] = HistoryDealGetDouble(d, DEAL_VOLUME);
         ot[at] = (long)HistoryDealGetInteger(d, DEAL_TIME);
         typ[at] = (dt == DEAL_TYPE_BUY ? "buy" : "sell");
         cmt[at] = HistoryDealGetString(d, DEAL_COMMENT);
        }
      else if(en == DEAL_ENTRY_OUT || en == DEAL_ENTRY_OUT_BY)
        {
         cp[at] = HistoryDealGetDouble(d, DEAL_PRICE);
         ct[at] = (long)HistoryDealGetInteger(d, DEAL_TIME);
        }
     }
   string j = "";
   int w = 0;
   for(int x = 0; x < k; x++)
     {
      if(ct[x] == 0 || ot[x] == 0 || ct[x] <= (long)g_closedSince) continue; // still open, or already reported
      if(PositionSelectByTicket((ulong)pid[x])) continue;                       // partly closed: wait for the end
      int d = (int)SymbolInfoInteger(sym[x], SYMBOL_DIGITS);
      j += (w++ > 0 ? "," : "") + "{\"position\":\"" + IntegerToString(pid[x]) + "\",\"symbol\":\"" + Esc(sym[x]) + "\",\"type\":\"" + typ[x] + "\""
         + ",\"volume\":" + Num(vol[x], 2) + ",\"open\":" + Num(op[x], d) + ",\"close\":" + Num(cp[x], d) + ",\"profit\":" + Num(prof[x], 2)
         + ",\"openTime\":" + IntegerToString(Utc(ot[x])) + ",\"closeTime\":" + IntegerToString(Utc(ct[x])) + ",\"comment\":\"" + Esc(cmt[x]) + "\"}";
     }
   return(j);
  }
//+------------------------------------------------------------------+
