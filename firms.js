// Prop firm rules, 50K accounts — gathered from each firm's help center (Oct 2026). Firms change rules often:
// every number is editable in Settings, and the source link is shown next to the firm.
(function (root) {
  const FIRMS = {
 "tradeify": {
  "name": "Tradeify",
  "api": "Allowed (your own setup, used only at Tradeify)",
  "plans": {
   "growth": {
    "name": "Growth 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": 1250,
     "consistencyPct": null,
     "minDays": 1,
     "maxMicros": 40
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": 1250,
     "consistencyPct": 35,
     "maxMicros": 40,
     "payout": {
      "minDays": 5,
      "minWinningDays": 5,
      "minWinningDayProfit": 150,
      "buffer": 3000,
      "cap": 1500,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "Daily loss limit pauses the day. Funded: payout after 5 days of $150+, balance \u2265 $53,000.",
    "src": "https://help.tradeify.co/en/articles/10495915-growth-evaluation-accounts"
   },
   "select-flex": {
    "name": "Select 50K \u00b7 Flex payouts",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 40,
     "minDays": 3,
     "maxMicros": 40
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": 40,
     "payout": {
      "minDays": 5,
      "minWinningDays": 5,
      "minWinningDayProfit": 150,
      "buffer": 0,
      "cap": 2500,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "40% consistency in the evaluation; 3 days minimum. Payout: up to 50% of profit, every 5 winning days.",
    "src": "https://help.tradeify.co/en/articles/12853921-select-evaluation-accounts"
   },
   "select-daily": {
    "name": "Select 50K \u00b7 Daily payouts",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 40,
     "minDays": 3,
     "maxMicros": 40
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": 1000,
     "consistencyPct": null,
     "maxMicros": 40,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2100,
      "cap": 1250,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "Daily payouts once above the $2,100 buffer (up to 2\u00d7 the cycle's profit).",
    "src": "https://help.tradeify.co/en/articles/12853966-select-flex-and-select-daily-payout-policies"
   },
   "lightning": {
    "name": "Lightning 50K (instant funded)",
    "eval": null,
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": 1250,
     "consistencyPct": 20,
     "maxMicros": 40,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 3000,
      "cap": 2000,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "No evaluation. First payout at $3,000 profit with the 20% consistency rule.",
    "src": "https://help.tradeify.co/en/articles/10495938-lightning-funded-accounts"
   }
  }
 },
 "phidias": {
  "name": "Phidias",
  "api": "Not allowed \u2014 fully automated trading is banned (place the orders yourself)",
  "plans": {
   "e2l": {
    "name": "Express to Live 50K",
    "eval": {
     "target": 2500,
     "dd": 650,
     "ddType": "static",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": null,
     "minDays": 0,
     "maxMicros": 50
    },
    "funded": {
     "dd": null,
     "ddType": "static",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": 30,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 0,
      "cap": 2000,
      "split": "",
      "processingDays": 1
     }
    },
    "note": "Tiny $650 static drawdown. One $2,000 bonus payout, then the account goes LIVE.",
    "src": "https://phidiaspropfirm.com/rules"
   },
   "fundamental": {
    "name": "Fundamental 50K",
    "eval": {
     "target": 4000,
     "dd": 2500,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": null,
     "minDays": 3,
     "maxMicros": 100
    },
    "funded": {
     "dd": 2500,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": 30,
     "maxMicros": 100,
     "payout": {
      "minDays": 10,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2600,
      "cap": 2000,
      "split": "80/20",
      "processingDays": 1
     }
    },
    "note": "Intraday only. Withdraw above $52,600.",
    "src": "https://phidiaspropfirm.com/rules"
   },
   "premium": {
    "name": "Premium 50K",
    "eval": {
     "target": 4000,
     "dd": 2500,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": null,
     "minDays": 1,
     "maxMicros": 100
    },
    "funded": {
     "dd": 2500,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": 30,
     "maxMicros": 100,
     "payout": {
      "minDays": 5,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2600,
      "cap": 2000,
      "split": "75/25 \u2192",
      "processingDays": 1
     }
    },
    "note": "Overnight / weekend holds allowed. Withdraw above $52,600.",
    "src": "https://phidiaspropfirm.com/rules"
   }
  }
 },
 "mffu": {
  "name": "MyFundedFutures",
  "api": "Allowed (your own settings, no HFT)",
  "plans": {
   "rapid": {
    "name": "Rapid 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 50,
     "minDays": 2,
     "maxMicros": 50
    },
    "funded": {
     "dd": 2000,
     "ddType": "intraday",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": 50,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2100,
      "cap": null,
      "split": "90/10",
      "processingDays": 1
     }
    },
    "note": "50% consistency in the evaluation (not a breach \u2014 you keep trading until it's met). Funded drawdown trails intraday. Daily payouts.",
    "src": "https://help.myfundedfutures.com/en/articles/13134709-rapid-plan-50k-a-comprehensive-look"
   },
   "rapid-eod": {
    "name": "Rapid EOD 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 30,
     "minDays": 4,
     "maxMicros": 30
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": 30,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2100,
      "cap": null,
      "split": "90/10",
      "processingDays": 1
     }
    },
    "note": "30% consistency, 4 days minimum. End-of-day drawdown when funded. Daily payouts.",
    "src": "https://help.myfundedfutures.com/en/articles/16158363-rapid-eod-50k-a-comprehensive-look"
   },
   "pro": {
    "name": "Pro 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 50,
     "minDays": 2,
     "maxMicros": null
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": null,
     "payout": {
      "minDays": 14,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2100,
      "cap": null,
      "split": "80/20",
      "processingDays": 1
     }
    },
    "note": "Payouts every 14 days.",
    "src": "https://help.myfundedfutures.com/en/articles/11802674-pro-plan-sim-funded-and-live-account-highlights"
   },
   "builder25": {
    "name": "Builder 25K",
    "eval": {
     "target": 1500,
     "dd": 1000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": 600,
     "consistencyPct": null,
     "minDays": 1,
     "maxMicros": 20,
     "inactivityDays": 7
    },
    "funded": {
     "dd": 1000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": 600,
     "consistencyPct": 50,
     "maxMicros": 20,
     "payout": {
      "minDays": 2,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 1100,
      "cap": 1000,
      "split": "80/20",
      "processingDays": 1
     }
    },
    "note": "$600 daily loss limit, 2 contracts (20 micros), trade at least every 7 calendar days. Min payout $250.",
    "src": "https://myfundedfutures.com"
   },
   "builder": {
    "name": "Builder 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": 1000,
     "consistencyPct": null,
     "minDays": 1,
     "maxMicros": 40
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": 1000,
     "consistencyPct": 50,
     "maxMicros": 40,
     "payout": {
      "minDays": 2,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2600,
      "cap": 2000,
      "split": "80/20",
      "processingDays": 1
     }
    },
    "note": "$1,000 daily loss pause. First payout needs $500 above the buffer.",
    "src": "https://help.myfundedfutures.com/en/articles/14290805-builder-plan-50k-a-comprehensive-guide"
   }
  }
 },
 "lucid": {
  "name": "Lucid Trading",
  "api": "Allowed (automation and copiers; no HFT)",
  "plans": {
   "pro": {
    "name": "LucidPro 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": 1200,
     "consistencyPct": null,
     "minDays": 0,
     "maxMicros": 40
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": 1200,
     "consistencyPct": 40,
     "maxMicros": 40,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 2100,
      "cap": 2000,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "Optional $1,200 daily loss (soft). Funded: 40% consistency, $500 profit goal per cycle.",
    "src": "https://support.lucidtrading.com/en/articles/12890029-lucidpro-evaluation-account"
   },
   "flex": {
    "name": "LucidFlex 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 50,
     "minDays": 0,
     "maxMicros": null
    },
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": 40,
     "payout": {
      "minDays": 5,
      "minWinningDays": 5,
      "minWinningDayProfit": 150,
      "buffer": 0,
      "cap": 2000,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "50% consistency in the evaluation. Funded: payout every 5 days of $150+ (up to 50% of profit).",
    "src": "https://support.lucidtrading.com/en/articles/12945790-lucidflex-evaluation-account"
   },
   "direct": {
    "name": "LucidDirect 50K (instant funded)",
    "eval": null,
    "funded": {
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": 50100,
     "dailyLoss": 1200,
     "consistencyPct": 20,
     "maxMicros": 40,
     "payout": {
      "minDays": 10,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": 3000,
      "cap": null,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "No evaluation. First payout at $3,000 profit after 10 days, 20% consistency.",
    "src": "https://lucidtrading.com/product/luciddirect-50k/"
   },
   "daily": {
    "name": "LucidDaily 50K",
    "eval": {
     "target": 3000,
     "dd": 2000,
     "ddType": "eod",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": 50,
     "minDays": 0,
     "maxMicros": null
    },
    "funded": {
     "dd": 2000,
     "ddType": "intraday",
     "ddLockAt": null,
     "dailyLoss": null,
     "consistencyPct": null,
     "maxMicros": null,
     "payout": {
      "minDays": 0,
      "minWinningDays": 0,
      "minWinningDayProfit": 0,
      "buffer": null,
      "cap": null,
      "split": "90/10",
      "processingDays": 2
     }
    },
    "note": "\u26a0 Trading red-folder USD news is a hard breach \u2014 flat 1 minute either side. Daily payouts.",
    "src": "https://support.lucidtrading.com/en/articles/15996664-luciddaily-evaluation"
   }
  }
 }
};
  if (typeof module !== "undefined" && module.exports) module.exports = FIRMS;
  if (root) { root.EdgeFirms = FIRMS; if (root.EdgeProp) root.EdgeProp.setFirms(FIRMS); }
})(typeof window !== "undefined" ? window : null);
